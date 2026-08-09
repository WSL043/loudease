const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  DEFAULT_PARAMS,
  ProgrammeLoudnessEstimator,
  computeTargetGainDb,
  computeTransitionCeilingDb,
  energyToDb
} = require('../shared/programme-leveler-policy.js');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const FRAME_SAMPLES = Math.round(SAMPLE_RATE * 0.02);
const HISTORY_SIZE = 150;
const LOOKAHEAD_SAMPLES = Math.round(SAMPLE_RATE * 0.005);
const DELAY_LENGTH = LOOKAHEAD_SAMPLES + 1;
const BASE_CEILING_DB = -3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dbToLinear(value) {
  return 10 ** (value / 20);
}

function linearToDb(value) {
  return 20 * Math.log10(Math.max(1e-12, value));
}

function loadRuntimeProcessor() {
  let ProcessorClass = null;
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'offscreen', 'leveler-worklet.js'), 'utf8');
  const context = {
    sampleRate: SAMPLE_RATE,
    LoudEaseProgrammePolicy: require('../shared/programme-leveler-policy.js'),
    AudioWorkletProcessor: class {
      constructor() {
        this.messages = [];
        this.port = { onmessage: null, postMessage: (message) => this.messages.push(message) };
      }
    },
    registerProcessor: (_name, implementation) => { ProcessorClass = implementation; }
  };
  vm.runInNewContext(source, context, { filename: 'leveler-worklet.js' });
  return ProcessorClass;
}

class ProgrammeCandidateProcessor {
  constructor(policyParams = DEFAULT_PARAMS) {
    this.messages = [];
    this.port = {
      onmessage: (event) => this.configure(event.data || {}),
      postMessage: (message) => this.messages.push(message)
    };
    this.energyHistory = new Float64Array(HISTORY_SIZE);
    this.inputPeakHistory = new Float32Array(HISTORY_SIZE);
    this.outputEnergyHistory = new Float64Array(HISTORY_SIZE);
    this.outputPeakHistory = new Float32Array(HISTORY_SIZE);
    this.historyIndex = 0;
    this.historyCount = 0;
    this.frameSamples = 0;
    this.inputEnergySum = 0;
    this.inputPeak = 0;
    this.outputEnergySum = 0;
    this.outputPeak = 0;
    this.previousInputFramePeak = 0;
    this.filterState = new Float64Array(8);
    this.shelf = this.makeShelf(1681.974450955533, 3.999843853973347);
    this.highpass = this.makeHighpass(38.13547087602444, 0.5003270373238773);
    this.policyParams = { ...DEFAULT_PARAMS, ...policyParams };
    this.programme = new ProgrammeLoudnessEstimator(this.policyParams);
    this.programmeSnapshot = this.programme.snapshot();
    this.programmeStride = 0;
    this.delay = new Float32Array(DELAY_LENGTH);
    this.delayIndex = 0;
    this.currentGainDb = 0;
    this.targetGainDb = 0;
    this.limiterGain = 1;
    this.transitionSamples = 0;
    this.transitionCeilingDb = BASE_CEILING_DB;
    this.signalActive = false;
    this.silenceFrames = 0;
    this.cutStrength = 100;
    this.liftStrength = 100;
    this.enabled = true;
    this.playerVolumeCap = 1;
    this.playerVolumeReliable = true;
    this.respectPlayerVolume = true;
    this.playerMuted = false;
    this.sequence = 0;
    this.limitedSamples = 0;
    this.hardClippedSamples = 0;
  }

  makeHighpass(frequency, q) {
    const omega = 2 * Math.PI * frequency / SAMPLE_RATE;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    return [((1 + cosine) / 2) / a0, (-(1 + cosine)) / a0, ((1 + cosine) / 2) / a0, (-2 * cosine) / a0, (1 - alpha) / a0];
  }

  makeShelf(frequency, gainDb) {
    const amplitude = 10 ** (gainDb / 40);
    const omega = 2 * Math.PI * frequency / SAMPLE_RATE;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) * Math.SQRT2 / 2;
    const root = 2 * Math.sqrt(amplitude) * alpha;
    const a0 = (amplitude + 1) - (amplitude - 1) * cosine + root;
    return [
      amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + root) / a0,
      -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine) / a0,
      amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - root) / a0,
      2 * ((amplitude - 1) - (amplitude + 1) * cosine) / a0,
      ((amplitude + 1) - (amplitude - 1) * cosine - root) / a0
    ];
  }

  configure(message) {
    if (message.type !== 'configure') return;
    const settings = message.settings || {};
    this.enabled = settings.enabled !== false;
    this.cutStrength = clamp(Number(settings.cutStrength) || 0, 0, 100);
    this.liftStrength = clamp(Number(settings.liftStrength) || 0, 0, 100);
    this.respectPlayerVolume = settings.respectPlayerVolume !== false;
    this.playerVolumeCap = clamp(Number(message.playerVolumeCap), 0, 1);
    if (!Number.isFinite(this.playerVolumeCap)) this.playerVolumeCap = 1;
    this.playerVolumeReliable = message.playerVolumeReliable === true;
    this.playerMuted = message.playerMuted === true;
    this.port.postMessage({ type: 'configured', configSequence: Number(message.configSequence) || 0 });
  }

  resetProgramme() {
    this.programme.reset();
    this.programmeSnapshot = this.programme.snapshot();
    this.programmeStride = 0;
    this.energyHistory.fill(0);
    this.inputPeakHistory.fill(0);
    this.outputEnergyHistory.fill(0);
    this.outputPeakHistory.fill(0);
    this.historyIndex = 0;
    this.historyCount = 0;
    this.targetGainDb = 0;
    this.currentGainDb = 0;
    this.limiterGain = 1;
  }

  weightedSample(sample) {
    let x1 = this.filterState[0];
    let x2 = this.filterState[1];
    let y1 = this.filterState[2];
    let y2 = this.filterState[3];
    const y = this.shelf[0] * sample + this.shelf[1] * x1 + this.shelf[2] * x2 - this.shelf[3] * y1 - this.shelf[4] * y2;
    x2 = x1; x1 = sample; y2 = y1; y1 = y;
    const z = this.highpass[0] * y + this.highpass[1] * this.filterState[4] + this.highpass[2] * this.filterState[5] - this.highpass[3] * this.filterState[6] - this.highpass[4] * this.filterState[7];
    this.filterState[0] = x1; this.filterState[1] = x2; this.filterState[2] = y1; this.filterState[3] = y2;
    this.filterState[5] = this.filterState[4]; this.filterState[4] = y;
    this.filterState[7] = this.filterState[6]; this.filterState[6] = z;
    return z;
  }

  meanLast(history, count) {
    const available = Math.min(this.historyCount, count);
    if (!available) return 0;
    let sum = 0;
    for (let index = 0; index < available; index += 1) {
      sum += history[(this.historyIndex - 1 - index + HISTORY_SIZE) % HISTORY_SIZE];
    }
    return sum / available;
  }

  maxLast(history, count) {
    const available = Math.min(this.historyCount, count);
    let maximum = 0;
    for (let index = 0; index < available; index += 1) {
      maximum = Math.max(maximum, history[(this.historyIndex - 1 - index + HISTORY_SIZE) % HISTORY_SIZE]);
    }
    return maximum;
  }

  finishFrame() {
    const capturedEnergy = this.inputEnergySum / Math.max(1, this.frameSamples);
    const outputEnergy = this.outputEnergySum / Math.max(1, this.frameSamples);
    const volumeDb = this.playerVolumeReliable && this.respectPlayerVolume && this.playerVolumeCap > 0.001
      ? Math.min(0, linearToDb(this.playerVolumeCap))
      : 0;
    const sourceCompensation = dbToLinear(-volumeDb);
    const sourceEnergy = capturedEnergy * sourceCompensation * sourceCompensation;
    const sourcePeak = this.inputPeak * sourceCompensation;

    this.energyHistory[this.historyIndex] = sourceEnergy;
    this.inputPeakHistory[this.historyIndex] = this.inputPeak;
    this.outputEnergyHistory[this.historyIndex] = outputEnergy;
    this.outputPeakHistory[this.historyIndex] = this.outputPeak;
    this.historyIndex = (this.historyIndex + 1) % HISTORY_SIZE;
    this.historyCount = Math.min(HISTORY_SIZE, this.historyCount + 1);

    const instantDb = energyToDb(sourceEnergy);
    const momentaryEnergy = this.meanLast(this.energyHistory, 20);
    const momentaryDb = energyToDb(momentaryEnergy);
    const shortTermDb = energyToDb(this.meanLast(this.energyHistory, 150));
    const fastDb = Math.max(instantDb, energyToDb(this.meanLast(this.energyHistory, 5)));
    this.signalActive = instantDb > (this.signalActive ? -68 : -62)
      && sourcePeak > (this.signalActive ? 0.000175 : 0.00035);

    if (this.signalActive) {
      this.silenceFrames = 0;
      this.programmeStride += 1;
      if (this.historyCount >= 20 && this.programmeStride >= 5) {
        this.programmeSnapshot = this.programme.addBlock(momentaryEnergy);
        this.programmeStride = 0;
      }
      const ceilingDb = BASE_CEILING_DB + volumeDb;
      const control = computeTargetGainDb({
        enabled: this.enabled,
        signalActive: true,
        cutStrength: this.cutStrength,
        liftStrength: this.liftStrength,
        programmeDb: this.programmeSnapshot.programmeDb,
        confidence: this.programmeSnapshot.confidence,
        momentaryDb,
        fastDb,
        peakDb: linearToDb(this.inputPeak),
        limiterCeilingDb: ceilingDb,
        canLift: !this.respectPlayerVolume || this.playerVolumeReliable
      }, this.policyParams);
      this.targetGainDb = control.targetGainDb;
      this.lastControl = control;
    } else {
      this.silenceFrames += 1;
      if (this.silenceFrames > 50) this.targetGainDb = 0;
    }

    if (this.sequence % 5 === 0) {
      this.port.postMessage({
        type: 'state',
        sequence: this.sequence,
        momentaryInputDb: momentaryDb + volumeDb,
        sourceMomentaryDb: momentaryDb,
        shortTermInputDb: shortTermDb + volumeDb,
        programmeInputDb: this.programmeSnapshot.programmeDb,
        programmeConfidence: this.programmeSnapshot.confidence,
        acceptedProgrammeBlocks: this.programmeSnapshot.acceptedBlocks,
        outputMomentaryDb: energyToDb(this.meanLast(this.outputEnergyHistory, 20)),
        currentGainDb: this.currentGainDb,
        targetGainDb: this.targetGainDb,
        programmeCorrectionDb: this.lastControl?.programmeCorrectionDb || 0,
        dynamicsCorrectionDb: this.lastControl?.dynamicsCorrectionDb || 0,
        fastProtectionDb: this.lastControl?.fastProtectionDb || 0,
        currentLimiterReductionDb: Math.max(0, -linearToDb(this.limiterGain)),
        transitionCeilingDb: this.transitionCeilingDb,
        signalActive: this.signalActive,
        limitedSamples: this.limitedSamples,
        hardClippedSamples: this.hardClippedSamples
      });
      this.limitedSamples = 0;
      this.hardClippedSamples = 0;
    }
    this.sequence += 1;
    this.previousInputFramePeak = this.inputPeak;
    this.frameSamples = 0;
    this.inputEnergySum = 0;
    this.inputPeak = 0;
    this.outputEnergySum = 0;
    this.outputPeak = 0;
  }

  process(inputs, outputs) {
    const source = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    const limiterRelease = 1 - Math.exp(-1 / (SAMPLE_RATE * 0.08));
    for (let index = 0; index < output.length; index += 1) {
      const sample = source?.[index] || 0;
      let seconds;
      if (this.targetGainDb < this.currentGainDb && this.targetGainDb < 0) seconds = 0.02;
      else if (this.targetGainDb > this.currentGainDb && this.currentGainDb < 0) seconds = 0.25;
      else if (this.targetGainDb > this.currentGainDb) seconds = 0.18;
      else seconds = 0.6;
      const gainAlpha = 1 - Math.exp(-1 / (SAMPLE_RATE * seconds));
      this.currentGainDb += (this.targetGainDb - this.currentGainDb) * gainAlpha;
      const levelGain = this.enabled ? dbToLinear(this.currentGainDb) : 1;
      const futureSample = sample * levelGain;
      this.delay[this.delayIndex] = futureSample;

      const recentOutputPeak = this.maxLast(this.outputPeakHistory, 20);
      const recentOutputPeakDb = recentOutputPeak > 1e-6 ? linearToDb(recentOutputPeak) : NaN;
      const baseCeilingDb = BASE_CEILING_DB + (
        this.playerVolumeReliable && this.respectPlayerVolume
          ? Math.min(0, linearToDb(this.playerVolumeCap))
          : 0
      );
      const protectedCeilingDb = computeTransitionCeilingDb({
        baseCeilingDb,
        recentOutputPeakDb,
        cutStrength: this.cutStrength,
        programmeTargetDb: this.policyParams.programmeTargetDb + (
          this.playerVolumeReliable && this.respectPlayerVolume
            ? Math.min(0, linearToDb(this.playerVolumeCap))
            : 0
        )
      });
      const liftedJump = this.currentGainDb > 0.01 && Math.abs(futureSample) > dbToLinear(protectedCeilingDb);
      const coldLoudOnset = !this.signalActive && Math.abs(sample) > dbToLinear(-18);
      const activeJump = this.signalActive
        && Math.abs(sample) > dbToLinear(-18)
        && Math.abs(sample) > this.previousInputFramePeak * dbToLinear(6);
      if (liftedJump || coldLoudOnset || activeJump) {
        this.transitionSamples = Math.max(this.transitionSamples, Math.round(SAMPLE_RATE * 0.04));
        this.transitionCeilingDb = protectedCeilingDb;
      }
      const ceilingDb = this.transitionSamples > 0 ? this.transitionCeilingDb : baseCeilingDb;
      const ceiling = dbToLinear(ceilingDb);
      const required = Math.abs(futureSample) > ceiling ? ceiling / Math.max(Math.abs(futureSample), 1e-12) : 1;
      if (required < this.limiterGain) {
        this.limiterGain = required;
        this.limitedSamples += 1;
      } else {
        this.limiterGain += (1 - this.limiterGain) * limiterRelease;
      }
      const readIndex = (this.delayIndex + 1) % DELAY_LENGTH;
      const delayedPeak = Math.abs(this.delay[readIndex]);
      if (delayedPeak * this.limiterGain > ceiling) {
        this.limiterGain = ceiling / Math.max(delayedPeak, 1e-12);
        this.limitedSamples += 1;
      }
      let rendered = this.delay[readIndex] * this.limiterGain * (this.playerMuted ? 0 : 1);
      if (rendered > ceiling) {
        if (rendered - ceiling > 1e-7) this.hardClippedSamples += 1;
        rendered = ceiling;
      } else if (rendered < -ceiling) {
        if (-rendered - ceiling > 1e-7) this.hardClippedSamples += 1;
        rendered = -ceiling;
      }
      output[index] = rendered;
      const weighted = this.weightedSample(sample);
      this.inputEnergySum += weighted * weighted;
      this.inputPeak = Math.max(this.inputPeak, Math.abs(sample));
      this.outputEnergySum += rendered * rendered;
      this.outputPeak = Math.max(this.outputPeak, Math.abs(rendered));
      this.delayIndex = readIndex;
      this.transitionSamples = Math.max(0, this.transitionSamples - 1);
      this.frameSamples += 1;
      if (this.frameSamples >= FRAME_SAMPLES) this.finishFrame();
    }
    return true;
  }
}

function configure(processor, overrides = {}, media = {}) {
  processor.port.onmessage({ data: {
    type: 'configure',
    configSequence: 1,
    settings: {
      enabled: true,
      respectPlayerVolume: true,
      cutStrength: 100,
      liftStrength: 100,
      ...overrides
    },
    playerVolumeCap: media.playerVolumeCap ?? 1,
    playerVolumeReliable: media.playerVolumeReliable ?? true,
    playerMuted: media.playerMuted ?? false,
    allowUnknownVolumeLift: false
  } });
}

function sine(amplitude, frequency = 997) {
  return (_sampleIndex, time) => amplitude * Math.sin(2 * Math.PI * frequency * time);
}

function renderInto(processor, seconds, generator, startSample = 0, collect = false) {
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  const samples = collect ? [] : null;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const sampleIndex = startSample + (block * BLOCK_SIZE) + index;
      input[index] = generator(sampleIndex, sampleIndex / SAMPLE_RATE);
    }
    processor.process([[input]], [[output]]);
    if (samples) samples.push(...output);
  }
  return { sampleCount: blocks * BLOCK_SIZE, samples };
}

function steadySummary(processor) {
  const states = processor.messages.filter((message) => message.type === 'state');
  const steady = states.slice(Math.floor(states.length * 0.65));
  const average = (field) => steady.reduce((sum, state) => sum + Number(state[field] || 0), 0) / Math.max(1, steady.length);
  return {
    inputDb: average('momentaryInputDb'),
    sourceInputDb: average('sourceMomentaryDb') || average('momentaryInputDb'),
    outputDb: average('outputMomentaryDb'),
    gainDb: average('currentGainDb'),
    programmeDb: average('programmeInputDb') || null,
    limiterReductionDb: average('currentLimiterReductionDb'),
    hardClippedSamples: states.reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0)
  };
}

function renderSteady(ProcessorClass, amplitude, media = {}, policyParams = undefined) {
  const processor = new ProcessorClass(policyParams);
  configure(processor, {}, media);
  renderInto(processor, 5, sine(amplitude));
  return steadySummary(processor);
}

function windowMetrics(samples, seconds) {
  const length = Math.min(samples.length, Math.round(SAMPLE_RATE * seconds));
  let energy = 0;
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[index];
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return {
    rmsDb: linearToDb(Math.sqrt(energy / Math.max(1, length))),
    peakDb: linearToDb(peak)
  };
}

function renderOnset(ProcessorClass, leadAmplitude) {
  const processor = new ProcessorClass();
  configure(processor);
  const lead = renderInto(processor, 1.5, sine(leadAmplitude));
  const onset = renderInto(processor, 0.08, sine(0.35), lead.sampleCount, true);
  return {
    first20Ms: windowMetrics(onset.samples, 0.02),
    first40Ms: windowMetrics(onset.samples, 0.04),
    first80Ms: windowMetrics(onset.samples, 0.08)
  };
}

function renderDynamics(ProcessorClass) {
  const processor = new ProcessorClass();
  configure(processor);
  let cursor = 0;
  const segments = [];
  for (const amplitude of [0.05, 0.2, 0.05]) {
    const before = processor.messages.length;
    const rendered = renderInto(processor, 4, sine(amplitude), cursor);
    cursor += rendered.sampleCount;
    const states = processor.messages.slice(before).filter((message) => message.type === 'state');
    const steady = states.slice(Math.floor(states.length * 0.75));
    const mean = (field) => steady.reduce((sum, state) => sum + Number(state[field] || 0), 0) / Math.max(1, steady.length);
    segments.push({ inputDb: mean('momentaryInputDb'), outputDb: mean('outputMomentaryDb'), gainDb: mean('currentGainDb') });
  }
  return {
    segments,
    inputContrastDb: segments[1].inputDb - ((segments[0].inputDb + segments[2].inputDb) / 2),
    outputContrastDb: segments[1].outputDb - ((segments[0].outputDb + segments[2].outputDb) / 2)
  };
}

function renderBoundary(resetProgramme) {
  const processor = new ProgrammeCandidateProcessor();
  configure(processor);
  let cursor = renderInto(processor, 12, sine(0.2)).sampleCount;
  if (resetProgramme) processor.resetProgramme();
  const before = processor.messages.length;
  renderInto(processor, 5, sine(0.02), cursor);
  const states = processor.messages.slice(before).filter((message) => message.type === 'state');
  const final = states.slice(Math.floor(states.length * 0.7));
  const mean = (field) => final.reduce((sum, state) => sum + Number(state[field] || 0), 0) / Math.max(1, final.length);
  return { outputDb: mean('outputMomentaryDb'), programmeDb: mean('programmeInputDb'), gainDb: mean('currentGainDb') };
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function assert(name, condition, details) {
  if (condition) console.log(`OK   ${name}`);
  else {
    console.error(`FAIL ${name}: ${details}`);
    process.exitCode = 1;
  }
}

const RuntimeProcessor = loadRuntimeProcessor();
const calibrationInputs = [0.2, 0.12, 0.35, 0.02, 0.008];
const calibrationSweep = [
  { programmeTargetDb: -20, maxLiftDb: 24 },
  { programmeTargetDb: -19, maxLiftDb: 25 },
  { programmeTargetDb: -18, maxLiftDb: 26 },
  { programmeTargetDb: -16, maxLiftDb: 28 }
].map((params) => {
  const steady = calibrationInputs.map((amplitude) => (
    renderSteady(ProgrammeCandidateProcessor, amplitude, {}, params)
  ));
  const ordinaryDeltas = steady.slice(0, 2).map((item) => item.outputDb - item.inputDb);
  return {
    params,
    steady,
    outputRangeDb: range(steady.map((item) => item.outputDb)),
    ordinaryDeltas,
    worstOrdinaryDeltaDb: Math.max(...ordinaryDeltas.map(Math.abs))
  };
});
const selectedCalibration = calibrationSweep.find((item) => item.params.programmeTargetDb === DEFAULT_PARAMS.programmeTargetDb);
const amplitudes = [0.35, 0.12, 0.05, 0.02, 0.008];
const runtimeSteady = amplitudes.map((amplitude) => renderSteady(RuntimeProcessor, amplitude));
const candidateSteady = amplitudes.map((amplitude) => renderSteady(ProgrammeCandidateProcessor, amplitude));
const runtimeOutputRangeDb = range(runtimeSteady.map((item) => item.outputDb));
const candidateOutputRangeDb = range(candidateSteady.map((item) => item.outputDb));
const typicalIndex = 1;
const runtimeTypicalDeltaDb = runtimeSteady[typicalIndex].outputDb - runtimeSteady[typicalIndex].inputDb;
const candidateTypicalDeltaDb = candidateSteady[typicalIndex].outputDb - candidateSteady[typicalIndex].inputDb;
const runtimeDynamics = renderDynamics(RuntimeProcessor);
const candidateDynamics = renderDynamics(ProgrammeCandidateProcessor);
const runtimeOnset = renderOnset(RuntimeProcessor, 0.008);
const candidateOnset = renderOnset(ProgrammeCandidateProcessor, 0.008);
const fullVolumeQuiet = renderSteady(ProgrammeCandidateProcessor, 0.02);
const quarterVolumeQuiet = renderSteady(ProgrammeCandidateProcessor, 0.005, { playerVolumeCap: 0.25, playerVolumeReliable: true });
const boundary = {
  stale: renderBoundary(false),
  reset: renderBoundary(true)
};
const legacyReference = {
  typicalDeltaDb: -7.757,
  steadyOutputDb: -29.44,
  dynamicsContrastDb: 0.399,
  onsetFirst20Ms: { rmsDb: -27.753, peakDb: -24 }
};

const report = {
  legacyReference,
  calibrationSweep,
  steady: {
    amplitudes,
    runtime: runtimeSteady,
    independentModel: candidateSteady,
    runtimeOutputRangeDb,
    candidateOutputRangeDb,
    runtimeTypicalDeltaDb,
    candidateTypicalDeltaDb
  },
  dynamics: { runtime: runtimeDynamics, independentModel: candidateDynamics },
  onset: { runtime: runtimeOnset, independentModel: candidateOnset },
  playerVolume: { fullVolumeQuiet, quarterVolumeQuiet },
  boundary
};

assert(
  'the selected centre minimizes ordinary enabled/bypass error in the calibration sweep',
  selectedCalibration
    && selectedCalibration.params.maxLiftDb === DEFAULT_PARAMS.maxLiftDb
    && calibrationSweep.every((item) => (
      selectedCalibration.worstOrdinaryDeltaDb <= item.worstOrdinaryDeltaDb + 0.05
    )),
  JSON.stringify(calibrationSweep)
);
assert(
  'the selected centre still converges the calibration range without extreme lift',
  selectedCalibration.outputRangeDb <= 2.5 && selectedCalibration.params.maxLiftDb <= 25,
  JSON.stringify(selectedCalibration)
);

assert(
  'runtime removes the legacy fixed -29 dB average baseline',
  runtimeSteady[0].outputDb > legacyReference.steadyOutputDb + 6
    && runtimeSteady[typicalIndex].outputDb > legacyReference.steadyOutputDb + 6,
  JSON.stringify(report.steady)
);
assert(
  'runtime keeps typical programme on/off average within two decibels',
  Math.abs(runtimeTypicalDeltaDb) <= 2,
  JSON.stringify(report.steady)
);
assert(
  'runtime still converges source-to-source programme levels',
  runtimeOutputRangeDb <= 4,
  JSON.stringify(report.steady)
);
assert(
  'runtime preserves useful internal contrast instead of flattening the programme',
  runtimeDynamics.outputContrastDb >= 2.5
    && runtimeDynamics.outputContrastDb < runtimeDynamics.inputContrastDb
    && runtimeDynamics.outputContrastDb > legacyReference.dynamicsContrastDb + 2,
  JSON.stringify(report.dynamics)
);
assert(
  'adaptive onset ceiling catches the first audible block without the old deep duck',
  runtimeOnset.first20Ms.peakDb <= -12.9
    && runtimeOnset.first20Ms.rmsDb > legacyReference.onsetFirst20Ms.rmsDb + 6,
  JSON.stringify(report.onset)
);
assert(
  'production worklet matches the independently rendered policy model',
  runtimeSteady.every((item, index) => Math.abs(item.outputDb - candidateSteady[index].outputDb) < 0.05)
    && Math.abs(runtimeDynamics.outputContrastDb - candidateDynamics.outputContrastDb) < 0.05
    && Math.abs(runtimeOnset.first20Ms.peakDb - candidateOnset.first20Ms.peakDb) < 0.05,
  JSON.stringify({ steady: report.steady, dynamics: report.dynamics, onset: report.onset })
);
assert(
  'source decision remains equivalent at quarter player volume',
  Math.abs(fullVolumeQuiet.gainDb - quarterVolumeQuiet.gainDb) < 0.5
    && Math.abs((fullVolumeQuiet.outputDb - quarterVolumeQuiet.outputDb) - 12.041) < 0.75,
  JSON.stringify(report.playerVolume)
);
assert(
  'explicit programme boundary is materially better than a stale cumulative reference',
  boundary.reset.outputDb > boundary.stale.outputDb + 2,
  JSON.stringify(boundary)
);
assert(
  'runtime remains sample-safe in all steady fixtures',
  runtimeSteady.every((item) => item.hardClippedSamples === 0),
  JSON.stringify(runtimeSteady)
);

console.log(JSON.stringify(report, null, 2));
if (process.exitCode) process.exit(process.exitCode);
