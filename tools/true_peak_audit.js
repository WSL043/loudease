const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const policySource = fs.readFileSync(path.join(root, 'shared', 'programme-leveler-policy.js'), 'utf8');
const workletSource = fs.readFileSync(path.join(root, 'offscreen', 'leveler-worklet.js'), 'utf8');
const BLOCK_SIZE = 128;
const SAMPLE_RATES = [44100, 48000, 96000];
const SAMPLE_CEILING = 10 ** (-3 / 20);
const TRUE_PEAK_LIMIT = 1;

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
  if (typeof ProcessorClass !== 'function') throw new Error(`production leveler processor did not register at ${sampleRate} Hz`);
  return ProcessorClass;
}

function configure(processor) {
  processor.port.onmessage({
    data: {
      type: 'configure',
      configSequence: 1,
      settings: {
        enabled: true,
        respectPlayerVolume: true,
        cutStrength: 0,
        liftStrength: 100,
        targetLoudnessDb: -19
      },
      playerVolumeCap: 1,
      playerVolumeReliable: true,
      playerMuted: false,
      allowUnknownVolumeLift: false,
      programmeKey: 'true-peak-audit'
    }
  });
}

function render(processor, sampleCount, generator) {
  const result = new Float32Array(sampleCount);
  for (let offset = 0; offset < sampleCount; offset += BLOCK_SIZE) {
    const length = Math.min(BLOCK_SIZE, sampleCount - offset);
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < length; index += 1) input[index] = generator(offset + index);
    processor.process([[input]], [[output]]);
    result.set(output.subarray(0, length), offset);
  }
  return result;
}

function samplePeak(samples) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return peak;
}

// A bounded 8x windowed-sinc estimate. This is an engineering stress detector,
// not a claim of standards-compliant BS.1770 true-peak metering.
function estimatedTruePeak(samples, factor = 8, radius = 32) {
  let peak = samplePeak(samples);
  for (let index = radius; index < samples.length - radius - 1; index += 1) {
    for (let phase = 1; phase < factor; phase += 1) {
      const cursor = index + (phase / factor);
      let value = 0;
      for (let sourceIndex = index - radius + 1; sourceIndex <= index + radius; sourceIndex += 1) {
        const distance = cursor - sourceIndex;
        const sinc = distance === 0 ? 1 : Math.sin(Math.PI * distance) / (Math.PI * distance);
        const window = 0.5 + (0.5 * Math.cos(Math.PI * distance / radius));
        const weight = sinc * window;
        value += samples[sourceIndex] * weight;
      }
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return peak;
}

function assert(name, condition, details) {
  if (condition) {
    console.log(`OK   ${name}: ${details}`);
    return;
  }
  console.error(`FAIL ${name}: ${details}`);
  process.exitCode = 1;
}

for (const sampleRate of SAMPLE_RATES) {
  const ProcessorClass = loadProcessor(sampleRate);
  const fixtures = [
    ['0.35 x rate sine', 0.35, 0.37],
    ['0.417 x rate sine', 5 / 12, 0.71],
    ['0.458 x rate sine', 11 / 24, 1.13],
    ['0.49 x rate near-Nyquist sine', 0.49, 0.43]
  ];
  const generatedFixtures = fixtures.map(([name, frequencyRatio, phase]) => [
    name,
    (index) => 1.2 * Math.sin(2 * Math.PI * frequencyRatio * index + phase)
  ]);
  generatedFixtures.push(['clustered impulses', (index) => index % 997 === 0 ? 1.2 : (index % 991 === 0 ? -1.2 : 0)]);

  for (const [name, generator] of generatedFixtures) {
    const processor = new ProcessorClass();
    configure(processor);
    render(processor, sampleRate * 3, (index) => 0.02 * Math.sin(2 * Math.PI * 997 * index / sampleRate));
    const output = render(processor, 8192, generator);
    const measuredSamplePeak = samplePeak(output);
    const measuredTruePeak = estimatedTruePeak(output);
    const details = JSON.stringify({
      sampleRate,
      samplePeakDbfs: 20 * Math.log10(Math.max(1e-12, measuredSamplePeak)),
      estimatedTruePeakDbtp: 20 * Math.log10(Math.max(1e-12, measuredTruePeak))
    });
    assert(`${sampleRate} Hz ${name} remains sample-safe`, measuredSamplePeak <= SAMPLE_CEILING + 1e-6, details);
    assert(`${sampleRate} Hz ${name} keeps estimated inter-sample peak below 0 dBTP`, measuredTruePeak < TRUE_PEAK_LIMIT, details);
  }
}

if (process.exitCode) process.exit(process.exitCode);
