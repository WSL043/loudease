const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK   ${message}`);
}

function exists(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (fs.existsSync(fullPath)) {
    ok(relativePath);
    return;
  }
  fail(`missing ${relativePath}`);
}

if (manifest.manifest_version === 3) {
  ok('manifest_version 3');
} else {
  fail('manifest_version must be 3');
}

if (manifest.name === '__MSG_appName__'
  && manifest.short_name === '__MSG_appShortName__'
  && manifest.description === '__MSG_appDescription__'
  && manifest.default_locale === 'en'
  && fs.existsSync(path.join(root, '_locales', 'en', 'messages.json'))) {
  ok('manifest uses the English-default Chrome i18n catalog');
} else {
  fail('manifest must use the English-default Chrome i18n catalog');
}

exists(manifest.background.service_worker);
exists(manifest.action.default_popup);
exists('shared/core.js');
exists('shared/programme-leveler-policy.js');
exists('content/bridge.js');
exists('popup/index.css');
exists('popup/index.js');
exists('monitor/index.html');
exists('monitor/index.css');
exists('monitor/index.js');
exists('offscreen/index.html');
exists('offscreen/index.js');
exists('offscreen/leveler-worklet.js');
exists('offscreen/limiter-worklet.js');
exists('offscreen/meter-worklet.js');
exists('assets/logo-ai-a-light.png');
exists('assets/logo-ai-a-dark.png');
exists('assets/icon-16.png');
exists('assets/icon-32.png');
exists('assets/icon-48.png');
exists('assets/icon-128.png');
exists('.gitignore');
exists('README.md');
exists('README_zh.md');
exists('CONTRIBUTING.md');
exists('SUPPORT.md');
exists('GOVERNANCE.md');
exists('DCO');
exists('ASSET_PROVENANCE.md');
exists('THIRD_PARTY_NOTICES.md');
exists('LICENSE');
exists('LICENSES/GPL-3.0-only.txt');
exists('NOTICE');
exists('TRADEMARKS.md');
exists('.github/CODEOWNERS');
exists('REUSE.toml');
exists('docs/RESEARCH.md');
exists('docs/ARCHITECTURE.md');
exists('docs/AUDIO_DSP.md');
exists('docs/ROOT_CAUSE.md');
exists('docs/TEST_PLAN.md');
exists('docs/SITE_ADAPTERS.md');
exists('docs/TEST_MATRIX.md');
exists('docs/KNOWN_LIMITATIONS.md');
exists('docs/ACCEPTANCE_AUDIT.md');
exists('docs/RELEASE_READINESS_REVIEW.md');
exists('docs/DATA_GOVERNANCE.md');
exists('docs/FEEDBACK.md');
exists('docs/LICENSING.md');
exists('PRIVACY.md');
exists('SECURITY.md');
exists('CHANGELOG.md');
exists('package.json');
exists('.github/workflows/ci.yml');
exists('.github/ISSUE_TEMPLATE/audio-quality.yml');
exists('tools/run-checks.cmd');
exists('docs/实现技术文档.md');
exists('docs/参数说明.md');
exists('docs/测试清单.md');
exists('docs/声学研究.md');
exists('tools/diagnostics_receiver.py');
exists('tools/assert_strength_zero.js');
exists('tools/assert_loudness_policy.js');
exists('tools/assert_failure_relevance.js');
exists('tools/assert_bridge_sanitization.js');
exists('tools/assert_publish_hygiene.js');
exists('tools/assert_license_hygiene.js');
exists('tools/assert_stream_fallback.js');
exists('tools/assert_popup_truthfulness.js');
exists('tools/assert_poc_capture.js');
exists('tools/assert_audio_worklet_limiter.js');
exists('tools/assert_audio_worklet_leveler.js');
exists('tools/assert_audio_worklet_meter.js');
exists('tools/meter_worklet_tests.js');
exists('tools/limiter_worklet_tests.js');
exists('tools/leveler_worklet_tests.js');
exists('tools/assert_test_pages.js');
exists('tools/dsp_unit_tests.js');
exists('tools/programme_leveler_experiment.js');
exists('tools/run_all_checks.js');
exists('tools/current_runtime_audit.js');
exists('tools/acceptance_audit.js');
exists('tools/live_matrix_watch.js');
exists('tools/e2e_poc_smoke.js');
exists('tools/e2e_stability_smoke.js');
exists('tools/e2e_long_run_smoke.js');
exists('tools/e2e_local_capture_matrix.js');
exists('tools/e2e_real_site_matrix.js');
exists('tools/e2e_silent_sink.js');
exists('tools/assert_silent_e2e.js');
exists('tools/render_store_assets.js');
exists('e2e/harness.html');
exists('e2e/harness.js');
exists('test-pages/simple-video.html');
exists('test-pages/simple-audio.html');
exists('test-pages/dynamic-video-replace.html');
exists('test-pages/spa-route-change.html');
exists('test-pages/iframe-video.html');
exists('test-pages/multi-video.html');
exists('test-pages/live-like-audio.html');
exists('test-pages/burst-volume.html');
exists('test-pages/quiet-dialog.html');
exists('test-pages/switching-audio.html');

for (const script of ['content/bridge.js', 'monitor/index.js']) {
  const text = fs.readFileSync(path.join(root, script), 'utf8');
  if (text.includes('tabCapture')) {
    fail(`${script} should not use tabCapture in the automatic path`);
  } else {
    ok(`${script} automatic path has no tabCapture`);
  }
}

if (!fs.existsSync(path.join(root, 'content/engine.js'))) {
  ok('legacy content engine removed from runtime tree');
} else {
  fail('legacy content engine should be deleted; automatic path must stay bridge-only');
}

const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
if (/message\.type === 'WVB_START_TAB_CAPTURE'[\s\S]*?startTabCapture/.test(background) && /chrome\.tabCapture\.getMediaStreamId/.test(background)) {
  ok('background tabCapture is user-triggered');
} else {
  fail('background tabCapture must be user-triggered');
}

if (/capture:start-request/.test(background) && /capture:start-error/.test(background) && /WVB_CAPTURE_ERROR/.test(background)) {
  ok('capture start failures are diagnostically logged');
} else {
  fail('capture start failures must be logged');
}

const popup = fs.readFileSync(path.join(root, 'popup/index.js'), 'utf8');
if (/function getTabCaptureStreamId\(tabId\)/.test(popup) && /const options = \{ targetTabId: tabId \};/.test(popup) && /api\.call\(chrome\.tabCapture, options/.test(popup) && /streamId/.test(popup)) {
  ok('popup can request tab capture stream id from user click');
} else {
  fail('popup must request tab capture stream id from user click');
}

const runtimeAudit = fs.readFileSync(path.join(root, 'tools/current_runtime_audit.js'), 'utf8');
if (/diagnosticsVersionMatchesManifest/.test(runtimeAudit)
  && /reloadExtensionRequired/.test(runtimeAudit)
  && /diagnosticsFromKnownMediaTarget/.test(runtimeAudit)
  && /localDiagnosticsReceiverListening/.test(runtimeAudit)
  && /diagnosticsReceiverState/.test(runtimeAudit)
  && /realAudioProcessingProven/.test(runtimeAudit)
  && /knownMediaProcessingTabs/.test(runtimeAudit)
  && /observedUnprocessedMediaTabs/.test(runtimeAudit)) {
  ok('runtime audit detects stale loaded extension, receiver state, wrong diagnostic tab, and missing real audio processing');
} else {
  fail('runtime audit must detect stale loaded extension, receiver state, wrong diagnostic tab, and missing real audio processing');
}

if (!/files: \['shared\/core\.js', 'content\/engine\.js'\]/.test(background) && !/"content\/engine\.js"/.test(JSON.stringify(manifest))) {
  ok('automatic path does not inject legacy content engine');
} else {
  fail('automatic path must not inject legacy content engine');
}
