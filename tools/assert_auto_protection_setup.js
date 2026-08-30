const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${message}`);
}

const retiredPaths = [
  'Enable-LoudEase-AutoProtection.cmd',
  'tools/enable_auto_protection.ps1',
  'tools/e2e_github_auto_capture.js',
  'tools/assert_github_auto_capture.js'
];

for (const relativePath of retiredPaths) {
  ok(!fs.existsSync(path.join(root, relativePath)), `${relativePath} is retired`);
}

const userFacingFiles = [
  'README.md',
  'README_zh.md',
  'AGENTS.md',
  'CHANGELOG.md',
  'package.json',
  'background.js',
  'docs/ARCHITECTURE.md',
  'docs/BUILD.md',
  'docs/FIRST_PRINCIPLES_AUDIT.md',
  'docs/INSTALLATION.md',
  'docs/KNOWN_LIMITATIONS.md',
  'docs/RESEARCH.md',
  'docs/ROOT_CAUSE.md',
  'docs/TEST_MATRIX.md',
  'docs/实现技术文档.md'
];
const unsafeStartupPath = /allowlisted-extension-id|startup allowlist|enable[_-]auto[_-]protection|automatic protection|自动保护|启动[^\n]{0,40}allowlist|automaticCapture|requestAutomaticCapture|trusted GitHub auto(?:matic)?-?protection|test:auto-capture/i;

for (const relativePath of userFacingFiles) {
  ok(!unsafeStartupPath.test(read(relativePath)), `${relativePath} contains no unsupported Chrome startup integration`);
}

if (process.exitCode) process.exit(process.exitCode);
