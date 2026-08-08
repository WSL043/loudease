const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TARGET_DB = -29;
const CEILING = 10 ** (-3 / 20);
const source = fs.readFileSync(path.resolve(__dirname, '..', 'offscreen', 'leveler-worklet.js'), 'utf8');

function loadProcessor(realizedAssistEnabled) {
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
  const configuredSource = source.replace(
    'const REALIZED_LIFT_ASSIST_RATIO = 0.5;',
    `const REALIZED_LIFT_ASSIST_RATIO = ${realizedAssistEnabled ? 0.5 : 0};`
  );
  vm.runInNewContext(configuredSource, context, { filename: 'leveler-worklet.js' });
  return ProcessorClass;
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
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  let outputPeak = 0;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const sampleIndex = block * BLOCK_SIZE + index;
      input[index] = generator(sampleIndex, sampleIndex / SAMPLE_RATE);
    }
    processor.process([[input]], [[output]]);
    for (const sample of output) outputPeak = Math.max(outputPeak, Math.abs(sample));
  }
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

const baselineClass = loadProcessor(false);
const candidateClass = loadProcessor(true);
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
const report = { baseline, candidate, baselineGap, candidateGap, gapImprovementDb: baselineGap - candidateGap };

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
  report.gapImprovementDb > 0.1,
  JSON.stringify(report)
);
assert(
  'candidate stays below the ceiling without hard clipping',
  candidate.limiterBoundQuiet.outputPeak <= CEILING + 1e-6
    && candidate.limiterBoundQuiet.hardClippedSamples === 0,
  JSON.stringify(report)
);

console.log(JSON.stringify(report, null, 2));
if (process.exitCode) process.exit(process.exitCode);
