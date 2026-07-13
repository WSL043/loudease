const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup', 'index.js'), 'utf8');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'shared', 'core.js'), 'utf8');

const checks = [
  ['legacy page engine is absent', !fs.existsSync(path.join(root, 'content', 'engine.js'))],
  ['shared DSP zero strength returns unity gain', /Math\.max\(cutScale, liftScale\) <= 0/.test(core) && /targetGainDb: 0/.test(core) && /liftDb: 0/.test(core) && /reductionDb: 0/.test(core)],
  ['shared DSP scales cut and lift independently', /const cutScale = strengthScale\(normalized\.cutStrength\)/.test(core) && /const liftScale = strengthScale\(normalized\.liftStrength\)/.test(core) && /maxCutDb[\s\S]*cutScale/.test(core) && /maxLiftDb[\s\S]*liftScale/.test(core)],
  ['offscreen leveler uses explicit per-session processing strength', /processingStrength\(\) \{[\s\S]*?Math\.max\(strengthScale\(this\.settings\.cutStrength\), strengthScale\(this\.settings\.liftStrength\)\)/.test(offscreen)],
  ['offscreen zero strength resets gain to unity', /processingStrength\(\) <= 0/.test(offscreen) && /resetGain\(\)/.test(offscreen) && /this\.outputGain\.gain\.value = 1;/.test(offscreen)],
  ['offscreen limiter disables at zero strength', /const scale = this\.settings\.enabled === false \? 0 : this\.processingStrength\(\);/.test(offscreen) && /enabled: scale > 0/.test(offscreen) && /this\.limiter\.ratio\.value = scale <= 0 \? 1 : 1 \+ \(19 \* scale\);/.test(offscreen)],
  ['offscreen settings changes update targeted live sessions without rebuilding graph', /WVB_OFFSCREEN_APPLY_SETTINGS/.test(offscreen) && /const targetTabId = Number\(message\.tabId\);/.test(offscreen) && /session\.applySettings\(nextSettings, \{ immediate: false \}\);[\s\S]*?session\.report\(\);/.test(offscreen)],
  ['popup ignores reduction when cut strength is zero', /percentValue\(settings\?\.cutStrength\) > 0 \? Math\.max\(0, finiteNumber\(status\.averageReductionDb\)\) : 0/.test(popup)]
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
