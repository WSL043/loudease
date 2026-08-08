const FRAME_MS = 20;
const FRAME_SAMPLES = Math.max(1, Math.round(sampleRate * FRAME_MS / 1000));
const HISTORY_SIZE = 150;
const LOOKAHEAD_SAMPLES = Math.max(1, Math.round(sampleRate * 0.005));
const DELAY_LENGTH = LOOKAHEAD_SAMPLES + 1;
const DB_FLOOR_ENERGY = 1e-9;
const TARGET_RMS_DB = -29;
const LIFT_TARGET_RMS_DB = -29;
const MAX_LIFT_DB = 34;
const LIFT_LIMITER_BUDGET_DB = 15;
const QUIET_TRANSITION_CUT_MARGIN_DB = 3;
const CUT_ATTACK_SECONDS = 0.012;
const CUT_RELEASE_SECONDS = 0.18;
const LIFT_ATTACK_SECONDS = 0.10;
const LIFT_RELEASE_SECONDS = 0.25;
const MAX_GAIN_INCREASE_STEP_DB = 3;
const TARGET_DEADBAND_DB = 0.8;
const TARGET_HOLD_SECONDS = 0.08;
const LIFT_LOUDNESS_PERCENTILE = 0.5;
const LIFT_PEAK_PERCENTILE = 0.65;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function dbToLinear(value) { return Math.pow(10, value / 20); }
function linearToDb(value) { return 20 * Math.log10(Math.max(0.0001, value)); }
function energyToDb(value) { return -0.691 + 10 * Math.log10(Math.max(DB_FLOOR_ENERGY, value)); }

class WebVolumeBalancerLevelerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.energyHistory = new Float64Array(HISTORY_SIZE);
    this.peakHistory = new Float32Array(HISTORY_SIZE);
    this.outputEnergyHistory = new Float64Array(HISTORY_SIZE);
    this.percentileScratch = new Float64Array(10);
    this.historyIndex = 0;
    this.historyCount = 0;
    this.delay = [new Float32Array(DELAY_LENGTH), new Float32Array(DELAY_LENGTH)];
    this.delayIndex = 0;
    this.frameSamples = 0;
    this.inputEnergySum = 0;
    this.inputPeak = 0;
    this.outputEnergySum = 0;
    this.outputPeak = 0;
    this.sequence = 0;
    this.currentGainDb = 0;
    this.targetGainDb = 0;
    this.stableTargetGainDb = 0;
    this.targetAgeSamples = 0;
    this.signalActive = false;
    this.cutStrength = this.targetCutStrength = 0;
    this.liftStrength = this.targetLiftStrength = 0;
    this.enabled = this.targetEnabled = 0;
    this.respectPlayerVolume = true;
    this.playerVolumeCap = this.targetPlayerVolumeCap = 1;
    this.playerVolumeReliable = false;
    this.allowUnknownVolumeLift = false;
    this.muteGain = this.targetMuteGain = 0;
    this.limiterGain = 1;
    this.limitedSamples = 0;
    this.hardClippedSamples = 0;
    this.maxHardClipOvershoot = 0;
    this.signalTickCount = 0;
    this.silentTickCount = 0;
    this.limiterTickCount = 0;
    this.targetHoldCount = 0;
    this.configured = false;
    this.shelf = this.makeShelf(1681.974450955533, 3.999843853973347);
    this.highpass = this.makeHighpass(38.13547087602444, 0.5003270373238773);
    this.filterState = new Float64Array(16);
    this.port.onmessage = (event) => this.configure(event.data || {});
  }

  makeHighpass(frequency, q) {
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    return [((1 + cosine) / 2) / a0, (-(1 + cosine)) / a0, ((1 + cosine) / 2) / a0, (-2 * cosine) / a0, (1 - alpha) / a0];
  }

  makeShelf(frequency, gainDb) {
    const amplitude = Math.pow(10, gainDb / 40);
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) * Math.SQRT2 / 2;
    const root = 2 * Math.sqrt(amplitude) * alpha;
    const a0 = (amplitude + 1) - (amplitude - 1) * cosine + root;
    return [amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + root) / a0, -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine) / a0, amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - root) / a0, 2 * ((amplitude - 1) - (amplitude + 1) * cosine) / a0, ((amplitude + 1) - (amplitude - 1) * cosine - root) / a0];
  }

  configure(message) {
    if (message.type !== 'configure') return;
    const settings = message.settings || {};
    this.targetEnabled = settings.enabled === false ? 0 : 1;
    this.targetCutStrength = clamp(Number(settings.cutStrength) || 0, 0, 100);
    this.targetLiftStrength = clamp(Number(settings.liftStrength) || 0, 0, 100);
    this.respectPlayerVolume = settings.respectPlayerVolume !== false;
    this.targetPlayerVolumeCap = clamp(Number(message.playerVolumeCap), 0, 1);
    if (!Number.isFinite(this.targetPlayerVolumeCap)) this.targetPlayerVolumeCap = 1;
    this.playerVolumeReliable = message.playerVolumeReliable === true;
    this.allowUnknownVolumeLift = message.allowUnknownVolumeLift === true;
    this.targetMuteGain = this.respectPlayerVolume && message.playerMuted === true ? 0 : 1;
    if (!this.configured) {
      this.enabled = this.targetEnabled;
      this.cutStrength = this.targetCutStrength;
      this.liftStrength = this.targetLiftStrength;
      this.playerVolumeCap = this.targetPlayerVolumeCap;
      this.muteGain = this.targetMuteGain;
      this.configured = true;
    } else if (this.targetMuteGain === 0) {
      this.muteGain = 0;
    }
    this.port.postMessage({
      type: 'configured',
      configSequence: Math.max(0, Math.floor(Number(message.configSequence) || 0))
    });
  }

  weightedSample(sample, channel) {
    const offset = channel * 8;
    let x1 = this.filterState[offset];
    let x2 = this.filterState[offset + 1];
    let y1 = this.filterState[offset + 2];
    let y2 = this.filterState[offset + 3];
    let y = this.shelf[0] * sample + this.shelf[1] * x1 + this.shelf[2] * x2 - this.shelf[3] * y1 - this.shelf[4] * y2;
    x2 = x1; x1 = sample; y2 = y1; y1 = y;
    const highOffset = offset + 4;
    const z = this.highpass[0] * y + this.highpass[1] * this.filterState[highOffset] + this.highpass[2] * this.filterState[highOffset + 1] - this.highpass[3] * this.filterState[highOffset + 2] - this.highpass[4] * this.filterState[highOffset + 3];
    this.filterState[offset] = x1; this.filterState[offset + 1] = x2; this.filterState[offset + 2] = y1; this.filterState[offset + 3] = y2;
    this.filterState[highOffset + 1] = this.filterState[highOffset]; this.filterState[highOffset] = y;
    this.filterState[highOffset + 3] = this.filterState[highOffset + 2]; this.filterState[highOffset + 2] = z;
    return z;
  }

  meanLast(history, count) {
    const available = Math.min(this.historyCount, count);
    if (!available) return 0;
    let sum = 0;
    for (let i = 0; i < available; i += 1) sum += history[(this.historyIndex - 1 - i + HISTORY_SIZE) % HISTORY_SIZE];
    return sum / available;
  }

  percentileLast(history, requestedCount, percentile) {
    const count = Math.min(this.historyCount, requestedCount);
    for (let i = 0; i < count; i += 1) this.percentileScratch[i] = history[(this.historyIndex - 1 - i + HISTORY_SIZE) % HISTORY_SIZE];
    for (let i = 1; i < count; i += 1) {
      const value = this.percentileScratch[i];
      let j = i - 1;
      while (j >= 0 && this.percentileScratch[j] > value) { this.percentileScratch[j + 1] = this.percentileScratch[j]; j -= 1; }
      this.percentileScratch[j + 1] = value;
    }
    return count ? this.percentileScratch[Math.floor((count - 1) * percentile)] : 0;
  }

  finishFrame() {
    const energy = this.inputEnergySum / Math.max(1, this.frameSamples);
    const outputEnergy = this.outputEnergySum / Math.max(1, this.frameSamples);
    this.energyHistory[this.historyIndex] = energy;
    this.peakHistory[this.historyIndex] = this.inputPeak;
    this.outputEnergyHistory[this.historyIndex] = outputEnergy;
    this.historyIndex = (this.historyIndex + 1) % HISTORY_SIZE;
    this.historyCount = Math.min(HISTORY_SIZE, this.historyCount + 1);
    const momentaryDb = energyToDb(this.meanLast(this.energyHistory, 20));
    const shortTermDb = energyToDb(this.meanLast(this.energyHistory, 150));
    const controlDb = Math.max(0.8 * momentaryDb + 0.2 * shortTermDb, energyToDb(this.meanLast(this.energyHistory, 5)));
    const liftControlDb = energyToDb(this.percentileLast(this.energyHistory, 5, LIFT_LOUDNESS_PERCENTILE));
    const liftPeak = this.percentileLast(this.peakHistory, 10, LIFT_PEAK_PERCENTILE) || this.inputPeak;
    const compensationDb = this.playerVolumeReliable && this.playerVolumeCap > 0.001 && this.playerVolumeCap < 0.98 ? -linearToDb(this.playerVolumeCap) : 0;
    const gateDb = energyToDb(energy) + compensationDb;
    const gatePeak = this.inputPeak * dbToLinear(compensationDb);
    this.signalActive = gateDb > (this.signalActive ? -68 : -62) && gatePeak > (this.signalActive ? 0.000175 : 0.00035);
    let candidate = 0;
    let maxLift = MAX_LIFT_DB;
    let peakHeadroom = 0;
    let rawPeakHeadroom = 0;
    let effectiveLiftBudget = 0;
    let quietDeficit = 0;
    let requestedLift = 0;
    const cutScale = this.cutStrength / 100;
    const liftScale = this.liftStrength / 100;
    if (this.signalActive && this.enabled > 0.001 && Math.max(cutScale, liftScale) > 0.001) {
      const canLift = this.playerVolumeReliable || this.allowUnknownVolumeLift || !this.respectPlayerVolume;
      const cap = this.playerVolumeReliable && this.respectPlayerVolume ? this.playerVolumeCap : 1;
      if (!canLift) maxLift = 0;
      else if (this.respectPlayerVolume && cap <= 0.001) maxLift = 0;
      else if (this.respectPlayerVolume && cap < 0.98) maxLift = clamp((LIFT_TARGET_RMS_DB + linearToDb(cap)) - liftControlDb, 0, MAX_LIFT_DB);
      const ceilingDb = this.respectPlayerVolume && this.playerVolumeReliable ? -3 + Math.min(0, linearToDb(cap)) : -3;
      const peakDb = linearToDb(this.inputPeak);
      // Loudness is compensated to judge the source independently of the player's
      // volume. Peak headroom stays in the captured/output domain because the
      // limiter ceiling already includes that player-volume attenuation.
      const liftPeakDb = linearToDb(liftPeak);
      quietDeficit = Math.max(0, LIFT_TARGET_RMS_DB - (liftControlDb + compensationDb));
      const loudnessControl = quietDeficit > 0
        ? Math.min(controlDb, liftControlDb + compensationDb + QUIET_TRANSITION_CUT_MARGIN_DB)
        : controlDb;
      const loudnessCut = Math.max(0, loudnessControl - TARGET_RMS_DB) * (0.65 + 0.35 * cutScale);
      const peakCut = Math.max(0, peakDb - (-6));
      const reduction = clamp(Math.max(loudnessCut, peakCut * (1 - 0.5 * clamp(quietDeficit / 12, 0, 1))) * cutScale, 0, 30 * cutScale);
      peakHeadroom = ceilingDb - liftPeakDb - 2;
      rawPeakHeadroom = ceilingDb - peakDb - 0.5;
      effectiveLiftBudget = Math.min(peakHeadroom, rawPeakHeadroom) + (LIFT_LIMITER_BUDGET_DB * liftScale);
      requestedLift = quietDeficit * liftScale;
      const lift = clamp(Math.min(requestedLift, effectiveLiftBudget), 0, maxLift * liftScale);
      candidate = clamp(Math.min(lift - reduction, effectiveLiftBudget), -30 * cutScale, maxLift * liftScale);
    }
    if (!this.signalActive) {
      this.stableTargetGainDb = 0;
      this.targetAgeSamples = 0;
      this.silentTickCount += 1;
    } else {
      const delta = candidate - this.stableTargetGainDb;
      if (delta < -TARGET_DEADBAND_DB || (delta > TARGET_DEADBAND_DB && this.targetAgeSamples >= sampleRate * TARGET_HOLD_SECONDS)) { this.stableTargetGainDb = candidate; this.targetAgeSamples = 0; }
      else { this.targetHoldCount += 1; this.targetAgeSamples += this.frameSamples; }
      this.signalTickCount += 1;
    }
    this.targetGainDb = this.stableTargetGainDb;
    const outputMomentaryDb = energyToDb(this.meanLast(this.outputEnergyHistory, 20));
    const outputShortTermDb = energyToDb(this.meanLast(this.outputEnergyHistory, 150));
    this.port.postMessage({ type: 'state', sequence: this.sequence++, lastInputDb: energyToDb(energy), momentaryInputDb: momentaryDb, shortTermInputDb: shortTermDb, controlInputDb: controlDb, liftControlInputDb: liftControlDb, lastPeak: this.inputPeak, liftPeak, lastOutputDb: energyToDb(outputEnergy), outputMomentaryDb, outputShortTermDb, outputControlDb: 0.8 * outputMomentaryDb + 0.2 * outputShortTermDb, lastOutputPeak: this.outputPeak, currentGainDb: this.currentGainDb, currentLiftDb: Math.max(0, this.currentGainDb), currentReductionDb: Math.max(0, -this.currentGainDb), currentLimiterReductionDb: Math.max(0, -linearToDb(this.limiterGain)), targetGainDb: this.targetGainDb, targetLiftDb: Math.max(0, this.targetGainDb), targetReductionDb: Math.max(0, -this.targetGainDb), effectiveMaxLiftDb: maxLift, playerVolumeLiftCeilingDb: LIFT_TARGET_RMS_DB + (this.playerVolumeReliable ? Math.min(0, linearToDb(this.playerVolumeCap)) : 0), effectiveLimiterCeilingDb: this.ceilingDb(), peakHeadroomDb: peakHeadroom, rawPeakHeadroomDb: rawPeakHeadroom, liftLimiterBudgetDb: LIFT_LIMITER_BUDGET_DB * liftScale, effectiveLiftBudgetDb: effectiveLiftBudget, quietDeficitDb: quietDeficit, requestedLiftDb: requestedLift, signalActive: this.signalActive, signalTickCount: this.signalTickCount, silentTickCount: this.silentTickCount, limiterTickCount: this.limiterTickCount, targetHoldCount: this.targetHoldCount, workletInputPeak: this.inputPeak, workletOutputPeak: this.outputPeak, limitedSamples: this.limitedSamples, hardClippedSamples: this.hardClippedSamples, maxHardClipOvershoot: this.maxHardClipOvershoot });
    this.frameSamples = 0; this.inputEnergySum = 0; this.inputPeak = 0; this.outputEnergySum = 0; this.outputPeak = 0; this.limitedSamples = 0; this.hardClippedSamples = 0; this.maxHardClipOvershoot = 0;
  }

  ceilingDb() {
    const base = this.currentGainDb > 0.01 ? -3 : -3 * (this.cutStrength / 100);
    return this.respectPlayerVolume && this.playerVolumeReliable ? base + Math.min(0, linearToDb(this.playerVolumeCap)) : base;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;
    const frames = output[0].length;
    const settingAlpha = 1 - Math.exp(-1 / (sampleRate * 0.03));
    const muteAlpha = 1 - Math.exp(-1 / (sampleRate * 0.008));
    const limiterRelease = 1 - Math.exp(-1 / (sampleRate * 0.08));
    for (let frame = 0; frame < frames; frame += 1) {
      this.cutStrength += (this.targetCutStrength - this.cutStrength) * settingAlpha;
      this.liftStrength += (this.targetLiftStrength - this.liftStrength) * settingAlpha;
      this.enabled += (this.targetEnabled - this.enabled) * settingAlpha;
      this.playerVolumeCap += (this.targetPlayerVolumeCap - this.playerVolumeCap) * settingAlpha;
      this.muteGain += (this.targetMuteGain - this.muteGain) * muteAlpha;
      const seconds = this.targetGainDb < this.currentGainDb && this.targetGainDb < 0 ? CUT_ATTACK_SECONDS : this.targetGainDb > this.currentGainDb && this.currentGainDb < 0 ? CUT_RELEASE_SECONDS : this.targetGainDb > this.currentGainDb ? LIFT_ATTACK_SECONDS : LIFT_RELEASE_SECONDS;
      const gainAlpha = 1 - Math.exp(-1 / (sampleRate * seconds));
      const gainDelta = (this.targetGainDb - this.currentGainDb) * gainAlpha;
      this.currentGainDb += Math.min(gainDelta, MAX_GAIN_INCREASE_STEP_DB / FRAME_SAMPLES);
      const levelGain = dbToLinear(this.currentGainDb) * this.enabled + (1 - this.enabled);
      let futurePeak = 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        const sample = source ? source[frame] || 0 : 0;
        this.delay[channel][this.delayIndex] = sample * levelGain;
        futurePeak = Math.max(futurePeak, Math.abs(sample * levelGain));
        const weighted = this.weightedSample(sample, Math.min(channel, 1));
        this.inputEnergySum += weighted * weighted / output.length;
        this.inputPeak = Math.max(this.inputPeak, Math.abs(sample));
      }
      const ceiling = dbToLinear(this.ceilingDb());
      const required = futurePeak > ceiling ? ceiling / Math.max(futurePeak, 1e-12) : 1;
      if (required < this.limiterGain) { this.limiterGain = required; this.limitedSamples += 1; this.limiterTickCount += 1; }
      else this.limiterGain += (1 - this.limiterGain) * limiterRelease;
      const readIndex = (this.delayIndex + 1) % DELAY_LENGTH;
      let delayedPeak = 0;
      for (let channel = 0; channel < output.length; channel += 1) delayedPeak = Math.max(delayedPeak, Math.abs(this.delay[channel][readIndex]));
      if (delayedPeak * this.limiterGain > ceiling) {
        this.limiterGain = ceiling / Math.max(delayedPeak, 1e-12);
        this.limitedSamples += 1;
        this.limiterTickCount += 1;
      }
      for (let channel = 0; channel < output.length; channel += 1) {
        let sample = this.delay[channel][readIndex] * this.limiterGain * this.muteGain;
        if (sample > ceiling) { this.maxHardClipOvershoot = Math.max(this.maxHardClipOvershoot, sample - ceiling); sample = ceiling; this.hardClippedSamples += 1; }
        else if (sample < -ceiling) { this.maxHardClipOvershoot = Math.max(this.maxHardClipOvershoot, -sample - ceiling); sample = -ceiling; this.hardClippedSamples += 1; }
        output[channel][frame] = sample;
        this.outputEnergySum += sample * sample / output.length;
        this.outputPeak = Math.max(this.outputPeak, Math.abs(sample));
      }
      this.delayIndex = readIndex;
      this.frameSamples += 1;
      if (this.frameSamples >= FRAME_SAMPLES) this.finishFrame();
    }
    return true;
  }
}

registerProcessor('wvb-leveler-processor', WebVolumeBalancerLevelerProcessor);
