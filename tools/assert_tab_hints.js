const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${message}`);
}

const manifest = JSON.parse(read('manifest.json'));
const background = read('background.js');
const bridge = read('content/bridge.js');
const audit = read('tools/current_runtime_audit.js');

ok(manifest.permissions.includes('tabs'), 'manifest grants tabs permission for diagnostic tab hints');
ok(manifest.host_permissions.includes('http://*/*'), 'manifest grants http host access for reinjection');
ok(manifest.host_permissions.includes('https://*/*'), 'manifest grants https host access for reinjection');
ok(background.includes('const tabHints = new Map();'), 'background tracks diagnostic tab hints');
ok(background.includes('function mediaTargetUrl(url)'), 'background classifies Bilibili and Douyin media targets');
ok(background.includes('live\\.(douyin|bilibili)'), 'background recognizes live Douyin and live Bilibili hosts');
ok(background.includes('diagnosticOnly: true'), 'diagnostics can list media tabs before frame status returns');
ok(background.includes('chrome.tabs?.onActivated?.addListener'), 'active tab changes trigger media-page reinjection');
ok(background.includes('chrome.tabs?.onUpdated?.addListener'), 'completed page loads trigger media-page reinjection');
ok(background.includes("changeInfo?.url"), 'SPA URL changes clear stale frame status and update hints');
ok(background.includes("'audible'") && background.includes('tab:audio-hint-update'), 'tab audible and muted changes refresh media hints');
ok(background.includes('tabAudibleHint') && background.includes('mediaTargetHint'), 'aggregate status exposes hint-only media state');
ok(background.includes('await refreshTabHints();'), 'local diagnostics refresh tab hints before snapshot upload');
ok(bridge.includes("message?.type === 'WVB_COLLECT_STATUS'") && bridge.includes('sendRuntime({ type: \'WVB_FRAME_STATUS\', status })'), 'bridge supports active status collection without page reload');
ok(background.includes('async function collectFrameStatusNow') && background.includes("type: 'WVB_COLLECT_STATUS'"), 'background can actively refresh bridge media state');
ok(background.includes('refreshActiveCaptureMediaStates().catch') && background.includes('for (const [tabId, capture] of captureStatuses.entries())'), 'active captures refresh media state without relying on popup polling');
ok(background.includes('classifyFrameRuntime(status)'), 'background classifies bridgeVersion as well as engineVersion');
ok(background.includes('playerVolumeConflict') && background.includes('audibleVolumeMismatch') && background.includes('hasVolumeConflict ? safeMinVolumeCap : maxVolumeCap'), 'background uses conservative volume cap when active media volumes conflict but does not hard-mute audible tabs from stale page state');
ok(background.includes('const effectiveVolumeKnown = captureVolumeKnown || mediaVolumeKnown'), 'fresh bridge volume state can correct stale capture volume state');
ok(audit.includes('knownMediaDiagnosticTab'), 'runtime audit searches all diagnostic tabs for media targets');
ok(audit.includes('live\\.(douyin|bilibili)'), 'runtime audit recognizes live Douyin and live Bilibili hosts');
