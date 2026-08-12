const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const workletPath = path.join(root, 'offscreen', 'leveler-worklet.js');
const policyPath = path.join(root, 'shared', 'programme-leveler-policy.js');
const worklet = fs.readFileSync(workletPath, 'utf8');
const policy = fs.readFileSync(policyPath, 'utf8');
const checks = [
  ['programme policy and leveler worklet exist', fs.existsSync(policyPath) && fs.existsSync(workletPath)],
  ['production loads shared policy before unified worklet', /shared\/programme-leveler-policy\.js/.test(offscreen) && offscreen.indexOf('shared/programme-leveler-policy.js') < offscreen.indexOf('offscreen/leveler-worklet.js')],
  ['unified graph bypasses main-thread meter gain and limiter', /this\.source\.connect\(this\.leveler\)/.test(offscreen) && /this\.leveler\.connect\(this\.playerGain\)/.test(offscreen)],
  ['legacy graph remains a fail-safe fallback', /if \(this\.levelerMode !== 'worklet'\)/.test(offscreen) && /createMeterNode\(\)/.test(offscreen) && /createLimiterNode\(\)/.test(offscreen)],
  ['runtime controls and programme boundaries use port messages', /this\.leveler\.port\.postMessage/.test(offscreen) && /programmeKey: this\.programmeKey/.test(offscreen) && /message\.programmeKey/.test(worklet)],
  ['render path uses bounded typed buffers', /new Float64Array\(HISTORY_SIZE\)/.test(worklet) && /new Float32Array\(DELAY_LENGTH\)/.test(worklet) && /ProgrammeLoudnessEstimator/.test(worklet)],
  ['render path avoids wall clocks timers DOM and network', !/Date\.now|setTimeout|document\.|fetch\(|XMLHttpRequest/.test(worklet)],
  ['worklet owns measurement gain smoothing and lookahead limiting', /finishFrame\(\)/.test(worklet) && /computeTargetGainDb/.test(worklet) && /currentGainDb/.test(worklet) && /limiterGain/.test(worklet)],
  ['programme reference is gated cumulative state rather than a rolling target', /ProgrammeLoudnessEstimator/.test(policy) && /relativeThresholdDb/.test(policy) && !/rolling|medianLast/.test(policy)],
  ['cold-start upward gain waits for confidence while fast cut remains immediate', /confidence/.test(policy) && /fastProtectionDb/.test(policy) && /if \(fastProtectionDb > 0\)/.test(policy)],
  ['one gain law combines programme correction and internal dynamics', /programmeCorrectionDb \+ dynamicsCorrectionDb/.test(policy) && /dynamicsAmount: 0\.72/.test(policy)],
  ['onset protection uses a stable relative crest and lookahead', /computeTransitionCeilingDb/.test(worklet) && /transitionDefaultCrestDb/.test(policy) && !/recentOutputPeakDb/.test(policy) && /LOOKAHEAD_SAMPLES/.test(worklet) && /TRANSITION_PROTECTION_SECONDS = 0\.04/.test(worklet)],
  ['strong lift and cut remain explicitly bounded', /maxLiftDb: 25/.test(policy) && /maxCutDb: 24/.test(policy) && /liftLimiterBudgetDb: 10/.test(policy)],
  ['player-volume compensation stays in source-domain measurement only', /sourceCompensation/.test(worklet) && /controlInput\.limiterCeilingDb = this\.baseCeilingDb\(\)/.test(worklet) && /controlInput\.peakDb = linearToDb\(this\.inputPeak\)/.test(worklet)],
  ['startup gate waits for the first measured control frame', /meterSequence < 0/.test(offscreen) && /this\.openStartupGateIfReady\(\);/.test(offscreen)],
  ['diagnostics are throttled separately from audio-rate processing', /STATE_REPORT_INTERVAL_FRAMES = 5/.test(worklet) && /type: 'state'/.test(worklet) && /reportLimitedSamples \+= this\.limitedSamples/.test(worklet)]
];

let failed = false;
for (const [name, ok] of checks) {
  if (ok) console.log(`OK   ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failed = true;
  }
}
if (failed) process.exit(1);
