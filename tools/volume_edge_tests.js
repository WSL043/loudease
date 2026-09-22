const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadProcessor, render, samplePeak } = require('./true_peak_audit');
const rms = (samples) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const errorDb = (actual, expected) => 20 * Math.log10(rms(actual) / rms(expected));
function configure(p, cap, extra = {}) {
  p.port.onmessage({ data: { type: 'configure', settings: { enabled: true,
    respectPlayerVolume: true, cutStrength: 100, liftStrength: 100, targetLoudnessDb: -19 },
  playerVolumeCap: cap, playerVolumeReliable: true, playerMuted: false, programmeKey: 'same', ...extra } });
}
function audit(loader = loadProcessor) {
  const rows = [];
  for (const rate of [44100, 48000, 96000]) {
    const P = loader(rate);
    const warm = Math.ceil(rate * 3 / 128) * 128;
    for (const [from, to] of [[1, 0.5], [0.5, 1]]) {
      const a = new P(), b = new P(); configure(a, from); configure(b, from);
      const period = Math.round(rate / 480), width = Math.round(period / 10);
      const wave = (i) => i % period < width ? 0.5 * Math.sin(2 * Math.PI * (i % period) / width) : 0;
      render(a, warm, (i) => wave(i) * from); render(b, warm, (i) => wave(i) * from);
      configure(b, to);
      const x = render(a, Math.ceil(rate / 128) * 128, (i) => wave(i + warm) * from);
      const y = render(b, x.length, (i) => wave(i + warm) * to);
      const start = Math.ceil(rate * 0.01), end = Math.ceil(rate * 0.05);
      rows.push({ rate, kind: 'high-crest', from, to,
        errorDb: errorDb(y.subarray(start, end), x.subarray(start, end).map((v) => v * to / from)),
        peak: samplePeak(y) });
    }
    for (const lagMs of [0, 3, 21, 101]) {
      const a = new P(), b = new P(); configure(a, 1); configure(b, 1);
      const tone = (i) => 0.08 * Math.sin(2 * Math.PI * 997 * i / rate);
      render(a, warm, tone); render(b, warm, tone);
      const lag = Math.ceil(rate * lagMs / 1000 / 128) * 128;
      render(a, lag, (i) => tone(i + warm) * 0.25);
      render(b, lag, (i) => tone(i + warm) * 0.25);
      configure(b, 0.25);
      const x = render(a, 1024, (i) => tone(i + warm + lag) * 0.25);
      const y = render(b, 1024, (i) => tone(i + warm + lag) * 0.25);
      // Compare the pending old samples too; do not skip the look-ahead interval.
      rows.push({ rate, kind: 'pending-audio', lagMs,
        errorDb: errorDb(y.subarray(0, Math.floor(rate * 0.004)), x.subarray(0, Math.floor(rate * 0.004))),
        peak: samplePeak(y) });
      configure(b, 0, { playerMuted: true });
      rows.push({ rate, kind: 'hard-mute', peak: samplePeak(render(b, 1024, () => 0.8)) });
    }
    const burst = new P(); configure(burst, 1);
    render(burst, warm, (i) => 0.08 * Math.sin(2 * Math.PI * 997 * i / rate));
    configure(burst, 0.25);
    const loud = render(burst, Math.ceil(rate * 0.04 / 128) * 128, () => 2);
    rows.push({ rate, kind: 'real-jump', peak: samplePeak(loud),
      postLookaheadPeak: samplePeak(loud.subarray(Math.ceil(rate * 0.005) + 1)),
      allowedPeak: 0.25 * 10 ** (-13 / 20) });
  }
  return rows;
}
if (require.main === module) {
  const baseline = process.argv.includes('--baseline');
  const source = baseline ? execFileSync('git', ['show', '9456af2:offscreen/leveler-worklet.js'],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }) : undefined;
  const rows = audit((rate) => loadProcessor(rate, source));
  const target = path.resolve(__dirname, '../tmp', baseline ? 'volume-edge-baseline.json' : 'volume-edge-audit.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify(rows, null, 2));
  for (const row of rows) {
    if (row.kind === 'hard-mute') assert.equal(row.peak, 0);
    else if (row.kind === 'real-jump') assert(row.postLookaheadPeak <= row.allowedPeak + 1e-6, 'real onset still protected');
    else assert(Math.abs(row.errorDb) < 0.25, `${row.rate} ${row.kind}: ${row.errorDb} dB`);
    assert(row.peak <= 10 ** (-3 / 20) + 1e-6, 'absolute sample ceiling');
  }
}
module.exports = { audit };
