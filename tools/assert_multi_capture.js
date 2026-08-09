const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup', 'index.js'), 'utf8');

function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${message}`);
}

ok(!background.includes('capture:replace-existing'), 'background no longer deletes other tab capture owners');
ok(!/for \(const \[existingTabId, existingSession\][\s\S]*?existingSession\.stop\(\)/.test(offscreen), 'offscreen keeps other tab sessions running');
ok(/constructor\(tabId, stream, initialSettings = settings\)/.test(offscreen) && /this\.settings = normalizeSettings\(initialSettings\)/.test(offscreen), 'each capture session owns its settings');
ok(/WVB_OFFSCREEN_APPLY_SETTINGS[\s\S]*?targetTabId[\s\S]*?sessions\.get\(targetTabId\)/.test(offscreen), 'offscreen can update one tab without changing other sessions');
ok(/applyEffectiveSettingsToActiveCaptures/.test(background) && /applyCaptureSettings\(await readSettingsForUrl\(tabUrl\), tabId\)/.test(background), 'global settings refresh every active capture with its effective site settings');
ok(/pending\.port !== port/.test(background) && /pending\.port !== port[\s\S]*?continue;/.test(background), 'stale offscreen port disconnects cannot reject a replacement port request');
ok(/capture:navigation-settings-applied/.test(background) && /captureNavigationRevisions/.test(background) && /capture:navigation-settings-superseded/.test(background), 'active capture adopts only the latest destination site settings during navigation');
ok(/offscreen stop was not acknowledged/.test(background) && /capture:stop-error/.test(background), 'capture stop keeps status truthful until offscreen acknowledges teardown');
ok(/async function clearTabState/.test(background) && /const stopped = await stopTabCapture\(tabId\)/.test(background), 'clearing tab state stops the offscreen session before deleting ownership');
ok(/async function offscreenDocumentExists\(\)/.test(background) && /capture:already-stopped/.test(background) && /alreadyStopped: true/.test(background), 'stopping an already stopped tab returns promptly when no offscreen document exists');
ok(/return sessions\.size;/.test(offscreen) && /remainingSessions = stopCapture/.test(offscreen), 'offscreen stop reports whether other capture sessions remain');
ok(/Number\(response\.remainingSessions\) === 0/.test(background) && /scheduleOffscreenIdleClose\(\)/.test(background) && /chrome\.offscreen\.closeDocument\(\)/.test(background), 'last capture stop closes the idle offscreen document');
ok(/ensureOffscreenDocument\(\)[\s\S]*?cancelOffscreenIdleClose\(\)/.test(background), 'new capture creation cancels a pending offscreen close');
ok(/tabId: activeTabId/.test(popup), 'popup includes the target tab in settings writes');

if (process.exitCode) {
  process.exit(process.exitCode);
}
