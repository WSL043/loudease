const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'shared', 'core.js'), 'utf8');
const meter = fs.readFileSync(path.join(root, 'offscreen', 'meter-worklet.js'), 'utf8');

function numberConst(name) {
  const match = offscreen.match(new RegExp(`const\\s+${name}\\s+=\\s+(-?[0-9.]+);`));
  return match ? Number(match[1]) : NaN;
}

const meterIntervalMs = numberConst('METER_INTERVAL_MS');
const fastCutHistoryFrames = numberConst('FAST_CUT_HISTORY_FRAMES');
const momentaryHistoryFrames = numberConst('MOMENTARY_HISTORY_FRAMES');
const shortTermHistoryFrames = numberConst('SHORT_TERM_HISTORY_FRAMES');
const liftPeakPercentile = numberConst('LIFT_PEAK_PERCENTILE');
const maxLiftDb = numberConst('MAX_LIFT_DB');
const maxCutDb = numberConst('MAX_CUT_DB');
const targetRmsDb = numberConst('TARGET_RMS_DB');
const limiterCeilingDb = numberConst('LIMITER_CEILING_DB');
const peakGuardDb = numberConst('PEAK_GUARD_DB');
const noiseFloorDb = numberConst('NOISE_FLOOR_DB');
const cutAttackSeconds = numberConst('CUT_ATTACK_SECONDS');
const cutReleaseSeconds = numberConst('CUT_RELEASE_SECONDS');
const liftAttackSeconds = numberConst('LIFT_ATTACK_SECONDS');
const liftReleaseSeconds = numberConst('LIFT_RELEASE_SECONDS');
const maxGainIncreaseStepDb = numberConst('MAX_GAIN_INCREASE_STEP_DB');

const checks = [
  ['legacy page loudness engine is absent', !fs.existsSync(path.join(root, 'content', 'engine.js'))],
  ['offscreen momentary window is 400ms', Number.isFinite(meterIntervalMs) && Number.isFinite(momentaryHistoryFrames) && meterIntervalMs * momentaryHistoryFrames === 400],
  ['offscreen protective cut window is 100ms', Number.isFinite(meterIntervalMs) && Number.isFinite(fastCutHistoryFrames) && meterIntervalMs * fastCutHistoryFrames === 100],
  ['offscreen short-term window is 3 seconds', Number.isFinite(meterIntervalMs) && Number.isFinite(shortTermHistoryFrames) && meterIntervalMs * shortTermHistoryFrames === 3000],
  ['offscreen robust lift peak percentile exists', Number.isFinite(liftPeakPercentile) && liftPeakPercentile > 0.5 && liftPeakPercentile < 1],
  ['full cut range is bounded but useful', Number.isFinite(maxCutDb) && maxCutDb >= 30],
  ['full lift range is conservative and useful', Number.isFinite(maxLiftDb) && maxLiftDb >= 8 && maxLiftDb <= 12],
  ['main loudness target is conservative', Number.isFinite(targetRmsDb) && targetRmsDb <= -28],
  ['limiter ceiling leaves headroom', Number.isFinite(limiterCeilingDb) && limiterCeilingDb <= -3],
  ['peak guard leaves musical transient headroom before clipping', Number.isFinite(peakGuardDb) && peakGuardDb <= -5 && peakGuardDb >= -8],
  ['lift ignores silence but accepts quiet real signal', Number.isFinite(noiseFloorDb) && noiseFloorDb <= -62 && /SIGNAL_PEAK_FLOOR = 0\.00035/.test(offscreen)],
  ['cut and lift use separate attack and release envelopes', Number.isFinite(cutAttackSeconds) && Number.isFinite(cutReleaseSeconds) && Number.isFinite(liftAttackSeconds) && Number.isFinite(liftReleaseSeconds) && cutAttackSeconds < cutReleaseSeconds && cutReleaseSeconds < liftAttackSeconds && cutAttackSeconds < liftReleaseSeconds && liftReleaseSeconds < liftAttackSeconds],
  ['upward recovery is bounded', Number.isFinite(maxGainIncreaseStepDb) && maxGainIncreaseStepDb <= 1.4],
  ['diagnostics include live lift and signal health', /currentLiftDb: this\.currentLiftDb/.test(offscreen) && /signalTickCount: this\.signalTickCount/.test(offscreen) && /silentTickCount: this\.silentTickCount/.test(offscreen)],
  ['silence does not create lift', /this\.hasSignal\(energy, peak\)/.test(offscreen) && /this\.targetGainDb = 0;[\s\S]*?this\.targetLiftDb = 0;/.test(offscreen)],
  ['signal gate has separate open and close thresholds', /computeSignalGateActive/.test(core) && /closeDb: NOISE_FLOOR_DB - 6/.test(offscreen) && /closePeak: SIGNAL_PEAK_FLOOR \* 0\.5/.test(offscreen)],
  ['offscreen uses shared DSP gain function', /computeLevelerGainDb/.test(core) && /computeLevelerGainDb\(\{[\s\S]*?rmsDb,[\s\S]*?peakDb,[\s\S]*?settings/.test(offscreen)],
  ['offscreen lift ceiling protects quality', /maxLiftDb: 12/.test(core) && /liftTargetRmsDb: -35/.test(core) && /const MAX_LIFT_DB = 12;/.test(offscreen) && /Math\.min\(peakHeadroomDb, rawPeakHeadroomDb\)/.test(core)],
  ['offscreen lift avoids fast upward pumping', /const LIFT_ATTACK_SECONDS = 0\.35;/.test(offscreen) && /const LIFT_RELEASE_SECONDS = 0\.25;/.test(offscreen)],
  ['offscreen upward gain step is bounded', Number.isFinite(maxGainIncreaseStepDb) && maxGainIncreaseStepDb <= 1.4 && /frameStartGainDb \+ MAX_GAIN_INCREASE_STEP_DB/.test(offscreen)],
  ['offscreen lift uses a stable loudness and robust peak window', /LIFT_CONTROL_HISTORY_FRAMES = 10/.test(offscreen) && /LIFT_PEAK_PERCENTILE = 0\.65/.test(offscreen) && /percentileLast\(this\.peakHistory, LIFT_CONTROL_HISTORY_FRAMES, LIFT_PEAK_PERCENTILE\)/.test(offscreen) && /liftPeakDb/.test(offscreen)],
  ['offscreen loudness measurement uses a separate K-weighted branch', /this\.kShelf\.type = 'highshelf'/.test(offscreen) && /this\.kHighpass\.type = 'highpass'/.test(offscreen) && /this\.weightedAnalyser\.connect\(this\.measurementSink\)/.test(offscreen) && /this\.measurementSink\.gain\.value = 0/.test(offscreen)],
  ['offscreen keeps raw peak safety separate from weighted loudness energy', /this\.source\.connect\(this\.meter, 0, 0\)/.test(offscreen) && /this\.kHighpass\.connect\(this\.meter, 0, 1\)/.test(offscreen) && /this\.rawPeak = Math\.max/.test(meter) && /this\.weightedSquareSum \+= sample \* sample/.test(meter)],
  ['offscreen combines dual loudness windows', /computeDualWindowLoudnessDb/.test(core) && /meanLast\(this\.energyHistory, MOMENTARY_HISTORY_FRAMES\)/.test(offscreen) && /meanLast\(this\.energyHistory, SHORT_TERM_HISTORY_FRAMES\)/.test(offscreen)],
  ['offscreen target has deadband and upward hold', /stabilizeGainTarget/.test(core) && /TARGET_DEADBAND_DB = 0\.8/.test(offscreen) && /TARGET_HOLD_MS = 200/.test(offscreen) && /targetHoldCount/.test(offscreen)],
  ['fast loudness is used only to strengthen protective cut', /fastCutEnergy/.test(offscreen) && /Math\.max\(loudness\.controlDb, energyToDb\(fastCutEnergy\)\)/.test(offscreen) && /this\.updateGain\(controlInputDb, loudness\.liftDb/.test(offscreen)],
  ['offscreen respects player volume with a fresh hard-mute output gate', /this\.playerGain = this\.context\.createGain\(\)/.test(offscreen) && /WVB_OFFSCREEN_APPLY_MEDIA_STATE/.test(offscreen) && /volumeCompensationDb/.test(offscreen) && /liftRmsDb/.test(core) && /freshPlayerMute = this\.playerMuted && this\.playerVolumeStateFresh\(\)/.test(offscreen)],
  ['offscreen scales the limiter ceiling with reliable player volume', /computePlayerVolumeLimiterCeilingDb/.test(core) && /playerVolumeLimiterCeilingDb\(\)/.test(offscreen) && /effectiveLimiterCeilingDb/.test(offscreen)],
  ['processing limiter follows cut strength until lift is active', /computeProcessingLimiterCeilingDb/.test(core) && /liftSafetyActive/.test(core) && /processingLimiterCeilingDb\(\)/.test(offscreen)],
  ['offscreen blocks unknown media-volume lift but allows fresh WebAudio-only tab lift', /MEDIA_STATE_STALE_MS = 5000/.test(offscreen) && /playerVolumeStateReliable\(\)/.test(offscreen) && /canUseAudibleFallbackForLift\(\)[\s\S]*?this\.playerVolumeStateFresh\(\)[\s\S]*?this\.playerVolumeKnown !== true[\s\S]*?this\.playerActiveMediaCount <= 0[\s\S]*?this\.tabAudibleHint === true/.test(offscreen) && /const canLiftWithCurrentVolumeState = volumeStateReliable \|\| this\.canUseAudibleFallbackForLift\(\);/.test(offscreen) && /const effectiveMaxLiftDb = canLiftWithCurrentVolumeState \? computePlayerVolumeBoundedMaxLiftDb/.test(offscreen) && /: 0;/.test(offscreen) && /this\.playerVolumeKnown = mediaState\.playerVolumeKnown === true;/.test(offscreen)],
  ['offscreen signal gate compensates reliable low player volume before classifying silence', /signalGateCompensationDb\(\)/.test(offscreen) && /const adjustedEnergyDb = energyToDb\(energy\) \+ compensationDb;/.test(offscreen) && /const adjustedPeak = peak \* dbToLinear\(compensationDb\);/.test(offscreen)],
  ['quiet lift is bounded by player volume intent', /computePlayerVolumeBoundedMaxLiftDb/.test(core) && /computePlayerVolumeBoundedMaxLiftDb/.test(offscreen) && /playerVolumeLiftCeilingDb/.test(offscreen) && /maxLiftDb: effectiveMaxLiftDb/.test(offscreen)],
  ['offscreen fades player volume zero without stale output diagnostics', /value <= 0\.001[\s\S]*?rampAudioParam\(this\.playerGain\.gain, 0, 0\.008\)/.test(offscreen) && /this\.lastOutputPeak = 0;/.test(offscreen)],
  ['shared DSP separates raw peak safety from lift peak headroom', /liftPeakDb/.test(core) && /peakHeadroomDb = limiterCeilingDb - liftPeakDb - liftHeadroomReserveDb/.test(core) && /rawPeakHeadroomDb = limiterCeilingDb - peakDb - 0\.5/.test(core)],
  ['offscreen has no special cross-zero gain jump', !/NEGATIVE_GAIN_RECOVERY_STEP_DB/.test(offscreen)],
  ['offscreen does not erase loudness history on ordinary amplitude drops', !/shouldResetLoudnessHistory/.test(offscreen) && !/resetLoudnessHistory\(energy, peak\)/.test(offscreen)],
  ['gain and mute transitions use short audio ramps', /rampAudioParam/.test(offscreen) && /linearRampToValueAtTime/.test(offscreen)]
];

let failed = false;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`OK   ${name}`);
  } else {
    failed = true;
    console.error(`FAIL ${name}`);
  }
}

if (failed) {
  process.exit(1);
}
