// Offline product tradeoff probe. Source and installed builds are never edited.
const fs = require('fs');
const path = require('path');
const { create } = require('./transition_crest_experiment');
const { quantile, energyMeanDb } = require('./analyze_balance_objective');

const root = path.resolve(__dirname, '..');
const worklet = fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'shared/programme-leveler-policy.js'), 'utf8');
const coefficientAnchor = 'dynamicsErrorDb * options.dynamicsAmount';
const releaseAnchor = 'const CUT_RELEASE_SECONDS = 0.25;';
if (policy.split(coefficientAnchor).length !== 2 || worklet.split(releaseAnchor).length !== 2) {
  throw Error('Unexpected DSP anchors; refusing in-memory counterfactual');
}

const variants = [
  { name: 'current', cut: .92, lift: .92, releaseSeconds: .25 },
  { name: 'gentler-symmetric', cut: .65, lift: .65, releaseSeconds: .25 },
  { name: 'asymmetric', cut: .5, lift: .8, releaseSeconds: .25 },
  { name: 'asymmetric-faster-release', cut: .5, lift: .8, releaseSeconds: .12 }
];
function sources(variant) {
  const expression = `dynamicsErrorDb * (dynamicsErrorDb < 0 ? ${variant.cut} : ${variant.lift})`;
  return {
    worklet: worklet.replace(releaseAnchor,
      `const CUT_RELEASE_SECONDS = ${variant.releaseSeconds};`),
    policy: policy.replace(coefficientAnchor, expression)
  };
}

const rate = 48000;
const tone = t => Math.sin(2 * Math.PI * 997 * t);
const crest = t => (Math.sin(2 * Math.PI * 211 * t)
  + Math.sin(2 * Math.PI * 419 * t)
  + Math.sin(2 * Math.PI * 839 * t)
  + Math.sin(2 * Math.PI * 1679 * t)) / 4;
const fixtures = {
  steppedTone: t => (t < 4 ? .12 : t < 9 ? .08 : t < 14 ? .16 : .12) * tone(t),
  pulsedCrest: t => (t < 4 ? .24 : t < 9 ? .16
    : t < 14 ? (t % .5 < .08 ? .52 : .30) : .24) * crest(t),
  quietBed: t => (t < 4 ? .24 : t < 9 ? .002 : t < 14 ? .24 : .002) * crest(t)
};

function run(source, fixture) {
  const processor = create(source.worklet, rate, 1, source.policy);
  const input = new Float32Array(128);
  const output = new Float32Array(128);
  let peak = 0;
  for (let n = 0; n < rate * 19; n += 128) {
    for (let j = 0; j < 128; j += 1) input[j] = fixture((n + j) / rate);
    processor.process([[input]], [[output]]);
    for (const sample of output) peak = Math.max(peak, Math.abs(sample));
  }
  const rows = processor.messages.filter(m => m.type === 'quality-audit');
  const section = (start, end) => {
    const selected = rows.filter(r => r.audioSeconds >= start && r.audioSeconds <= end);
    return { inputDb: energyMeanDb(selected.map(r => r.shortTerm[0])),
      outputDb: energyMeanDb(selected.map(r => r.shortTerm[1])),
      gainDb: quantile(selected.map(r => r.gainDb), .5),
      targetGainDb: quantile(selected.map(r => r.targetGainDb), .5),
      limiterP90Db: quantile(selected.map(r => r.limiterReductionDb), .9) };
  };
  const quiet = section(7, 8.9);
  const loud = section(12, 13.9);
  const bed = section(7, 8.9);
  const hardClips = processor.messages.filter(m => m.type === 'state')
    .reduce((sum, m) => sum + (m.hardClippedSamples || 0), 0);
  return { quiet, loud, bed,
    inputContrastDb: loud.inputDb - quiet.inputDb,
    outputContrastDb: loud.outputDb - quiet.outputDb,
    outputPeakDb: 20 * Math.log10(Math.max(1e-12, peak)), hardClips };
}

function experiment() {
  const results = [];
  for (const variant of variants) {
    const source = sources(variant);
    for (const [fixture, generator] of Object.entries(fixtures)) {
      const result = run(source, generator);
      results.push({ variant, fixture, ...result });
      console.log(JSON.stringify({ variant: variant.name, fixture,
        inputContrastDb: result.inputContrastDb,
        outputContrastDb: result.outputContrastDb,
        quietOutputDb: result.quiet.outputDb,
        loudOutputDb: result.loud.outputDb,
        hardClips: result.hardClips }));
    }
  }
  const destination = path.join(root, 'tmp/transition-crest-candidate/balance-dynamics-counterfactual.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify({ generatedAt: new Date().toISOString(),
    scope: 'Generated mono PCM only, 48 kHz; no real-video replay, semantics, listening or true-peak proof',
    variants, results }, null, 2));
  return destination;
}

if (require.main === module) console.log(experiment());
module.exports = { variants, sources, run, experiment };
