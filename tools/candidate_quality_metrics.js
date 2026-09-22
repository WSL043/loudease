// Diagnostic metrics, not a perceptual score or calibrated hardware THD+N.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadProcessor, configure, render, samplePeak } = require('./true_peak_audit');
const { candidateSource } = require('./true_peak_candidate');
const db = (value) => 20 * Math.log10(Math.max(1e-12, value));

function toneMetrics(pcm, rate, frequency) {
  assert(pcm.length > 0 && pcm.every(Number.isFinite));
  let ss = 0, cc = 0, sc = 0, xs = 0, xc = 0, energy = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.sin(2 * Math.PI * frequency * i / rate);
    const c = Math.cos(2 * Math.PI * frequency * i / rate);
    ss += s * s; cc += c * c; sc += s * c;
    xs += pcm[i] * s; xc += pcm[i] * c; energy += pcm[i] ** 2;
  }
  const determinant = ss * cc - sc * sc;
  assert(determinant > 0 && energy > 0, 'tone fit requires non-silent, non-degenerate data');
  const a = (xs * cc - xc * sc) / determinant;
  const b = (xc * ss - xs * sc) / determinant;
  let residual = 0;
  const windows = [];
  const window = Math.round(rate * 0.02);
  for (let offset = 0; offset + window <= pcm.length; offset += window) {
    let sum = 0;
    for (let i = offset; i < offset + window; i += 1) sum += pcm[i] ** 2;
    windows.push(db(Math.sqrt(sum / window)));
  }
  for (let i = 0; i < pcm.length; i += 1) residual += (pcm[i]
    - a * Math.sin(2 * Math.PI * frequency * i / rate)
    - b * Math.cos(2 * Math.PI * frequency * i / rate)) ** 2;
  const rms = Math.sqrt(energy / pcm.length);
  return { residualDb: 10 * Math.log10(Math.max(1e-24, residual / energy)),
    rmsDb: db(rms), peakDb: db(samplePeak(pcm)), crestDb: db(samplePeak(pcm) / rms),
    windowRangeDb: Math.max(...windows) - Math.min(...windows) };
}

function selfTest() {
  const pure = Float32Array.from({ length: 48000 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 1000 * i / 48000 + 0.31));
  assert(toneMetrics(pure, 48000, 1000).residualDb < -120);
  const clipped = Float32Array.from(pure, (x) => Math.max(-0.1, Math.min(0.1, x)));
  assert(toneMetrics(clipped, 48000, 1000).residualDb > -20);
  assert.throws(() => toneMetrics(new Float32Array(1000), 48000, 1000));
  console.log('OK tone residual rejects clipping and accepts gain/phase changes');
}

function main() {
  selfTest();
  if (process.argv.includes('--self-test')) return;
  const source = candidateSource(), reference = candidateSource(undefined, { fused: false });
  const report = { date: new Date().toISOString(), sampleRate: 48000,
    candidateSha256: crypto.createHash('sha256').update(source).digest('hex'),
    referenceSha256: crypto.createHash('sha256').update(reference).digest('hex'), rows: [] };
  try {
    for (const frequency of [100, 997, 8000]) for (const amplitude of [0.02, 0.2, 1.2]) {
      const outputs = [source, reference].map((code) => {
        const p = new (loadProcessor(48000, code))();
        configure(p, { cutStrength: 100, liftStrength: 100 });
        return render(p, 48000 * 4, (i) => amplitude * Math.sin(2 * Math.PI * frequency * i / 48000));
      });
      assert(Buffer.from(outputs[0].buffer).equals(Buffer.from(outputs[1].buffer)), 'optimization changes PCM');
      const row = { frequency, amplitude, exactPcmMatch: true,
        settled: toneMetrics(outputs[0].subarray(48000 * 3), 48000, frequency) };
      report.rows.push(row);
      console.log(JSON.stringify(row));
    }
  } catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error); }
  const directory = path.join(__dirname, '../tmp');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'candidate-quality-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
}
if (require.main === module) main();
module.exports = { toneMetrics };
