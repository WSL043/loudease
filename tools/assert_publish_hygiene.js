const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
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
const support = fs.readFileSync(path.join(root, 'SUPPORT.md'), 'utf8');
const agentGuide = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const installation = fs.readFileSync(path.join(root, 'docs', 'INSTALLATION.md'), 'utf8');
const publishing = fs.readFileSync(path.join(root, 'docs', 'PUBLISHING.md'), 'utf8');
const accountSetup = fs.readFileSync(path.join(root, 'store', 'ACCOUNT_SETUP.md'), 'utf8');
const testInstructions = fs.readFileSync(path.join(root, 'store', 'TEST_INSTRUCTIONS.md'), 'utf8');
const submissionChecklist = fs.readFileSync(path.join(root, 'store', 'SUBMISSION_CHECKLIST.md'), 'utf8');
const localizationStatus = fs.readFileSync(path.join(root, 'store', 'LOCALIZATION_STATUS.md'), 'utf8');
const buildGuide = fs.readFileSync(path.join(root, 'docs', 'BUILD.md'), 'utf8');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const communityTesting = fs.readFileSync(path.join(root, 'docs', 'COMMUNITY_TESTING.md'), 'utf8');
const compatibilityForm = fs.readFileSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'compatibility.yml'), 'utf8');
const monitor = fs.readFileSync(path.join(root, 'monitor', 'index.html'), 'utf8');
const monitorScript = fs.readFileSync(path.join(root, 'monitor', 'index.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'content', 'bridge.js'), 'utf8');
const mediaDetailBody = bridge.match(/function mediaDetail\(media, index\) \{[\s\S]*?\n  \}/)?.[0] || '';
const storeLocaleDrafts = ['zh_CN', 'zh_TW', 'ja', 'ko', 'ru', 'de', 'fr', 'es', 'pt_BR', 'ar'];
const localizationDraftMarker = 'Draft - fluent review required before publishing';

function pngHasSize(file, width, height) {
  const bytes = fs.readFileSync(path.join(root, file));
  return bytes.length >= 24
    && bytes.toString('ascii', 1, 4) === 'PNG'
    && bytes.readUInt32BE(16) === width
    && bytes.readUInt32BE(20) === height;
}

const checks = [
  ['gitignore excludes local diagnostics', /^tmp\/$/m.test(gitignore)],
  ['gitignore excludes extension packages and keys', /^\*\.zip$/m.test(gitignore) && /^\*\.crx$/m.test(gitignore) && /^\*\.pem$/m.test(gitignore)],
  ['manifest does not reference tmp assets', !JSON.stringify(manifest).includes('tmp/')],
  ['legacy content engine is not a publish asset', !fs.existsSync(path.join(root, 'content', 'engine.js'))],
  ['local diagnostics default disabled', /let\s+localDiagnosticsEnabled\s*=\s*false;/.test(background)],
  ['bridge mediaDetail diagnostics avoid layout reads', !mediaDetailBody.includes('getBoundingClientRect')],
  ['public project metadata exists', fs.existsSync(path.join(root, 'package.json')) && fs.existsSync(path.join(root, '.github', 'workflows', 'ci.yml')) && /LoudEase/.test(englishReadme)],
  ['GPL license transition and contribution policies exist', packageMetadata.license === 'GPL-3.0-only' && /GNU GENERAL PUBLIC LICENSE/.test(license) && /Historical tagged releases retain their original license grants/.test(changelog) && /Developer Certificate of Origin/.test(contributing)],
  ['governance and provenance policies exist', ['GOVERNANCE.md', 'DCO', 'ASSET_PROVENANCE.md', 'THIRD_PARTY_NOTICES.md', '.github/CODEOWNERS', 'REUSE.toml', 'LICENSES/GPL-3.0-only.txt', 'docs/LICENSING.md'].every((file) => fs.existsSync(path.join(root, file))) && fs.existsSync(path.join(root, 'TRADEMARKS.md')) && fs.existsSync(path.join(root, 'NOTICE'))],
  ['selected logo and reproducible current light/dark product screenshots exist', ['assets/logo-ai-a-light.png', 'assets/logo-ai-a-dark.png', 'docs/popup-screenshot-light.png', 'docs/popup-screenshot-dark.png', 'docs/settings-screenshot-light.png', 'docs/settings-screenshot-dark.png'].every((file) => fs.existsSync(path.join(root, file))) && fs.existsSync(path.join(root, 'tools', 'render_store_assets.js')) && /assets:store/.test(JSON.stringify(packageMetadata))],
  ['privacy and security policies exist', /Audio samples are not uploaded/.test(privacy) && /Limited Use requirements/.test(privacy) && /Security Policy/.test(security)],
  ['manifest keeps capture authorization without redundant tabs access', !manifest.permissions.includes('tabs') && manifest.permissions.includes('activeTab')],
  ['store dashboard copy and privacy fields exist', ['store/STORE_LISTING.md', 'store/PRIVACY_PRACTICES.md', 'store/ASSETS.md'].every((file) => fs.existsSync(path.join(root, file))) && /Single purpose/.test(fs.readFileSync(path.join(root, 'store', 'PRIVACY_PRACTICES.md'), 'utf8'))],
  ['store screenshots and promotional tile use exact dimensions', pngHasSize('store/assets/screenshot-balancing-1280x800.png', 1280, 800) && pngHasSize('store/assets/screenshot-settings-1280x800.png', 1280, 800) && pngHasSize('store/assets/promo-small-440x280.png', 440, 280)],
  ['release review blocks diagnostics and silent E2E from the store package', /no localhost permission or URL, no diagnostics or silent-E2E symbol/.test(releaseReview)],
  ['readmes link current privacy and release limits', /PRIVACY\.md/.test(readme) && /RELEASE_READINESS_REVIEW\.md/.test(englishReadme)],
  ['private corpus and future telemetry have explicit release gates', /private-corpus\//.test(gitignore) && /Telemetry is not implemented/.test(dataGovernance) && /Raw PCM/.test(dataGovernance) && /clear, separate opt-in/.test(dataGovernance) && /DATA_GOVERNANCE\.md/.test(privacy) && /DATA_GOVERNANCE\.md/.test(releaseReview)],
  ['feedback remains user initiated without embedded service credentials', /GitHub is a manual feedback tracker/.test(feedback) && /must never contain a GitHub access token/.test(feedback) && /issues\/new\?template=audio-quality\.yml/.test(monitorScript)],
  ['community testing is scoped and privacy preserving', /10-minute platform check/.test(communityTesting) && /one person to validate every platform/.test(communityTesting) && /private or account-specific URL/.test(compatibilityForm)],
  ['readmes use current product visuals and link community testing', /screenshot-balancing-1280x800\.png/.test(englishReadme) && /processing-flow\.png/.test(englishReadme) && /COMMUNITY_TESTING\.md/.test(englishReadme) && /screenshot-balancing-1280x800\.png/.test(readme) && /processing-flow\.png/.test(readme) && /COMMUNITY_TESTING\.md/.test(readme)],
  ['automatic quality measurement excludes browsing identity', /must not infer or transmit a platform, hostname, URL/.test(dataGovernance) && /must not include a persistent installation identifier/.test(feedback)],
  ['community support routes reports through Issue Forms', /Security vulnerability/.test(support) && /GitHub Issue/.test(support) && /WSL043/.test(support)],
  ['agent and installation documentation records the user and contributor boundary', /only audio-processing path/.test(agentGuide) && /Manual beta sideload for trusted testers/.test(installation) && /Ordinary users do not deploy a server, run a database, or install Node\.js/.test(installation)],
  ['release documentation records durable public beta history', /one public GitHub beta/.test(publishing) && /Public beta releases are durable history/.test(publishing) && /explicit maintainer approval/.test(agentGuide)],
  ['GitHub and store releases use one stripped archive', /npm run package:store/.test(publishing) && /exact same ZIP to the Chrome Web Store/.test(publishing) && /only installable release archive/.test(buildGuide) && /Never attach `dist\/github-dev`/.test(publishing)],
  ['source instructions do not create an unrelated lockfile', !englishReadme.includes('npm install') && !readme.includes('npm install') && !installation.includes('npm install')],
  ['Chrome Web Store account checklist is documented', /one-time developer registration fee/.test(accountSetup) && /two-step verification/.test(accountSetup) && /never automated/.test(publishing)],
  ['Chrome Web Store reviewer instructions are complete', /No account or credentials are required/.test(testInstructions) && /Stop balancing/.test(testInstructions) && /Expected limitations/.test(testInstructions) && /LoudEase Beta/.test(testInstructions)],
  ['Chrome Web Store submission checklist covers account package listing privacy and review', ['Developer contact email', 'two-step verification', 'SHA-256', 'Website content', 'Web history', 'Submit for review'].every((text) => submissionChecklist.includes(text))],
  ['localized store drafts and status table agree on fluent review', /English remains the default listing/.test(localizationStatus) && storeLocaleDrafts.every((locale) => {
    const file = path.join(root, 'store', 'locales', `${locale}.md`);
    return fs.existsSync(file)
      && fs.readFileSync(file, 'utf8').includes(`Review status: ${localizationDraftMarker}`)
      && localizationStatus.includes(`(\`${locale}\`): ${localizationDraftMarker}.`);
  })]
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
