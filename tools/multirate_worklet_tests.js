const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const policySource = fs.readFileSync(path.join(root, 'shared', 'programme-leveler-policy.js'), 'utf8');
const workletSource = fs.readFileSync(path.join(root, 'offscreen', 'leveler-worklet.js'), 'utf8');
const BLOCK_SIZE = 128;
const SAMPLE_RATES = [44100, 48000, 96000];
const CEILING = 10 ** (-3 / 20);

function assert(name, condition, details = '') {
  if (condition) {
    console.log(`OK   ${name}`);
    return;
  }
  console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
  process.exitCode = 1;
}

function loadProcessor(sampleRate) {
  let ProcessorClass = null;
  class AudioWorkletProcessor {
    constructor() {
      this.messages = [];
      this.port = {
        onmessage: null,
        postMessage: (message) => this.messages.push(message)
      };
    }
  }
  const context = vm.createContext({
    sampleRate,
    AudioWorkletProcessor,
    registerProcessor(name, implementation) {
      if (name === 'wvb-leveler-processor') ProcessorClass = implementation;
    }
  });
  vm.runInContext(policySource, context, { filename: 'shared/programme-leveler-policy.js' });
  vm.runInContext(workletSource, context, { filename: 'offscreen/leveler-worklet.js' });
  if (typeof ProcessorClass !== 'function') {
    throw new Error(`leveler processor did not register at ${sampleRate} Hz`);
  }
  return ProcessorClass;
}

function configure(processor, settings = {}, media = {}) {
  processor.port.onmessage({
    data: {
      type: 'configure',
      configSequence: 1,
      settings: {
        enabled: true,
        respectPlayerVolume: true,
        cutStrength: 100,
        liftStrength: 100,
        ...settings
      },
      playerVolumeCap: media.playerVolumeCap ?? 1,
      playerVolumeReliable: media.playerVolumeReliable ?? true,
      playerMuted: media.playerMuted ?? false,
      allowUnknownVolumeLift: false,
      programmeKey: 'multirate-programme'
    }
  });
}

function render(processor, sampleRate, seconds, amplitude, frequency = 997) {
  const blocks = Math.ceil(seconds * sampleRate / BLOCK_SIZE);
  let peak = 0;
  let energy = 0;
  let sampleCount = 0;
  let finite = true;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const cursor = (block * BLOCK_SIZE) + index;
      input[index] = amplitude * Math.sin(2 * Math.PI * frequency * cursor / sampleRate);
    }
    processor.process([[input]], [[output]]);
    for (const value of output) {
      finite &&= Number.isFinite(value);
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
      sampleCount += 1;
    }
  }
  return { finite, peak, rms: Math.sqrt(energy / Math.max(1, sampleCount)) };
}

function states(processor) {
  return processor.messages.filter((message) => message.type === 'state');
}

function steady(processor) {
  const all = states(processor);
  const tail = all.slice(Math.floor(all.length * 0.65));
  const average = (field) => tail.reduce((sum, state) => sum + Number(state[field] || 0), 0)
    / Math.max(1, tail.length);
  return {
    stateCount: all.length,
    inputDb: average('momentaryInputDb'),
    outputDb: average('outputMomentaryDb'),
    gainDb: average('currentGainDb'),
    hardClippedSamples: all.reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0)
  };
}

for (const sampleRate of SAMPLE_RATES) {
  const ProcessorClass = loadProcessor(sampleRate);

  const quiet = new ProcessorClass();
  configure(quiet);
  const quietOutput = render(quiet, sampleRate, 7, 0.02);
  const quietState = steady(quiet);

  const loud = new ProcessorClass();
  configure(loud);
  const loudOutput = render(loud, sampleRate, 7, 0.35);
  const loudState = steady(loud);

  const muted = new ProcessorClass();
  configure(muted, {}, { playerMuted: true });
  const mutedOutput = render(muted, sampleRate, 0.5, 0.2);

  const details = JSON.stringify({ sampleRate, quietOutput, quietState, loudOutput, loudState, mutedOutput });
  assert(`${sampleRate} Hz output remains finite`, quietOutput.finite && loudOutput.finite && mutedOutput.finite, details);
  assert(`${sampleRate} Hz quiet programme reaches useful bounded lift`, quietState.stateCount > 20 && quietState.gainDb > 16 && quietState.gainDb <= 25.01, details);
  assert(`${sampleRate} Hz loud programme reaches the calibrated range`, loudState.gainDb < -4.5 && loudState.outputDb > -19.5 && loudState.outputDb < -17.5, details);
  assert(`${sampleRate} Hz limiter remains sample-safe`, quietOutput.peak <= CEILING + 1e-6 && loudOutput.peak <= CEILING + 1e-6 && quietState.hardClippedSamples === 0 && loudState.hardClippedSamples === 0, details);
  assert(`${sampleRate} Hz preserves hard player mute`, mutedOutput.rms < 0.001, details);
}

if (process.exitCode) process.exit(process.exitCode);
