// Decompose target requests from qualified real-site telemetry. This does not
// reconstruct PCM, limiter action or what a different DSP would have sounded like.
const fs = require('fs');
const path = require('path');
const { analyze } = require('./analyze_personal_quality');
const { quantile, energyMeanDb } = require('./analyze_balance_objective');
const { applyDeadband } = require('../shared/programme-leveler-policy');

function targetParts(row, cutAmount, liftAmount) {
  if (!Number.isFinite(row.programmeDb) || !Number.isFinite(row.momentary?.[0])
    || !(row.normalizationCap > 0)) return null;
  const confidence = row.confidence ?? 1;
  const momentary = row.momentary[0] - 20 * Math.log10(row.normalizationCap);
  const programme = applyDeadband(-19 - row.programmeDb, 1) * confidence;
  const error = applyDeadband(row.programmeDb - momentary, 1);
  let dynamics = error * (error < 0 ? cutAmount : liftAmount) * confidence;
  if (dynamics > 0) dynamics = Math.min(dynamics,
    16 * Math.max(0, Math.min(1, (momentary + 48) / 8)));
  return { programme, dynamics, base: programme + dynamics, momentary };
}

function group(rows) {
  const old = rows.map(r => targetParts(r, .92, .92));
  const softer = rows.map(r => targetParts(r, .65, .65));
  const asymmetric = rows.map(r => targetParts(r, .5, .8));
  const safe = (values, fraction = .5) => quantile(values.filter(Number.isFinite), fraction);
  return { seconds: rows.length / 10,
    inputDb: safe(rows.map(r => r.input)), outputDb: safe(rows.map(r => r.output)),
    momentaryDb: safe(old.map(p => p?.momentary)), programmeDb: safe(rows.map(r => r.programmeDb)),
    requestedGainDb: safe(rows.map(r => r.targetGainDb)), actualGainDb: safe(rows.map(r => r.gainDb)),
    oldBaseDb: safe(old.map(p => p?.base)), oldDynamicsDb: safe(old.map(p => p?.dynamics)),
    symmetricBaseDb: safe(softer.map(p => p?.base)),
    asymmetricBaseDb: safe(asymmetric.map(p => p?.base)),
    fastOrHeadroomDominatedPercent: 100 * rows.filter((r, i) =>
      old[i] && r.targetGainDb < old[i].base - .5).length / rows.length,
    noLimiterPercent: 100 * rows.filter(r => r.limiterReductionDb < .1).length / rows.length };
}

function probe(directory) {
  const statusLines = fs.readFileSync(path.join(directory, 'status.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse);
  const active = statusLines.flatMap(s => s.tabs || []).filter(t => t.captureDspLive === true);
  if (!active.length || active.some(t => t.settingsCutStrength !== 100
    || t.settingsLiftStrength !== 100 || t.settingsTargetLoudnessDb !== -19)) {
    throw Error('Probe requires confirmed 100/100 strengths and -19 dB target throughout live capture');
  }
  const bySegment = new Map();
  const report = analyze(directory, (site, segment, row) => {
    const key = `${site}:${segment}`;
    if (!bySegment.has(key)) bySegment.set(key, []);
    bySegment.get(key).push(row);
  });
  const videos = report.results.filter(r => r.coverage === 'at-least-60s-eligible').map(result => {
    const rows = bySegment.get(`${result.site}:${result.segment}`);
    const gate = energyMeanDb(rows.map(r => r.input)) - 20;
    const signal = rows.filter(r => r.input >= Math.max(-70, gate));
    const low = quantile(signal.map(r => r.input), .25);
    const high = quantile(signal.map(r => r.input), .75);
    return { site: result.site, segment: result.segment, title: result.title,
      quieter: group(signal.filter(r => r.input <= low)),
      louder: group(signal.filter(r => r.input >= high)) };
  });
  return { scope: 'Qualified real-site numeric telemetry with verified 100/100 strengths and -19 dB target. Base requests omit fast peak and headroom caps; alternative output is not estimated.',
    videos };
}

if (require.main === module) {
  const directory = process.argv[2] || path.resolve(__dirname, '../tmp/personal-quality-20260923-033648');
  const result = probe(directory);
  const output = path.join(directory, 'balance-telemetry-policy-probe.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, videos: result.videos.map(v => ({ site: v.site,
    segment: v.segment, quiet: v.quieter, loud: v.louder })) }, null, 2));
}
module.exports = { targetParts, group, probe };
