const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const node = process.execPath;

const syntaxTargets = [
  'background.js',
  'offscreen/index.js',
  'offscreen/leveler-worklet.js',
  'offscreen/limiter-worklet.js',
  'offscreen/meter-worklet.js',
  'content/bridge.js',
  'popup/index.js',
  'monitor/index.js',
  'shared/core.js',
  'shared/programme-leveler-policy.js',
  'tools/verify.js',
  'tools/assert_poc_capture.js',
  'tools/assert_audio_worklet_limiter.js',
  'tools/assert_audio_worklet_leveler.js',
  'tools/assert_audio_worklet_meter.js',
  'tools/limiter_worklet_tests.js',
  'tools/leveler_worklet_tests.js',
  'tools/meter_worklet_tests.js',
  'tools/assert_test_pages.js',
  'tools/e2e_poc_smoke.js',
  'tools/e2e_slider_persistence.js',
  'tools/assert_failure_relevance.js',
  'tools/assert_popup_truthfulness.js',
  'tools/assert_stream_fallback.js',
  'tools/assert_strength_zero.js',
  'tools/assert_loudness_policy.js',
  'tools/assert_bridge_sanitization.js',
  'tools/assert_publish_hygiene.js',
  'tools/assert_license_hygiene.js',
  'tools/assert_tab_hints.js',
  'tools/assert_auto_protection_setup.js',
  'tools/assert_runtime_reload.js',
  'tools/assert_multi_capture.js',
  'tools/assert_site_settings.js',
  'tools/assert_monitor_options.js',
  'tools/assert_i18n_compact_ui.js',
  'tools/assert_first_principles_audit.js',
  'tools/assert_silent_e2e.js',
  'tools/render_store_assets.js',
  'tools/site_matrix_audit.js',
  'tools/live_matrix_watch.js',
  'tools/current_runtime_audit.js',
  'tools/acceptance_audit.js',
  'tools/e2e_stability_smoke.js',
  'tools/e2e_long_run_smoke.js',
  'tools/e2e_local_capture_matrix.js',
  'tools/e2e_real_site_matrix.js',
  'tools/e2e_silent_sink.js',
  'tools/dsp_unit_tests.js',
  'tools/programme_leveler_experiment.js',
  'tools/offline_audio_graph_tests.js'
];

const scriptTargets = [
  'tools/verify.js',
  'tools/assert_poc_capture.js',
  'tools/assert_audio_worklet_limiter.js',
  'tools/assert_audio_worklet_leveler.js',
  'tools/assert_audio_worklet_meter.js',
  'tools/limiter_worklet_tests.js',
  'tools/leveler_worklet_tests.js',
  'tools/meter_worklet_tests.js',
  'tools/assert_test_pages.js',
  'tools/assert_failure_relevance.js',
  'tools/assert_popup_truthfulness.js',
  'tools/assert_stream_fallback.js',
  'tools/assert_strength_zero.js',
  'tools/assert_loudness_policy.js',
  'tools/assert_bridge_sanitization.js',
  'tools/assert_publish_hygiene.js',
  'tools/assert_license_hygiene.js',
  'tools/assert_tab_hints.js',
  'tools/assert_auto_protection_setup.js',
  'tools/assert_runtime_reload.js',
  'tools/assert_multi_capture.js',
  'tools/assert_site_settings.js',
  'tools/assert_monitor_options.js',
  'tools/assert_i18n_compact_ui.js',
  'tools/assert_first_principles_audit.js',
  'tools/assert_silent_e2e.js',
  ['tools/site_matrix_audit.js', '--self-test'],
  ['tools/live_matrix_watch.js', '--self-test'],
  'tools/dsp_unit_tests.js',
  'tools/programme_leveler_experiment.js',
  'tools/offline_audio_graph_tests.js'
];

function run(args) {
  const result = spawnSync(node, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

for (const target of syntaxTargets) {
  run(['--check', target]);
}

for (const target of scriptTargets) {
  run(Array.isArray(target) ? target : [target]);
}

console.log('OK   all checks passed');
