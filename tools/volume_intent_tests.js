const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadProcessor, render, samplePeak } = require('./true_peak_audit');

function configure(processor, cap = 1, extra = {}) {
  processor.port.onmessage({ data: { type: 'configure', settings: {
    enabled: true, respectPlayerVolume: true, cutStrength: 100, liftStrength: 100,
    targetLoudnessDb: -19 }, playerVolumeCap: cap, playerVolumeReliable: true,
    playerMuted: cap === 0, programmeKey: 'same-source', ...extra } });
}
const db = (value) => 20 * Math.log10(Math.max(1e-12, value));
function rms(samples) { return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); }

function audit(loader = loadProcessor) {
  const report = [];
  for (const sampleRate of [44100, 48000, 96000]) for (const amplitude of [0.008, 0.08, 0.35]) {
    const Processor = loader(sampleRate);
    const reference = new Processor();
    const controlled = new Processor();
    configure(reference);
    configure(controlled);
    const second = Math.ceil(sampleRate / 128) * 128;
    let cursor = 0;
    function segment(cap, seconds) {
      configure(controlled, cap);
      const source = (i) => amplitude * Math.sin(2 * Math.PI * 997 * (cursor + i) / sampleRate);
      const before = render(reference, second * seconds, source);
      const after = render(controlled, second * seconds, (i) => source(i) * cap);
      cursor += second * seconds;
      return { before, after };
    }
    segment(1, 3);
    const transitions = [];
    for (const cap of [0.25, 1, 0.1, 1]) {
      const { before, after } = segment(cap, 3);
      const frames = [];
      const window = Math.round(sampleRate * 0.02);
      // Wait only for the original 5 ms audio delay, not controller settling.
      for (let offset = Math.round(sampleRate * 0.01); offset + window <= sampleRate; offset += window) {
        frames.push(db(rms(after.subarray(offset, offset + window)))
          - db(rms(before.subarray(offset, offset + window))) - db(cap));
      }
      const settledErrorDb = db(rms(after.subarray(after.length - second)))
        - db(rms(before.subarray(before.length - second))) - db(cap);
      transitions.push({ cap, settledErrorDb, worstFirstSecondErrorDb: Math.max(...frames.map(Math.abs)),
        programmeDriftDb: controlled.programmeState.programmeDb - reference.programmeState.programmeDb });
    }
    const boundary = new Processor();
    configure(boundary);
    render(boundary, second * 3, (i) => 0.8 * Math.sin(2 * Math.PI * 997 * i / sampleRate));
    configure(boundary, 1, { programmeKey: 'new-silent-source' });
    const boundaryOutput = render(boundary, 1024, () => 0);
    const firstNewFrameEnergy = boundary.energyHistory[0];
    configure(boundary, 0, { playerMuted: false });
    const zeroVolumePeak = samplePeak(render(boundary, 1024, () => 0.2));
    report.push({ sampleRate, amplitude, transitions, oldProgrammeLeakPeakDbfs: db(samplePeak(boundaryOutput)),
      firstNewFrameEnergy, zeroVolumePeak });
  }
  return report;
}

function metadataLagAudit(loader = loadProcessor) {
  const rate = 48000;
  const Processor = loader(rate);
  const results = [];
  for (const delayBlocks of [0, 1, 8, 38]) for (const [from, to] of [[0.1, 1], [1, 0.1]]) {
    const processor = new Processor();
    const reference = new Processor();
    configure(processor, from); configure(reference, to);
    const tone = (index) => 0.08 * Math.sin(2 * Math.PI * 997 * index / rate);
    render(processor, rate * 3, (i) => tone(i) * from);
    render(reference, rate * 3, (i) => tone(i) * to);
    const expected = render(reference, rate, (i) => tone(i) * to);
    const output = new Float32Array(rate);
    for (let block = 0; block < rate / 128; block += 1) {
      if (block === delayBlocks) configure(processor, to);
      const rendered = render(processor, 128, (i) => tone(block * 128 + i) * to);
      output.set(rendered, block * 128);
    }
    const settledErrorDb = db(rms(output.subarray(rate / 2))) - db(rms(expected.subarray(rate / 2)));
    const peak = samplePeak(output);
    results.push({ metadataDelayMs: delayBlocks * 128 / rate * 1000, from, to, peak, settledErrorDb });
  }
  return results;
}

if (require.main === module) {
  const baseline = process.argv.includes('--baseline');
  const source = baseline ? execFileSync('git', ['show', '475d29ce92d63f92fa73a3b816177b86afd5afbe:offscreen/leveler-worklet.js'],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }) : undefined;
  const report = audit((rate) => loadProcessor(rate, source));
  const metadataLag = metadataLagAudit((rate) => loadProcessor(rate, source));
  const target = path.resolve(__dirname, '..', 'tmp', baseline ? 'volume-intent-baseline.json' : 'volume-intent-audit.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ aligned: report, metadataLag }, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  for (const row of report) {
    assert.equal(row.oldProgrammeLeakPeakDbfs, -240, 'no old programme PCM after a source boundary');
    assert.equal(row.firstNewFrameEnergy, 0, 'no partial old measurement frame after a source boundary');
    assert.equal(row.zeroVolumePeak, 0, 'zero-volume worklet boundary without a separate mute flag');
    for (const step of row.transitions) {
      assert(Math.abs(step.settledErrorDb) < 0.25, 'settled player-volume intent');
      assert(step.worstFirstSecondErrorDb < 0.25, 'player volume is not a source-loudness event');
      assert(Math.abs(step.programmeDriftDb) < 0.01, 'player volume does not corrupt programme history');
    }
  }
  for (const row of metadataLag) {
    assert(row.peak <= 10 ** (-3 / 20) + 1e-6, 'asynchronous player metadata remains sample-safe');
    assert(Math.abs(row.settledErrorDb) < 0.5, 'asynchronous volume changes recover within the second half-second');
  }
  console.log(JSON.stringify({ metadataLag }, null, 2));
}
module.exports = { audit, metadataLagAudit };
