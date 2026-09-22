const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { loadProcessor, configure, render, samplePeak, estimatedTruePeak } = require('./true_peak_audit');
const { CandidatePeakDetector, candidateSource, loadCandidate } = require('./true_peak_candidate');

const root = path.resolve(__dirname, '..');
const db = (value) => 20 * Math.log10(Math.max(1e-12, value));
const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function detectorTests() {
  for (const [name, generator, expected] of [
    ['silence', () => 0, 0], ['DC', () => 0.5, 0.5],
    ['quarter-rate sine', (i) => Math.sin(Math.PI * i / 2 + Math.PI / 4), 1]
  ]) {
    const detector = new CandidatePeakDetector();
    let peak = 0;
    for (let i = 0; i < 2048; i += 1) {
      const value = detector.push([[generator(i)], [0]], 0, 2);
      if (i >= 64) peak = Math.max(peak, value);
    }
    assert(Math.abs(peak - expected) < 0.001, `${name}: ${peak}`);
  }
  assert.throws(() => candidateSource('changed runtime'), /anchor/);
  const full = new CandidatePeakDetector();
  const pruned = new CandidatePeakDetector();
  const reference = new CandidatePeakDetector(false);
  for (let i = 0; i < 10000; i += 1) {
    const amplitude = i % 211 < 37 ? 1.2 : 0.01;
    const stereo = [[amplitude * Math.sin(i * 2.13)], [amplitude * Math.cos(i * 1.71)]];
    const ceiling = i % 97 < 20 ? 0.1 : 0.708;
    const expected = full.push(stereo, 0, 2);
    const actual = pruned.push(stereo, 0, 2, ceiling);
    assert.equal(actual, reference.push(stereo, 0, 2, ceiling), 'fused detector changes peak');
    assert.equal(Math.min(1, ceiling / Math.max(actual, 1e-12)),
      Math.min(1, ceiling / Math.max(expected, 1e-12)), 'bounded pruning changes required gain');
  }
  for (const sampleRate of [44100, 48000, 96000]) {
    const processor = new (loadCandidate(sampleRate))();
    configure(processor, { cutStrength: 0, liftStrength: 0 });
    const impulse = render(processor, 1024, (i) => i === 0 ? 0.001 : 0);
    assert.equal(impulse.findIndex((sample) => sample !== 0), Math.round(sampleRate * 0.005),
      'detector must not extend the audio delay');
    render(processor, 1024, (i) => i % 2 ? 1.2 : -1.2);
    processor.port.onmessage({ data: { type: 'configure',
      settings: { enabled: true, respectPlayerVolume: true, cutStrength: 100, liftStrength: 100 },
      playerVolumeCap: 1, playerVolumeReliable: true, playerMuted: true } });
    assert.equal(samplePeak(render(processor, 1024, (i) => i % 2 ? 1.2 : -1.2)), 0,
      'mute during active limiting must be immediately silent');
  }
  console.log('OK candidate detector calibration and fail-closed integration anchors');
}

// Retain both edges of every burst, with at least 256 samples of context for
// the long independent reconstructor. Deterministic fixtures are not listening.
function stress(sampleRate, loader) {
  const Processor = loader(sampleRate);
  const cases = [];
  for (const ratio of [0.25, 0.49, 0.5]) {
    for (const phase of [0, Math.PI / 4]) {
      cases.push([`burst-${ratio}-${phase}`, (i) => i >= 513 && i < 2561
        ? 0.95 * Math.cos(2 * Math.PI * ratio * i + phase) : 0]);
    }
  }
  cases.push(['short-alternating-bursts', (i) => i % 997 < 31 ? (i % 2 ? -0.95 : 0.95) : 0]);
  cases.push(['opposite-impulse-pairs', (i) => i % 997 === 510 ? 0.95 : i % 997 === 511 ? -0.95 : 0]);
  cases.push(['deterministic-wideband', (i) => {
    let seed = (i + 1) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
    return 0.95 * (((seed ^ (seed >>> 16)) >>> 0) / 0xffffffff * 2 - 1);
  }]);
  return cases.map(([fixture, generator]) => {
    const processor = new Processor();
    configure(processor);
    render(processor, Math.ceil(sampleRate * 3 / 128) * 128,
      (i) => 0.02 * Math.sin(2 * Math.PI * 997 * i / sampleRate));
    const output = render(processor, 4096, generator);
    const short = db(estimatedTruePeak(output));
    const long = db(estimatedTruePeak(output, 16, 128, 'blackman'));
    return { sampleRate, fixture, samplePeakDbfs: db(samplePeak(output)),
      sampleCeilingExceeded: samplePeak(output) > 10 ** (-3 / 20) + 1e-6, shortDbtp: short,
      longDbtp: long, fullScaleExceeded: Math.max(short, long) >= 0 };
  });
}

function runSequence(Processor, sampleRate, blocks) {
  const processor = new Processor();
  const output = [new Float32Array(blocks.length * 128), new Float32Array(blocks.length * 128)];
  const out = [new Float32Array(128), new Float32Array(128)];
  const blocksPerSecond = Math.ceil(sampleRate / 128);
  const start = performance.now();
  for (let block = 0; block < blocks.length; block += 1) {
    const second = Math.floor(block / blocksPerSecond);
    if (block % blocksPerSecond === 0) processor.port.onmessage({ data: {
      type: 'configure', settings: { enabled: second !== 6, respectPlayerVolume: true,
        cutStrength: 100, liftStrength: 100, targetLoudnessDb: -19 },
      playerVolumeCap: second === 4 ? 0.25 : second === 5 ? 0 : 1,
      playerVolumeReliable: true, playerMuted: second === 3 || second === 5,
      programmeKey: second >= 7 ? 'second' : 'first'
    } });
    processor.process([blocks[block]], [out]);
    for (let channel = 0; channel < 2; channel += 1) output[channel].set(out[channel], block * 128);
  }
  return { elapsedMs: performance.now() - start, output };
}

function ordinaryAndCost(sampleRate) {
  const blocksPerSecond = Math.ceil(sampleRate / 128);
  const amplitudes = [0.02, 0.12, 0.35, 0.2, 0.02, 0, 0.12, 0.008, 0.35, 0];
  const blocks = Array.from({ length: blocksPerSecond * amplitudes.length }, (_, block) => {
    const second = Math.floor(block / blocksPerSecond);
    const left = Float32Array.from({ length: 128 }, (_, i) => amplitudes[second]
      * (0.7 * Math.sin(2 * Math.PI * 997 * (block * 128 + i) / sampleRate)
        + 0.3 * Math.sin(2 * Math.PI * 217 * (block * 128 + i) / sampleRate)));
    return [left, Float32Array.from(left, (value) => -0.5 * value)];
  });
  const classes = { production: loadProcessor(sampleRate), candidate: loadCandidate(sampleRate),
    unpruned: loadProcessor(sampleRate, candidateSource(undefined, { prune: false })) };
  for (const Processor of Object.values(classes)) runSequence(Processor, sampleRate, blocks.slice(0, blocksPerSecond));
  const times = { production: [], candidate: [], unpruned: [] };
  const rendered = {};
  for (let trial = 0; trial < 3; trial += 1) {
    for (const name of trial % 2 ? ['candidate', 'unpruned', 'production'] : ['production', 'unpruned', 'candidate']) {
      rendered[name] = runSequence(classes[name], sampleRate, blocks);
      times[name].push(rendered[name].elapsedMs);
    }
  }
  for (let channel = 0; channel < 2; channel += 1) {
    assert(Buffer.from(rendered.candidate.output[channel].buffer)
      .equals(Buffer.from(rendered.unpruned.output[channel].buffer)), 'pruning must preserve candidate PCM exactly');
  }
  const sections = amplitudes.map((amplitude, second) => {
    const begin = second * blocksPerSecond * 128;
    const end = (second + 1) * blocksPerSecond * 128;
    const before = rendered.production.output[0].subarray(begin, end);
    const after = rendered.candidate.output[0].subarray(begin, end);
    if (second === 3 || second === 5) assert.equal(samplePeak(after), 0, 'mute/zero-volume boundary');
    const rmsDeltaDb = db(rms(after)) - db(rms(before));
    assert(Math.abs(rmsDeltaDb) < 0.1, 'ordinary synthetic section RMS changed by >= 0.1 dB');
    return { second, amplitude, rmsDeltaDb,
      exactPcmMatch: Buffer.from(before.buffer, before.byteOffset, before.byteLength)
        .equals(Buffer.from(after.buffer, after.byteOffset, after.byteLength)) };
  });
  let stereoError = 0;
  for (let i = 0; i < rendered.candidate.output[0].length; i += 1) {
    const left = rendered.candidate.output[0][i];
    const right = rendered.candidate.output[1][i];
    assert(Number.isFinite(left) && Number.isFinite(right));
    stereoError = Math.max(stereoError, Math.abs(right + 0.5 * left));
  }
  assert(stereoError < 1e-6, 'linked stereo ratio');
  return { sampleRate, audioSeconds: blocks.length * 128 / sampleRate, channels: 2, trialsMs: times,
    medianOverheadPercent: (median(times.candidate) / median(times.production) - 1) * 100,
    unprunedMedianOverheadPercent: (median(times.unpruned) / median(times.production) - 1) * 100,
    prunedAndUnprunedPcmMatch: true,
    sections, stereoError };
}

function main() {
  detectorTests();
  if (process.argv.includes('--self-test')) return;
  const report = { schemaVersion: 1, candidate: 'detector-4x-radius32-hold-bounded-pruning', candidateSha256:
    crypto.createHash('sha256').update(candidateSource()).digest('hex'), productionSha256:
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'))).digest('hex'),
    environment: `Node ${process.version} VM on ${process.platform}; not browser CPU or listening evidence`,
    stress: [], ordinaryAndCost: [] };
  try {
    for (const sampleRate of [44100, 48000, 96000]) {
      const baseline = stress(sampleRate, loadProcessor);
      const candidate = stress(sampleRate, loadCandidate);
      report.stress.push({ sampleRate, baseline, candidate });
      const cost = process.argv.includes('--stress-only') ? null : ordinaryAndCost(sampleRate);
      if (cost) report.ordinaryAndCost.push(cost);
      console.log(JSON.stringify({ sampleRate, baselineUnsafe: baseline.filter((v) => v.fullScaleExceeded).length,
        candidateUnsafe: candidate.filter((v) => v.fullScaleExceeded).length,
        worstCandidateDbtp: Math.max(...candidate.map((v) => Math.max(v.shortDbtp, v.longDbtp))),
        medianOverheadPercent: cost?.medianOverheadPercent, sections: cost?.sections }));
    }
  } catch (error) {
    report.error = { message: error.message, stack: error.stack };
    console.error(error);
    process.exitCode = 1;
  }
  const reportPath = path.join(root, 'tmp', process.argv.includes('--stress-only')
    ? 'true-peak-candidate-stress.json' : 'true-peak-candidate-evaluation.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
  if (report.stress.some((rate) => rate.candidate.some((fixture) => fixture.fullScaleExceeded || fixture.sampleCeilingExceeded))) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { detectorTests };
