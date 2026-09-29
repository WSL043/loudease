// Offline/local test instrumentation only. The original processor produces PCM
// first; this observer reads it without changing samples or control state.
const crypto = require('crypto');
function instrument(source) {
  const sourceFingerprint = parseInt(crypto.createHash('sha256').update(source).digest('hex').slice(0, 12), 16);
  const anchor = "registerProcessor('wvb-leveler-processor', WebVolumeBalancerLevelerProcessor);";
  if (source.split(anchor).length !== 2) throw new Error('Quality meter registration anchor changed');
  return source.replace(anchor, `
class QualityObservedProcessor extends WebVolumeBalancerLevelerProcessor {
  constructor() {
    super();
    this.auditFilters = Array.from({length: 2}, () => ({ shelf: this.shelf, highpass: this.highpass, filterState: new Float64Array(16) }));
    this.auditHistory = [];
    this.auditSums = [0, 0];
    this.auditPeaks = [0, 0];
    this.auditCount = 0;
    this.auditTotal = 0;
    this.auditIndex = 0;
  }
  process(inputs, outputs) {
    const result = super.process(inputs, outputs);
    const output = outputs[0];
    const input = inputs[0] || [];
    if (!output || !output.length) return result;
    for (let i = 0; i < output[0].length; i++) {
      for (let ch = 0; ch < output.length; ch++) {
        const values = [input[ch]?.[i] ?? input[0]?.[i] ?? 0, output[ch][i]];
        for (let k = 0; k < 2; k++) {
          const value = WebVolumeBalancerLevelerProcessor.prototype.weightedSample.call(this.auditFilters[k], values[k], Math.min(ch, 1));
          this.auditSums[k] += value * value / output.length;
          this.auditPeaks[k] = Math.max(this.auditPeaks[k], Math.abs(values[k]));
        }
      }
      this.auditTotal++;
      if (++this.auditCount >= FRAME_SAMPLES) {
        this.auditHistory.push(this.auditSums.map(x => x / this.auditCount));
        if (this.auditHistory.length > 150) this.auditHistory.shift();
        this.auditSums = [0, 0]; this.auditCount = 0;
        if (++this.auditIndex % 5 === 0) {
          const db = count => {
            const a = this.auditHistory.slice(-count);
            return [0, 1].map(k => energyToDb(a.reduce((sum, row) => sum + row[k], 0) / a.length));
          };
          this.port.postMessage({ type: 'quality-audit', audioSeconds: this.auditTotal / sampleRate,
            sourceFingerprint: ${sourceFingerprint}, transitionProtected: this.transitionProtectionSamples > 0,
            effectiveCeilingDb: this.ceilingDb(),
            momentary: db(20), shortTerm: db(150), peaks: this.auditPeaks,
            sampleRate, channels: output.length, resetCount: this.loudnessResetCount,
            cap: this.playerVolumeCap, reliable: this.playerVolumeReliable, muted: this.targetMuteGain === 0,
            gainDb: this.currentGainDb, targetGainDb: this.targetGainDb,
            dynamicsAmount: this.programmeParams.dynamicsAmount,
            limiterReductionDb: -20 * Math.log10(Math.max(1e-12, this.limiterGain)),
            programmeDb: this.programmeState.programmeDb, confidence: this.programmeState.confidence,
            liftBudgetDb: this.lastControl?.liftBudgetDb, targetDb: this.programmeParams.programmeTargetDb,
            limitedSamples: this.reportLimitedSamples, hardClips: this.reportHardClippedSamples });
          this.auditPeaks = [0, 0];
        }
      }
    }
    return result;
  }
}
registerProcessor('wvb-leveler-processor', QualityObservedProcessor);`);
}
module.exports = { instrument };
