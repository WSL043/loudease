const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'content', 'bridge.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');

const checks = [
  ['legacy page-level audio engine is absent', !fs.existsSync(path.join(root, 'content', 'engine.js'))],
  ['manifest does not inject legacy page-level audio scripts', !manifest.includes('content/engine.js') && !manifest.includes('shared/core.js')],
  ['bridge keeps srcObject classification for diagnostics only', /sourceKind: mediaSourceKind\(media\)/.test(bridge) && /srcObject/.test(bridge)],
  ['bridge does not attempt MediaElementSource or MediaStream fallback', !/createMediaElementSource|captureStream|createMediaStreamSource|MediaStreamAudioSourceNode/.test(bridge)],
  ['bridge does not assign media.volume anywhere', !/\.volume\s*=/.test(bridge)],
  ['bridge reports player mute and volume for offscreen gate', /playerMuted/.test(bridge) && /playerVolumeCap/.test(bridge)]
];

let failed = false;
for (const [name, pass] of checks) {
  if (pass) {
    console.log(`OK   ${name}`);
  } else {
    console.error(`FAIL ${name}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
