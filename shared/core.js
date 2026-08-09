(function initWebVolumeBalancerCore(global) {
  if (global.WebVolumeBalancerCore) {
    return;
  }

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    respectPlayerVolume: true,
    preset: 'standard',
    cutStrength: 100,
    liftStrength: 100
  });
  const VALID_PRESETS = new Set(['standard', 'voice', 'night', 'live', 'strong', 'custom']);
  const NOISE_FLOOR_ENERGY = 1e-9;
  const K_WEIGHTING_PARAMS = Object.freeze({
    shelfFrequencyHz: 1681.974450955533,
    shelfGainDb: 3.999843853973347,
    highpassFrequencyHz: 38.13547087602444,
    highpassQ: 0.5003270373238773
  });
  const DEFAULT_SIGNAL_GATE_PARAMS = Object.freeze({
    openDb: -62,
    closeDb: -68,
    openPeak: 0.00035,
    closePeak: 0.000175
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
    for (let index = start; index < values.length; index += 1) {
      sum += values[index];
    }
    return sum / (values.length - start);
  }

  function maxLast(values, count) {
    if (!values.length) {
      return 0;
    }
    const start = Math.max(0, values.length - count);
    let maximum = 0;
    for (let index = start; index < values.length; index += 1) {
      maximum = Math.max(maximum, values[index]);
    }
    return maximum;
  }

  function computeDualWindowLoudnessDb(momentaryEnergy, shortTermEnergy) {
    const momentaryDb = energyToDb(momentaryEnergy);
    const shortTermDb = energyToDb(shortTermEnergy);
    return {
      momentaryDb,
      shortTermDb,
      controlDb: (0.8 * momentaryDb) + (0.2 * shortTermDb)
    };
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

  function computePlayerVolumeLimiterCeilingDb(input = {}, params = {}) {
    const limiterCeilingDb = finite(params.limiterCeilingDb, -3);
    if (input.respectPlayerVolume === false) {
      return limiterCeilingDb;
    }
    const playerVolumeCap = clamp(finite(input.playerVolumeCap, 1), 0, 1);
    if (playerVolumeCap <= 0.001) {
      return -96;
    }
    return limiterCeilingDb + Math.min(0, linearToDb(playerVolumeCap));
  }

  function isAlreadyConnectedError(error) {
    return /already connected previously|different MediaElementSourceNode/i.test(String(error || ''));
  }

  global.WebVolumeBalancerCore = Object.freeze({
    DEFAULT_SETTINGS,
    DEFAULT_SIGNAL_GATE_PARAMS,
    K_WEIGHTING_PARAMS,
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
    computeSignalGateActive,
    computePlayerVolumeLimiterCeilingDb,
    isAlreadyConnectedError
  });
})(globalThis);
