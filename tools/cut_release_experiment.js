// Offline envelope counterfactual; never edits installed or production DSP.
const fs = require('fs');
const path = require('path');
const { render } = require('./transition_crest_experiment');

const root = path.resolve(__dirname, '..');
const worklet = fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'shared/programme-leveler-policy.js'), 'utf8');
const anchor = 'const CUT_RELEASE_SECONDS = 0.25;';
if (worklet.split(anchor).length !== 2) throw Error('Unexpected cut-release anchor');
const tone = t => Math.sin(2 * Math.PI * 997 * t);
const crest = t => (Math.sin(2 * Math.PI * 211 * t) + Math.sin(2 * Math.PI * 419 * t)
  + Math.sin(2 * Math.PI * 839 * t) + Math.sin(2 * Math.PI * 1679 * t)) / 4;
const fixtures = {
  ordinary: { cap: 1, source: t => .15 * tone(t) },
  periodicLoudBursts: { cap: 1, source: t => (t < 4 ? .12 : t % .5 < .08 ? .65 : .12) * tone(t) },
  alternatingSpeechLike: { cap: 1, source: t => (t < 4 ? .04 : .035 + .115 * (1 + Math.sin(2 * Math.PI * 3 * t)) / 2) * tone(t) },
  quietToLoud: { cap: 1, source: t => (t < 4 ? .01 : .8) * tone(t) },
  loudHighCrest: { cap: 1, source: t => .8 * crest(t) },
  periodicLoudBurstsPlayer44: { cap: .44, source: t => (t < 4 ? .12 : t % .5 < .08 ? .65 : .12) * tone(t) }
};

const results = [];
for (const seconds of [.25, .18, .12, .08]) {
  const source = seconds === .25 ? worklet : worklet.replace(anchor, `const CUT_RELEASE_SECONDS = ${seconds};`);
  for (const [name, fixture] of Object.entries(fixtures)) {
    const result = render(source, fixture.source, 48000, fixture.cap, policy);
    results.push({ cutReleaseSeconds: seconds, name, cap: fixture.cap, ...result,
      medianGainLagDb: result.targetGainDb - result.gainDb });
  }
}
const output = path.join(root, 'tmp/transition-crest-candidate/cut-release-experiment.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(),
  scope: '48 kHz generated PCM only; no listening, Chrome workload or real video replay', results }, null, 2));
console.log(JSON.stringify({ output, results: results.map(r => ({ seconds: r.cutReleaseSeconds,
  name: r.name, outputDb: r.outputDb, gainDb: r.gainDb, targetGainDb: r.targetGainDb,
  lagDb: r.medianGainLagDb, peakDb: r.peakDb, stepPeakDb: r.stepPeakDb, hardClips: r.hardClips })) }, null, 2));
