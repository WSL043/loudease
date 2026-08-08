globalThis.__WVB_OFFSCREEN_READY__ = 'script-start';
globalThis.addEventListener('error', (event) => {
  globalThis.__WVB_OFFSCREEN_ERROR__ = String(event?.error?.message || event?.message || event);
});
globalThis.addEventListener('unhandledrejection', (event) => {
  globalThis.__WVB_OFFSCREEN_ERROR__ = String(event?.reason?.message || event?.reason || event);
});

let ENGINE_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
if (ENGINE_VERSION === 'unknown' && chrome.runtime?.getURL) {
  fetch(chrome.runtime.getURL('manifest.json'))
    .then((response) => response.json())
    .then((manifest) => {
      ENGINE_VERSION = String(manifest?.version || ENGINE_VERSION);
    })
    .catch(() => {});
}
const STATUS_INTERVAL_MS = 1000;
const STARTUP_FADE_SECONDS = 0.01;
const METER_INTERVAL_MS = 20;
const MEDIA_STATE_STALE_MS = 5000;
const PIPELINE_MODE = 'leveler-v3';
const TARGET_RMS_DB = -29;
const NOISE_FLOOR_DB = -62;
const SIGNAL_PEAK_FLOOR = 0.00035;
const MAX_LIFT_DB = 12;
const MAX_CUT_DB = 30;
const LIMITER_CEILING_DB = -3;
const LIMITER_LOOKAHEAD_MS = 5;
const PEAK_GUARD_DB = -6;
const CUT_ATTACK_SECONDS = 0.012;
const CUT_RELEASE_SECONDS = 0.18;
const LIFT_ATTACK_SECONDS = 0.35;
const LIFT_RELEASE_SECONDS = 0.25;
const MAX_GAIN_INCREASE_STEP_DB = 1.4;
const FAST_CUT_HISTORY_FRAMES = 5;
const MOMENTARY_HISTORY_FRAMES = 20;
const SHORT_TERM_HISTORY_FRAMES = 150;
const LIFT_CONTROL_HISTORY_FRAMES = 10;
const MAX_HISTORY_FRAMES = SHORT_TERM_HISTORY_FRAMES;
const LIFT_PEAK_PERCENTILE = 0.65;
const TARGET_DEADBAND_DB = 0.8;
const TARGET_HOLD_MS = 200;

const {
  DEFAULT_LEVELER_PARAMS,
  K_WEIGHTING_PARAMS,
  finite,
  normalizeSettings,
  strengthScale,
  dbToLinear,
  energyToDb,
  linearToDb,
  meanLast,
  computeDualWindowLoudnessDb,
  stabilizeGainTarget,
  computeSignalGateActive,
  computeLevelerGainDb,
  computePlayerVolumeBoundedMaxLiftDb,
  computePlayerVolumeLimiterCeilingDb,
  computeProcessingLimiterCeilingDb
} = globalThis.WebVolumeBalancerCore;

const sessions = new Map();
const startTokens = new Map();
let nextStartToken = 1;

let settings = {
  enabled: true,
  respectPlayerVolume: true,
  cutStrength: 100,
  liftStrength: 100
};

function trackSummary(track) {
  return {
    kind: String(track?.kind || ''),
    id: String(track?.id || ''),
    label: String(track?.label || ''),
    enabled: Boolean(track?.enabled),
    muted: Boolean(track?.muted),
    readyState: String(track?.readyState || '')
  };
}

function streamSummary(stream) {
  const tracks = typeof stream?.getTracks === 'function' ? stream.getTracks() : [];
  const audioTracks = typeof stream?.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
  return {
    trackCount: tracks.length,
    audioTrackCount: audioTracks.length,
    tracks: tracks.map(trackSummary),
    audioTracks: audioTracks.map(trackSummary)
  };
}

function sendCaptureStatus(status) {
  chrome.runtime.sendMessage({
    type: 'WVB_CAPTURE_STATUS',
    status: {
      engineVersion: ENGINE_VERSION,
      pipelineMode: PIPELINE_MODE,
      ...status
    }
  }).catch(() => {});
}

function readEnergy(analyser, samples) {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sum += sample * sample;
  }
  return { energy: sum / samples.length, peak };
}

function pushBounded(target, value, maxLength) {
  target.push(value);
  if (target.length > maxLength) {
    target.splice(0, target.length - maxLength);
  }
}

function percentileLast(values, count, percentile) {
  if (!values.length) {
    return 0;
  }
  const start = Math.max(0, values.length - count);
  const slice = values.slice(start).sort((a, b) => a - b);
  if (!slice.length) {
    return 0;
  }
  const index = Math.min(slice.length - 1, Math.max(0, Math.floor((slice.length - 1) * percentile)));
  return slice[index];
}

class CaptureSession {
  constructor(tabId, stream, initialSettings = settings) {
    this.tabId = tabId;
    this.stream = stream;
    this.settings = normalizeSettings(initialSettings);
    this.context = null;
    this.source = null;
    this.outputGain = null;
    this.leveler = null;
    this.levelerMode = 'none';
    this.levelerError = '';
    this.kShelf = null;
    this.kHighpass = null;
    this.outputKShelf = null;
    this.outputKHighpass = null;
    this.measurementSink = null;
    this.meter = null;
    this.meterMode = 'none';
    this.meterError = '';
    this.meterSequence = -1;
    this.lastMeterFrameAt = 0;
    this.limiter = null;
    this.limiterMode = 'none';
    this.limiterError = '';
    this.workletLimitedSamples = 0;
    this.workletInputPeak = 0;
    this.workletOutputPeak = 0;
    this.workletHardClippedSamples = 0;
    this.workletMaxHardClipOvershoot = 0;
    this.playerGain = null;
    this.startupGain = null;
    this.startupGateOpen = false;
    this.levelerConfigSequence = 0;
    this.levelerConfiguredSequence = 0;
    this.inputAnalyser = null;
    this.weightedAnalyser = null;
    this.outputAnalyser = null;
    this.inputSamples = null;
    this.weightedSamples = null;
    this.outputSamples = null;
    this.state = 'stream-created';
    this.error = '';
    this.startedAt = Date.now();
    this.lastSignalAt = 0;
    this.lastInputDb = null;
    this.controlInputDb = null;
    this.momentaryInputDb = null;
    this.shortTermInputDb = null;
    this.liftControlInputDb = null;
    this.lastPeak = 0;
    this.liftPeak = 0;
    this.lastOutputDb = null;
    this.outputMomentaryDb = null;
    this.outputShortTermDb = null;
    this.outputControlDb = null;
    this.lastOutputPeak = 0;
    this.currentGainDb = 0;
    this.currentLiftDb = 0;
    this.currentReductionDb = 0;
    this.currentLimiterReductionDb = 0;
    this.targetGainDb = 0;
    this.targetLiftDb = 0;
    this.targetReductionDb = 0;
    this.stableTargetGainDb = 0;
    this.targetChangedAt = this.startedAt;
    this.targetHoldCount = 0;
    this.effectiveMaxLiftDb = MAX_LIFT_DB;
    this.playerVolumeLiftCeilingDb = DEFAULT_LEVELER_PARAMS.liftTargetRmsDb;
    this.effectiveLimiterCeilingDb = LIMITER_CEILING_DB;
    this.peakHeadroomDb = 0;
    this.quietDeficitDb = 0;
    this.requestedLiftDb = 0;
    this.rawPeakHeadroomDb = 0;
    this.energyHistory = [];
    this.peakHistory = [];
    this.outputEnergyHistory = [];
    this.playerVolumeCap = 1;
    this.playerMaxVolumeCap = 1;
    this.playerMinVolumeCap = 1;
    this.playerVolumeKnown = false;
    this.playerVolumeConflict = false;
    this.playerMuted = false;
    this.limiterSafetyLiftActive = false;
    this.playerActiveMediaCount = 0;
    this.tabAudibleHint = false;
    this.mediaStateReceivedAt = 0;
    this.signalTickCount = 0;
    this.silentTickCount = 0;
    this.limiterTickCount = 0;
    this.loudnessResetCount = 0;
    this.signalActive = false;
    this.destroyed = false;
    this.meterTimer = 0;
    this.statusTimer = 0;
    this.trackListeners = [];
  }

  setState(state, error = '') {
    this.state = state;
    this.error = error;
    this.report();
  }

  async start() {
    try {
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('Captured stream has no audio track');
      }

      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.context.addEventListener('statechange', () => {
        if (this.destroyed) {
          return;
        }
        this.setState(this.context.state === 'running' ? 'processing' : this.context.state);
      });
      this.setState('audio-context-created');

      this.source = this.context.createMediaStreamSource(this.stream);
      this.outputGain = this.context.createGain();
      this.outputGain.gain.value = 1;
      this.kShelf = this.context.createBiquadFilter();
      this.kShelf.type = 'highshelf';
      this.kShelf.frequency.value = K_WEIGHTING_PARAMS.shelfFrequencyHz;
      this.kShelf.gain.value = K_WEIGHTING_PARAMS.shelfGainDb;
      this.kHighpass = this.context.createBiquadFilter();
      this.kHighpass.type = 'highpass';
      this.kHighpass.frequency.value = K_WEIGHTING_PARAMS.highpassFrequencyHz;
      this.kHighpass.Q.value = K_WEIGHTING_PARAMS.highpassQ;
      this.outputKShelf = this.context.createBiquadFilter();
      this.outputKShelf.type = 'highshelf';
      this.outputKShelf.frequency.value = K_WEIGHTING_PARAMS.shelfFrequencyHz;
      this.outputKShelf.gain.value = K_WEIGHTING_PARAMS.shelfGainDb;
      this.outputKHighpass = this.context.createBiquadFilter();
      this.outputKHighpass.type = 'highpass';
      this.outputKHighpass.frequency.value = K_WEIGHTING_PARAMS.highpassFrequencyHz;
      this.outputKHighpass.Q.value = K_WEIGHTING_PARAMS.highpassQ;
      this.measurementSink = this.context.createGain();
      this.measurementSink.gain.value = 0;
      await this.createLevelerNode();
      if (this.levelerMode !== 'worklet') {
        await this.createMeterNode();
        await this.createLimiterNode();
      }
      this.playerGain = this.context.createGain();
      this.playerGain.gain.value = 1;
      this.startupGain = this.context.createGain();
      this.startupGain.gain.value = 0;
      this.outputAnalyser = this.context.createAnalyser();
      this.outputAnalyser.fftSize = 1024;
      this.outputAnalyser.smoothingTimeConstant = 0;
      this.outputSamples = new Float32Array(this.outputAnalyser.fftSize);
      this.applySettings(this.settings, { immediate: true });

      if (this.levelerMode === 'worklet') {
        this.source.connect(this.leveler);
        this.leveler.connect(this.playerGain);
      } else {
        this.source.connect(this.kShelf);
        this.kShelf.connect(this.kHighpass);
      }
      if (this.levelerMode === 'worklet') {
        // The unified worklet owns measurement, gain, and limiting.
      } else if (this.meterMode === 'worklet') {
        this.source.connect(this.outputGain);
        this.source.connect(this.meter, 0, 0);
        this.kHighpass.connect(this.meter, 0, 1);
        this.meter.connect(this.measurementSink);
      } else {
        this.source.connect(this.inputAnalyser);
        this.inputAnalyser.connect(this.outputGain);
        this.kHighpass.connect(this.weightedAnalyser);
        this.weightedAnalyser.connect(this.measurementSink);
      }
      if (this.levelerMode !== 'worklet') {
        this.measurementSink.connect(this.context.destination);
        this.outputGain.connect(this.limiter);
        this.limiter.connect(this.playerGain);
      }
      if (this.levelerMode !== 'worklet' && this.meterMode === 'worklet') {
        this.playerGain.connect(this.meter, 0, 2);
        this.playerGain.connect(this.outputKShelf);
        this.outputKShelf.connect(this.outputKHighpass);
        this.outputKHighpass.connect(this.meter, 0, 3);
      }
      this.playerGain.connect(this.startupGain);
      this.startupGain.connect(this.outputAnalyser);
      this.outputAnalyser.connect(this.context.destination);
      this.openStartupGateIfReady();

      this.bindTracks();
      await this.context.resume();
      this.setState(this.context.state === 'running' ? 'processing' : this.context.state);
      if (this.levelerMode !== 'worklet') {
        if (this.meterMode !== 'worklet') {
          this.measure();
        }
      }
      this.statusTimer = setInterval(() => this.report(), STATUS_INTERVAL_MS);
    } catch (error) {
      this.setState('error', String(error?.message || error));
      this.stop({ reportStopped: false });
      throw error;
    }
  }

  bindTracks() {
    for (const track of this.stream.getTracks()) {
      const onEnded = () => this.stop({ finalState: 'ended', error: 'capture stream ended' });
      const onMute = () => this.report();
      const onUnmute = () => this.report();
      track.addEventListener('ended', onEnded);
      track.addEventListener('mute', onMute);
      track.addEventListener('unmute', onUnmute);
      this.trackListeners.push({ track, type: 'ended', listener: onEnded });
      this.trackListeners.push({ track, type: 'mute', listener: onMute });
      this.trackListeners.push({ track, type: 'unmute', listener: onUnmute });
    }
  }

  measure() {
    if (this.destroyed || !this.inputAnalyser || !this.inputSamples) {
      return;
    }
    const raw = readEnergy(this.inputAnalyser, this.inputSamples);
    const weighted = this.weightedAnalyser && this.weightedSamples
      ? readEnergy(this.weightedAnalyser, this.weightedSamples)
      : raw;
    this.processMeasurement(weighted.energy, raw.peak);
    this.meterTimer = setTimeout(() => this.measure(), METER_INTERVAL_MS);
  }

  processMeasurement(energy, peak, measuredOutput = null) {
    const instantInputDb = energyToDb(energy);
    pushBounded(this.energyHistory, energy, MAX_HISTORY_FRAMES);
    pushBounded(this.peakHistory, peak, MAX_HISTORY_FRAMES);
    const fastCutEnergy = meanLast(this.energyHistory, FAST_CUT_HISTORY_FRAMES);
    const momentaryEnergy = meanLast(this.energyHistory, MOMENTARY_HISTORY_FRAMES);
    const shortTermEnergy = meanLast(this.energyHistory, SHORT_TERM_HISTORY_FRAMES);
    const loudness = computeDualWindowLoudnessDb(momentaryEnergy, shortTermEnergy);
    const controlInputDb = Math.max(loudness.controlDb, energyToDb(fastCutEnergy));
    const liftPeak = percentileLast(this.peakHistory, LIFT_CONTROL_HISTORY_FRAMES, LIFT_PEAK_PERCENTILE);
    const output = measuredOutput || (this.outputAnalyser && this.outputSamples
      ? readEnergy(this.outputAnalyser, this.outputSamples)
      : { energy: 0, peak: 0 });
    pushBounded(this.outputEnergyHistory, Math.max(0, finite(output.energy, 0)), MAX_HISTORY_FRAMES);
    const outputLoudness = computeDualWindowLoudnessDb(
      meanLast(this.outputEnergyHistory, MOMENTARY_HISTORY_FRAMES),
      meanLast(this.outputEnergyHistory, SHORT_TERM_HISTORY_FRAMES)
    );
    this.lastInputDb = instantInputDb;
    this.momentaryInputDb = loudness.momentaryDb;
    this.shortTermInputDb = loudness.shortTermDb;
    this.controlInputDb = controlInputDb;
    this.liftControlInputDb = loudness.liftDb;
    this.lastPeak = peak;
    this.liftPeak = liftPeak;
    this.lastOutputDb = energyToDb(output.energy);
    this.outputMomentaryDb = outputLoudness.momentaryDb;
    this.outputShortTermDb = outputLoudness.shortTermDb;
    this.outputControlDb = outputLoudness.controlDb;
    this.lastOutputPeak = output.peak;
    if (this.hasSignal(energy, peak)) {
      this.lastSignalAt = Date.now();
      this.signalTickCount += 1;
      this.updateGain(controlInputDb, loudness.liftDb, peak, liftPeak);
    } else {
      this.silentTickCount += 1;
      this.targetGainDb = 0;
      this.targetLiftDb = 0;
      this.targetReductionDb = 0;
      this.stableTargetGainDb = 0;
      this.targetChangedAt = Date.now();
      this.effectiveMaxLiftDb = MAX_LIFT_DB;
      this.peakHeadroomDb = 0;
      this.quietDeficitDb = 0;
      this.requestedLiftDb = 0;
      this.rawPeakHeadroomDb = 0;
      this.smoothGain(0, this.currentGainDb < 0 ? CUT_RELEASE_SECONDS : LIFT_RELEASE_SECONDS);
    }
    if (this.limiterMode === 'compressor') {
      this.currentLimiterReductionDb = this.limiter ? Math.abs(Math.min(0, finite(this.limiter.reduction, 0))) : 0;
    }
    if (this.currentLimiterReductionDb > 0.2) {
      this.limiterTickCount += 1;
    }
  }

  hasSignal(energy, peak) {
    const compensationDb = this.signalGateCompensationDb();
    const adjustedEnergyDb = energyToDb(energy) + compensationDb;
    const adjustedPeak = peak * dbToLinear(compensationDb);
    this.signalActive = computeSignalGateActive({
      wasActive: this.signalActive,
      energyDb: adjustedEnergyDb,
      peak: adjustedPeak
    }, {
      openDb: NOISE_FLOOR_DB,
      closeDb: NOISE_FLOOR_DB - 6,
      openPeak: SIGNAL_PEAK_FLOOR,
      closePeak: SIGNAL_PEAK_FLOOR * 0.5
    });
    return this.signalActive;
  }

  signalGateCompensationDb() {
    if (!this.playerVolumeStateReliable()) {
      return 0;
    }
    const volumeCap = Math.max(0, Math.min(1, finite(this.playerVolumeCap, 1)));
    if (volumeCap <= 0.001 || volumeCap >= 0.98) {
      return 0;
    }
    return -linearToDb(volumeCap);
  }

  playerVolumeStateFresh() {
    return this.mediaStateReceivedAt > 0 && Date.now() - this.mediaStateReceivedAt <= MEDIA_STATE_STALE_MS;
  }

  playerVolumeStateReliable() {
    return this.settings.respectPlayerVolume === false
      || (this.playerVolumeStateFresh() && this.playerVolumeKnown === true && !this.playerVolumeConflict);
  }

  canUseAudibleFallbackForLift() {
    return this.settings.respectPlayerVolume !== false
      && this.playerVolumeStateFresh()
      && this.playerVolumeKnown !== true
      && !this.playerVolumeConflict
      && this.playerActiveMediaCount <= 0
      && this.tabAudibleHint === true;
  }

  updateGain(rmsDb, liftWindowRmsDb, peak, liftPeak) {
    if (this.settings.enabled === false || this.processingStrength() <= 0) {
      this.resetGain();
      return;
    }

    const peakDb = linearToDb(peak);
    const liftPeakDb = linearToDb(liftPeak || peak);
    const volumeStateReliable = this.playerVolumeStateReliable();
    const canLiftWithCurrentVolumeState = volumeStateReliable || this.canUseAudibleFallbackForLift();
    const volumeCap = this.settings.respectPlayerVolume === false || !volumeStateReliable
      ? 1
      : Math.max(0, Math.min(1, finite(this.playerVolumeCap, 1)));
    const volumeDb = volumeStateReliable && volumeCap > 0.001 && volumeCap < 0.98 ? linearToDb(volumeCap) : 0;
    const volumeCompensationDb = -volumeDb;
    const limiterCeilingDb = this.playerVolumeLimiterCeilingDb();
    // Compensate loudness to classify the source, but keep peak headroom in
    // the captured/output domain because the limiter ceiling already carries
    // the player-volume attenuation.
    const liftRmsDb = liftWindowRmsDb + volumeCompensationDb;
    const effectiveMaxLiftDb = canLiftWithCurrentVolumeState ? computePlayerVolumeBoundedMaxLiftDb({
      rmsDb: liftWindowRmsDb,
      playerVolumeCap: volumeCap,
      respectPlayerVolume: this.settings.respectPlayerVolume
    }, {
      liftTargetRmsDb: DEFAULT_LEVELER_PARAMS.liftTargetRmsDb,
      maxLiftDb: MAX_LIFT_DB
    }) : 0;
    const gain = computeLevelerGainDb({
      rmsDb,
      peakDb,
      liftRmsDb,
      liftPeakDb,
      settings: this.settings
    }, {
      targetRmsDb: TARGET_RMS_DB,
      liftTargetRmsDb: DEFAULT_LEVELER_PARAMS.liftTargetRmsDb,
      maxLiftDb: effectiveMaxLiftDb,
      maxCutDb: MAX_CUT_DB,
      limiterCeilingDb,
      peakGuardDb: PEAK_GUARD_DB
    });

    const stabilized = stabilizeGainTarget({
      currentTargetDb: this.stableTargetGainDb,
      candidateTargetDb: gain.targetGainDb,
      elapsedMs: Date.now() - this.targetChangedAt
    }, {
      deadbandDb: TARGET_DEADBAND_DB,
      holdMs: TARGET_HOLD_MS
    });
    if (stabilized.changed) {
      this.targetChangedAt = Date.now();
    } else if (stabilized.held) {
      this.targetHoldCount += 1;
    }
    this.stableTargetGainDb = stabilized.targetGainDb;
    this.targetGainDb = stabilized.targetGainDb;
    this.targetLiftDb = Math.max(0, stabilized.targetGainDb);
    this.targetReductionDb = Math.max(0, -stabilized.targetGainDb);
    this.effectiveMaxLiftDb = effectiveMaxLiftDb;
    this.playerVolumeLiftCeilingDb = DEFAULT_LEVELER_PARAMS.liftTargetRmsDb + volumeDb;
    this.effectiveLimiterCeilingDb = this.processingLimiterCeilingDb();
    this.peakHeadroomDb = gain.peakHeadroomDb;
    this.quietDeficitDb = gain.quietDeficitDb;
    this.requestedLiftDb = gain.requestedLiftDb;
    this.rawPeakHeadroomDb = gain.rawPeakHeadroomDb;
    const frameStartGainDb = this.currentGainDb;
    if (this.targetGainDb < this.currentGainDb && this.targetGainDb < 0) {
      this.smoothGain(this.targetGainDb, CUT_ATTACK_SECONDS, frameStartGainDb);
    } else if (this.targetGainDb > this.currentGainDb && this.currentGainDb < 0) {
      this.smoothGain(this.targetGainDb, CUT_RELEASE_SECONDS, frameStartGainDb);
    } else if (this.targetGainDb > this.currentGainDb) {
      this.smoothGain(this.targetGainDb, LIFT_ATTACK_SECONDS, frameStartGainDb);
    } else {
      this.smoothGain(this.targetGainDb, LIFT_RELEASE_SECONDS, frameStartGainDb);
    }
  }

  smoothGain(targetDb, timeConstant, frameStartGainDb = this.currentGainDb) {
    const seconds = Math.max(0.001, timeConstant);
    const alpha = 1 - Math.exp(-(METER_INTERVAL_MS / 1000) / seconds);
    const nextGainDb = this.currentGainDb + ((targetDb - this.currentGainDb) * alpha);
    this.currentGainDb = Math.min(nextGainDb, frameStartGainDb + MAX_GAIN_INCREASE_STEP_DB);
    this.applyGain();
  }

  applyGain() {
    this.currentLiftDb = Math.max(0, this.currentGainDb);
    this.currentReductionDb = Math.max(0, -this.currentGainDb);
    if (!this.outputGain || !this.context) {
      return;
    }
    const value = dbToLinear(this.currentGainDb);
    this.rampAudioParam(this.outputGain.gain, value, METER_INTERVAL_MS / 1000);
    const liftSafetyActive = this.limiterSafetyLiftActive
      ? this.currentGainDb > 0.01
      : this.currentGainDb > 0.15;
    if (liftSafetyActive !== this.limiterSafetyLiftActive) {
      this.limiterSafetyLiftActive = liftSafetyActive;
      this.configureLimiter();
    }
    this.applyPlayerVolume();
  }

  rampAudioParam(param, value, seconds) {
    const now = this.context?.currentTime || 0;
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      const currentValue = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(currentValue, now);
    }
    param.linearRampToValueAtTime(value, now + Math.max(0.005, seconds));
  }

  resetGain() {
    this.targetGainDb = 0;
    this.targetLiftDb = 0;
    this.targetReductionDb = 0;
    this.stableTargetGainDb = 0;
    this.targetChangedAt = Date.now();
    this.effectiveMaxLiftDb = MAX_LIFT_DB;
    this.playerVolumeLiftCeilingDb = DEFAULT_LEVELER_PARAMS.liftTargetRmsDb;
    this.peakHeadroomDb = 0;
    this.quietDeficitDb = 0;
    this.requestedLiftDb = 0;
    this.rawPeakHeadroomDb = 0;
    this.currentGainDb = 0;
    this.currentLiftDb = 0;
    this.currentReductionDb = 0;
    if (this.outputGain) {
      this.rampAudioParam(this.outputGain.gain, 1, 0.012);
    }
    this.configureLimiter();
    this.applyPlayerVolume();
  }

  applyPlayerVolume() {
    if (!this.playerGain || !this.context) {
      return;
    }
    const shouldRespect = this.settings.respectPlayerVolume !== false;
    const volumeCap = Math.max(0, Math.min(1, finite(this.playerVolumeCap, 1)));
    const freshPlayerMute = this.playerMuted && this.playerVolumeStateFresh();
    const value = shouldRespect && (freshPlayerMute || (this.playerVolumeStateReliable() && volumeCap <= 0.001)) ? 0 : 1;
    if (value <= 0.001) {
      this.rampAudioParam(this.playerGain.gain, 0, 0.008);
      this.lastOutputPeak = 0;
      this.lastOutputDb = energyToDb(0);
      return;
    }
    this.rampAudioParam(this.playerGain.gain, value, 0.012);
  }

  playerVolumeLimiterCeilingDb() {
    if (this.settings.respectPlayerVolume === false || !this.playerVolumeStateReliable()) {
      return LIMITER_CEILING_DB;
    }
    return computePlayerVolumeLimiterCeilingDb({
      playerVolumeCap: this.playerVolumeCap,
      respectPlayerVolume: true
    }, {
      limiterCeilingDb: LIMITER_CEILING_DB
    });
  }

  processingLimiterCeilingDb() {
    const respectReliablePlayerVolume = this.settings.respectPlayerVolume !== false
      && this.playerVolumeStateReliable();
    return computeProcessingLimiterCeilingDb({
      settings: this.settings,
      liftSafetyActive: this.limiterSafetyLiftActive,
      playerVolumeCap: this.playerVolumeCap,
      respectPlayerVolume: respectReliablePlayerVolume
    }, {
      limiterCeilingDb: LIMITER_CEILING_DB
    });
  }

  applyMediaState(mediaState = {}) {
    this.playerVolumeCap = Math.max(0, Math.min(1, finite(mediaState.playerVolumeCap, this.playerVolumeCap)));
    this.playerMaxVolumeCap = Math.max(0, Math.min(1, finite(mediaState.playerMaxVolumeCap, this.playerVolumeCap)));
    this.playerMinVolumeCap = Math.max(0, Math.min(1, finite(mediaState.playerMinVolumeCap, this.playerVolumeCap)));
    this.playerVolumeKnown = mediaState.playerVolumeKnown === true;
    this.playerVolumeConflict = Boolean(mediaState.playerVolumeConflict);
    this.playerMuted = Boolean(mediaState.playerMuted);
    this.playerActiveMediaCount = Number(mediaState.playerActiveMediaCount) || 0;
    this.tabAudibleHint = Boolean(mediaState.tabAudibleHint);
    this.mediaStateReceivedAt = Date.now();
    this.configureLeveler();
    this.configureLimiter();
    this.applyPlayerVolume();
    this.report();
  }

  processingStrength() {
    return Math.max(strengthScale(this.settings.cutStrength), strengthScale(this.settings.liftStrength));
  }

  async createLevelerNode() {
    try {
      await this.context.audioWorklet.addModule(chrome.runtime.getURL('offscreen/leveler-worklet.js'));
      this.leveler = new AudioWorkletNode(this.context, 'wvb-leveler-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.levelerMode = 'worklet';
      this.meterMode = 'leveler-worklet';
      this.limiterMode = 'leveler-worklet';
      this.leveler.port.onmessage = (event) => this.handleLevelerMessage(event.data || {});
      this.configureLeveler();
    } catch (error) {
      this.levelerMode = 'fallback';
      this.levelerError = String(error?.message || error);
      this.leveler = null;
    }
  }

  configureLeveler() {
    if (!this.leveler || this.levelerMode !== 'worklet') return;
    const configSequence = this.levelerConfigSequence += 1;
    this.leveler.port.postMessage({
      type: 'configure',
      configSequence,
      settings: this.settings,
      playerVolumeCap: this.playerVolumeCap,
      playerVolumeReliable: this.playerVolumeStateReliable(),
      playerMuted: this.playerMuted && this.playerVolumeStateFresh(),
      allowUnknownVolumeLift: this.canUseAudibleFallbackForLift()
    });
  }

  handleLevelerMessage(message) {
    if (message.type === 'configured' && !this.destroyed) {
      this.levelerConfiguredSequence = Math.max(
        this.levelerConfiguredSequence,
        Math.max(0, Math.floor(finite(message.configSequence, 0)))
      );
      this.openStartupGateIfReady();
      return;
    }
    if (message.type !== 'state' || this.destroyed) return;
    const fields = ['lastInputDb', 'momentaryInputDb', 'shortTermInputDb', 'controlInputDb', 'liftControlInputDb', 'lastPeak', 'liftPeak', 'lastOutputDb', 'outputMomentaryDb', 'outputShortTermDb', 'outputControlDb', 'lastOutputPeak', 'currentGainDb', 'currentLiftDb', 'currentReductionDb', 'currentLimiterReductionDb', 'targetGainDb', 'targetLiftDb', 'targetReductionDb', 'effectiveMaxLiftDb', 'playerVolumeLiftCeilingDb', 'effectiveLimiterCeilingDb', 'peakHeadroomDb', 'rawPeakHeadroomDb', 'quietDeficitDb', 'requestedLiftDb'];
    for (const field of fields) {
      if (Number.isFinite(Number(message[field]))) this[field] = Number(message[field]);
    }
    this.signalActive = message.signalActive === true;
    if (this.signalActive) this.lastSignalAt = Date.now();
    this.signalTickCount = Math.max(0, Math.floor(finite(message.signalTickCount, this.signalTickCount)));
    this.silentTickCount = Math.max(0, Math.floor(finite(message.silentTickCount, this.silentTickCount)));
    this.limiterTickCount = Math.max(0, Math.floor(finite(message.limiterTickCount, this.limiterTickCount)));
    this.targetHoldCount = Math.max(0, Math.floor(finite(message.targetHoldCount, this.targetHoldCount)));
    this.meterSequence = Math.max(this.meterSequence, Math.floor(finite(message.sequence, this.meterSequence + 1)));
    this.lastMeterFrameAt = Date.now();
    this.workletInputPeak = Math.max(0, finite(message.workletInputPeak, 0));
    this.workletOutputPeak = Math.max(0, finite(message.workletOutputPeak, 0));
    this.workletLimitedSamples += Math.max(0, Math.floor(finite(message.limitedSamples, 0)));
    this.workletHardClippedSamples += Math.max(0, Math.floor(finite(message.hardClippedSamples, 0)));
    this.workletMaxHardClipOvershoot = Math.max(this.workletMaxHardClipOvershoot, Math.max(0, finite(message.maxHardClipOvershoot, 0)));
  }

  openStartupGateIfReady() {
    if (!this.startupGain || this.startupGateOpen || this.destroyed) {
      return;
    }
    if (this.levelerMode === 'worklet' && this.levelerConfiguredSequence <= 0) {
      return;
    }
    const now = this.context?.currentTime || 0;
    const gain = this.startupGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(1, now + STARTUP_FADE_SECONDS);
    this.startupGateOpen = true;
  }

  async createMeterNode() {
    try {
      await this.context.audioWorklet.addModule(chrome.runtime.getURL('offscreen/meter-worklet.js'));
      this.meter = new AudioWorkletNode(this.context, 'wvb-meter-processor', {
        numberOfInputs: 4,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      this.meterMode = 'worklet';
      this.meterError = '';
      this.meter.port.onmessage = (event) => this.handleMeterMessage(event.data || {});
      this.meter.port.postMessage({ type: 'configure', frameMs: METER_INTERVAL_MS });
    } catch (error) {
      this.meterMode = 'analyser-fallback';
      this.meterError = String(error?.message || error);
      this.meter = null;
      this.inputAnalyser = this.context.createAnalyser();
      this.weightedAnalyser = this.context.createAnalyser();
      for (const analyser of [this.inputAnalyser, this.weightedAnalyser]) {
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
      }
      this.inputSamples = new Float32Array(this.inputAnalyser.fftSize);
      this.weightedSamples = new Float32Array(this.weightedAnalyser.fftSize);
    }
  }

  handleMeterMessage(message) {
    if (message.type !== 'frame' || this.destroyed) {
      return;
    }
    const energy = Math.max(0, finite(message.energy, 0));
    const peak = Math.max(0, finite(message.peak, 0));
    const outputEnergy = Math.max(0, finite(message.outputEnergy, 0));
    const outputPeak = Math.max(0, finite(message.outputPeak, 0));
    this.meterSequence = Math.max(this.meterSequence, Math.floor(finite(message.sequence, this.meterSequence + 1)));
    this.lastMeterFrameAt = Date.now();
    this.processMeasurement(energy, peak, { energy: outputEnergy, peak: outputPeak });
  }

  async createLimiterNode() {
    try {
      await this.context.audioWorklet.addModule(chrome.runtime.getURL('offscreen/limiter-worklet.js'));
      this.limiter = new AudioWorkletNode(this.context, 'wvb-limiter-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.limiterMode = 'worklet';
      this.limiterError = '';
      this.limiter.port.onmessage = (event) => this.handleLimiterMessage(event.data || {});
      this.configureLimiter();
    } catch (error) {
      this.limiterMode = 'compressor';
      this.limiterError = String(error?.message || error);
      this.limiter = this.context.createDynamicsCompressor();
      this.configureLimiter();
    }
  }

  handleLimiterMessage(message) {
    if (message.type !== 'meter') {
      return;
    }
    this.currentLimiterReductionDb = Math.max(0, finite(message.reductionDb, 0));
    this.workletInputPeak = Math.max(0, finite(message.inputPeak, 0));
    this.workletOutputPeak = Math.max(0, finite(message.outputPeak, 0));
    this.workletLimitedSamples += Math.max(0, Math.floor(finite(message.limitedSamples, 0)));
    this.workletHardClippedSamples += Math.max(0, Math.floor(finite(message.hardClippedSamples, 0)));
    this.workletMaxHardClipOvershoot = Math.max(
      this.workletMaxHardClipOvershoot,
      Math.max(0, finite(message.maxHardClipOvershoot, 0))
    );
  }

  configureLimiter() {
    if (!this.limiter) {
      return;
    }
    const scale = this.settings.enabled === false ? 0 : this.processingStrength();
    const ceilingDb = this.processingLimiterCeilingDb();
    this.effectiveLimiterCeilingDb = ceilingDb;
    if (this.limiterMode === 'worklet') {
      this.limiter.port.postMessage({
        type: 'configure',
        enabled: scale > 0,
        ceilingDb,
        releaseSeconds: 0.08,
        lookaheadMs: LIMITER_LOOKAHEAD_MS
      });
      return;
    }
    const threshold = scale <= 0 ? 0 : ceilingDb;
    this.limiter.threshold.value = threshold;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = scale <= 0 ? 1 : 1 + (19 * scale);
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.16;
  }

  applySettings(nextSettings = this.settings, options = {}) {
    this.settings = normalizeSettings(nextSettings);
    this.configureLeveler();
    this.configureLimiter();
    this.applyPlayerVolume();
    if (options.immediate || this.settings.enabled === false || this.processingStrength() <= 0) {
      this.resetGain();
    }
  }

  status() {
    this.configureLeveler();
    const stream = streamSummary(this.stream);
    const context = this.context;
    const meterFrameAgeMs = this.lastMeterFrameAt ? Date.now() - this.lastMeterFrameAt : null;
    const connected = !this.destroyed
      && stream.audioTrackCount > 0
      && stream.audioTracks.some((track) => track.readyState === 'live');
    const dspLive = connected
      && context?.state === 'running'
      && this.startupGateOpen
      && this.meterSequence >= 0
      && meterFrameAgeMs != null
      && meterFrameAgeMs < 1000;
    return {
      tabId: this.tabId,
      active: !this.destroyed,
      connected,
      dspLive,
      state: this.state,
      error: this.error,
      audible: Date.now() - (this.lastSignalAt || 0) < 2000,
      lastSignalAgeMs: this.lastSignalAt ? Date.now() - this.lastSignalAt : null,
      averageLiftDb: this.currentLiftDb,
      averageReductionDb: this.currentReductionDb + this.currentLimiterReductionDb,
      averageInputDb: this.lastInputDb,
      momentaryInputDb: this.momentaryInputDb,
      shortTermInputDb: this.shortTermInputDb,
      controlInputDb: this.controlInputDb,
      liftControlInputDb: this.liftControlInputDb,
      averageInputPeak: this.lastPeak,
      liftPeak: this.liftPeak,
      averageOutputDb: this.lastOutputDb,
      outputMomentaryDb: this.outputMomentaryDb,
      outputShortTermDb: this.outputShortTermDb,
      outputControlDb: this.outputControlDb,
      averageOutputPeak: this.lastOutputPeak,
      currentGainDb: this.currentGainDb,
      currentLiftDb: this.currentLiftDb,
      currentReductionDb: this.currentReductionDb,
      limiterReductionDb: this.currentLimiterReductionDb,
      limiterActive: this.currentLimiterReductionDb > 0.2,
      limiterTickCount: this.limiterTickCount,
      limiterMode: this.limiterMode,
      limiterError: this.limiterError,
      levelerMode: this.levelerMode,
      levelerError: this.levelerError,
      meterMode: this.meterMode,
      meterError: this.meterError,
      meterSequence: this.meterSequence,
      meterFrameAgeMs,
      startupGateOpen: this.startupGateOpen,
      levelerConfigured: this.levelerMode !== 'worklet' || this.levelerConfiguredSequence > 0,
      workletLimitedSamples: this.workletLimitedSamples,
      workletInputPeak: this.workletInputPeak,
      workletOutputPeak: this.workletOutputPeak,
      workletHardClippedSamples: this.workletHardClippedSamples,
      workletMaxHardClipOvershoot: this.workletMaxHardClipOvershoot,
      loudnessResetCount: this.loudnessResetCount,
      targetHoldCount: this.targetHoldCount,
      kWeightingMode: 'biquad-approx',
      targetGainDb: this.targetGainDb,
      targetLiftDb: this.targetLiftDb,
      targetReductionDb: this.targetReductionDb,
      effectiveMaxLiftDb: this.effectiveMaxLiftDb,
      playerVolumeLiftCeilingDb: this.playerVolumeLiftCeilingDb,
      effectiveLimiterCeilingDb: this.effectiveLimiterCeilingDb,
      peakHeadroomDb: this.peakHeadroomDb,
      rawPeakHeadroomDb: this.rawPeakHeadroomDb,
      quietDeficitDb: this.quietDeficitDb,
      requestedLiftDb: this.requestedLiftDb,
      playerVolumeCap: this.playerVolumeCap,
      playerMaxVolumeCap: this.playerMaxVolumeCap,
      playerMinVolumeCap: this.playerMinVolumeCap,
      playerVolumeKnown: this.playerVolumeKnown,
      playerVolumeConflict: this.playerVolumeConflict,
      playerMuted: this.playerMuted,
      playerActiveMediaCount: this.playerActiveMediaCount,
      tabAudibleHint: this.tabAudibleHint,
      mediaStateAgeMs: this.mediaStateReceivedAt ? Date.now() - this.mediaStateReceivedAt : null,
      signalTickCount: this.signalTickCount,
      silentTickCount: this.silentTickCount,
      startedAt: this.startedAt,
      contextState: context?.state || 'none',
      sampleRate: finite(context?.sampleRate, 0),
      baseLatency: finite(context?.baseLatency, 0),
      outputLatency: finite(context?.outputLatency, 0),
      trackCount: stream.trackCount,
      audioTrackCount: stream.audioTrackCount,
      tracks: stream.tracks,
      audioTracks: stream.audioTracks,
      settingsEnabled: this.settings.enabled !== false,
      settingsPreset: this.settings.preset,
      settingsCutStrength: this.settings.cutStrength,
      settingsLiftStrength: this.settings.liftStrength,
      settingsRespectPlayerVolume: this.settings.respectPlayerVolume !== false
    };
  }

  report() {
    sendCaptureStatus(this.status());
  }

  stop(options = {}) {
    const reportStopped = options.reportStopped !== false;
    const finalState = String(options.finalState || 'stopped');
    const finalError = options.error == null ? this.error : String(options.error || '');
    if (finalError) {
      this.error = finalError;
    }
    if (this.destroyed) {
      return;
    }
    this.state = 'stopping';
    this.destroyed = true;
    clearTimeout(this.meterTimer);
    clearInterval(this.statusTimer);

    for (const item of this.trackListeners) {
      item.track.removeEventListener(item.type, item.listener);
    }
    this.trackListeners = [];

    for (const node of [this.source, this.leveler, this.outputGain, this.kShelf, this.kHighpass, this.outputKShelf, this.outputKHighpass, this.measurementSink, this.meter, this.limiter, this.playerGain, this.startupGain, this.inputAnalyser, this.weightedAnalyser, this.outputAnalyser]) {
      try {
        node?.disconnect();
      } catch (_) {}
    }

    for (const track of this.stream.getTracks()) {
      try {
        track.stop();
      } catch (_) {}
    }

    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
    }

    this.state = finalState;
    if (reportStopped) {
      sendCaptureStatus({
        tabId: this.tabId,
        active: false,
        connected: false,
        dspLive: false,
        state: finalState,
        error: finalError,
        lastSignalAgeMs: this.lastSignalAt ? Date.now() - this.lastSignalAt : null,
        averageLiftDb: 0,
        averageReductionDb: 0,
        averageInputDb: this.lastInputDb,
        momentaryInputDb: this.momentaryInputDb,
        shortTermInputDb: this.shortTermInputDb,
        controlInputDb: this.controlInputDb,
        averageInputPeak: this.lastPeak,
        liftPeak: this.liftPeak,
        averageOutputDb: this.lastOutputDb,
        outputMomentaryDb: this.outputMomentaryDb,
        outputShortTermDb: this.outputShortTermDb,
        outputControlDb: this.outputControlDb,
        averageOutputPeak: this.lastOutputPeak,
        currentGainDb: 0,
        currentLiftDb: 0,
        currentReductionDb: 0,
        limiterReductionDb: 0,
        limiterActive: false,
        limiterTickCount: this.limiterTickCount,
        limiterMode: this.limiterMode,
        limiterError: this.limiterError,
        meterMode: this.meterMode,
        meterError: this.meterError,
        meterSequence: this.meterSequence,
        meterFrameAgeMs: this.lastMeterFrameAt ? Date.now() - this.lastMeterFrameAt : null,
        startupGateOpen: false,
        levelerConfigured: this.levelerMode !== 'worklet' || this.levelerConfiguredSequence > 0,
        workletLimitedSamples: this.workletLimitedSamples,
        workletInputPeak: this.workletInputPeak,
        workletOutputPeak: this.workletOutputPeak,
        workletHardClippedSamples: this.workletHardClippedSamples,
        workletMaxHardClipOvershoot: this.workletMaxHardClipOvershoot,
        loudnessResetCount: this.loudnessResetCount,
        targetHoldCount: this.targetHoldCount,
        kWeightingMode: 'biquad-approx',
        targetGainDb: 0,
        targetLiftDb: 0,
        targetReductionDb: 0,
        effectiveMaxLiftDb: this.effectiveMaxLiftDb,
        peakHeadroomDb: 0,
        rawPeakHeadroomDb: 0,
        quietDeficitDb: 0,
        requestedLiftDb: 0,
        playerVolumeCap: this.playerVolumeCap,
        playerVolumeKnown: this.playerVolumeKnown,
        playerVolumeConflict: this.playerVolumeConflict,
        playerMuted: this.playerMuted,
        playerActiveMediaCount: this.playerActiveMediaCount,
        tabAudibleHint: this.tabAudibleHint,
        mediaStateAgeMs: this.mediaStateReceivedAt ? Date.now() - this.mediaStateReceivedAt : null,
        signalTickCount: this.signalTickCount,
        silentTickCount: this.silentTickCount,
        contextState: 'closed',
        sampleRate: finite(this.context?.sampleRate, 0),
        baseLatency: finite(this.context?.baseLatency, 0),
        outputLatency: finite(this.context?.outputLatency, 0),
        trackCount: 0,
        audioTrackCount: 0,
        tracks: [],
        audioTracks: []
      });
    }
    if (sessions.get(this.tabId) === this) {
      sessions.delete(this.tabId);
    }
  }
}

async function startCapture({ tabId, streamId, nextSettings, mediaState }) {
  const numericTabId = Number(tabId);
  const startToken = nextStartToken += 1;
  startTokens.set(numericTabId, startToken);
  const existing = sessions.get(numericTabId);
  if (existing) {
    existing.stop();
  }

  const sessionSettings = normalizeSettings(nextSettings || settings);
  sendCaptureStatus({
    tabId: numericTabId,
    active: true,
    connected: false,
    dspLive: false,
    state: 'offscreen-starting',
    error: '',
    lastSignalAgeMs: null,
    averageLiftDb: 0,
    averageReductionDb: 0,
    averageInputDb: null,
    momentaryInputDb: null,
    shortTermInputDb: null,
    controlInputDb: null,
    averageInputPeak: 0,
    liftPeak: 0,
    averageOutputDb: null,
    outputMomentaryDb: null,
    outputShortTermDb: null,
    outputControlDb: null,
    averageOutputPeak: 0,
    currentGainDb: 0,
    currentLiftDb: 0,
    currentReductionDb: 0,
    limiterReductionDb: 0,
    limiterActive: false,
    limiterTickCount: 0,
    limiterMode: 'none',
    limiterError: '',
    meterMode: 'none',
    meterError: '',
    meterSequence: -1,
    meterFrameAgeMs: null,
    workletLimitedSamples: 0,
    workletInputPeak: 0,
    workletOutputPeak: 0,
    workletHardClippedSamples: 0,
    workletMaxHardClipOvershoot: 0,
    targetHoldCount: 0,
    kWeightingMode: 'biquad-approx',
    targetGainDb: 0,
    targetLiftDb: 0,
    targetReductionDb: 0,
    effectiveMaxLiftDb: MAX_LIFT_DB,
    peakHeadroomDb: 0,
    rawPeakHeadroomDb: 0,
    quietDeficitDb: 0,
    requestedLiftDb: 0,
    playerVolumeCap: 1,
    playerMuted: false,
    playerActiveMediaCount: 0,
    mediaStateAgeMs: null,
    signalTickCount: 0,
    silentTickCount: 0,
    contextState: 'none',
    sampleRate: 0,
    baseLatency: 0,
    outputLatency: 0,
    trackCount: 0,
    audioTrackCount: 0,
    tracks: [],
    audioTracks: []
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
    if (startTokens.get(numericTabId) !== startToken) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch (_) {}
      }
      return {
        tabId: numericTabId,
        active: false,
        state: 'superseded',
        error: ''
      };
    }
    const session = new CaptureSession(numericTabId, stream, sessionSettings);
    session.applyMediaState(mediaState || {});
    sessions.set(numericTabId, session);
    await session.start();
    if (startTokens.get(numericTabId) !== startToken) {
      session.stop({ finalState: 'superseded', error: '' });
      return {
        tabId: numericTabId,
        active: false,
        state: 'superseded',
        error: ''
      };
    }
    return session.status();
  } catch (error) {
    sendCaptureStatus({
      tabId: numericTabId,
      active: false,
      state: 'error',
      error: String(error?.message || error),
      lastSignalAgeMs: null,
      averageLiftDb: 0,
      averageReductionDb: 0,
      averageInputDb: null,
      controlInputDb: null,
      averageInputPeak: 0,
      liftPeak: 0,
      averageOutputDb: null,
      outputMomentaryDb: null,
      outputShortTermDb: null,
      outputControlDb: null,
      averageOutputPeak: 0,
      currentGainDb: 0,
      currentLiftDb: 0,
      currentReductionDb: 0,
      limiterReductionDb: 0,
      limiterActive: false,
      limiterTickCount: 0,
      limiterMode: 'none',
      limiterError: 'no active capture session',
      meterMode: 'none',
      meterError: 'no active capture session',
      meterSequence: -1,
      meterFrameAgeMs: null,
      workletLimitedSamples: 0,
      workletInputPeak: 0,
      workletOutputPeak: 0,
      workletHardClippedSamples: 0,
      workletMaxHardClipOvershoot: 0,
      targetGainDb: 0,
      targetLiftDb: 0,
      targetReductionDb: 0,
      effectiveMaxLiftDb: MAX_LIFT_DB,
      peakHeadroomDb: 0,
      rawPeakHeadroomDb: 0,
      quietDeficitDb: 0,
      requestedLiftDb: 0,
      playerVolumeCap: 1,
      playerMuted: false,
      playerActiveMediaCount: 0,
      mediaStateAgeMs: null,
      signalTickCount: 0,
      silentTickCount: 0,
      contextState: 'none',
      sampleRate: 0,
      baseLatency: 0,
      outputLatency: 0,
      trackCount: 0,
      audioTrackCount: 0,
      tracks: [],
      audioTracks: []
    });
    throw error;
  }
}

function stopCapture(tabId) {
  const numericTabId = Number(tabId);
  startTokens.delete(numericTabId);
  const session = sessions.get(numericTabId);
  if (session) {
    session.stop();
    sessions.delete(numericTabId);
  }
  return sessions.size;
}

async function handleOffscreenMessage(message) {
  if (message?.type === 'WVB_OFFSCREEN_START_CAPTURE') {
    const status = await startCapture(message);
    return { ok: true, status };
  }
  if (message?.type === 'WVB_OFFSCREEN_STOP_CAPTURE') {
    const remainingSessions = stopCapture(Number(message.tabId));
    return { ok: true, remainingSessions };
  }
  if (message?.type === 'WVB_OFFSCREEN_APPLY_SETTINGS') {
    const nextSettings = normalizeSettings(message.settings || settings);
    const targetTabId = Number(message.tabId);
    if (Number.isInteger(targetTabId)) {
      const session = sessions.get(targetTabId);
      if (session) {
        session.applySettings(nextSettings, { immediate: false });
        session.report();
      }
      return { ok: true, applied: Boolean(session) };
    }
    settings = nextSettings;
    for (const session of sessions.values()) {
      session.applySettings(nextSettings, { immediate: false });
      session.report();
    }
    return { ok: true };
  }
  if (message?.type === 'WVB_OFFSCREEN_APPLY_MEDIA_STATE') {
    const session = sessions.get(Number(message.tabId));
    if (session) {
      session.applyMediaState(message.mediaState || {});
    }
    return { ok: true };
  }
  return { ok: false, error: 'unknown offscreen message' };
}

function connectPort() {
  globalThis.__WVB_OFFSCREEN_READY__ = 'connecting';
  const port = chrome.runtime.connect({ name: 'WVB_OFFSCREEN' });
  globalThis.__WVB_OFFSCREEN_READY__ = 'connected';
  port.onMessage.addListener((message) => {
    const requestId = Number(message?.requestId);
    handleOffscreenMessage(message)
      .then((response) => {
        port.postMessage({ requestId, ok: response?.ok !== false, response });
      })
      .catch((error) => {
        port.postMessage({ requestId, ok: false, error: String(error?.message || error) });
      });
  });
  port.onDisconnect.addListener(() => {
    setTimeout(connectPort, 250);
  });
}

try {
  connectPort();
} catch (error) {
  globalThis.__WVB_OFFSCREEN_READY__ = 'connect-error';
  globalThis.__WVB_OFFSCREEN_ERROR__ = String(error?.message || error);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!String(message?.type || '').startsWith('WVB_OFFSCREEN_')) {
    return false;
  }
  handleOffscreenMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true;
});
