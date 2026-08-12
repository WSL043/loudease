const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const worklet = fs.readFileSync(path.join(root, 'offscreen', 'leveler-worklet.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'shared', 'programme-leveler-policy.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'content', 'bridge.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const meter = fs.readFileSync(path.join(root, 'offscreen', 'meter-worklet.js'), 'utf8');

const checks = [
  ['legacy page loudness engine is absent', !fs.existsSync(path.join(root, 'content', 'engine.js'))],
  ['programme target replaces the legacy -29 fixed output target', /programmeTargetDb: -19/.test(policy) && !/TARGET_RMS_DB = -29/.test(worklet)],
  ['measurement keeps 400 ms momentary and 3 second short-term windows', /MOMENTARY_FRAMES = 20/.test(worklet) && /SHORT_TERM_FRAMES = 150/.test(worklet) && /const FRAME_MS = 20/.test(worklet)],
  ['programme estimator uses absolute and relative gating', /absoluteGateDb: -70/.test(policy) && /relativeGateDb: 10/.test(policy) && /relativeThresholdDb/.test(policy)],
  ['programme measurement is constant-memory cumulative state', /Uint32Array\(this\.binCount\)/.test(policy) && /Float64Array\(this\.binCount\)/.test(policy) && /acceptedBlocks/.test(policy)],
  ['programme and within-programme corrections share one gain target', /programmeCorrectionDb \+ dynamicsCorrectionDb/.test(policy) && /targetGainDb/.test(policy)],
  ['cold-start lift requires several seconds of representative programme evidence', /confidenceStartBlocks: 1/.test(policy) && /confidenceFullBlocks: 40/.test(policy) && /\* confidence/.test(policy)],
  ['fast loud protection does not wait for programme confidence', /fastCutMarginDb: 3/.test(policy) && /fastProtectionDb = fastExcessDb \* cutScale/.test(policy)],
  ['lift and cut strength remain independent and zero-safe', /scaleByDirection/.test(policy) && /Math\.max\(cutScale, liftScale\) <= 0/.test(policy)],
  ['upward gain is bounded by peak headroom and limiter budget', /rawHeadroomDb/.test(policy) && /liftLimiterBudgetDb: 10/.test(policy) && /maxLiftDb: 25/.test(policy)],
  ['transition ceiling is fixed to the programme safety crest instead of chasing recent quiet peaks', /transitionDefaultCrestDb: 6/.test(policy) && !/recentOutputPeakDb/.test(policy) && /computeTransitionCeilingDb/.test(worklet)],
  ['worklet limiter keeps 5 ms lookahead and no hard clip path', /sampleRate \* 0\.005/.test(worklet) && /hardClippedSamples/.test(worklet) && /maxHardClipOvershoot/.test(worklet)],
  ['signal gate has hysteresis and holds gain through short pauses', /-68 : -62/.test(worklet) && /SILENCE_HOLD_FRAMES = 50/.test(worklet)],
  ['source-domain player-volume compensation does not alter captured peak headroom', /sourceEnergy = capturedEnergy \* sourceCompensation \* sourceCompensation/.test(worklet) && /controlInput\.peakDb = linearToDb\(this\.inputPeak\)/.test(worklet)],
  ['unknown player volume blocks lift while known low volume preserves intent', /allowUnknownVolumeLift/.test(worklet) && /playerVolumeReliable/.test(worklet) && /volumeDb\(\)/.test(worklet)],
  ['media source and navigation identity is privacy-preserving before reset', /stableFingerprint/.test(bridge) && /programmeKey/.test(background) && /resetProgramme/.test(worklet)],
  ['pause and resume retain the last active programme identity', /let lastProgrammeKey = ''/.test(bridge) && /activeSources\.length > 0/.test(bridge) && /href !== lastProgrammeHref/.test(bridge) && /const lastProgrammeKeys = new Map\(\)/.test(background) && /lastProgrammeKeys\.set\(tabId, programmeKey\)/.test(background)],
  ['ephemeral blob and srcObject replacement stays within one page programme', /function programmeSourceIdentity\(media\)/.test(bridge) && /sanitizeMediaSource\(media\?\.currentSrc \|\| media\?\.src\)/.test(bridge) && !/sourceObjectIds|nextSourceObjectId/.test(bridge)],
  ['fallback invokes the same shared programme gain law', /updateProgrammeGain/.test(offscreen) && /computeTargetGainDb\(\{/.test(offscreen)],
  ['offscreen loudness measurement retains a separate K-weighted branch', /this\.kShelf\.type = 'highshelf'/.test(offscreen) && /this\.kHighpass\.type = 'highpass'/.test(offscreen) && /this\.measurementSink\.gain\.value = 0/.test(offscreen)],
  ['raw peak and K-weighted energy remain separate in fallback meter', /this\.rawPeak = Math\.max/.test(meter) && /this\.weightedSquareSum \+= sample \* sample/.test(meter)],
  ['gain and mute transitions remain ramped', /rampAudioParam/.test(offscreen) && /linearRampToValueAtTime/.test(offscreen)]
];

let failed = false;
for (const [name, ok] of checks) {
  if (ok) console.log(`OK   ${name}`);
  else {
    failed = true;
    console.error(`FAIL ${name}`);
  }
}
if (failed) process.exit(1);
