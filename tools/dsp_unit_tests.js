require('../shared/core.js');
const {
  DEFAULT_SETTINGS,
  K_WEIGHTING_PARAMS,
  computePlayerVolumeLimiterCeilingDb,
  computeSignalGateActive,
  normalizeSettings
} = globalThis.WebVolumeBalancerCore;
const {
  POLICY_REVISION,
  DEFAULT_PARAMS,
  ProgrammeLoudnessEstimator,
  computeTargetGainDb,
  computeTransitionCeilingDb,
  dbToEnergy
} = require('../shared/programme-leveler-policy.js');

function assert(name, condition, details = '') {
  if (condition) console.log(`OK   ${name}`);
  else {
    console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
    process.exitCode = 1;
  }
}

function close(actual, expected, tolerance = 0.01) {
  return Math.abs(actual - expected) <= tolerance;
}

assert('settings preserve known preset', normalizeSettings({ preset: 'night' }).preset === 'night');
assert('settings classify unknown preset as custom', normalizeSettings({ preset: 'mystery' }).preset === 'custom');
assert('default settings retain independent full-strength controls', DEFAULT_SETTINGS.cutStrength === 100 && DEFAULT_SETTINGS.liftStrength === 100);
assert('K-weighting constants remain the BS.1770 biquad approximation', K_WEIGHTING_PARAMS.shelfGainDb > 3.9 && K_WEIGHTING_PARAMS.highpassFrequencyHz > 38);
assert('programme controller exposes its runtime policy revision', POLICY_REVISION === 'uniform-shortform-v1');

const gateOpen = computeSignalGateActive({ wasActive: false, energyDb: -60, peak: 0.001 });
const gateCloseHeld = computeSignalGateActive({ wasActive: true, energyDb: -65, peak: 0.0003 });
const gateClosed = computeSignalGateActive({ wasActive: true, energyDb: -72, peak: 0.0001 });
assert('signal gate uses hysteresis around the noise floor', gateOpen && gateCloseHeld && !gateClosed);

const estimator = new ProgrammeLoudnessEstimator();
estimator.addBlock(dbToEnergy(-80));
assert('absolute gate rejects sub-floor blocks', estimator.snapshot().acceptedBlocks === 0);
for (let index = 0; index < 12; index += 1) estimator.addBlock(dbToEnergy(-24));
assert(
  'programme confidence reaches one after short-form representative evidence',
  estimator.snapshot().acceptedBlocks === 12 && estimator.snapshot().confidence === 1,
  JSON.stringify(estimator.snapshot())
);
assert('steady programme estimate is accurate', close(estimator.snapshot().programmeDb, -24, 0.05), JSON.stringify(estimator.snapshot()));

const gated = new ProgrammeLoudnessEstimator();
for (let index = 0; index < 20; index += 1) gated.addBlock(dbToEnergy(-20));
for (let index = 0; index < 5; index += 1) gated.addBlock(dbToEnergy(-40));
assert(
  'relative gate keeps very quiet tails from redefining the programme centre',
  gated.snapshot().programmeDb > -20.5,
  JSON.stringify(gated.snapshot())
);
for (let index = 0; index < 20; index += 1) gated.addBlock(dbToEnergy(-30));
assert(
  'cumulative programme state does not chase the latest window',
  gated.snapshot().programmeDb > -25 && gated.snapshot().programmeDb < -19,
  JSON.stringify(gated.snapshot())
);
gated.reset();
assert('explicit boundary reset clears accumulated programme state', gated.snapshot().acceptedBlocks === 0 && gated.snapshot().programmeDb === null);

function gain(input) {
  return computeTargetGainDb({
    enabled: true,
    signalActive: true,
    cutStrength: 100,
    liftStrength: 100,
    programmeDb: DEFAULT_PARAMS.programmeTargetDb,
    confidence: 1,
    momentaryDb: DEFAULT_PARAMS.programmeTargetDb,
    fastDb: DEFAULT_PARAMS.programmeTargetDb,
    peakDb: -12,
    limiterCeilingDb: -3,
    canLift: true,
    ...input
  });
}

assert('disabled policy returns unity', gain({ enabled: false }).targetGainDb === 0);
assert('zero strength returns unity', gain({ cutStrength: 0, liftStrength: 0 }).targetGainDb === 0);
assert('programme at target stays at unity', close(gain({}).targetGainDb, 0));
const loud = gain({ programmeDb: -12, momentaryDb: -12, fastDb: -12, peakDb: -6 });
assert('loud programme receives downward correction', loud.targetGainDb < -5.5 && loud.targetGainDb > -7, JSON.stringify(loud));
const quiet = gain({ programmeDb: -35, momentaryDb: -35, fastDb: -35, peakDb: -24 });
assert('quiet programme receives strong upward correction', quiet.targetGainDb > 13 && quiet.targetGainDb < 16, JSON.stringify(quiet));
const loudMoment = gain({ programmeDb: -20, momentaryDb: -12, fastDb: -12, peakDb: -6 });
const quietMoment = gain({ programmeDb: -20, momentaryDb: -28, fastDb: -28, peakDb: -18 });
assert('within-programme loud moments are compressed around the centre', loudMoment.dynamicsCorrectionDb < -4, JSON.stringify(loudMoment));
assert('within-programme quiet moments are lifted without becoming a second target', quietMoment.dynamicsCorrectionDb > 4 && quietMoment.dynamicsCorrectionDb < 12, JSON.stringify(quietMoment));
const liveBed = gain({ programmeDb: -14, momentaryDb: -60, fastDb: -60, peakDb: -52 });
assert(
  'a loud programme quiet bed cannot become a second full-volume programme',
  liveBed.dynamicsCorrectionDb === 0 && liveBed.targetGainDb < 0,
  JSON.stringify(liveBed)
);
const coldLoud = gain({ programmeDb: null, confidence: 0, momentaryDb: -10, fastDb: -10, peakDb: -5 });
const coldQuiet = gain({ programmeDb: null, confidence: 0, momentaryDb: -35, fastDb: -35, peakDb: -24 });
assert('cold-start fast cut acts before programme confidence', coldLoud.targetGainDb <= -6, JSON.stringify(coldLoud));
assert('cold-start upward gain waits for programme confidence', coldQuiet.targetGainDb === 0, JSON.stringify(coldQuiet));
const peakBound = gain({ programmeDb: -45, momentaryDb: -45, fastDb: -45, peakDb: -4 });
assert('upward gain is bounded by captured peak budget', peakBound.targetGainDb <= 10.51 && peakBound.liftBudgetDb <= 10.51, JSON.stringify(peakBound));
assert('lift slider zero leaves only downward policy', gain({ programmeDb: -35, momentaryDb: -35, fastDb: -35, liftStrength: 0 }).targetGainDb === 0);
assert('cut slider zero leaves loud programme unattenuated', gain({ programmeDb: -12, momentaryDb: -12, fastDb: -12, peakDb: -6, cutStrength: 0 }).targetGainDb === 0);

assert('adaptive transition defaults to target plus six dB crest', close(computeTransitionCeilingDb({ baseCeilingDb: -3, cutStrength: 100 }), -13));
assert('recent quiet output cannot tighten the next onset below the programme safety crest', close(computeTransitionCeilingDb({ baseCeilingDb: -3, recentOutputPeakDb: -20, cutStrength: 100 }), -13));
assert('transition protection follows cut strength', close(computeTransitionCeilingDb({ baseCeilingDb: -3, recentOutputPeakDb: -20, cutStrength: 50 }), -8));
assert('zero cut keeps the ordinary limiter ceiling', close(computeTransitionCeilingDb({ baseCeilingDb: -3, recentOutputPeakDb: -20, cutStrength: 0 }), -3));

assert('player volume scales the sample limiter ceiling', close(computePlayerVolumeLimiterCeilingDb({ playerVolumeCap: 0.25, respectPlayerVolume: true }, { limiterCeilingDb: -3 }), -15.041, 0.01));
assert('disabling player-volume safety keeps the base ceiling', computePlayerVolumeLimiterCeilingDb({ playerVolumeCap: 0.25, respectPlayerVolume: false }, { limiterCeilingDb: -3 }) === -3);
assert('policy bounds are intentionally smaller than the legacy controller', DEFAULT_PARAMS.maxLiftDb === 25 && DEFAULT_PARAMS.maxCutDb === 24 && DEFAULT_PARAMS.liftLimiterBudgetDb === 10 && DEFAULT_PARAMS.maxDynamicsLiftDb === 16);

if (process.exitCode) process.exit(process.exitCode);
