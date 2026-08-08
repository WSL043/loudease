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
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  let peak = 0;
  let energy = 0;
  let samples = 0;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i += 1) input[i] = amplitude * Math.sin(2 * Math.PI * 997 * (startSample + block * BLOCK_SIZE + i) / SAMPLE_RATE);
    processor.process([[input]], [[output]]);
    if (block > 2) for (const value of output) { peak = Math.max(peak, Math.abs(value)); energy += value * value; samples += 1; }
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
assert('configured worklet begins processing audio', configuredOut.rms > 0.05, String(configuredOut.rms));

const zero = new ProcessorClass();
configure(zero, { cutStrength: 0, liftStrength: 0 });
const zeroOut = render(zero, 0.8, 0.2);
assert('zero strength remains unity', Math.abs(zeroOut.rms - 0.2 / Math.SQRT2) < 0.003, String(zeroOut.rms));

const loud = new ProcessorClass();
configure(loud);
render(loud, 1.2, 0.35);
assert('loud material is attenuated', latest(loud).currentGainDb < -4, JSON.stringify(latest(loud)));

const quiet = new ProcessorClass();
configure(quiet);
render(quiet, 1.2, 0.008);
assert('quiet material lifts when peak headroom exists', latest(quiet).currentGainDb > 2, JSON.stringify(latest(quiet)));

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
assert('gain envelope has bounded upward steps', after - before <= 1.41, JSON.stringify({ before, after }));

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
