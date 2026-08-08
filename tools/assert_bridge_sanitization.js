const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'content', 'bridge.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const manifestText = JSON.stringify(manifest);
const checks = [
  ['manifest no longer injects content engine', !manifestText.includes('content/engine.js') && !manifestText.includes('shared/core.js')],
  ['bridge runs as isolated content script', manifestText.includes('content/bridge.js') && !manifestText.includes('"world":"MAIN"')],
  ['bridge reinjection invalidates stale listeners', /const bridgeToken = `\$\{Date\.now\(\)\}:/.test(bridge) && /__WEB_VOLUME_BALANCER_BRIDGE_TOKEN__/.test(bridge) && /function stillCurrent\(\)/.test(bridge) && /stillCurrent\(\)/.test(bridge)],
  ['bridge reinjection actively cleans old listeners', /__WEB_VOLUME_BALANCER_BRIDGE_CLEANUP__/.test(bridge) && /mediaListeners\.clear\(\)/.test(bridge) && /removeEventListener\(eventName, reportStatus\)/.test(bridge) && /onChanged\?\.removeListener/.test(bridge) && /onMessage\?\.removeListener/.test(bridge) && /removeEventListener\('visibilitychange', reportStatus\)/.test(bridge)],
  ['bridge prunes detached media listeners', /function pruneMediaListeners\(\)/.test(bridge) && /media\.isConnected/.test(bridge) && /mediaListeners\.delete\(media\)/.test(bridge)],
  ['bridge observes media without WebAudio', /function discoverMedia\(root/.test(bridge) && /document\.createTreeWalker\(root, NodeFilter\.SHOW_ELEMENT\)/.test(bridge) && !/AudioContext|createMediaElementSource|createMediaStreamSource/.test(bridge)],
  ['bridge scan budget limits traversal before materializing the full DOM', !/querySelectorAll\('\*'\)/.test(bridge) && /budget\.count >= MAX_SCAN_NODES/.test(bridge)],
  ['bridge incrementally discovers mutation-added media', /for \(const node of record\.addedNodes\)/.test(bridge) && /discoverMedia\(node, \{ count: 0 \}\)/.test(bridge)],
  ['bridge observes discovered open shadow roots', /function observeRoot\(root\)/.test(bridge) && /observeRoot\(element\.shadowRoot\)/.test(bridge) && /observer\.observe\(root/.test(bridge)],
  ['normal status reads the media registry instead of rescanning the DOM', /function currentMedia\(\)/.test(bridge) && /const media = currentMedia\(\)/.test(bridge) && /FULL_RESCAN_INTERVAL_MS = 15000/.test(bridge) && /ensurePeriodicDiscovery\(\)/.test(bridge)],
  ['bridge retains a bounded slow rescan for late shadow-root attachment', /function fullRescanMedia\(\)/.test(bridge) && /Date\.now\(\) - lastFullScanAt >= FULL_RESCAN_INTERVAL_MS/.test(bridge)],
  ['bridge reports bounded media details', /media\.slice\(0, 8\)\.map\(mediaDetail\)/.test(bridge) && /src: sanitizeMediaSource\(media\.currentSrc \|\| media\.src\)/.test(bridge)],
  ['bridge strips media query strings fragments and opaque payloads', /function sanitizeMediaSource\(value\)/.test(bridge) && /parsed\.origin\}\$\{parsed\.pathname/.test(bridge) && /\^\(blob\|data\|mediastream\):/.test(bridge) && !/src: text\(media\.currentSrc/.test(bridge)],
  ['bridge reports audible media count', /function isAudible\(media\)/.test(bridge) && /audibleCount: audible\.length/.test(bridge)],
  ['bridge reports conservative player volume conflict state', /playerMaxVolumeCap/.test(bridge) && /playerMinVolumeCap/.test(bridge) && /playerVolumeConflict/.test(bridge) && /volumeConflict \? minVolumeCap : maxVolumeCap/.test(bridge)],
  ['bridge uses the background settings diagnostic schema', /settingsPreset: currentSettings\.preset/.test(bridge) && /settingsCutStrength: currentSettings\.cutStrength/.test(bridge) && /settingsLiftStrength: currentSettings\.liftStrength/.test(bridge) && /settingsEnabled: currentSettings\.enabled/.test(bridge) && /settingsRespectPlayerVolume: currentSettings\.respectPlayerVolume/.test(bridge)],
  ['bridge does not accept page postMessage status', !/window\.addEventListener\('message'/.test(bridge) && !/WEB_VOLUME_BALANCER_ENGINE/.test(bridge)],
  ['bridge sends frame status only from own registry state', /sendRuntime\(\{ type: 'WVB_FRAME_STATUS', status: buildStatus\(\) \}\)/.test(bridge)],
  ['bridge never sends runtime manifest version into page engine settings', !/postMessage/.test(bridge) && !/engineSettings/.test(bridge)]
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
