(function initWebVolumeBalancerCore(global) {
  if (global.WebVolumeBalancerCore) {
    return;
  }

  const DEFAULT_SETTINGS = {
    enabled: true,
    respectPlayerVolume: true,
    preset: 'standard',
    cutStrength: 100,
    liftStrength: 100
  };
  const VALID_PRESETS = new Set(['standard', 'voice', 'night', 'live', 'strong', 'custom']);

  const NOISE_FLOOR_ENERGY = 1e-9;
  const K_WEIGHTING_PARAMS = Object.freeze({
    shelfFrequencyHz: 1681.974450955533,
    shelfGainDb: 3.999843853973347,
    highpassFrequencyHz: 38.13547087602444,
    highpassQ: 0.5003270373238773
  });
  const DEFAULT_TARGET_STABILITY_PARAMS = Object.freeze({
    deadbandDb: 0.8,
    holdMs: 120
  });
  const DEFAULT_SIGNAL_GATE_PARAMS = Object.freeze({
    openDb: -62,
    closeDb: -68,
    openPeak: 0.00035,
    closePeak: 0.000175
  });
  const DEFAULT_LEVELER_PARAMS = Object.freeze({
    targetRmsDb: -29,
    liftTargetRmsDb: -29,
    maxLiftDb: 34,
    maxCutDb: 30,
    limiterCeilingDb: -3,
    peakGuardDb: -6,
    liftHeadroomReserveDb: 2,
    liftLimiterBudgetDb: 15,
    quietTransitionCutMarginDb: 3,
    quietLiftBiasDb: 0
  });

  function finite(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function percent(value, fallback = 100) {
    return clamp(finite(value, fallback), 0, 100);
  }

  function normalizeSettings(input = {}) {
    const preset = String(input.preset || DEFAULT_SETTINGS.preset);
    return {
      enabled: input.enabled !== false,
      respectPlayerVolume: input.respectPlayerVolume !== false,
      preset: VALID_PRESETS.has(preset) ? preset : 'custom',
      cutStrength: percent(input.cutStrength, DEFAULT_SETTINGS.cutStrength),
      liftStrength: percent(input.liftStrength, DEFAULT_SETTINGS.liftStrength)
    };
  }

  function strengthScale(value) {
    return percent(value, 100) / 100;
  }

  function dbToLinear(value) {
    return Math.pow(10, value / 20);
  }

  function energyToDb(energy) {
    return -0.691 + 10 * Math.log10(Math.max(NOISE_FLOOR_ENERGY, energy));
  }

  function linearToDb(value) {
    return 20 * Math.log10(Math.max(0.0001, value));
  }

  function meanLast(values, count) {
    if (!values.length) {
      return 0;
    }
    const start = Math.max(0, values.length - count);
    let sum = 0;
    for (let i = start; i < values.length; i += 1) {
      sum += values[i];
    }
    return sum / (values.length - start);
  }

  function maxLast(values, count) {
    if (!values.length) {
      return 0;
    }
    const start = Math.max(0, values.length - count);
    let max = 0;
    for (let i = start; i < values.length; i += 1) {
      max = Math.max(max, values[i]);
    }
    return max;
  }

  function computeDualWindowLoudnessDb(momentaryEnergy, shortTermEnergy) {
    const momentaryDb = energyToDb(momentaryEnergy);
    const shortTermDb = energyToDb(shortTermEnergy);
    return {
      momentaryDb,
      shortTermDb,
      controlDb: (0.8 * momentaryDb) + (0.2 * shortTermDb),
      // Upward gain follows the 400 ms window. Keeping the 3 s window in the
      // lift path makes quiet dialogue stay suppressed after a loud passage.
      liftDb: momentaryDb
    };
  }

  function stabilizeGainTarget(input = {}, params = DEFAULT_TARGET_STABILITY_PARAMS) {
    const currentTargetDb = finite(input.currentTargetDb, 0);
    const candidateTargetDb = finite(input.candidateTargetDb, currentTargetDb);
    const elapsedMs = Math.max(0, finite(input.elapsedMs, 0));
    const deadbandDb = Math.max(0, finite(params.deadbandDb, DEFAULT_TARGET_STABILITY_PARAMS.deadbandDb));
    const holdMs = Math.max(0, finite(params.holdMs, DEFAULT_TARGET_STABILITY_PARAMS.holdMs));
    const deltaDb = candidateTargetDb - currentTargetDb;

    if (deltaDb < -deadbandDb) {
      return { targetGainDb: candidateTargetDb, changed: true, held: false };
    }
    if (Math.abs(deltaDb) <= deadbandDb || (deltaDb > 0 && elapsedMs < holdMs)) {
      return { targetGainDb: currentTargetDb, changed: false, held: true };
    }
    return { targetGainDb: candidateTargetDb, changed: true, held: false };
  }

  function computeSignalGateActive(input = {}, params = DEFAULT_SIGNAL_GATE_PARAMS) {
    const wasActive = input.wasActive === true;
    const energyDb = finite(input.energyDb, -120);
    const peak = Math.max(0, finite(input.peak, 0));
    const energyThresholdDb = wasActive
      ? finite(params.closeDb, DEFAULT_SIGNAL_GATE_PARAMS.closeDb)
      : finite(params.openDb, DEFAULT_SIGNAL_GATE_PARAMS.openDb);
    const peakThreshold = wasActive
      ? finite(params.closePeak, DEFAULT_SIGNAL_GATE_PARAMS.closePeak)
      : finite(params.openPeak, DEFAULT_SIGNAL_GATE_PARAMS.openPeak);
    return energyDb > energyThresholdDb && peak > peakThreshold;
  }

  function isAlreadyConnectedError(error) {
    return /already connected previously|different MediaElementSourceNode/i.test(String(error || ''));
  }

  function computeLevelerGainDb(input = {}, params = DEFAULT_LEVELER_PARAMS) {
    const normalized = normalizeSettings(input.settings || input);
    if (normalized.enabled === false) {
      return {
        targetGainDb: 0,
        liftDb: 0,
        reductionDb: 0,
        peakHeadroomDb: 0,
        rawPeakHeadroomDb: 0,
        effectiveLiftHeadroomDb: 0,
        liftLimiterBudgetDb: 0,
        effectiveLiftBudgetDb: 0,
        quietDeficitDb: 0,
        loudnessCutDb: 0,
        peakCutDb: 0
      };
    }

    const cutScale = strengthScale(normalized.cutStrength);
    const liftScale = strengthScale(normalized.liftStrength);
    const maxCutDb = finite(params.maxCutDb, DEFAULT_LEVELER_PARAMS.maxCutDb) * cutScale;
    const maxLiftDb = finite(params.maxLiftDb, DEFAULT_LEVELER_PARAMS.maxLiftDb) * liftScale;
    if (Math.max(cutScale, liftScale) <= 0) {
      return {
        targetGainDb: 0,
        liftDb: 0,
        reductionDb: 0,
        peakHeadroomDb: 0,
        rawPeakHeadroomDb: 0,
        effectiveLiftHeadroomDb: 0,
        liftLimiterBudgetDb: 0,
        effectiveLiftBudgetDb: 0,
        quietDeficitDb: 0,
        loudnessCutDb: 0,
        peakCutDb: 0
      };
    }

    const rmsDb = finite(input.rmsDb, DEFAULT_LEVELER_PARAMS.targetRmsDb);
    const peakDb = finite(input.peakDb, rmsDb);
    const liftRmsDb = finite(input.liftRmsDb, rmsDb);
    const liftPeakDb = finite(input.liftPeakDb, peakDb);
    const targetRmsDb = finite(params.targetRmsDb, DEFAULT_LEVELER_PARAMS.targetRmsDb);
    const liftTargetRmsDb = finite(params.liftTargetRmsDb, DEFAULT_LEVELER_PARAMS.liftTargetRmsDb);
    const peakGuardDb = finite(params.peakGuardDb, DEFAULT_LEVELER_PARAMS.peakGuardDb);
    const limiterCeilingDb = finite(params.limiterCeilingDb, DEFAULT_LEVELER_PARAMS.limiterCeilingDb);
    const liftHeadroomReserveDb = finite(params.liftHeadroomReserveDb, DEFAULT_LEVELER_PARAMS.liftHeadroomReserveDb);
    const liftLimiterBudgetDb = Math.max(0, finite(
      params.liftLimiterBudgetDb,
      DEFAULT_LEVELER_PARAMS.liftLimiterBudgetDb
    )) * liftScale;
    const quietTransitionCutMarginDb = Math.max(0, finite(
      params.quietTransitionCutMarginDb,
      DEFAULT_LEVELER_PARAMS.quietTransitionCutMarginDb
    ));
    const quietLiftBiasDb = finite(params.quietLiftBiasDb, DEFAULT_LEVELER_PARAMS.quietLiftBiasDb) * liftScale;

    const quietDeficitDb = Math.max(0, liftTargetRmsDb - liftRmsDb);
    // Once the faster lift window confirms a quiet passage, stale long-window
    // loudness must not keep cancelling the requested recovery gain.
    const loudnessControlDb = quietDeficitDb > 0
      ? Math.min(rmsDb, liftRmsDb + quietTransitionCutMarginDb)
      : rmsDb;
    const loudnessCutDb = Math.max(0, loudnessControlDb - targetRmsDb) * (0.65 + 0.35 * cutScale);
    const peakCutDb = Math.max(0, peakDb - peakGuardDb);
    const quietnessRatio = clamp(quietDeficitDb / 12, 0, 1);
    const effectivePeakCutDb = peakCutDb * (1 - (0.5 * quietnessRatio));
    const reductionDb = clamp(Math.max(loudnessCutDb, effectivePeakCutDb) * cutScale, 0, maxCutDb);

    const peakHeadroomDb = limiterCeilingDb - liftPeakDb - liftHeadroomReserveDb;
    const rawPeakHeadroomDb = limiterCeilingDb - peakDb - 0.5;
    const effectiveLiftHeadroomDb = Math.min(peakHeadroomDb, rawPeakHeadroomDb);
    // Strong leveling may intentionally compress brief peaks, but the limiter
    // allowance is bounded so upward gain cannot turn into unbounded clipping.
    const effectiveLiftBudgetDb = effectiveLiftHeadroomDb + liftLimiterBudgetDb;
    const liftFullness = 1;
    const requestedLiftDb = quietDeficitDb > 0
      ? (quietDeficitDb * liftScale * liftFullness) + quietLiftBiasDb
      : 0;
    const liftDb = clamp(Math.min(requestedLiftDb, effectiveLiftBudgetDb), 0, maxLiftDb);
    const targetGainDb = clamp(Math.min(liftDb - reductionDb, effectiveLiftBudgetDb), -maxCutDb, maxLiftDb);

    return {
      targetGainDb,
      liftDb,
      reductionDb,
      peakHeadroomDb,
      rawPeakHeadroomDb,
      effectiveLiftHeadroomDb,
      liftLimiterBudgetDb,
      effectiveLiftBudgetDb,
      quietDeficitDb,
      requestedLiftDb,
      loudnessControlDb,
      loudnessCutDb,
      peakCutDb,
      effectivePeakCutDb
    };
  }

  function computePlayerVolumeBoundedMaxLiftDb(input = {}, params = DEFAULT_LEVELER_PARAMS) {
    const respectPlayerVolume = input.respectPlayerVolume !== false;
    const maxLiftDb = finite(params.maxLiftDb, DEFAULT_LEVELER_PARAMS.maxLiftDb);
    if (!respectPlayerVolume) {
      return maxLiftDb;
    }
    const playerVolumeCap = clamp(finite(input.playerVolumeCap, 1), 0, 1);
    if (playerVolumeCap <= 0.001) {
      return 0;
    }
    if (playerVolumeCap >= 0.98) {
      return maxLiftDb;
    }
    const rmsDb = finite(input.rmsDb, DEFAULT_LEVELER_PARAMS.targetRmsDb);
    const liftTargetRmsDb = finite(params.liftTargetRmsDb, DEFAULT_LEVELER_PARAMS.liftTargetRmsDb);
    const volumeDb = linearToDb(playerVolumeCap);
    return clamp((liftTargetRmsDb + volumeDb) - rmsDb, 0, maxLiftDb);
  }

  function computePlayerVolumeLimiterCeilingDb(input = {}, params = DEFAULT_LEVELER_PARAMS) {
    const limiterCeilingDb = finite(params.limiterCeilingDb, DEFAULT_LEVELER_PARAMS.limiterCeilingDb);
    if (input.respectPlayerVolume === false) {
      return limiterCeilingDb;
    }
    const playerVolumeCap = clamp(finite(input.playerVolumeCap, 1), 0, 1);
    if (playerVolumeCap <= 0.001) {
      return -96;
    }
    return limiterCeilingDb + Math.min(0, linearToDb(playerVolumeCap));
  }

  function computeProcessingLimiterCeilingDb(input = {}, params = DEFAULT_LEVELER_PARAMS) {
    const normalized = normalizeSettings(input.settings || input);
    const fullCeilingDb = finite(params.limiterCeilingDb, DEFAULT_LEVELER_PARAMS.limiterCeilingDb);
    const liftSafetyActive = input.liftSafetyActive === true;
    const scaledCeilingDb = liftSafetyActive
      ? fullCeilingDb
      : fullCeilingDb * strengthScale(normalized.cutStrength);
    return computePlayerVolumeLimiterCeilingDb({
      playerVolumeCap: input.playerVolumeCap,
      respectPlayerVolume: input.respectPlayerVolume
    }, {
      limiterCeilingDb: scaledCeilingDb
    });
  }

  global.WebVolumeBalancerCore = Object.freeze({
    DEFAULT_SETTINGS: Object.freeze({ ...DEFAULT_SETTINGS }),
    DEFAULT_LEVELER_PARAMS,
    DEFAULT_SIGNAL_GATE_PARAMS,
    K_WEIGHTING_PARAMS,
    DEFAULT_TARGET_STABILITY_PARAMS,
    NOISE_FLOOR_ENERGY,
    finite,
    clamp,
    percent,
    normalizeSettings,
    strengthScale,
    dbToLinear,
    energyToDb,
    linearToDb,
    meanLast,
    maxLast,
    computeDualWindowLoudnessDb,
    stabilizeGainTarget,
    computeSignalGateActive,
    isAlreadyConnectedError,
    computeLevelerGainDb,
    computePlayerVolumeBoundedMaxLiftDb,
    computePlayerVolumeLimiterCeilingDb,
    computeProcessingLimiterCeilingDb
  });
})(globalThis);
