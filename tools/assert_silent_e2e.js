const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`OK   ${message}`);
}

function devBlocks(text) {
  return [...text.matchAll(/\/\* WVB_DEV_DIAGNOSTICS_START \*\/[\s\S]*?\/\* WVB_DEV_DIAGNOSTICS_END \*\//g)]
    .map((match) => match[0])
    .join('\n');
}

const background = read('background.js');
const offscreen = read('offscreen/index.js');
const runner = read('tools/e2e_poc_smoke.js');
const longRun = read('tools/e2e_long_run_smoke.js');
const slider = read('tools/e2e_slider_persistence.js');
const localMatrix = read('tools/e2e_local_capture_matrix.js');
const matrix = read('tools/e2e_real_site_matrix.js');
const release = read('tools/assert_release_build.js');
const acceptance = read('tools/acceptance_audit.js');
const backgroundDev = devBlocks(background);
const offscreenDev = devBlocks(offscreen);

assert(
  /E2E_SILENT_SINK_STORAGE_KEY/.test(backgroundDev)
    && /e2eSilentSink:\s*e2eSinkSetting\[E2E_SILENT_SINK_STORAGE_KEY\]\s*===\s*true/.test(backgroundDev),
  'silent-sink request is development-only and forwarded to offscreen capture'
);
assert(
  /setSinkId\(\{\s*type:\s*['"]none['"]\s*\}\)/.test(offscreenDev)
    && /silentSink:\s*this\.silentSink/.test(offscreenDev)
    && /session\.silentSink\s*=\s*message\?\.e2eSilentSink\s*===\s*true/.test(offscreenDev),
  'offscreen development path activates and reports the silent AudioContext sink'
);
assert(
  /args\.push\(['"]--disable-audio-output['"]\)/.test(runner)
    && /WASAPIAudioOutputStream/i.test(runner)
    && /latestStatus\.silentSink\s*!==\s*true/.test(runner)
    && /nativeAudioOutputOpened/.test(runner)
    && /configureSilentSinkInExtensionPage/.test(runner)
    && /Target\.createTarget/.test(runner)
    && /Target\.closeTarget/.test(runner)
    && /meterFrameAgeMs:\s*tab\.meterFrameAgeMs/.test(runner)
    && /e2e-profile-\$\{runSuffix\}/.test(runner)
    && /cleanupRunDirectories\(\{\s*tolerateTransientLocks:\s*true\s*\}\)/.test(runner)
    && /capture hold input stopped progressing/.test(runner)
    && /readExternalMediaState/.test(runner)
    && /--disable-background-media-suspend/.test(runner),
  'E2E runner combines fake browser output, silent sink verification, native-output detection, and long-run source diagnostics'
);
assert(
  /configureSilentSinkInExtensionPage/.test(read('tools/e2e_stability_smoke.js')),
  'stability runner configures the silent sink from a deterministic extension page'
);
assert(/WVB_E2E_SILENT_SINK\s*=\s*['"]1['"]/.test(slider), 'slider persistence uses the silent E2E path');
assert(
  /Number\.isInteger\(result\.status\)\s*\?\s*result\.status\s*:\s*1/.test(longRun),
  'long-run wrapper cannot turn a spawn failure into success'
);
assert(
  /WVB_E2E_SILENT_SINK:\s*['"]1['"]/.test(matrix)
    && /nativeAudioOutputOpened\s*===\s*false/.test(matrix),
  'real-site matrix always requests silent output and rejects native audio output'
);
for (const id of ['loud-cut', 'quiet-lift', 'low-volume-source-lift', 'low-player-hold', 'mute-boundary', 'burst-recovery']) {
  assert(localMatrix.includes(`id: '${id}'`), `local capture matrix includes ${id}`);
}

for (const id of [
  'youtube-video',
  'youtube-live',
  'bilibili-video',
  'bilibili-live',
  'douyin-short',
  'douyin-live'
]) {
  assert(matrix.includes(`id: '${id}'`), `real-site matrix includes ${id}`);
}

assert(
  /e2eSilentSink\|E2E_SILENT_SINK\|webVolumeBalancer\\\.e2eSilentSink/.test(release),
  'store-package verifier rejects silent-E2E symbols'
);
assert(
  /latest-real-site-matrix-e2e\.json/.test(acceptance)
    && /latest-real-site-endurance-e2e\.json/.test(acceptance)
    && /latest-real-site-endurance-e2e\.json/.test(matrix)
    && /structuredRealSiteReady/.test(acceptance)
    && /realSiteEnduranceReady/.test(acceptance),
  'acceptance audit consumes structured matrix and endurance evidence'
);

console.log('OK   silent E2E contract passed');
