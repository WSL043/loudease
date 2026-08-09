const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TARGET_DB = -29;
const CEILING = 10 ** (-3 / 20);
const source = fs.readFileSync(path.resolve(__dirname, '..', 'offscreen', 'leveler-worklet.js'), 'utf8');

function loadProcessor({ realizedAssistEnabled = true, transitionProtectionDepthDb = 15 } = {}) {
  let ProcessorClass = null;
  const context = {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: class {
      constructor() {
        this.messages = [];
        this.port = { onmessage: null, postMessage: (message) => this.messages.push(message) };
      }
    },
    registerProcessor: (_name, implementation) => { ProcessorClass = implementation; }
  };
  if (!source.includes('const REALIZED_LIFT_ASSIST_RATIO = 0.5;')
    || !source.includes('const TRANSITION_PROTECTION_DEPTH_DB = 15;')) {
    throw new Error('Expected DSP candidate constants were not found');
  }
  const configuredSource = source.replace(
    'const REALIZED_LIFT_ASSIST_RATIO = 0.5;',
    `const REALIZED_LIFT_ASSIST_RATIO = ${realizedAssistEnabled ? 0.5 : 0};`
  ).replace(
    'const TRANSITION_PROTECTION_DEPTH_DB = 15;',
    `const TRANSITION_PROTECTION_DEPTH_DB = ${transitionProtectionDepthDb};`
  );
  vm.runInNewContext(configuredSource, context, { filename: 'leveler-worklet.js' });
  return ProcessorClass;
}

function renderInto(processor, seconds, generator, startSample = 0, collectOutput = false) {
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  const outputSamples = collectOutput ? [] : null;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const sampleIndex = startSample + block * BLOCK_SIZE + index;
      input[index] = generator(sampleIndex, sampleIndex / SAMPLE_RATE);
    }
    processor.process([[input]], [[output]]);
    if (outputSamples) outputSamples.push(...output);
  }
  return { outputSamples, sampleCount: blocks * BLOCK_SIZE };
}

function configure(processor) {
  processor.port.onmessage({ data: {
    type: 'configure',
    configSequence: 1,
    settings: { enabled: true, respectPlayerVolume: true, cutStrength: 100, liftStrength: 100 },
    playerVolumeCap: 1,
    playerVolumeReliable: true,
    playerMuted: false,
    allowUnknownVolumeLift: false
  } });
}

function render(ProcessorClass, seconds, generator) {
  const processor = new ProcessorClass();
  configure(processor);
  let outputPeak = 0;
  const rendered = renderInto(processor, seconds, generator, 0, true);
  for (const sample of rendered.outputSamples) outputPeak = Math.max(outputPeak, Math.abs(sample));
  const states = processor.messages.filter((message) => message.type === 'state');
  const steady = states.slice(Math.floor(states.length / 2));
  const average = (field) => steady.reduce((sum, state) => sum + Number(state[field] || 0), 0) / Math.max(1, steady.length);
  return {
    outputMomentaryDb: average('outputMomentaryDb'),
    currentGainDb: average('currentGainDb'),
    limiterReductionDb: average('currentLimiterReductionDb'),
    realizedLiftAssistDb: average('realizedLiftAssistDb'),
    limitedSamples: states.reduce((sum, state) => sum + Number(state.limitedSamples || 0), 0),
    hardClippedSamples: states.reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0),
    outputPeak
  };
}

function windowMetrics(samples, count) {
  let energy = 0;
  let peak = 0;
  const length = Math.min(samples.length, count);
  for (let index = 0; index < length; index += 1) {
    const sample = samples[index];
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    rmsDb: 20 * Math.log10(Math.max(1e-12, Math.sqrt(energy / Math.max(1, length)))),
    peakDb: 20 * Math.log10(Math.max(1e-12, peak))
  };
}

function renderToLoudOnset(ProcessorClass, leadAmplitude) {
  const processor = new ProcessorClass();
  configure(processor);
  const lead = renderInto(processor, 1.2, sine(leadAmplitude));
  const onset = renderInto(processor, 0.04, sine(0.35), lead.sampleCount, true);
  return {
    first20Ms: windowMetrics(onset.outputSamples, Math.round(SAMPLE_RATE * 0.02)),
    first40Ms: windowMetrics(onset.outputSamples, Math.round(SAMPLE_RATE * 0.04)),
    hardClippedSamples: processor.messages
      .filter((message) => message.type === 'state')
      .reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0)
  };
}

function sine(amplitude, frequency = 997) {
  return (_sampleIndex, time) => amplitude * Math.sin(2 * Math.PI * frequency * time);
}

function limiterBoundQuiet(sampleIndex, time) {
  const period = Math.round(SAMPLE_RATE * 0.25);
  const burst = sampleIndex % period === 4000 ? 0.45 : 0;
  return (0.006 * Math.sin(2 * Math.PI * 997 * time)) + burst;
}

function assert(name, condition, details) {
  if (condition) console.log(`OK   ${name}`);
  else {
    console.error(`FAIL ${name}: ${details}`);
    process.exitCode = 1;
  }
}

const baselineClass = loadProcessor({ realizedAssistEnabled: false });
const candidateClass = loadProcessor({ realizedAssistEnabled: true });
const baseline = {
  loud: render(baselineClass, 3, sine(0.35)),
  quiet: render(baselineClass, 3, sine(0.008)),
  limiterBoundQuiet: render(baselineClass, 4, limiterBoundQuiet)
};
const candidate = {
  loud: render(candidateClass, 3, sine(0.35)),
  quiet: render(candidateClass, 3, sine(0.008)),
  limiterBoundQuiet: render(candidateClass, 4, limiterBoundQuiet)
};

const baselineGap = Math.abs(baseline.limiterBoundQuiet.outputMomentaryDb - baseline.loud.outputMomentaryDb);
const candidateGap = Math.abs(candidate.limiterBoundQuiet.outputMomentaryDb - candidate.loud.outputMomentaryDb);
const transitionBaselineClass = loadProcessor({ transitionProtectionDepthDb: 0 });
const transitionCandidateClass = loadProcessor({ transitionProtectionDepthDb: 15 });
const transitionBaseline = {
  quietToLoud: renderToLoudOnset(transitionBaselineClass, 0.008),
  normalToLoud: renderToLoudOnset(transitionBaselineClass, 0.05),
  highCrest: render(transitionBaselineClass, 3, limiterBoundQuiet)
};
const transitionCandidate = {
  quietToLoud: renderToLoudOnset(transitionCandidateClass, 0.008),
  normalToLoud: renderToLoudOnset(transitionCandidateClass, 0.05),
  highCrest: render(transitionCandidateClass, 3, limiterBoundQuiet)
};
const onsetPeakImprovementDb = transitionBaseline.quietToLoud.first40Ms.peakDb - transitionCandidate.quietToLoud.first40Ms.peakDb;
const onsetRmsImprovementDb = transitionBaseline.quietToLoud.first20Ms.rmsDb - transitionCandidate.quietToLoud.first20Ms.rmsDb;
const programmeJumpPeakImprovementDb = transitionBaseline.normalToLoud.first40Ms.peakDb - transitionCandidate.normalToLoud.first40Ms.peakDb;
const programmeJumpRmsImprovementDb = transitionBaseline.normalToLoud.first20Ms.rmsDb - transitionCandidate.normalToLoud.first20Ms.rmsDb;
const report = {
  realizedAssist: { baseline, candidate, baselineGap, candidateGap, gapImprovementDb: baselineGap - candidateGap },
  onsetProtection: {
    baseline: transitionBaseline,
    candidate: transitionCandidate,
    onsetPeakImprovementDb,
    onsetRmsImprovementDb,
    programmeJumpPeakImprovementDb,
    programmeJumpRmsImprovementDb
  }
};

assert(
  'candidate leaves ordinary loud and quiet steady state unchanged',
  Math.abs(candidate.loud.outputMomentaryDb - baseline.loud.outputMomentaryDb) < 0.05
    && Math.abs(candidate.quiet.outputMomentaryDb - baseline.quiet.outputMomentaryDb) < 0.05,
  JSON.stringify(report)
);
assert(
  'candidate activates only after measured limiter loss',
  candidate.limiterBoundQuiet.realizedLiftAssistDb > 0
    && baseline.limiterBoundQuiet.realizedLiftAssistDb === 0,
  JSON.stringify(report)
);
assert(
  'candidate reduces the limiter-bound quiet-to-loud gap',
  report.realizedAssist.gapImprovementDb > 0.1,
  JSON.stringify(report)
);
assert(
  'candidate stays below the ceiling without hard clipping',
  candidate.limiterBoundQuiet.outputPeak <= CEILING + 1e-6
    && candidate.limiterBoundQuiet.hardClippedSamples === 0,
  JSON.stringify(report)
);
assert(
  'strength-scaled transition protection closes the first-frame loudness leak',
  onsetPeakImprovementDb >= 14.5
    && onsetRmsImprovementDb >= 14
    && transitionCandidate.quietToLoud.first20Ms.rmsDb <= -27
    && transitionCandidate.quietToLoud.first40Ms.peakDb <= -23.9,
  JSON.stringify(report)
);
assert(
  'active normal programme jumps receive the same first-frame protection',
  programmeJumpPeakImprovementDb >= 14.5
    && programmeJumpRmsImprovementDb >= 14
    && transitionCandidate.normalToLoud.first20Ms.rmsDb <= -27
    && transitionCandidate.normalToLoud.first40Ms.peakDb <= -23.9,
  JSON.stringify(report)
);
assert(
  'transition protection preserves high-crest steady state and avoids hard clipping',
  Math.abs(transitionCandidate.highCrest.outputMomentaryDb - transitionBaseline.highCrest.outputMomentaryDb) < 0.5
    && transitionCandidate.highCrest.hardClippedSamples === 0,
  JSON.stringify(report)
);

console.log(JSON.stringify(report, null, 2));
if (process.exitCode) process.exit(process.exitCode);
