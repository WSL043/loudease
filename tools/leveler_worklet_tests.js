const path = require('path');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
let ProcessorClass;
global.sampleRate = SAMPLE_RATE;
global.AudioWorkletProcessor = class {
  constructor() {
    this.messages = [];
    this.port = { onmessage: null, postMessage: (message) => this.messages.push(message) };
  }
};
global.registerProcessor = (name, implementation) => {
  if (name === 'wvb-leveler-processor') ProcessorClass = implementation;
};
require(path.resolve(__dirname, '..', 'offscreen', 'leveler-worklet.js'));

function assert(name, condition, details = '') {
  if (condition) console.log(`OK   ${name}`);
  else { console.error(`FAIL ${name}${details ? `: ${details}` : ''}`); process.exitCode = 1; }
}

function configure(processor, overrides = {}, media = {}) {
  processor.port.onmessage({ data: {
    type: 'configure',
    configSequence: 1,
    settings: { enabled: true, respectPlayerVolume: true, cutStrength: 100, liftStrength: 100, ...overrides },
    playerVolumeCap: media.playerVolumeCap ?? 1,
    playerVolumeReliable: media.playerVolumeReliable ?? true,
    playerMuted: media.playerMuted ?? false,
    allowUnknownVolumeLift: media.allowUnknownVolumeLift ?? false
  } });
}

function render(processor, seconds, amplitude, startSample = 0) {
  return renderGenerated(processor, seconds, (sampleIndex) => (
    amplitude * Math.sin(2 * Math.PI * 997 * sampleIndex / SAMPLE_RATE)
  ), startSample);
}

function renderGenerated(processor, seconds, generator, startSample = 0, warmupBlocks = 2) {
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  let peak = 0;
  let energy = 0;
  let samples = 0;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i += 1) input[i] = generator(startSample + block * BLOCK_SIZE + i);
    processor.process([[input]], [[output]]);
    if (block > warmupBlocks) for (const value of output) { peak = Math.max(peak, Math.abs(value)); energy += value * value; samples += 1; }
  }
  return { peak, rms: Math.sqrt(energy / Math.max(1, samples)), samples: blocks * BLOCK_SIZE };
}

function renderImpulseTrain(processor, seconds, peakAmplitude, startSample = 0) {
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  const frameSamples = Math.round(SAMPLE_RATE * 0.02);
  let peak = 0;
  let energy = 0;
  let samples = 0;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      const absoluteSample = startSample + block * BLOCK_SIZE + i;
      input[i] = absoluteSample % frameSamples === 0 ? peakAmplitude : 0;
    }
    processor.process([[input]], [[output]]);
    if (block > 2) for (const value of output) { peak = Math.max(peak, Math.abs(value)); energy += value * value; samples += 1; }
  }
  return { peak, rms: Math.sqrt(energy / Math.max(1, samples)), samples: blocks * BLOCK_SIZE };
}

function latest(processor) { return processor.messages.filter((message) => message.type === 'state').at(-1) || {}; }

const unconfigured = new ProcessorClass();
const unconfiguredOut = render(unconfigured, 0.05, 0.2);
assert('unconfigured worklet is fail-closed', unconfiguredOut.rms < 1e-6, String(unconfiguredOut.rms));
configure(unconfigured);
assert(
  'worklet acknowledges applied configuration',
  unconfigured.messages.some((message) => message.type === 'configured' && message.configSequence === 1),
  JSON.stringify(unconfigured.messages)
);
const configuredOut = render(unconfigured, 0.1, 0.2, unconfiguredOut.samples);
assert(
  'configured worklet begins processing audio without a loud startup leak',
  configuredOut.rms > 0.01 && configuredOut.rms < 0.04,
  String(configuredOut.rms)
);
const configuredStates = unconfigured.messages.filter((message) => message.type === 'state');
assert(
  'worklet keeps sample-rate DSP while limiting diagnostic state messages to about 10 Hz',
  configuredStates.length >= 1 && configuredStates.length <= 2,
  String(configuredStates.length)
);

const zero = new ProcessorClass();
configure(zero, { cutStrength: 0, liftStrength: 0 });
const zeroOut = render(zero, 0.8, 0.2);
assert('zero strength remains unity', Math.abs(zeroOut.rms - 0.2 / Math.SQRT2) < 0.003, String(zeroOut.rms));

const loud = new ProcessorClass();
configure(loud);
const loudOut = render(loud, 1.2, 0.35);
assert('loud material is attenuated to the common target', latest(loud).currentGainDb < -15 && Math.abs(latest(loud).outputMomentaryDb - (-29)) < 1, JSON.stringify(latest(loud)));

const quiet = new ProcessorClass();
configure(quiet);
const quietOut = render(quiet, 1.2, 0.008);
assert('quiet material receives strong lift to the common target', latest(quiet).currentGainDb > 15 && Math.abs(latest(quiet).outputMomentaryDb - (-29)) < 1, JSON.stringify(latest(quiet)));
assert(
  'worklet loud and quiet outputs converge',
  Math.abs(latest(loud).outputMomentaryDb - latest(quiet).outputMomentaryDb) < 1,
  JSON.stringify({ loud: latest(loud).outputMomentaryDb, quiet: latest(quiet).outputMomentaryDb, loudRms: loudOut.rms, quietRms: quietOut.rms })
);

const lowPlayerVolumeQuiet = new ProcessorClass();
configure(lowPlayerVolumeQuiet, {}, { playerVolumeCap: 0.25, playerVolumeReliable: true });
renderImpulseTrain(lowPlayerVolumeQuiet, 1.6, Math.pow(10, -30 / 20));
assert(
  'low player volume preserves captured-domain peak headroom for high-crest quiet material',
  latest(lowPlayerVolumeQuiet).currentGainDb > 4,
  JSON.stringify(latest(lowPlayerVolumeQuiet))
);

const noHeadroom = new ProcessorClass();
configure(noHeadroom);
render(noHeadroom, 1.2, 0.75);
assert('quiet lift is unavailable without peak headroom', latest(noHeadroom).currentGainDb <= 0, JSON.stringify(latest(noHeadroom)));

const silence = new ProcessorClass();
configure(silence);
render(silence, 0.8, 0);
assert('silence is never lifted', Math.abs(latest(silence).targetGainDb || 0) < 1e-6 && latest(silence).signalActive === false, JSON.stringify(latest(silence)));

const stepped = new ProcessorClass();
configure(stepped);
render(stepped, 0.8, 0.35);
const before = latest(stepped).currentGainDb;
render(stepped, 0.02, 0.006, 40000);
const after = latest(stepped).currentGainDb;
assert('gain envelope has bounded upward steps', after - before <= 3.01, JSON.stringify({ before, after }));

const highCrest = new ProcessorClass();
configure(highCrest);
const highCrestOut = renderGenerated(highCrest, 3, (sampleIndex) => {
  const quietBed = 0.006 * Math.sin(2 * Math.PI * 997 * sampleIndex / SAMPLE_RATE);
  return sampleIndex % Math.round(SAMPLE_RATE * 0.25) === 4000 ? 0.55 : quietBed;
});
const highCrestStates = highCrest.messages.filter((message) => message.type === 'state');
const highCrestLimitedSamples = highCrestStates.reduce((sum, state) => sum + Number(state.limitedSamples || 0), 0);
const highCrestHardClips = highCrestStates.reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0);
const highCrestSteadyStates = highCrestStates.slice(Math.floor(highCrestStates.length / 2));
const highCrestSummary = highCrestSteadyStates.reduce((summary, state) => ({
  minTargetGainDb: Math.min(summary.minTargetGainDb, Number(state.targetGainDb || 0)),
  maxTargetGainDb: Math.max(summary.maxTargetGainDb, Number(state.targetGainDb || 0)),
  averageCurrentGainDb: summary.averageCurrentGainDb + (Number(state.currentGainDb || 0) / highCrestSteadyStates.length),
  averageOutputMomentaryDb: summary.averageOutputMomentaryDb + (Number(state.outputMomentaryDb || 0) / highCrestSteadyStates.length)
}), {
  minTargetGainDb: Infinity,
  maxTargetGainDb: -Infinity,
  averageCurrentGainDb: 0,
  averageOutputMomentaryDb: 0
});
const highCrestLoudGapDb = Math.abs(
  highCrestSummary.averageOutputMomentaryDb - latest(loud).outputMomentaryDb
);
assert(
  'full-strength high-crest quiet material converges through bounded limiting',
  highCrestSummary.averageCurrentGainDb > 18
    && highCrestLoudGapDb < 3.5
    && highCrestLimitedSamples > 0,
  JSON.stringify({ latest: latest(highCrest), highCrestLimitedSamples, highCrestLoudGapDb, highCrestSummary })
);
assert('high-crest lift remains below the ceiling', highCrestOut.peak <= Math.pow(10, -3 / 20) + 1e-6, String(highCrestOut.peak));
assert('high-crest lift uses lookahead limiting without hard clipping', highCrestHardClips === 0, String(highCrestHardClips));

const liftedOnset = new ProcessorClass();
configure(liftedOnset);
const liftedOnsetQuiet = render(liftedOnset, 1.2, 0.008);
const liftedOnsetLoud = renderGenerated(liftedOnset, 0.04, (sampleIndex) => (
  0.35 * Math.sin(2 * Math.PI * 997 * sampleIndex / SAMPLE_RATE)
), liftedOnsetQuiet.samples, -1);
assert(
  'loud onset after quiet lift is caught before the first audible block',
  liftedOnsetLoud.peak <= Math.pow(10, -24 / 20) + 1e-6,
  JSON.stringify({ peak: liftedOnsetLoud.peak, state: latest(liftedOnset) })
);
liftedOnset.transitionProtectionSamples = 1;
liftedOnset.cutStrength = 50;
assert(
  'transition protection depth follows the loud-cut strength',
  Math.abs(liftedOnset.ceilingDb() - (-16.5)) < 1e-9,
  String(liftedOnset.ceilingDb())
);
liftedOnset.transitionProtectionSamples = 0;
liftedOnset.cutStrength = 0;
liftedOnset.currentGainDb = 1;
assert(
  'ordinary lift keeps its -3 dBFS ceiling when cut strength is zero',
  Math.abs(liftedOnset.ceilingDb() - (-3)) < 1e-9,
  String(liftedOnset.ceilingDb())
);

const silentOnset = new ProcessorClass();
configure(silentOnset);
const silentOnsetLead = render(silentOnset, 0.2, 0);
const silentOnsetLoud = renderGenerated(silentOnset, 0.04, (sampleIndex) => (
  0.8 * Math.sin(2 * Math.PI * 997 * sampleIndex / SAMPLE_RATE)
), silentOnsetLead.samples, -1);
assert(
  'loud onset after silence is caught before the first audible block',
  silentOnsetLoud.peak <= Math.pow(10, -24 / 20) + 1e-6,
  JSON.stringify({ peak: silentOnsetLoud.peak, state: latest(silentOnset) })
);

const normalOnset = new ProcessorClass();
configure(normalOnset);
const normalOnsetLead = render(normalOnset, 1.2, 0.05);
const normalOnsetLoud = renderGenerated(normalOnset, 0.04, (sampleIndex) => (
  0.35 * Math.sin(2 * Math.PI * 997 * sampleIndex / SAMPLE_RATE)
), normalOnsetLead.samples, -1);
assert(
  'loud jump from an already active normal programme is caught before the first audible block',
  normalOnsetLoud.peak <= Math.pow(10, -24 / 20) + 1e-6,
  JSON.stringify({ peak: normalOnsetLoud.peak, state: latest(normalOnset) })
);

const limited = new ProcessorClass();
configure(limited);
const limitedOut = render(limited, 0.6, 1);
const limitedStates = limited.messages.filter((message) => message.type === 'state');
const hardClips = limitedStates.reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0);
assert('lookahead limiter respects the ceiling', limitedOut.peak <= Math.pow(10, -3 / 20) + 1e-6, String(limitedOut.peak));
assert('lookahead limiter avoids hard clipping', hardClips === 0, String(hardClips));

const runtime = new ProcessorClass();
configure(runtime, { cutStrength: 0, liftStrength: 0 });
render(runtime, 0.5, 0.35);
configure(runtime, { cutStrength: 100, liftStrength: 100 });
render(runtime, 1, 0.35, 30000);
assert('runtime setting updates change processing', latest(runtime).currentGainDb < -3, JSON.stringify(latest(runtime)));

const muted = new ProcessorClass();
configure(muted, {}, { playerMuted: true });
const mutedOut = render(muted, 0.5, 0.2);
assert('hard player mute is preserved', mutedOut.rms < 0.001, String(mutedOut.rms));

if (process.exitCode) process.exit(process.exitCode);
