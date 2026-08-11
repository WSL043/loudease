const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${message}`);
}

ok(
  /WVB_DEV_DIAGNOSTICS_START[\s\S]*?function automaticCaptureTargetUrl\(url\)[\s\S]*?WVB_DEV_DIAGNOSTICS_END/.test(background),
  'GitHub-only build owns the automatic media-site classifier'
);
ok(
  /automaticCaptureTargetUrl[\s\S]*?(?:douyin|bilibili)[\s\S]*?youtu(?:be|\.be)/i.test(background),
  'automatic protection covers the current Douyin, Bilibili, and YouTube site matrix'
);
ok(
  /async function requestAutomaticCapture\(tabId, tabUrl, reason\)/.test(background),
  'automatic capture has one deduplicated orchestration entry point'
);
ok(
  /chrome\.tabs\?\.onCreated\?\.addListener[\s\S]*?requestAutomaticCapture/.test(background),
  'new tabs can be protected before their first audible frame'
);
ok(
  /chrome\.tabs\?\.onUpdated\?\.addListener[\s\S]*?requestAutomaticCapture/.test(background),
  'early URL updates can start protection before page playback'
);
ok(
  background.includes("const AUTOMATIC_CAPTURE_DENIED_ERROR = 'Extension has not been invoked for the current page';")
    && /if \(error\.includes\(AUTOMATIC_CAPTURE_DENIED_ERROR\)\) \{[\s\S]*?automaticCaptureUnavailable = true;/.test(background),
  'missing Chrome allowlist support is latched without repeated capture attempts'
);
ok(
  /captureStatuses\.get\(Number\(tab\?\.openerTabId\)\)\?\.active/.test(background),
  'a new tab inherits early protection from an already protected opener'
);

const build = spawnSync(process.execPath, [path.join(root, 'tools', 'build_extension.js'), 'store'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit'
});
if (build.status !== 0) {
  process.exit(build.status || 1);
}

const storeBackground = fs.readFileSync(path.join(root, 'dist', 'store', 'background.js'), 'utf8');
ok(!/automaticCapture|AUTO_CAPTURE|allowlisted-extension-id/i.test(storeBackground), 'store runtime contains no GitHub automatic-capture path');
