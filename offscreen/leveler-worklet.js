const FRAME_MS = 20;
const FRAME_SAMPLES = Math.max(1, Math.round(sampleRate * FRAME_MS / 1000));
const STATE_REPORT_INTERVAL_FRAMES = 5;
const HISTORY_SIZE = 150;
const MOMENTARY_FRAMES = 20;
const SHORT_TERM_FRAMES = 150;
const PROGRAMME_BLOCK_STRIDE_FRAMES = 5;
const SILENCE_HOLD_FRAMES = 50;
const LOOKAHEAD_SAMPLES = Math.max(1, Math.round(sampleRate * 0.005));
const DELAY_LENGTH = LOOKAHEAD_SAMPLES + 1;
const BASE_LIMITER_CEILING_DB = -3;
const ONSET_PROTECTION_TRIGGER_DB = -18;
const PROGRAMME_JUMP_TRIGGER_DB = 6;
const TRANSITION_PROTECTION_SECONDS = 0.04;
const CUT_ATTACK_SECONDS = 0.02;
const CUT_RELEASE_SECONDS = 0.25;
const LIFT_ATTACK_SECONDS = 0.18;
const LIFT_RELEASE_SECONDS = 0.12;
const MAX_GAIN_INCREASE_STEP_DB = 3;

const ProgrammePolicy = globalThis.LoudEaseProgrammePolicy;
if (!ProgrammePolicy) {
  throw new Error('LoudEase programme policy was not loaded before the leveler worklet');
}
const {
  DEFAULT_PARAMS: PROGRAMME_PARAMS,
  ProgrammeLoudnessEstimator,
  computeTargetGainDb,
  computeTransitionCeilingDb,
  energyToDb
} = ProgrammePolicy;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function dbToLinear(value) { return Math.pow(10, value / 20); }
function linearToDb(value) { return 20 * Math.log10(Math.max(0.0001, value)); }

class WebVolumeBalancerLevelerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.energyHistory = new Float64Array(HISTORY_SIZE);
    this.inputPeakHistory = new Float32Array(HISTORY_SIZE);
    this.outputEnergyHistory = new Float64Array(HISTORY_SIZE);
    this.outputPeakHistory = new Float32Array(HISTORY_SIZE);
    this.historyIndex = 0;
    this.historyCount = 0;
    this.programmeEstimator = new ProgrammeLoudnessEstimator();
    this.programmeState = this.programmeEstimator.snapshot();
    this.programmeStrideFrames = 0;
    this.programmeKey = '';
    this.delay = [new Float32Array(DELAY_LENGTH), new Float32Array(DELAY_LENGTH)];
    this.delayIndex = 0;
    this.frameSamples = 0;
    this.inputEnergySum = 0;
    this.inputPeak = 0;
    this.previousInputFramePeak = 0;
    this.outputEnergySum = 0;
    this.outputPeak = 0;
    this.sequence = 0;
    this.controlFrameSequence = 0;
    this.currentGainDb = 0;
    this.targetGainDb = 0;
    this.signalActive = false;
    this.silenceFrames = 0;
    this.cutStrength = this.targetCutStrength = 0;
    this.liftStrength = this.targetLiftStrength = 0;
    this.enabled = this.targetEnabled = 0;
    this.respectPlayerVolume = true;
    this.playerVolumeCap = this.targetPlayerVolumeCap = 1;
    this.playerVolumeReliable = false;
    this.allowUnknownVolumeLift = false;
    this.muteGain = this.targetMuteGain = 0;
    this.limiterGain = 1;
    this.adaptiveTransitionCeilingDb = PROGRAMME_PARAMS.programmeTargetDb
      + PROGRAMME_PARAMS.transitionDefaultCrestDb;
    this.transitionCeilingDb = this.adaptiveTransitionCeilingDb;
    this.transitionProtectionSamples = 0;
    this.lastControl = null;
    this.controlInput = {};
    this.controlResult = {};
    this.transitionInput = {};
    this.limitedSamples = 0;
    this.hardClippedSamples = 0;
    this.maxHardClipOvershoot = 0;
    this.reportInputPeak = 0;
    this.reportOutputPeak = 0;
    this.reportLimitedSamples = 0;
    this.reportHardClippedSamples = 0;
    this.reportMaxHardClipOvershoot = 0;
    this.signalTickCount = 0;
    this.silentTickCount = 0;
    this.limiterTickCount = 0;
    this.loudnessResetCount = 0;
    this.configured = false;
    this.shelf = this.makeShelf(1681.974450955533, 3.999843853973347);
    this.highpass = this.makeHighpass(38.13547087602444, 0.5003270373238773);
    this.filterState = new Float64Array(16);
    this.port.onmessage = (event) => this.configure(event.data || {});
  }

  makeHighpass(frequency, q) {
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    return [((1 + cosine) / 2) / a0, (-(1 + cosine)) / a0, ((1 + cosine) / 2) / a0, (-2 * cosine) / a0, (1 - alpha) / a0];
  }

  makeShelf(frequency, gainDb) {
    const amplitude = Math.pow(10, gainDb / 40);
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) * Math.SQRT2 / 2;
    const root = 2 * Math.sqrt(amplitude) * alpha;
    const a0 = (amplitude + 1) - (amplitude - 1) * cosine + root;
    return [amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + root) / a0, -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine) / a0, amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - root) / a0, 2 * ((amplitude - 1) - (amplitude + 1) * cosine) / a0, ((amplitude + 1) - (amplitude - 1) * cosine - root) / a0];
  }

  configure(message) {
    if (message.type !== 'configure') return;
    const settings = message.settings || {};
    const nextProgrammeKey = String(message.programmeKey || '');
    const programmeChanged = this.configured
      && nextProgrammeKey
      && this.programmeKey
      && nextProgrammeKey !== this.programmeKey;
    this.targetEnabled = settings.enabled === false ? 0 : 1;
    this.targetCutStrength = clamp(Number(settings.cutStrength) || 0, 0, 100);
    this.targetLiftStrength = clamp(Number(settings.liftStrength) || 0, 0, 100);
    this.respectPlayerVolume = settings.respectPlayerVolume !== false;
    this.targetPlayerVolumeCap = clamp(Number(message.playerVolumeCap), 0, 1);
    if (!Number.isFinite(this.targetPlayerVolumeCap)) this.targetPlayerVolumeCap = 1;
    this.playerVolumeReliable = message.playerVolumeReliable === true;
    this.allowUnknownVolumeLift = message.allowUnknownVolumeLift === true;
    this.targetMuteGain = this.respectPlayerVolume && message.playerMuted === true ? 0 : 1;
    if (nextProgrammeKey) this.programmeKey = nextProgrammeKey;
    if (programmeChanged || message.resetProgramme === true) this.resetProgramme();
    if (!this.configured) {
      this.enabled = this.targetEnabled;
      this.cutStrength = this.targetCutStrength;
      this.liftStrength = this.targetLiftStrength;
      this.playerVolumeCap = this.targetPlayerVolumeCap;
      this.muteGain = this.targetMuteGain;
      this.configured = true;
    } else if (this.targetMuteGain === 0) {
      this.muteGain = 0;
    }
    this.port.postMessage({
      type: 'configured',
      configSequence: Math.max(0, Math.floor(Number(message.configSequence) || 0))
    });
  }

  resetProgramme() {
    this.energyHistory.fill(0);
    this.inputPeakHistory.fill(0);
    this.outputEnergyHistory.fill(0);
    this.outputPeakHistory.fill(0);
    this.historyIndex = 0;
    this.historyCount = 0;
    this.programmeEstimator.reset();
    this.programmeState = this.programmeEstimator.snapshot();
    this.programmeStrideFrames = 0;
    this.targetGainDb = 0;
    this.currentGainDb = 0;
    this.limiterGain = 1;
    this.signalActive = false;
    this.silenceFrames = 0;
    this.previousInputFramePeak = 0;
    this.transitionProtectionSamples = 0;
    this.lastControl = null;
    this.loudnessResetCount += 1;
  }

  weightedSample(sample, channel) {
    const offset = channel * 8;
    let x1 = this.filterState[offset];
    let x2 = this.filterState[offset + 1];
    let y1 = this.filterState[offset + 2];
    let y2 = this.filterState[offset + 3];
    const y = this.shelf[0] * sample + this.shelf[1] * x1 + this.shelf[2] * x2 - this.shelf[3] * y1 - this.shelf[4] * y2;
    x2 = x1; x1 = sample; y2 = y1; y1 = y;
    const highOffset = offset + 4;
    const z = this.highpass[0] * y + this.highpass[1] * this.filterState[highOffset] + this.highpass[2] * this.filterState[highOffset + 1] - this.highpass[3] * this.filterState[highOffset + 2] - this.highpass[4] * this.filterState[highOffset + 3];
    this.filterState[offset] = x1; this.filterState[offset + 1] = x2; this.filterState[offset + 2] = y1; this.filterState[offset + 3] = y2;
    this.filterState[highOffset + 1] = this.filterState[highOffset]; this.filterState[highOffset] = y;
    this.filterState[highOffset + 3] = this.filterState[highOffset + 2]; this.filterState[highOffset + 2] = z;
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

  volumeDb() {
    if (!this.respectPlayerVolume || !this.playerVolumeReliable || this.playerVolumeCap <= 0.001) return 0;
    return Math.min(0, linearToDb(this.playerVolumeCap));
  }

  baseCeilingDb() {
    return BASE_LIMITER_CEILING_DB + this.volumeDb();
  }

  finishFrame() {
    const capturedEnergy = this.inputEnergySum / Math.max(1, this.frameSamples);
    const outputEnergy = this.outputEnergySum / Math.max(1, this.frameSamples);
    const volumeDb = this.volumeDb();
    const sourceCompensation = dbToLinear(-volumeDb);
    const sourceEnergy = capturedEnergy * sourceCompensation * sourceCompensation;
    const sourcePeak = this.inputPeak * sourceCompensation;
    this.energyHistory[this.historyIndex] = sourceEnergy;
    this.inputPeakHistory[this.historyIndex] = this.inputPeak;
    this.outputEnergyHistory[this.historyIndex] = outputEnergy;
    this.outputPeakHistory[this.historyIndex] = this.outputPeak;
    this.historyIndex = (this.historyIndex + 1) % HISTORY_SIZE;
    this.historyCount = Math.min(HISTORY_SIZE, this.historyCount + 1);

    const instantSourceDb = energyToDb(sourceEnergy);
    const momentarySourceEnergy = this.meanLast(this.energyHistory, MOMENTARY_FRAMES);
    const momentarySourceDb = energyToDb(momentarySourceEnergy);
    const shortTermSourceDb = energyToDb(this.meanLast(this.energyHistory, SHORT_TERM_FRAMES));
    const fastSourceDb = Math.max(instantSourceDb, energyToDb(this.meanLast(this.energyHistory, 5)));
    const outputMomentaryDb = energyToDb(this.meanLast(this.outputEnergyHistory, MOMENTARY_FRAMES));
    const outputShortTermDb = energyToDb(this.meanLast(this.outputEnergyHistory, SHORT_TERM_FRAMES));
    this.signalActive = instantSourceDb > (this.signalActive ? -68 : -62)
      && sourcePeak > (this.signalActive ? 0.000175 : 0.00035);

    if (this.signalActive) {
      this.silenceFrames = 0;
      this.programmeStrideFrames += 1;
      if (this.historyCount >= MOMENTARY_FRAMES && this.programmeStrideFrames >= PROGRAMME_BLOCK_STRIDE_FRAMES) {
        this.programmeState = this.programmeEstimator.addBlock(momentarySourceEnergy);
        this.programmeStrideFrames = 0;
      }
      const canLift = this.playerVolumeReliable || this.allowUnknownVolumeLift || !this.respectPlayerVolume;
      this.controlInput.enabled = this.enabled > 0.001;
      this.controlInput.signalActive = true;
      this.controlInput.cutStrength = this.cutStrength;
      this.controlInput.liftStrength = this.liftStrength;
      this.controlInput.programmeDb = this.programmeState.programmeDb;
      this.controlInput.confidence = this.programmeState.confidence;
      this.controlInput.momentaryDb = momentarySourceDb;
      this.controlInput.fastDb = fastSourceDb;
      this.controlInput.peakDb = linearToDb(this.inputPeak);
      this.controlInput.limiterCeilingDb = this.baseCeilingDb();
      this.controlInput.canLift = canLift;
      this.lastControl = computeTargetGainDb(this.controlInput, PROGRAMME_PARAMS, this.controlResult);
      this.targetGainDb = this.lastControl.targetGainDb;
      this.signalTickCount += 1;
    } else {
      this.silenceFrames += 1;
      this.silentTickCount += 1;
      if (this.silenceFrames > SILENCE_HOLD_FRAMES) {
        this.targetGainDb = this.lastControl?.programmeBaselineGainDb || 0;
      }
    }

    const recentOutputPeak = this.maxLast(this.outputPeakHistory, MOMENTARY_FRAMES);
    this.transitionInput.baseCeilingDb = this.baseCeilingDb();
    this.transitionInput.recentOutputPeakDb = recentOutputPeak > 1e-6 ? linearToDb(recentOutputPeak) : NaN;
    this.transitionInput.cutStrength = this.cutStrength;
    this.transitionInput.programmeTargetDb = PROGRAMME_PARAMS.programmeTargetDb + volumeDb;
    this.adaptiveTransitionCeilingDb = computeTransitionCeilingDb(this.transitionInput);

    this.reportInputPeak = Math.max(this.reportInputPeak, this.inputPeak);
    this.reportOutputPeak = Math.max(this.reportOutputPeak, this.outputPeak);
    this.reportLimitedSamples += this.limitedSamples;
    this.reportHardClippedSamples += this.hardClippedSamples;
    this.reportMaxHardClipOvershoot = Math.max(this.reportMaxHardClipOvershoot, this.maxHardClipOvershoot);
    this.controlFrameSequence += 1;
    const shouldReport = this.controlFrameSequence === 1
      || (this.controlFrameSequence - 1) % STATE_REPORT_INTERVAL_FRAMES === 0;
    if (shouldReport) {
      const programmeDb = Number.isFinite(this.programmeState.programmeDb)
        ? this.programmeState.programmeDb
        : null;
      const peakHeadroomDb = this.baseCeilingDb() - linearToDb(this.inputPeak) - 0.5;
      const requestedLiftDb = Math.max(0,
        (this.lastControl?.programmeCorrectionDb || 0) + (this.lastControl?.dynamicsCorrectionDb || 0)
      );
      this.port.postMessage({
        type: 'state',
        sequence: this.sequence++,
        lastInputDb: instantSourceDb + volumeDb,
        momentaryInputDb: momentarySourceDb + volumeDb,
        shortTermInputDb: shortTermSourceDb + volumeDb,
        controlInputDb: fastSourceDb + volumeDb,
        liftControlInputDb: momentarySourceDb + volumeDb,
        sourceMomentaryInputDb: momentarySourceDb,
        programmeInputDb: programmeDb,
        programmeConfidence: this.programmeState.confidence,
        acceptedProgrammeBlocks: this.programmeState.acceptedBlocks,
        programmeCorrectionDb: this.lastControl?.programmeCorrectionDb || 0,
        dynamicsCorrectionDb: this.lastControl?.dynamicsCorrectionDb || 0,
        fastProtectionDb: this.lastControl?.fastProtectionDb || 0,
        lastPeak: this.inputPeak,
        liftPeak: this.maxLast(this.inputPeakHistory, MOMENTARY_FRAMES),
        lastOutputDb: energyToDb(outputEnergy),
        outputMomentaryDb,
        outputShortTermDb,
        outputControlDb: outputMomentaryDb,
        lastOutputPeak: this.outputPeak,
        currentGainDb: this.currentGainDb,
        currentLiftDb: Math.max(0, this.currentGainDb),
        currentReductionDb: Math.max(0, -this.currentGainDb),
        currentLimiterReductionDb: Math.max(0, -linearToDb(this.limiterGain)),
        targetGainDb: this.targetGainDb,
        targetLiftDb: Math.max(0, this.targetGainDb),
        targetReductionDb: Math.max(0, -this.targetGainDb),
        effectiveMaxLiftDb: PROGRAMME_PARAMS.maxLiftDb * (this.liftStrength / 100),
        playerVolumeLiftCeilingDb: PROGRAMME_PARAMS.programmeTargetDb + volumeDb,
        effectiveLimiterCeilingDb: this.ceilingDb(),
        adaptiveTransitionCeilingDb: this.adaptiveTransitionCeilingDb,
        peakHeadroomDb,
        rawPeakHeadroomDb: peakHeadroomDb,
        liftLimiterBudgetDb: PROGRAMME_PARAMS.liftLimiterBudgetDb * (this.liftStrength / 100),
        effectiveLiftBudgetDb: this.lastControl?.liftBudgetDb || 0,
        quietDeficitDb: programmeDb == null ? 0 : Math.max(0, PROGRAMME_PARAMS.programmeTargetDb - programmeDb),
        requestedLiftDb,
        signalActive: this.signalActive,
        signalTickCount: this.signalTickCount,
        silentTickCount: this.silentTickCount,
        limiterTickCount: this.limiterTickCount,
        loudnessResetCount: this.loudnessResetCount,
        workletInputPeak: this.reportInputPeak,
        workletOutputPeak: this.reportOutputPeak,
        limitedSamples: this.reportLimitedSamples,
        hardClippedSamples: this.reportHardClippedSamples,
        maxHardClipOvershoot: this.reportMaxHardClipOvershoot
      });
      this.reportInputPeak = 0;
      this.reportOutputPeak = 0;
      this.reportLimitedSamples = 0;
      this.reportHardClippedSamples = 0;
      this.reportMaxHardClipOvershoot = 0;
    }
    this.previousInputFramePeak = this.inputPeak;
    this.frameSamples = 0;
    this.inputEnergySum = 0;
    this.inputPeak = 0;
    this.outputEnergySum = 0;
    this.outputPeak = 0;
    this.limitedSamples = 0;
    this.hardClippedSamples = 0;
    this.maxHardClipOvershoot = 0;
  }

  ceilingDb() {
    return this.transitionProtectionSamples > 0
      ? Math.min(this.baseCeilingDb(), this.transitionCeilingDb)
      : this.baseCeilingDb();
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;
    const frames = output[0].length;
    const settingAlpha = 1 - Math.exp(-1 / (sampleRate * 0.03));
    const muteAlpha = 1 - Math.exp(-1 / (sampleRate * 0.008));
    const limiterRelease = 1 - Math.exp(-1 / (sampleRate * 0.08));
    for (let frame = 0; frame < frames; frame += 1) {
      this.cutStrength += (this.targetCutStrength - this.cutStrength) * settingAlpha;
      this.liftStrength += (this.targetLiftStrength - this.liftStrength) * settingAlpha;
      this.enabled += (this.targetEnabled - this.enabled) * settingAlpha;
      this.playerVolumeCap += (this.targetPlayerVolumeCap - this.playerVolumeCap) * settingAlpha;
      this.muteGain += (this.targetMuteGain - this.muteGain) * muteAlpha;
      let seconds;
      if (this.targetGainDb < this.currentGainDb && this.targetGainDb < 0) seconds = CUT_ATTACK_SECONDS;
      else if (this.targetGainDb > this.currentGainDb && this.currentGainDb < 0) seconds = CUT_RELEASE_SECONDS;
      else if (this.targetGainDb > this.currentGainDb) seconds = LIFT_ATTACK_SECONDS;
      else seconds = LIFT_RELEASE_SECONDS;
      const gainAlpha = 1 - Math.exp(-1 / (sampleRate * seconds));
      const gainDelta = (this.targetGainDb - this.currentGainDb) * gainAlpha;
      this.currentGainDb += Math.min(gainDelta, MAX_GAIN_INCREASE_STEP_DB / FRAME_SAMPLES);
      const levelGain = dbToLinear(this.currentGainDb) * this.enabled + (1 - this.enabled);
      let futurePeak = 0;
      let rawInputPeak = 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        const sample = source ? source[frame] || 0 : 0;
        this.delay[channel][this.delayIndex] = sample * levelGain;
        futurePeak = Math.max(futurePeak, Math.abs(sample * levelGain));
        rawInputPeak = Math.max(rawInputPeak, Math.abs(sample));
        const weighted = this.weightedSample(sample, Math.min(channel, 1));
        this.inputEnergySum += weighted * weighted / output.length;
        this.inputPeak = Math.max(this.inputPeak, Math.abs(sample));
      }
      const liftedJump = this.currentGainDb > 0.01 && futurePeak > dbToLinear(this.adaptiveTransitionCeilingDb);
      const newSignalOnset = !this.signalActive && futurePeak > dbToLinear(ONSET_PROTECTION_TRIGGER_DB);
      const activeProgrammeJump = this.signalActive
        && this.cutStrength > 0.01
        && rawInputPeak > dbToLinear(ONSET_PROTECTION_TRIGGER_DB)
        && rawInputPeak > this.previousInputFramePeak * dbToLinear(PROGRAMME_JUMP_TRIGGER_DB);
      if (liftedJump || newSignalOnset || activeProgrammeJump) {
        this.transitionProtectionSamples = Math.max(
          this.transitionProtectionSamples,
          Math.round(sampleRate * TRANSITION_PROTECTION_SECONDS)
        );
        this.transitionCeilingDb = this.adaptiveTransitionCeilingDb;
      }
      const ceiling = dbToLinear(this.ceilingDb());
      const required = futurePeak > ceiling ? ceiling / Math.max(futurePeak, 1e-12) : 1;
      if (required < this.limiterGain) {
        this.limiterGain = required;
        this.limitedSamples += 1;
        this.limiterTickCount += 1;
      } else {
        this.limiterGain += (1 - this.limiterGain) * limiterRelease;
      }
      const readIndex = (this.delayIndex + 1) % DELAY_LENGTH;
      let delayedPeak = 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        delayedPeak = Math.max(delayedPeak, Math.abs(this.delay[channel][readIndex]));
      }
      if (delayedPeak * this.limiterGain > ceiling) {
        this.limiterGain = ceiling / Math.max(delayedPeak, 1e-12);
        this.limitedSamples += 1;
        this.limiterTickCount += 1;
      }
      for (let channel = 0; channel < output.length; channel += 1) {
        let sample = this.delay[channel][readIndex] * this.limiterGain * this.muteGain;
        if (sample > ceiling) {
          const overshoot = sample - ceiling;
          this.maxHardClipOvershoot = Math.max(this.maxHardClipOvershoot, overshoot);
          sample = ceiling;
          if (overshoot > 1e-7) this.hardClippedSamples += 1;
        } else if (sample < -ceiling) {
          const overshoot = -sample - ceiling;
          this.maxHardClipOvershoot = Math.max(this.maxHardClipOvershoot, overshoot);
          sample = -ceiling;
          if (overshoot > 1e-7) this.hardClippedSamples += 1;
        }
        output[channel][frame] = sample;
        this.outputEnergySum += sample * sample / output.length;
        this.outputPeak = Math.max(this.outputPeak, Math.abs(sample));
      }
      this.delayIndex = readIndex;
      this.transitionProtectionSamples = Math.max(0, this.transitionProtectionSamples - 1);
      this.frameSamples += 1;
      if (this.frameSamples >= FRAME_SAMPLES) this.finishFrame();
    }
    return true;
  }
}

registerProcessor('wvb-leveler-processor', WebVolumeBalancerLevelerProcessor);
