const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const englishReadme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README_zh.md'), 'utf8');
const contributing = fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8');
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
const security = fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8');
const releaseReview = fs.readFileSync(path.join(root, 'docs', 'RELEASE_READINESS_REVIEW.md'), 'utf8');
const dataGovernance = fs.readFileSync(path.join(root, 'docs', 'DATA_GOVERNANCE.md'), 'utf8');
const feedback = fs.readFileSync(path.join(root, 'docs', 'FEEDBACK.md'), 'utf8');
const monitor = fs.readFileSync(path.join(root, 'monitor', 'index.html'), 'utf8');
const monitorScript = fs.readFileSync(path.join(root, 'monitor', 'index.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'content', 'bridge.js'), 'utf8');
const mediaDetailBody = bridge.match(/function mediaDetail\(media, index\) \{[\s\S]*?\n  \}/)?.[0] || '';

const checks = [
  ['gitignore excludes local diagnostics', /^tmp\/$/m.test(gitignore)],
  ['gitignore excludes extension packages and keys', /^\*\.zip$/m.test(gitignore) && /^\*\.crx$/m.test(gitignore) && /^\*\.pem$/m.test(gitignore)],
  ['manifest does not reference tmp assets', !JSON.stringify(manifest).includes('tmp/')],
  ['legacy content engine is not a publish asset', !fs.existsSync(path.join(root, 'content', 'engine.js'))],
  ['local diagnostics default disabled', /let\s+localDiagnosticsEnabled\s*=\s*false;/.test(background)],
  ['bridge mediaDetail diagnostics avoid layout reads', !mediaDetailBody.includes('getBoundingClientRect')],
  ['public project metadata exists', fs.existsSync(path.join(root, 'package.json')) && fs.existsSync(path.join(root, '.github', 'workflows', 'ci.yml')) && /LoudEase/.test(englishReadme)],
  ['contribution and license policies exist', /DSP changes and regressions/.test(contributing) && /Mozilla Public License Version 2\.0/.test(license) && fs.existsSync(path.join(root, 'TRADEMARKS.md')) && fs.existsSync(path.join(root, 'NOTICE'))],
  ['selected logo and light/dark product screenshots exist', ['assets/logo-ai-a-light.png', 'assets/logo-ai-a-dark.png', 'docs/popup-screenshot-light.png', 'docs/popup-screenshot-dark.png'].every((file) => fs.existsSync(path.join(root, file)))],
  ['privacy and security policies exist', /Audio samples are not uploaded/.test(privacy) && /Security Policy/.test(security)],
  ['release review blocks localhost diagnostics from the store package', /no localhost permission, URL, diagnostics symbol/.test(releaseReview)],
  ['readmes link current privacy and release limits', /PRIVACY\.md/.test(readme) && /RELEASE_READINESS_REVIEW\.md/.test(englishReadme)],
  ['private corpus and future telemetry have explicit release gates', /private-corpus\//.test(gitignore) && /Telemetry is not implemented/.test(dataGovernance) && /Raw PCM/.test(dataGovernance) && /clear, separate opt-in/.test(dataGovernance) && /DATA_GOVERNANCE\.md/.test(privacy) && /DATA_GOVERNANCE\.md/.test(releaseReview)],
  ['feedback remains user initiated without embedded service credentials', /GitHub is a manual feedback tracker/.test(feedback) && /must never contain a GitHub access token/.test(feedback) && /issues\/new\?template=audio-quality\.yml/.test(monitorScript)],
  ['automatic quality measurement excludes browsing identity', /must not infer or transmit a platform, hostname, URL/.test(dataGovernance) && /must not include a persistent installation identifier/.test(feedback)]
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

if (failed) process.exit(1);
