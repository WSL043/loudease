const path = require('path');

require(path.resolve(__dirname, '..', 'shared', 'core.js'));

const {
  computeDualWindowLoudnessDb,
  computeLevelerGainDb,
  dbToLinear,
  energyToDb,
  K_WEIGHTING_PARAMS,
  linearToDb,
  meanLast,
  stabilizeGainTarget,
  computeSignalGateActive
} = globalThis.WebVolumeBalancerCore;

const SAMPLE_RATE = 48000;
const FRAME_MS = 20;
const FRAME_SIZE = Math.round(SAMPLE_RATE * FRAME_MS / 1000);
const NOISE_FLOOR_DB = -62;
const SIGNAL_PEAK_FLOOR = 0.00035;
const TARGET_RMS_DB = -29;
const LIFT_TARGET_RMS_DB = -29;
const MAX_LIFT_DB = 34;
const MAX_CUT_DB = 30;
const LIMITER_CEILING_DB = -3;
const PEAK_GUARD_DB = -6;
const LIFT_LIMITER_BUDGET_DB = 15;
const CUT_ATTACK_SECONDS = 0.012;
const CUT_RELEASE_SECONDS = 0.18;
const LIFT_ATTACK_SECONDS = 0.10;
const LIFT_RELEASE_SECONDS = 0.25;
const MAX_GAIN_INCREASE_STEP_DB = 3;
const FAST_CUT_HISTORY_FRAMES = 5;
const MOMENTARY_HISTORY_FRAMES = 20;
const SHORT_TERM_HISTORY_FRAMES = 150;
const LIFT_LOUDNESS_HISTORY_FRAMES = 5;
const LIFT_CONTROL_HISTORY_FRAMES = 10;
const MAX_HISTORY_FRAMES = SHORT_TERM_HISTORY_FRAMES;
const LIFT_LOUDNESS_PERCENTILE = 0.5;
const LIFT_PEAK_PERCENTILE = 0.65;
const TARGET_DEADBAND_DB = 0.8;
const TARGET_HOLD_MS = 80;
const CEILING_LINEAR = dbToLinear(LIMITER_CEILING_DB);

const settings = {
  enabled: true,
  respectPlayerVolume: true,
  cutStrength: 100,
  liftStrength: 100
};

function assert(name, condition, details = '') {
  if (!condition) {
    console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${name}`);
}

function makeRng(seed = 0x12345678) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return (value / 0xffffffff) * 2 - 1;
  };
}

function appendSamples(target, seconds, generator) {
  const count = Math.round(seconds * SAMPLE_RATE);
  const start = target.length;
  for (let i = 0; i < count; i += 1) {
    target.push(generator((start + i) / SAMPLE_RATE, i));
  }
  return { start, end: target.length };
}

function sine(frequency, amplitude, phase = 0) {
  return (time) => amplitude * Math.sin((2 * Math.PI * frequency * time) + phase);
}

function buildFixture() {
  const samples = [];
  const segments = {};
  const rng = makeRng();

  segments.silence = appendSamples(samples, 1.0, () => 0);
  segments.quietVoice = appendSamples(samples, 1.2, (time) => (
    sine(180, 0.004)(time)
    + sine(360, 0.0025, 0.4)(time)
    + sine(2400, 0.0008, 0.2)(time)
  ));
  segments.loudTone = appendSamples(samples, 1.0, sine(1000, 0.18));
  segments.burst = appendSamples(samples, 0.25, sine(1000, 0.9));
  segments.recovery = appendSamples(samples, 0.8, sine(260, 0.012));
  segments.noiseQuietVoice = appendSamples(samples, 1.2, (time) => (
    sine(210, 0.004)(time)
    + sine(420, 0.002, 0.3)(time)
    + rng() * 0.0009
  ));
  segments.alternating = appendSamples(samples, 2.4, (time, index) => {
    const local = index / SAMPLE_RATE;
    const block = Math.floor(local / 0.4);
    const amp = block % 2 === 0 ? 0.14 : 0.006;
    return sine(330, amp)(time) + sine(660, amp * 0.35, 0.2)(time);
  });

  return { samples, segments };
}

function frameStats(samples, start, end) {
  let sum = 0;
  let peak = 0;
  for (let i = start; i < end; i += 1) {
    const sample = samples[i] || 0;
    sum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    energy: sum / Math.max(1, end - start),
    peak
  };
}

function highpassCoefficients(frequencyHz, q) {
  const omega = (2 * Math.PI * frequencyHz) / SAMPLE_RATE;
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

function highShelfCoefficients(frequencyHz, gainDb) {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequencyHz) / SAMPLE_RATE;
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

function applyBiquad(samples, coefficients) {
  const output = new Array(samples.length).fill(0);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x0 = samples[i];
    const y0 = (coefficients.b0 * x0)
      + (coefficients.b1 * x1)
      + (coefficients.b2 * x2)
      - (coefficients.a1 * y1)
      - (coefficients.a2 * y2);
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function applyKWeighting(samples) {
  const shelf = applyBiquad(samples, highShelfCoefficients(
    K_WEIGHTING_PARAMS.shelfFrequencyHz,
    K_WEIGHTING_PARAMS.shelfGainDb
  ));
  return applyBiquad(shelf, highpassCoefficients(
    K_WEIGHTING_PARAMS.highpassFrequencyHz,
    K_WEIGHTING_PARAMS.highpassQ
  ));
}

function smoothGain(currentGainDb, targetGainDb, seconds, frameStartGainDb = currentGainDb) {
  const timeConstant = Math.max(0.001, seconds);
  const alpha = 1 - Math.exp(-(FRAME_MS / 1000) / timeConstant);
  const nextGainDb = currentGainDb + ((targetGainDb - currentGainDb) * alpha);
  return Math.min(nextGainDb, frameStartGainDb + MAX_GAIN_INCREASE_STEP_DB);
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

function processFixture(samples) {
  const output = new Array(samples.length).fill(0);
  const weightedSamples = applyKWeighting(samples);
  const gainByFrame = [];
  let currentGainDb = 0;
  let targetGainDb = 0;
  let stableTargetGainDb = 0;
  let targetChangedAtMs = 0;
  let signalActive = false;
  const energyHistory = [];
  const peakHistory = [];

  for (let start = 0; start < samples.length; start += FRAME_SIZE) {
    const end = Math.min(samples.length, start + FRAME_SIZE);
    const { peak } = frameStats(samples, start, end);
    const { energy } = frameStats(weightedSamples, start, end);
    const inputDb = energyToDb(energy);
    signalActive = computeSignalGateActive({
      wasActive: signalActive,
      energyDb: inputDb,
      peak
    }, {
      openDb: NOISE_FLOOR_DB,
      closeDb: NOISE_FLOOR_DB - 6,
      openPeak: SIGNAL_PEAK_FLOOR,
      closePeak: SIGNAL_PEAK_FLOOR * 0.5
    });
    const hasSignal = signalActive;
    pushBounded(energyHistory, energy, MAX_HISTORY_FRAMES);
    pushBounded(peakHistory, peak, MAX_HISTORY_FRAMES);
    const fastCutEnergy = meanLast(energyHistory, FAST_CUT_HISTORY_FRAMES);
    const momentaryEnergy = meanLast(energyHistory, MOMENTARY_HISTORY_FRAMES);
    const shortTermEnergy = meanLast(energyHistory, SHORT_TERM_HISTORY_FRAMES);
    const loudness = computeDualWindowLoudnessDb(momentaryEnergy, shortTermEnergy);
    const liftControlDb = energyToDb(percentileLast(energyHistory, LIFT_LOUDNESS_HISTORY_FRAMES, LIFT_LOUDNESS_PERCENTILE));
    const liftPeak = percentileLast(peakHistory, LIFT_CONTROL_HISTORY_FRAMES, LIFT_PEAK_PERCENTILE);
    const controlDb = Math.max(loudness.controlDb, energyToDb(fastCutEnergy));
    const peakDb = linearToDb(peak);
    const liftPeakDb = linearToDb(liftPeak || peak);

    if (!hasSignal) {
      targetGainDb = 0;
      stableTargetGainDb = 0;
      targetChangedAtMs = (start / SAMPLE_RATE) * 1000;
      currentGainDb = smoothGain(
        currentGainDb,
        0,
        currentGainDb < 0 ? CUT_RELEASE_SECONDS : LIFT_RELEASE_SECONDS
      );
    } else {
      const gain = computeLevelerGainDb({
        rmsDb: controlDb,
        liftRmsDb: liftControlDb,
        peakDb,
        liftPeakDb,
        settings
      }, {
        targetRmsDb: TARGET_RMS_DB,
        liftTargetRmsDb: LIFT_TARGET_RMS_DB,
        maxLiftDb: MAX_LIFT_DB,
        maxCutDb: MAX_CUT_DB,
        limiterCeilingDb: LIMITER_CEILING_DB,
        peakGuardDb: PEAK_GUARD_DB,
        liftLimiterBudgetDb: LIFT_LIMITER_BUDGET_DB
      });

      const nowMs = (start / SAMPLE_RATE) * 1000;
      const stabilized = stabilizeGainTarget({
        currentTargetDb: stableTargetGainDb,
        candidateTargetDb: gain.targetGainDb,
        elapsedMs: nowMs - targetChangedAtMs
      }, {
        deadbandDb: TARGET_DEADBAND_DB,
        holdMs: TARGET_HOLD_MS
      });
      if (stabilized.changed) {
        targetChangedAtMs = nowMs;
      }
      stableTargetGainDb = stabilized.targetGainDb;
      targetGainDb = stableTargetGainDb;
      const frameStartGainDb = currentGainDb;
      if (targetGainDb < currentGainDb && targetGainDb < 0) {
        currentGainDb = smoothGain(currentGainDb, targetGainDb, CUT_ATTACK_SECONDS, frameStartGainDb);
      } else if (targetGainDb > currentGainDb && currentGainDb < 0) {
        currentGainDb = smoothGain(currentGainDb, targetGainDb, CUT_RELEASE_SECONDS, frameStartGainDb);
      } else if (targetGainDb > currentGainDb) {
        currentGainDb = smoothGain(currentGainDb, targetGainDb, LIFT_ATTACK_SECONDS, frameStartGainDb);
      } else {
        currentGainDb = smoothGain(currentGainDb, targetGainDb, LIFT_RELEASE_SECONDS, frameStartGainDb);
      }
    }

    const linearGain = dbToLinear(currentGainDb);
    for (let i = start; i < end; i += 1) {
      const amplified = samples[i] * linearGain;
      output[i] = Math.max(-CEILING_LINEAR, Math.min(CEILING_LINEAR, amplified));
    }

    gainByFrame.push({
      start,
      end,
      inputDb,
      controlDb,
      liftControlDb,
      peakDb,
      liftPeakDb,
      targetGainDb,
      currentGainDb,
      hasSignal
    });
  }

  return { output, gainByFrame };
}

function segmentMetrics(samples, output, segment) {
  const input = frameStats(samples, segment.start, segment.end);
  const out = frameStats(output, segment.start, segment.end);
  return {
    inputDb: energyToDb(input.energy),
    outputDb: energyToDb(out.energy),
    inputPeakDb: linearToDb(input.peak),
    outputPeakDb: linearToDb(out.peak),
    deltaDb: energyToDb(out.energy) - energyToDb(input.energy)
  };
}

function gainStepSummary(gainByFrame) {
  let maxIncrease = 0;
  let maxDecrease = 0;
  for (let i = 1; i < gainByFrame.length; i += 1) {
    const diff = gainByFrame[i].currentGainDb - gainByFrame[i - 1].currentGainDb;
    maxIncrease = Math.max(maxIncrease, diff);
    maxDecrease = Math.max(maxDecrease, -diff);
  }
  return { maxIncrease, maxDecrease };
}

function segmentFrameSummary(gainByFrame, segment, maxElapsedSeconds) {
  const frames = gainByFrame.filter((frame) => (
    frame.start >= segment.start
    && frame.start < segment.end
    && (frame.start - segment.start) < maxElapsedSeconds * SAMPLE_RATE
  ));
  let maxGainDb = -Infinity;
  let firstPositiveAtMs = null;
  for (const frame of frames) {
    maxGainDb = Math.max(maxGainDb, frame.currentGainDb);
    if (firstPositiveAtMs == null && frame.currentGainDb > 0.5) {
      firstPositiveAtMs = ((frame.start - segment.start) / SAMPLE_RATE) * 1000;
    }
  }
  return {
    maxGainDb: Number.isFinite(maxGainDb) ? maxGainDb : 0,
    firstPositiveAtMs
  };
}

function segmentGainRange(gainByFrame, segment) {
  const values = gainByFrame
    .filter((frame) => frame.start >= segment.start && frame.start < segment.end)
    .map((frame) => frame.currentGainDb);
  const minGainDb = values.length ? Math.min(...values) : 0;
  const maxGainDb = values.length ? Math.max(...values) : 0;
  let polarityChanges = 0;
  let previousPolarity = 0;
  for (const value of values) {
    const polarity = value > 0.5 ? 1 : value < -0.5 ? -1 : 0;
    if (polarity && previousPolarity && polarity !== previousPolarity) {
      polarityChanges += 1;
    }
    if (polarity) {
      previousPolarity = polarity;
    }
  }
  return { minGainDb, maxGainDb, spanDb: maxGainDb - minGainDb, polarityChanges };
}

function maxAbs(values) {
  let max = 0;
  for (const value of values) {
    max = Math.max(max, Math.abs(value));
  }
  return max;
}

const fixture = buildFixture();
const processed = processFixture(fixture.samples);
const metrics = Object.fromEntries(
  Object.entries(fixture.segments).map(([name, segment]) => [
    name,
    segmentMetrics(fixture.samples, processed.output, segment)
  ])
);
// Program-level assertions exclude the first 200 ms after a fixture boundary.
// That interval deliberately exercises the bounded gain transition and would
// otherwise dominate an RMS average even though the steady passage converges.
const settledMetrics = Object.fromEntries(
  Object.entries(fixture.segments).map(([name, segment]) => [
    name,
    segmentMetrics(fixture.samples, processed.output, {
      start: Math.min(segment.end, segment.start + Math.round(0.2 * SAMPLE_RATE)),
      end: segment.end
    })
  ])
);

const overallOutputPeak = maxAbs(processed.output);
const gainStep = gainStepSummary(processed.gainByFrame);
const recoveryStart = segmentFrameSummary(processed.gainByFrame, fixture.segments.recovery, 0.8);
const alternatingGain = segmentGainRange(processed.gainByFrame, fixture.segments.alternating);
const quietLoudGapDb = Math.abs(settledMetrics.quietVoice.outputDb - settledMetrics.loudTone.outputDb);
const noisyQuietLoudGapDb = Math.abs(settledMetrics.noiseQuietVoice.outputDb - settledMetrics.loudTone.outputDb);

assert('silence is not lifted into noise', metrics.silence.outputDb < -80, JSON.stringify(metrics.silence));
assert('quiet voice receives strong lift', metrics.quietVoice.deltaDb > 18 && metrics.quietVoice.deltaDb <= MAX_LIFT_DB + 0.5, JSON.stringify(metrics.quietVoice));
assert('loud 1kHz tone settles at the common target', settledMetrics.loudTone.deltaDb < -10 && Math.abs(settledMetrics.loudTone.outputDb - TARGET_RMS_DB) < 1, JSON.stringify(settledMetrics.loudTone));
assert('quiet and loud program levels converge', quietLoudGapDb <= 3.5, `gapDb=${quietLoudGapDb.toFixed(3)}`);
assert('burst peak is limited below ceiling', metrics.burst.outputPeakDb <= LIMITER_CEILING_DB + 0.1, JSON.stringify(metrics.burst));
assert('noise plus quiet voice is strongly lifted but remains bounded', metrics.noiseQuietVoice.deltaDb > 18 && metrics.noiseQuietVoice.deltaDb < MAX_LIFT_DB, JSON.stringify(metrics.noiseQuietVoice));
assert('noisy quiet voice also converges toward the loud program', noisyQuietLoudGapDb <= 3.5, `gapDb=${noisyQuietLoudGapDb.toFixed(3)}`);
assert('alternating loud quiet sequence remains bounded', metrics.alternating.outputPeakDb <= LIMITER_CEILING_DB + 0.1, JSON.stringify(metrics.alternating));
assert(
  'strong leveling applies opposite correction to alternating loud and quiet blocks',
  alternatingGain.minGainDb < -8 && alternatingGain.maxGainDb > 10 && alternatingGain.polarityChanges >= 4,
  JSON.stringify(alternatingGain)
);
assert(
  'quiet recovery becomes audible within 400ms without an immediate jump',
  recoveryStart.maxGainDb > 10
    && recoveryStart.firstPositiveAtMs != null
    && recoveryStart.firstPositiveAtMs >= 100
    && recoveryStart.firstPositiveAtMs <= 400,
  JSON.stringify(recoveryStart)
);
assert('overall output never clips', overallOutputPeak <= CEILING_LINEAR + 0.000001, `peak=${overallOutputPeak}`);
assert('gain recovery has bounded upward steps', gainStep.maxIncrease <= MAX_GAIN_INCREASE_STEP_DB + 0.01, `maxIncreaseDb=${gainStep.maxIncrease.toFixed(3)}`);
assert('protective cut remains bounded', gainStep.maxDecrease <= MAX_CUT_DB + 1, `maxDecreaseDb=${gainStep.maxDecrease.toFixed(3)}`);

if (process.exitCode) {
  console.log(JSON.stringify({ metrics, settledMetrics, quietLoudGapDb, noisyQuietLoudGapDb, overallOutputPeak, gainStep, recoveryStart, alternatingGain }, null, 2));
  process.exit(process.exitCode);
}
