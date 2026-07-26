const path = require('path');

require(path.resolve(__dirname, '..', 'shared', 'core.js'));

const {
  computeDualWindowLoudnessDb,
  computeSignalGateActive,
  computeLevelerGainDb,
  computePlayerVolumeBoundedMaxLiftDb,
  computePlayerVolumeLimiterCeilingDb,
  computeProcessingLimiterCeilingDb,
  DEFAULT_LEVELER_PARAMS,
  K_WEIGHTING_PARAMS,
  stabilizeGainTarget,
  normalizeSettings
} = globalThis.WebVolumeBalancerCore;

function assert(name, condition, details = '') {
  if (!condition) {
    console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${name}`);
}

function closeToZero(value) {
  return Math.abs(Number(value) || 0) < 0.000001;
}

function complexMagnitudeDb(coefficients, frequencyHz, sampleRate = 48000) {
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);
  const numeratorReal = coefficients.b0 + (coefficients.b1 * cos1) + (coefficients.b2 * cos2);
  const numeratorImag = -((coefficients.b1 * sin1) + (coefficients.b2 * sin2));
  const denominatorReal = 1 + (coefficients.a1 * cos1) + (coefficients.a2 * cos2);
  const denominatorImag = -((coefficients.a1 * sin1) + (coefficients.a2 * sin2));
  const numeratorPower = (numeratorReal * numeratorReal) + (numeratorImag * numeratorImag);
  const denominatorPower = (denominatorReal * denominatorReal) + (denominatorImag * denominatorImag);
  return 10 * Math.log10(Math.max(Number.MIN_VALUE, numeratorPower / denominatorPower));
}

function highpassCoefficients(frequencyHz, q, sampleRate = 48000) {
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosine) / 2) / a0,
    b1: (-(1 + cosine)) / a0,
    b2: ((1 + cosine) / 2) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0
  };
}

function highShelfCoefficients(frequencyHz, gainDb, sampleRate = 48000) {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = (Math.sin(omega) / 2) * Math.sqrt(2);
  const rootTerm = 2 * Math.sqrt(amplitude) * alpha;
  const a0 = (amplitude + 1) - ((amplitude - 1) * cosine) + rootTerm;
  return {
    b0: (amplitude * ((amplitude + 1) + ((amplitude - 1) * cosine) + rootTerm)) / a0,
    b1: (-2 * amplitude * ((amplitude - 1) + ((amplitude + 1) * cosine))) / a0,
    b2: (amplitude * ((amplitude + 1) + ((amplitude - 1) * cosine) - rootTerm)) / a0,
    a1: (2 * ((amplitude - 1) - ((amplitude + 1) * cosine))) / a0,
    a2: ((amplitude + 1) - ((amplitude - 1) * cosine) - rootTerm) / a0
  };
}

function kWeightingResponseDb(frequencyHz) {
  return complexMagnitudeDb(highpassCoefficients(
    K_WEIGHTING_PARAMS.highpassFrequencyHz,
    K_WEIGHTING_PARAMS.highpassQ
  ), frequencyHz) + complexMagnitudeDb(highShelfCoefficients(
    K_WEIGHTING_PARAMS.shelfFrequencyHz,
    K_WEIGHTING_PARAMS.shelfGainDb
  ), frequencyHz);
}

const baseSettings = {
  enabled: true,
  respectPlayerVolume: true,
  preset: 'standard',
  cutStrength: 100,
  liftStrength: 100
};

const dualWindow = computeDualWindowLoudnessDb(10 ** (-20 / 10), 10 ** (-32 / 10));
assert(
  'dual-window control follows current loudness without forgetting recent context',
  dualWindow.momentaryDb > dualWindow.controlDb
    && dualWindow.controlDb > dualWindow.shortTermDb
    && dualWindow.liftDb === dualWindow.momentaryDb,
  JSON.stringify(dualWindow)
);

const fastCut = stabilizeGainTarget({ currentTargetDb: 4, candidateTargetDb: -8, elapsedMs: 0 });
assert('stronger attenuation bypasses target hold', fastCut.changed && fastCut.targetGainDb === -8, JSON.stringify(fastCut));

const heldLift = stabilizeGainTarget({ currentTargetDb: -4, candidateTargetDb: 3, elapsedMs: 60 });
assert('upward gain waits through the hold window', heldLift.held && heldLift.targetGainDb === -4, JSON.stringify(heldLift));

const releasedLift = stabilizeGainTarget({ currentTargetDb: -4, candidateTargetDb: 3, elapsedMs: 140 });
assert('upward gain proceeds after the hold window', releasedLift.changed && releasedLift.targetGainDb === 3, JSON.stringify(releasedLift));

const deadband = stabilizeGainTarget({ currentTargetDb: -4, candidateTargetDb: -3.5, elapsedMs: 500 });
assert('small gain changes stay inside the deadband', deadband.held && deadband.targetGainDb === -4, JSON.stringify(deadband));

const signalGateOpened = computeSignalGateActive({ wasActive: false, energyDb: -61, peak: 0.0005 });
const signalGateHeld = computeSignalGateActive({ wasActive: signalGateOpened, energyDb: -65, peak: 0.00025 });
const signalGateClosed = computeSignalGateActive({ wasActive: signalGateHeld, energyDb: -70, peak: 0.0001 });
assert('signal gate uses hysteresis around the noise floor', signalGateOpened && signalGateHeld && !signalGateClosed);

const response30Hz = kWeightingResponseDb(30);
const response1000Hz = kWeightingResponseDb(1000);
const response8000Hz = kWeightingResponseDb(8000);
assert(
  'K-weighting approximation attenuates sub-bass relative to speech band',
  response30Hz < response1000Hz - 5,
  JSON.stringify({ response30Hz, response1000Hz })
);
assert(
  'K-weighting approximation applies the high-frequency shelf',
  response8000Hz > response1000Hz + 2,
  JSON.stringify({ response8000Hz, response1000Hz })
);

const presetSettings = normalizeSettings({ preset: 'voice', cutStrength: 65, liftStrength: 85 });
assert('settings preserve known preset', presetSettings.preset === 'voice' && presetSettings.cutStrength === 65 && presetSettings.liftStrength === 85);

const invalidPresetSettings = normalizeSettings({ preset: 'unknown' });
assert('settings classify unknown preset as custom', invalidPresetSettings.preset === 'custom');

const disabled = computeLevelerGainDb({
  rmsDb: -20,
  peakDb: -5,
  settings: { ...baseSettings, enabled: false }
});
assert('disabled returns unity gain', closeToZero(disabled.targetGainDb) && closeToZero(disabled.reductionDb) && closeToZero(disabled.liftDb));

const zeroStrength = computeLevelerGainDb({
  rmsDb: -20,
  peakDb: -5,
  settings: { ...baseSettings, cutStrength: 0, liftStrength: 0 }
});
assert('zero strength returns unity gain', closeToZero(zeroStrength.targetGainDb) && closeToZero(zeroStrength.reductionDb) && closeToZero(zeroStrength.liftDb));

const loud = computeLevelerGainDb({
  rmsDb: -24,
  peakDb: -6,
  settings: baseSettings
});
assert('loud input is reduced', loud.targetGainDb < 0 && loud.reductionDb > 0 && closeToZero(loud.liftDb), JSON.stringify(loud));

const quiet = computeLevelerGainDb({
  rmsDb: -42,
  peakDb: -24,
  settings: baseSettings
});
assert('quiet input is lifted when headroom exists', quiet.targetGainDb > 0 && quiet.liftDb > 0 && closeToZero(quiet.reductionDb), JSON.stringify(quiet));

const veryQuiet = computeLevelerGainDb({
  rmsDb: -50,
  peakDb: -36,
  settings: baseSettings
});
assert(
  'full lift strength moves very quiet material toward the common target',
  veryQuiet.targetGainDb >= 20 && veryQuiet.targetGainDb <= DEFAULT_LEVELER_PARAMS.maxLiftDb,
  JSON.stringify(veryQuiet)
);

const quietHighCrest = computeLevelerGainDb({
  rmsDb: -42,
  peakDb: -8,
  liftPeakDb: -24,
  settings: baseSettings
});
assert(
  'full-strength quiet high-crest speech converges despite brief peaks',
  quietHighCrest.targetGainDb >= 12.5
    && quietHighCrest.targetGainDb <= DEFAULT_LEVELER_PARAMS.maxLiftDb
    && quietHighCrest.targetGainDb > quietHighCrest.rawPeakHeadroomDb
    && quietHighCrest.targetGainDb <= quietHighCrest.effectiveLiftBudgetDb + 0.001
    && quietHighCrest.targetGainDb - quietHighCrest.rawPeakHeadroomDb <= DEFAULT_LEVELER_PARAMS.liftLimiterBudgetDb + 0.001,
  JSON.stringify(quietHighCrest)
);

const quietNoHeadroom = computeLevelerGainDb({
  rmsDb: -42,
  peakDb: -3.2,
  settings: baseSettings
});
assert(
  'near-ceiling high-crest material becomes audible through bounded peak compression',
  quietNoHeadroom.targetGainDb >= 11
    && Math.abs((-42 + quietNoHeadroom.targetGainDb) - DEFAULT_LEVELER_PARAMS.liftTargetRmsDb) <= 2
    && quietNoHeadroom.targetGainDb <= quietNoHeadroom.effectiveLiftBudgetDb + 0.001
    && quietNoHeadroom.targetGainDb <= DEFAULT_LEVELER_PARAMS.liftLimiterBudgetDb,
  JSON.stringify(quietNoHeadroom)
);

const peakOnly = computeLevelerGainDb({
  rmsDb: DEFAULT_LEVELER_PARAMS.targetRmsDb - 1,
  peakDb: -4,
  settings: baseSettings
});
assert('peak guard reduces transient even when rms is quiet', peakOnly.targetGainDb < 0 && peakOnly.peakCutDb > 0 && peakOnly.reductionDb > 0, JSON.stringify(peakOnly));

const halfCut = computeLevelerGainDb({
  rmsDb: -16,
  peakDb: -5,
  settings: { ...baseSettings, cutStrength: 50, liftStrength: 100 }
});
const fullCut = computeLevelerGainDb({
  rmsDb: -16,
  peakDb: -5,
  settings: baseSettings
});
assert('cut strength scales reduction', fullCut.reductionDb > halfCut.reductionDb && halfCut.reductionDb > 0, JSON.stringify({ halfCut, fullCut }));

const noLift = computeLevelerGainDb({
  rmsDb: -42,
  peakDb: -24,
  settings: { ...baseSettings, cutStrength: 100, liftStrength: 0 }
});
assert('lift strength zero disables quiet lift', closeToZero(noLift.targetGainDb) && closeToZero(noLift.liftDb), JSON.stringify(noLift));

const lowPlayerVolumeNormalSource = computeLevelerGainDb({
  rmsDb: -38,
  peakDb: -24,
  liftRmsDb: -26,
  liftPeakDb: -12,
  settings: baseSettings
});
assert('low player volume alone does not trigger quiet lift', lowPlayerVolumeNormalSource.targetGainDb <= 0.5 && lowPlayerVolumeNormalSource.liftDb <= 0.5, JSON.stringify(lowPlayerVolumeNormalSource));

const lowPlayerVolumeQuietSource = computeLevelerGainDb({
  rmsDb: -56,
  peakDb: -42,
  liftRmsDb: -44,
  liftPeakDb: -30,
  settings: baseSettings
});
assert('quiet source still lifts when player volume is low', lowPlayerVolumeQuietSource.targetGainDb >= 8 && lowPlayerVolumeQuietSource.liftDb >= 8, JSON.stringify(lowPlayerVolumeQuietSource));

const fullPlayerVolumeLiftCap = computePlayerVolumeBoundedMaxLiftDb({
  rmsDb: -56,
  playerVolumeCap: 1,
  respectPlayerVolume: true
}, DEFAULT_LEVELER_PARAMS);
assert('full player volume keeps full lift range', fullPlayerVolumeLiftCap === DEFAULT_LEVELER_PARAMS.maxLiftDb, String(fullPlayerVolumeLiftCap));

const lowPlayerVolumeNormalLiftCap = computePlayerVolumeBoundedMaxLiftDb({
  rmsDb: -38,
  playerVolumeCap: 0.25,
  respectPlayerVolume: true
}, DEFAULT_LEVELER_PARAMS);
assert('low player volume normal source has no lift headroom', closeToZero(lowPlayerVolumeNormalLiftCap), String(lowPlayerVolumeNormalLiftCap));

const lowPlayerVolumeQuietLiftCap = computePlayerVolumeBoundedMaxLiftDb({
  rmsDb: -56,
  playerVolumeCap: 0.25,
  respectPlayerVolume: true
}, DEFAULT_LEVELER_PARAMS);
assert(
  'low player volume bounds quiet lift below full-volume target',
  lowPlayerVolumeQuietLiftCap > 8 && lowPlayerVolumeQuietLiftCap <= DEFAULT_LEVELER_PARAMS.maxLiftDb,
  String(lowPlayerVolumeQuietLiftCap)
);

const quarterVolumeLimiterCeiling = computePlayerVolumeLimiterCeilingDb({
  playerVolumeCap: 0.25,
  respectPlayerVolume: true
});
assert(
  'player volume scales the hard limiter ceiling',
  quarterVolumeLimiterCeiling < -14.9 && quarterVolumeLimiterCeiling > -15.2,
  String(quarterVolumeLimiterCeiling)
);
assert(
  'disabling player-volume safety keeps the base limiter ceiling',
  computePlayerVolumeLimiterCeilingDb({ playerVolumeCap: 0.25, respectPlayerVolume: false }) === DEFAULT_LEVELER_PARAMS.limiterCeilingDb
);

assert(
  'zero cut does not attenuate unlifted source peaks',
  closeToZero(computeProcessingLimiterCeilingDb({
    settings: { ...baseSettings, cutStrength: 0, liftStrength: 100 },
    liftSafetyActive: false,
    playerVolumeCap: 1,
    respectPlayerVolume: true
  }))
);

assert(
  'cut strength scales the processing limiter ceiling',
  Math.abs(computeProcessingLimiterCeilingDb({
    settings: { ...baseSettings, cutStrength: 50, liftStrength: 100 },
    liftSafetyActive: false,
    playerVolumeCap: 1,
    respectPlayerVolume: true
  }) - (-1.5)) < 0.001
);

assert(
  'active quiet lift uses the full safety ceiling',
  Math.abs(computeProcessingLimiterCeilingDb({
    settings: { ...baseSettings, cutStrength: 0, liftStrength: 100 },
    liftSafetyActive: true,
    playerVolumeCap: 1,
    respectPlayerVolume: true
  }) - DEFAULT_LEVELER_PARAMS.limiterCeilingDb) < 0.001
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
