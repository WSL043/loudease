const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const currentVersion = manifest.version;
const research = read('docs/RESEARCH.md');
const architecture = read('docs/ARCHITECTURE.md');
const dsp = read('docs/AUDIO_DSP.md');
const limitations = read('docs/KNOWN_LIMITATIONS.md');
const audit = read('docs/FIRST_PRINCIPLES_AUDIT.md');
const activeDocs = [research, architecture, dsp, limitations, audit].join('\n');

const checks = [
  ['audit doc names first principles and non-negotiable facts', /^# First-principles audit/m.test(audit) && /## Non-negotiable facts/.test(audit) && /## Failure containment/.test(audit)],
  ['audit doc records the open-source boundary', /Open-source the runtime and public tests/.test(audit) && /Keep private any licensed listening corpus/.test(audit)],
  ['architecture cites the current runtime version', architecture.includes(`current \`${currentVersion}\` runtime`)],
  ['DSP doc cites the current implementation version', dsp.includes(`version \`${currentVersion}\``) && /momentary window/.test(dsp) && /short-term window/.test(dsp)],
  ['known limitations cite the current beta version', limitations.includes(`Version \`${currentVersion}\` is a beta`)],
  ['research documents established methods without novelty inflation', /established browser and audio engineering techniques/.test(research) && /not an uncopyable secret/.test(research)],
  ['legacy page engine is not present', !fs.existsSync(path.join(root, 'content', 'engine.js'))],
  ['architecture records the observer-only content bridge', /old page-level \`createMediaElementSource\(\)\` engine is no longer part of the runtime/.test(architecture) && /does not process PCM audio/.test(architecture)],
  ['active docs do not present retired 0.4 releases as current', !/current[^\n]*0\.4\.|Version \`0\.4\./i.test(activeDocs)]
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
