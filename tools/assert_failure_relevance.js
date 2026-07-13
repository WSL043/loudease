const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'content', 'bridge.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');

const legacyEnginePath = path.join(root, 'content', 'engine.js');

const checks = [
  ['legacy MAIN world content engine is deleted', !fs.existsSync(legacyEnginePath)],
  ['manifest injects only lightweight bridge', manifest.includes('"content/bridge.js"') && !manifest.includes('"content/engine.js"') && !manifest.includes('"shared/core.js"')],
  ['bridge has media observer helpers', /function mediaDetail\(media, index\)/.test(bridge) && /function playerState\(media\)/.test(bridge)],
  ['bridge reports media status without page audio processing', /processedCount: 0/.test(bridge) && /activeProcessorCount: 0/.test(bridge) && /averageLiftDb: 0/.test(bridge)],
  ['bridge does not use WebAudio or page source hooks', !/AudioContext|webkitAudioContext|createMediaElementSource|captureStream|getUserMedia|tabCapture/.test(bridge)],
  ['bridge does not change page playback volume', !/\.volume\s*=/.test(bridge)],
  ['bridge tracks player volume and mute for offscreen safety', /playerVolumeCap/.test(bridge) && /playerMuted/.test(bridge) && /volumechange/.test(bridge)],
  ['background filters failures by current media details', /function relevantFailedErrors\(status\)/.test(background) && /failureIsCurrent\(status\) \? errors : \[\]/.test(background)],
  ['background compares current source with failed source', /const currentSrc = String\(item\.src \|\| ''\);[\s\S]*?const errorSrc = String\(item\.lastErrorSrc \|\| ''\);[\s\S]*?currentSrc === errorSrc/.test(background)],
  ['background limited count uses filtered failures', /total\.limitedCount \+= failedErrors\.length > 0/.test(background)],
  ['background reload signal uses filtered failures', /if \(failedErrors\.some\(isAlreadyConnectedError\)\)/.test(background)],
  ['background no longer stops stale page engines from MAIN world', !/function stopStaleEngine\(tabId/.test(background) && !/__WEB_VOLUME_BALANCER_ENGINE_STOP__/.test(background)],
  ['GET_STATUS is a read-only status query', /message\.type === 'WVB_GET_STATUS'[\s\S]*?return aggregateStatus\(tabId\);/.test(background) && !/message\.ensure === true[\s\S]*?ensureInjected/.test(background)],
  ['observer injection is an explicit action', /message\.type === 'WVB_ENSURE_OBSERVER'[\s\S]*?ensureInjected\(tabId, tabUrl, \{ clearStatus: true, force: true \}\)/.test(background) && /observer:ensure-ok/.test(background)],
  ['extension install proactively reinjects lightweight observers', /function ensureOpenTabsInjected\(options = \{\}\)/.test(background) && /tab\.audible \|\| tab\.active/.test(background) && /onInstalled\.addListener[\s\S]*?ensureOpenTabsInjected\(\{ clearStatus: true \}\)/.test(background)],
  ['background aggregates analyser silent status', /analysisSilentCount/.test(background) && /averageInputDb/.test(background) && /averageInputPeak/.test(background)],
  ['offscreen reports manifest version', /ENGINE_VERSION = chrome\.runtime\?\.getManifest\?\.\(\)\.version/.test(offscreen) && /manifest\.json/.test(offscreen)],
  ['offscreen reports capture state and tracks', /state: this\.state/.test(offscreen) && /trackCount: stream\.trackCount/.test(offscreen) && /audioTracks: stream\.audioTracks/.test(offscreen)],
  ['offscreen cleanup stops tracks and closes context', /for \(const track of this\.stream\.getTracks\(\)\) \{[\s\S]*?track\.stop\(\);/.test(offscreen) && /this\.context\.close\(\)/.test(offscreen)]
];

let failed = false;
for (const [name, pass] of checks) {
  if (pass) {
    console.log(`OK   ${name}`);
  } else {
    failed = true;
    console.error(`FAIL ${name}`);
  }
}

if (failed) {
  process.exit(1);
}
