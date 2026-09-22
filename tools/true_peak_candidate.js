// Offline-only candidate. No extension module imports this file; build allowlists
// exclude tools. Do not promote without the DSP_EVALUATION listening/runtime gates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadProcessor, audit } = require('./true_peak_audit');

const root = path.resolve(__dirname, '..');

// A causal 4x, 64-tap-per-phase Hann sinc detector. The detector's 32-sample
// observation delay fits inside the existing 5 ms audio delay. It does not
// resample the output or add to the audio delay. This is not a certified meter.
class CandidatePeakDetector {
  constructor() {
    this.radius = 32;
    this.length = this.radius * 2;
    this.index = 0;
    this.chunkSamples = 0;
    this.currentChunkPeak = 0;
    this.previousChunkPeak = 0;
    this.history = [new Float64Array(this.length * 2), new Float64Array(this.length * 2)];
    this.weights = Array.from({ length: 3 }, (_, phase) => {
      const weights = new Float64Array(this.length);
      let sum = 0;
      for (let tap = 0; tap < this.length; tap += 1) {
        const distance = (phase + 1) / 4 + this.radius - 1 - tap;
        weights[tap] = Math.sin(Math.PI * distance) / (Math.PI * distance)
          * (0.5 + 0.5 * Math.cos(Math.PI * distance / this.radius));
        sum += weights[tap];
      }
      for (let tap = 0; tap < weights.length; tap += 1) weights[tap] /= sum;
      return weights;
    });
    this.absoluteWeightSum = Math.max(...this.weights.map((weights) =>
      weights.reduce((sum, value) => sum + Math.abs(value), 0)));
  }

  reset() {
    for (const channel of this.history) channel.fill(0);
    this.currentChunkPeak = this.previousChunkPeak = this.chunkSamples = this.index = 0;
  }

  push(delay, delayIndex, channels, ceiling = 0) {
    let peak = 0;
    for (let channel = 0; channel < this.history.length; channel += 1) {
      const history = this.history[channel];
      const sample = channel < channels ? delay[channel][delayIndex] : 0;
      history[this.index] = history[this.index + this.length] = sample;
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > peak) peak = magnitude;
    }
    if (peak > this.currentChunkPeak) this.currentChunkPeak = peak;
    // Two adjacent length-sized chunks cover the entire FIR history. The
    // triangle inequality bounds every reconstructed phase even with stereo
    // cancellation, so quiet blocks need no FIR multiplies. The history still
    // advances while skipped. This bound is conservative, never a heuristic.
    const bound = (this.currentChunkPeak > this.previousChunkPeak
      ? this.currentChunkPeak : this.previousChunkPeak) * this.absoluteWeightSum;
    if (bound > ceiling) for (let channel = 0; channel < channels; channel += 1) {
      const history = this.history[channel];
      for (const weights of this.weights) {
        let value = 0;
        for (let tap = 0; tap < this.length; tap += 1) {
          value += history[this.index + 1 + tap] * weights[tap];
        }
        const magnitude = value < 0 ? -value : value;
        if (magnitude > peak) peak = magnitude;
      }
    }
    this.chunkSamples += 1;
    if (this.chunkSamples === this.length) {
      this.previousChunkPeak = this.currentChunkPeak;
      this.currentChunkPeak = 0;
      this.chunkSamples = 0;
    }
    this.index = (this.index + 1) % this.length;
    return peak;
  }
}

function candidateSource(source = fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'), 'utf8'), { prune = true } = {}) {
  let result = source.replace(/\r\n/g, '\n');
  function replaceOnce(anchor, replacement) {
    assert.equal(result.split(anchor).length, 2, `Candidate integration anchor must occur once: ${anchor}`);
    result = result.replace(anchor, replacement);
  }
  replaceOnce('    this.delayIndex = 0;', '    this.delayIndex = 0;\n    this.candidatePeakDetector = new CandidatePeakDetector();\n    this.candidatePeakHold = 0;\n    this.candidateBoundaryCeiling = 0;\n    this.candidateBoundarySamples = 0;');
  replaceOnce('    this.filterState.fill(0);', '    this.filterState.fill(0);\n    this.candidatePeakDetector.reset();\n    this.candidatePeakHold = 0;\n    this.candidateBoundarySamples = 0;\n    this.candidateBoundaryCeiling = 0;');
  // Do not scale actual FIR history when metadata arrives. Its old PCM may
  // already be attenuated. Retain the greater boundary only until the old
  // audio/detector support drains; current sample checks remain independent.
  replaceOnce('      const ratio = previousSourceVolumeGain / this.sourceVolumeGain;',
    `      const ratio = previousSourceVolumeGain / this.sourceVolumeGain;
      if (ratio !== 1) {
        this.candidateBoundaryCeiling = Math.max(
          this.candidateBoundarySamples > 0 ? this.candidateBoundaryCeiling : 0,
          dbToLinear(BASE_LIMITER_CEILING_DB) / previousSourceVolumeGain);
        this.candidateBoundarySamples = LOOKAHEAD_SAMPLES + this.candidatePeakDetector.length;
      }`);
  replaceOnce('      const required = futurePeak > ceiling ? ceiling / Math.max(futurePeak, 1e-12) : 1;',
    `      const base = this.delayBaseCeiling[this.delayIndex];
      const detectorCeiling = Math.max(base,
        this.candidateBoundarySamples > 0 ? this.candidateBoundaryCeiling : 0) * ceiling / base;
      if (this.candidateBoundarySamples > 0) this.candidateBoundarySamples -= 1;
      const detectedPeak = this.candidatePeakDetector.push(this.delay, this.delayIndex,
        output.length, ${prune ? 'detectorCeiling' : '0'});
      const required = Math.min(futurePeak > ceiling ? ceiling / Math.max(futurePeak, 1e-12) : 1,
        detectedPeak > detectorCeiling ? detectorCeiling / Math.max(detectedPeak, 1e-12) : 1);`);
  replaceOnce('        this.limiterGain = required;', `        this.limiterGain = required;
        this.candidatePeakHold = LOOKAHEAD_SAMPLES + 2 * this.candidatePeakDetector.radius;`);
  replaceOnce('        this.limiterGain += (1 - this.limiterGain) * limiterRelease;',
    `        if (this.candidatePeakHold > 0) this.candidatePeakHold -= 1;
        else this.limiterGain += (1 - this.limiterGain) * limiterRelease;`);
  return `${CandidatePeakDetector.toString()}\n${result}`;
}

function loadCandidate(sampleRate) {
  return loadProcessor(sampleRate, candidateSource());
}

if (require.main === module) {
  audit({ loader: loadCandidate, reportName: 'true-peak-candidate-audit', label: 'experimental-detector-4x-hold' });
}

module.exports = { CandidatePeakDetector, candidateSource, loadCandidate };
