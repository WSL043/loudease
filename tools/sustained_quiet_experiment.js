// Offline counterfactual only: do not change the installed or production DSP.
const fs = require('fs');
const path = require('path');
const { render } = require('./transition_crest_experiment');
const { analyze } = require('./analyze_personal_quality');

const root = path.resolve(__dirname, '..');
const worklet = fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'shared/programme-leveler-policy.js'), 'utf8');
const workletAnchor = '      this.controlInput.momentaryDb = momentarySourceDb;';
const policyAnchor = '    if (dynamicsCorrectionDb > 0) {';

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw Error(`Unexpected source for ${anchor}`);
  return source.replace(anchor, replacement);
}

function detailRescueDb(input) {
  const clamp01 = value => Math.max(0, Math.min(1, value));
  const { programmeDb, momentaryDb, shortTermDb, confidence = 1, liftScale = 1 } = input;
  const programmeGap = clamp01((programmeDb - momentaryDb - 4) / 4);
  const sustainedQuiet = clamp01((-29.5 - shortTermDb) / 3.5);
  const quietBedFloor = clamp01((shortTermDb + 41) / 4);
  const momentaryFloor = clamp01((momentaryDb + 40) / 3);
  return 2.5 * liftScale * confidence * programmeGap * sustainedQuiet * quietBedFloor * momentaryFloor;
}

const candidateWorklet = replaceOnce(worklet, workletAnchor,
  `${workletAnchor}\n      this.controlInput.shortTermDb = shortTermSourceDb;`);
const candidatePolicy = replaceOnce(policy, policyAnchor, `    const shortTermDb = finite(input.shortTermDb, momentaryDb);
    const detailRescueDb = 2.5 * liftScale * confidence
      * clamp((programmeDb - momentaryDb - 4) / 4, 0, 1)
      * clamp((-29.5 - shortTermDb) / 3.5, 0, 1)
      * clamp((shortTermDb + 41) / 4, 0, 1)
      * clamp((momentaryDb + 40) / 3, 0, 1);
    if (dynamicsCorrectionDb > 0) {
      dynamicsCorrectionDb += detailRescueDb;`);

function syntheticProbe() {
  const tone = t => Math.sin(2 * Math.PI * 997 * t);
  const ambience = t => (Math.sin(2 * Math.PI * 181 * t) + Math.sin(2 * Math.PI * 373 * t)
    + Math.sin(2 * Math.PI * 761 * t) + Math.sin(2 * Math.PI * 1523 * t)) / 2;
  const crest = t => (Math.sin(2 * Math.PI * 211 * t) + Math.sin(2 * Math.PI * 419 * t)
    + Math.sin(2 * Math.PI * 839 * t) + Math.sin(2 * Math.PI * 1679 * t)) / 4;
  const cases = {
    steadyDetailLevel: t => .03 * tone(t),
    louderProgrammeToDetail: t => (t < 2 ? .15 : .03) * tone(t),
    louderProgrammeToAmbience: t => t < 2 ? .15 * tone(t) : .03 * ambience(t),
    louderProgrammeToDeepBed: t => (t < 2 ? .15 : .009) * tone(t),
    louderProgrammeToModerate: t => (t < 2 ? .15 : .08) * tone(t),
    quietToLoud: t => (t < 4 ? .01 : .8) * tone(t),
    highCrest: t => .8 * crest(t)
  };
  const results = [];
  for (const [name, fixture] of Object.entries(cases)) {
    const before = render(worklet, fixture, 48000, 1, policy);
    const after = render(candidateWorklet, fixture, 48000, 1, candidatePolicy);
    results.push({ name, rate: 48000, before, after,
      deltaOutputDb: after.outputDb - before.outputDb,
      deltaTargetGainDb: after.targetGainDb - before.targetGainDb });
  }
  return results;
}

function realProbe(directory) {
  const collected = new Map();
  const report = analyze(directory, (site, segment, row) => {
    const key = `${site}:${segment}`;
    if (!collected.has(key)) collected.set(key, []);
    const momentaryDb = row.momentary[0] - 20 * Math.log10(row.normalizationCap);
    const rescueDb = detailRescueDb({ programmeDb: row.programmeDb, momentaryDb,
      shortTermDb: row.input, confidence: row.confidence });
    const floor = Math.max(0, Math.min(1, (momentaryDb + 48) / 8));
    const existingDynamicsDb = Math.max(0, (row.programmeDb - momentaryDb - 1) * .92 * row.confidence);
    const capSlackDb = Math.max(0, 16 * floor - existingDynamicsDb);
    const headroomSlackDb = Math.max(0, row.liftBudgetDb - row.targetGainDb);
    const feasibleRequestDb = Math.min(rescueDb, capSlackDb, headroomSlackDb,
      Math.max(0, 25 - row.targetGainDb));
    collected.get(key).push({ rescueDb, feasibleRequestDb, outputDb: row.output,
      limiterDb: row.limiterReductionDb });
  });
  const segments = report.results.filter(r => r.coverage === 'at-least-60s-eligible');
  return segments.map(r => {
    const rows = collected.get(`${r.site}:${r.segment}`) || [];
    const below = rows.filter(x => x.outputDb < -21);
    const affected = below.filter(x => x.rescueDb > 1);
    return { site: r.site, segment: r.segment, title: r.title, eligibleRows: rows.length,
      belowBandRows: below.length, belowBandRescueGateOver1Db: affected.length,
      belowBandFeasibleRequestOver1Db: affected.filter(x => x.feasibleRequestDb > 1).length,
      belowBandFeasibleRequestOver1DbWithLittleLimiting:
        affected.filter(x => x.feasibleRequestDb > 1 && x.limiterDb < .1).length,
      alreadyAboveBandFeasibleRequestOver1Db:
        rows.filter(x => x.outputDb > -17 && x.feasibleRequestDb > 1).length,
      caveat: 'Eligible page/status-verified rows; requested extra is an upper bound, not rendered output or audible benefit.' };
  });
}

function run(directory = path.join(root, 'tmp/personal-quality-20260923-033648')) {
  const synthetic = syntheticProbe();
  const detail = synthetic.find(r => r.name === 'louderProgrammeToDetail');
  const ambience = synthetic.find(r => r.name === 'louderProgrammeToAmbience');
  const result = { generatedAt: new Date().toISOString(), scope: 'Offline policy-source replacement; no installed extension changed',
    candidate: 'Up to +2.5 dB when a louder programme has sustained moderate quiet detail, gated by the 3 s level and quiet floor',
    decision: ambience.deltaOutputDb > 1 && Math.abs(ambience.deltaOutputDb - detail.deltaOutputDb) < .25
      ? 'reject: equally raises moderate-level ambience and wanted detail' : 'review-required',
    synthetic, real: realProbe(directory) };
  const output = path.join(root, 'tmp/transition-crest-candidate/sustained-quiet-experiment.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, decision: result.decision, synthetic: result.synthetic.map(r => ({ name: r.name,
    before: r.before.outputDb, after: r.after.outputDb, deltaOutputDb: r.deltaOutputDb,
    deltaTargetGainDb: r.deltaTargetGainDb, beforePeakDb: r.before.peakDb, afterPeakDb: r.after.peakDb,
    beforeHardClips: r.before.hardClips, afterHardClips: r.after.hardClips })), real: result.real }, null, 2));
  return result;
}
if (require.main === module) run(process.argv[2]);
module.exports = { detailRescueDb, run };
