// Product-oriented diagnostic over previously qualified real-site numeric rows.
// The approximate K-weighted observer is not a certified LUFS or speech meter.
const fs = require('fs');
const path = require('path');
const { analyze } = require('./analyze_personal_quality');

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function energyMeanDb(values) {
  if (!values.length) return null;
  return 10 * Math.log10(values.reduce((sum, db) => sum + 10 ** (db / 10), 0) / values.length);
}

function estimatedFastExtraCutDb(row) {
  if (!Number.isFinite(row.programmeDb) || !Number.isFinite(row.targetGainDb)
    || !Number.isFinite(row.momentary?.[0]) || !(row.normalizationCap > 0)) return null;
  const momentaryDb = row.momentary[0] - 20 * Math.log10(row.normalizationCap);
  const signedDeadband = value => Math.sign(value) * Math.max(0, Math.abs(value) - 1);
  const confidence = row.confidence ?? 1;
  const programme = signedDeadband(-19 - row.programmeDb) * confidence;
  let dynamics = signedDeadband(row.programmeDb - momentaryDb)
    * (row.dynamicsAmount ?? .92) * confidence;
  if (dynamics > 0) dynamics = Math.min(dynamics,
    16 * Math.max(0, Math.min(1, (momentaryDb + 48) / 8)));
  const withoutFast = programme + dynamics;
  // Headroom can also cap positive requests. Only infer fast extra cut where
  // the unprotected request is already non-positive.
  return withoutFast <= 0 ? Math.max(0, withoutFast - row.targetGainDb) : null;
}

function describeVideo(result, rows) {
  if (!rows.length) return null;
  // EBU Tech 3342 inspires the relative gate, but these values are not LRA:
  // the observer is approximate and the same input-selected times are used for both sides.
  const inputCentreDb = energyMeanDb(rows.map(r => r.input));
  const outputCentreDb = energyMeanDb(rows.map(r => r.output));
  const gateDb = Math.max(-70, inputCentreDb - 20);
  const signal = rows.filter(r => r.input >= gateDb);
  const inputLowDb = quantile(signal.map(r => r.input), .1);
  const inputHighDb = quantile(signal.map(r => r.input), .95);
  const outputLowDb = quantile(signal.map(r => r.output), .1);
  const outputHighDb = quantile(signal.map(r => r.output), .95);
  const bottomCutDb = quantile(signal.map(r => r.input), .25);
  const topCutDb = quantile(signal.map(r => r.input), .75);
  const quieter = signal.filter(r => r.input <= bottomCutDb);
  const louder = signal.filter(r => r.input >= topCutDb);
  const group = subset => ({ seconds: subset.length / 10,
    inputMedianDb: quantile(subset.map(r => r.input), .5),
    outputMedianDb: quantile(subset.map(r => r.output), .5),
    programmeMedianDb: quantile(subset.map(r => r.programmeDb).filter(Number.isFinite), .5),
    targetGainMedianDb: quantile(subset.map(r => r.targetGainDb).filter(Number.isFinite), .5),
    gainMedianDb: quantile(subset.map(r => r.gainDb).filter(Number.isFinite), .5),
    limiterMedianDb: quantile(subset.map(r => r.limiterReductionDb).filter(Number.isFinite), .5),
    limiterP90Db: quantile(subset.map(r => r.limiterReductionDb).filter(Number.isFinite), .9),
    estimatedFastExtraCutMedianDb: quantile(subset.map(estimatedFastExtraCutDb).filter(Number.isFinite), .5),
    estimatedFastExtraCutOverHalfDbPercent: 100 * subset.filter(r =>
      (estimatedFastExtraCutDb(r) ?? 0) > .5).length / subset.length,
    transitionProtectedPercent: 100 * subset.filter(r => r.transitionProtected).length / subset.length });
  const quietGroup = group(quieter);
  const loudGroup = group(louder);
  const inputGroupContrastDb = loudGroup.inputMedianDb - quietGroup.inputMedianDb;
  const outputGroupContrastDb = loudGroup.outputMedianDb - quietGroup.outputMedianDb;
  return { site: result.site, segment: result.segment, title: result.title,
    eligibleSeconds: rows.length / 10, signalSeconds: signal.length / 10,
    inputCentreDb, outputCentreDb, centreChangeDb: outputCentreDb - inputCentreDb,
    sharedInputGateDb: gateDb,
    inputRangeP10P95Db: inputHighDb - inputLowDb,
    outputRangeP10P95Db: outputHighDb - outputLowDb,
    inputGroupContrastDb, outputGroupContrastDb,
    contrastWarning: inputGroupContrastDb >= 4 && outputGroupContrastDb < 0
      ? 'reversed' : inputGroupContrastDb >= 4 && outputGroupContrastDb < 1
        ? 'near-flat' : null,
    quietGroup, loudGroup,
    medianOutputDb: quantile(rows.map(r => r.output), .5),
    peakLimitingP90Db: quantile(rows.map(r => r.limiterReductionDb), .9),
    transitionProtectedPercent: result.transitionProtectedPercent };
}

function analyzeBalance(directory) {
  const bySegment = new Map();
  const report = analyze(directory, (site, segment, row) => {
    const key = `${site}:${segment}`;
    if (!bySegment.has(key)) bySegment.set(key, []);
    bySegment.get(key).push(row);
  });
  const qualified = report.results.filter(r => r.coverage === 'at-least-60s-eligible');
  const videos = qualified.map(r => describeVideo(r, bySegment.get(`${r.site}:${r.segment}`) || []));
  const inputCentres = videos.map(v => v.inputCentreDb);
  const outputCentres = videos.map(v => v.outputCentreDb);
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceDirectory: directory,
    interpretation: 'Internal approximate K-weighted, volume-normalized 3 s windows; not LUFS, LRA, foreground classification, independent samples or a listening pass',
    crossVideo: { videos: videos.length,
      inputCentreSpanDb: Math.max(...inputCentres) - Math.min(...inputCentres),
      outputCentreSpanDb: Math.max(...outputCentres) - Math.min(...outputCentres),
      inputMedianCentreDb: quantile(inputCentres, .5), outputMedianCentreDb: quantile(outputCentres, .5) },
    contrastWarnings: videos.filter(v => v.contrastWarning).map(v =>
      ({ site: v.site, segment: v.segment, warning: v.contrastWarning,
        inputGroupContrastDb: v.inputGroupContrastDb, outputGroupContrastDb: v.outputGroupContrastDb })),
    videos, transitions: report.transitions };
}

if (require.main === module) {
  const directory = process.argv[2] || path.resolve(__dirname, '../tmp/personal-quality-20260923-033648');
  const result = analyzeBalance(directory);
  const output = path.join(directory, 'balance-objective.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, crossVideo: result.crossVideo, contrastWarnings: result.contrastWarnings,
    videos: result.videos.map(v => ({ site: v.site, segment: v.segment, centre: [v.inputCentreDb, v.outputCentreDb],
      range: [v.inputRangeP10P95Db, v.outputRangeP10P95Db], contrast: [v.inputGroupContrastDb, v.outputGroupContrastDb] })) }, null, 2));
}
module.exports = { quantile, energyMeanDb, estimatedFastExtraCutDb, describeVideo, analyzeBalance };
