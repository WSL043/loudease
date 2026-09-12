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

function loadProcessor(sampleRate, source = workletSource) {
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
  vm.runInContext(source, context, { filename: 'offscreen/leveler-worklet.js' });
  if (typeof ProcessorClass !== 'function') throw new Error(`production leveler processor did not register at ${sampleRate} Hz`);
  return ProcessorClass;
}

function configure(processor, settings = {}) {
  processor.port.onmessage({
    data: {
      type: 'configure',
      configSequence: 1,
      settings: {
        enabled: true,
        respectPlayerVolume: true,
        cutStrength: 0,
        liftStrength: 100,
        targetLoudnessDb: -19,
        ...settings
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
function estimatedTruePeak(samples, factor = 8, radius = 32, windowKind = 'hann') {
  if (samples.some((sample) => !Number.isFinite(sample))) throw new Error('Non-finite PCM in peak audit');
  // Each phase uses the same coefficients at every sample. Preparing them once
  // avoids millions of identical trigonometric calls during regression runs.
  const phases = Array.from({ length: factor - 1 }, (_, phase) => {
    const weights = new Float64Array(2 * radius);
    for (let tap = 0; tap < weights.length; tap += 1) {
      const distance = ((phase + 1) / factor) + radius - 1 - tap;
      const sinc = Math.sin(Math.PI * distance) / (Math.PI * distance);
      const window = windowKind === 'blackman'
        ? 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius)
        : 0.5 + 0.5 * Math.cos(Math.PI * distance / radius);
      weights[tap] = sinc * window;
    }
    return weights;
  });
  let peak = samplePeak(samples);
  for (let index = radius; index < samples.length - radius - 1; index += 1) {
    for (const weights of phases) {
      let value = 0;
      for (let tap = 0; tap < weights.length; tap += 1) {
        value += samples[index - radius + 1 + tap] * weights[tap];
      }
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return peak;
}

function assert(name, condition, details = '') {
  if (condition) {
    console.log(`OK   ${name}: ${details}`);
    return;
  }
  console.error(`FAIL ${name}: ${details}`);
  process.exitCode = 1;
}

function measurePeaks(output) {
  const measuredSamplePeak = samplePeak(output);
  const measuredTruePeak = estimatedTruePeak(output);
  // A short-filter pass must not hide a long-filter fail.
  const referencePeak = estimatedTruePeak(output, 16, 128, 'blackman');
  return { measuredSamplePeak, measuredTruePeak, referencePeak,
    fullScaleExceeded: measuredTruePeak >= TRUE_PEAK_LIMIT || referencePeak >= TRUE_PEAK_LIMIT };
}

function calibrate() {
  const sine = Float32Array.from({ length: 2048 }, (_, index) => Math.sin(Math.PI * index / 2 + Math.PI / 4));
  assert('phase-offset Fs/4 fixture has a -3.01 dBFS sample peak', Math.abs(samplePeak(sine) - Math.SQRT1_2) < 1e-6);
  for (const [factor, radius, window] of [[8, 32, 'hann'], [16, 128, 'blackman']]) {
    const name = `${factor}x ${window} radius ${radius}`;
    assert(`${name} reconstructs unity from the analytically known Fs/4 sine`, Math.abs(estimatedTruePeak(sine, factor, radius, window) - 1) < 0.001);
    assert(`${name} preserves constant level`, Math.abs(estimatedTruePeak(new Float32Array(2048).fill(0.5), factor, radius, window) - 0.5) < 0.001);
    assert(`${name} keeps silence exactly zero`, estimatedTruePeak(new Float32Array(2048), factor, radius, window) === 0);
  }
  let rejected = false;
  try { estimatedTruePeak(new Float32Array([0, NaN, 0])); } catch { rejected = true; }
  assert('detector rejects non-finite PCM instead of reporting a safe peak', rejected);
  const edge = Float32Array.from({ length: 4096 }, (_, index) => index < 512 ? 0 : (index % 2 ? -0.58 : 0.58));
  const measurements = measurePeaks(edge);
  assert('long-filter-only overshoot cannot pass the audit',
    measurements.measuredTruePeak < 1 && measurements.referencePeak > 1 && measurements.fullScaleExceeded);
}

function audit({ loader = loadProcessor, reportName = 'true-peak-audit', label = 'production' } = {}) {
  let unsafe = 0;
  const report = [];
  for (const sampleRate of SAMPLE_RATES) {
    const ProcessorClass = loader(sampleRate);
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
    // Keep the original failing waveform. Near-Nyquist sines do not replace an
    // abrupt onset at Nyquist; their reconstruction has different ringing.
    generatedFixtures.push(['alternating full scale (original counterexample)', (index) => index % 2 === 0 ? 1.2 : -1.2]);
    generatedFixtures.push(['alternating sub-full scale', (index) => index % 2 === 0 ? 0.9 : -0.9]);
    generatedFixtures.push(['phase-offset Fs/4 sub-full-scale sine', (index) => 0.95 * Math.sin(Math.PI * index / 2 + Math.PI / 4)]);

    for (const [name, generator] of generatedFixtures) {
      const processor = new ProcessorClass();
      configure(processor);
      render(processor, Math.ceil(sampleRate * 3 / BLOCK_SIZE) * BLOCK_SIZE, (index) => 0.02 * Math.sin(2 * Math.PI * 997 * index / sampleRate));
      const output = render(processor, 8192, generator);
      const { measuredSamplePeak, measuredTruePeak, referencePeak, fullScaleExceeded } = measurePeaks(output);
      const record = {
        fixture: name,
        sampleRate,
        samplePeakDbfs: 20 * Math.log10(Math.max(1e-12, measuredSamplePeak)),
        estimatedTruePeakDbtp: 20 * Math.log10(Math.max(1e-12, measuredTruePeak)),
        crossCheckDbtp: 20 * Math.log10(Math.max(1e-12, referencePeak)),
        fullScaleExceeded
      };
      report.push(record);
      const details = JSON.stringify(record);
      assert(`${sampleRate} Hz ${name} remains sample-safe`, measuredSamplePeak <= SAMPLE_CEILING + 1e-6, details);
      assert(`${sampleRate} Hz ${name} keeps estimated inter-sample peak below 0 dBTP`, !record.fullScaleExceeded, details);
      if (record.fullScaleExceeded) unsafe += 1;
    }
  }
  const result = { schemaVersion: 2, audit: 'engineering-inter-sample-peak', label, certifiedMeter: false, settings: { cutStrength: 0, liftStrength: 100, targetLoudnessDb: -19 }, unsafeFixtures: unsafe, fixtures: report };
  const reportPath = path.join(root, 'tmp', `${reportName}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`AUDIT ${unsafe}/${report.length} fixtures exceeded estimated full scale. Report: ${reportPath}`);
  return result;
}

if (require.main === module) {
  calibrate();
  if (!process.exitCode && !process.argv.includes('--self-test')) audit();
}

module.exports = { loadProcessor, configure, render, samplePeak, estimatedTruePeak, measurePeaks, audit };
