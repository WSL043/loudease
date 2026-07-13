const fs = require('fs');
const path = require('path');
const { buildReport } = require('./site_matrix_audit.js');

const root = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  } catch (_) {
    return null;
  }
}

function readFirstJson(relativePaths) {
  for (const relativePath of relativePaths) {
    const value = readJson(relativePath);
    if (value) {
      return value;
    }
  }
  return null;
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
  } catch (_) {
    return '';
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function countLines(relativePath) {
  const text = readText(relativePath);
  return text ? text.split(/\r?\n/).length : 0;
}

function mb(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric / 1024 / 1024).toFixed(2)} MB` : 'n/a';
}

const manifest = readJson('manifest.json') || {};
const diagnostics = readJson('tmp/latest-diagnostics.json') || {};
const latestLongRun = readJson('tmp/latest-long-run.json') || {};
const latestPocReports = {
  reduce: readJson('tmp/latest-e2e-poc-reduce.json'),
  lift: readJson('tmp/latest-e2e-poc-lift.json'),
  liftLowVolume: readJson('tmp/latest-e2e-poc-lift-low-volume.json'),
  lowPlayerVolumeHold: readFirstJson([
    'tmp/latest-e2e-poc-low-player-volume-hold.json',
    'tmp/latest-e2e-poc-hold-low-player-volume.json'
  ]),
  muted: readJson('tmp/latest-e2e-poc-muted-during-capture.json')
};
const latestSwitchReports = {
  dynamicVideoReplace: readFirstJson([
    'tmp/latest-e2e-switch-dynamic-video-replace-html.json',
    'tmp/latest-e2e-switch-switching-audio-html.json'
  ])
};
const architecture = readText('docs/ARCHITECTURE.md');
const research = readText('docs/RESEARCH.md');
const testMatrix = readText('docs/TEST_MATRIX.md');
const background = readText('background.js');
const offscreen = readText('offscreen/index.js');
const popupHtml = readText('popup/index.html');
const popupJs = readText('popup/index.js');
const monitorHtml = readText('monitor/index.html');
const monitorJs = readText('monitor/index.js');
const core = readText('shared/core.js');
const requiredDocs = [
  'docs/RESEARCH.md',
  'docs/ARCHITECTURE.md',
  'docs/AUDIO_DSP.md',
  'docs/ROOT_CAUSE.md',
  'docs/TEST_PLAN.md',
  'docs/TEST_MATRIX.md',
  'docs/KNOWN_LIMITATIONS.md',
  'docs/ACCEPTANCE_AUDIT.md'
];

const requiredPages = [
  'test-pages/simple-video.html',
  'test-pages/simple-audio.html',
  'test-pages/dynamic-video-replace.html',
  'test-pages/spa-route-change.html',
  'test-pages/iframe-video.html',
  'test-pages/multi-video.html',
  'test-pages/live-like-audio.html',
  'test-pages/burst-volume.html',
  'test-pages/quiet-dialog.html',
  'test-pages/switching-audio.html'
];

function status(name, state, evidence) {
  return { name, state, evidence };
}

const diagnosticsAgeMs = diagnostics?.now ? Date.now() - Number(diagnostics.now) : null;
const diagnosticsCurrent = diagnosticsAgeMs != null && diagnosticsAgeMs <= 10000;
const diagnosticsVersionMatchesManifest = Boolean(manifest.version && diagnostics.version && manifest.version === diagnostics.version);
const matrixReport = buildReport(diagnostics);
const captureTab = Array.isArray(diagnostics.tabs) ? diagnostics.tabs[0] : null;
const realSiteTabs = Array.isArray(diagnostics.tabs)
  ? diagnostics.tabs.filter((tab) => {
    const values = [
      tab?.url,
      tab?.href,
      tab?.frameUrl,
      ...(Array.isArray(tab?.frames) ? tab.frames.flatMap((frame) => [frame?.url, frame?.href]) : [])
    ].filter(Boolean);
    return values.some((value) => /douyin|bilibili|youtube|youtu\.be/i.test(String(value)));
  })
  : [];
const processingRealSiteTabs = realSiteTabs.filter((tab) => (
  tab?.captureActive
  && tab?.captureState === 'processing'
  && tab?.capturePipelineMode === 'leveler-v3'
  && tab?.captureContextState === 'running'
  && ['leveler-worklet', 'worklet', 'analyser-fallback'].includes(tab?.meterMode)
  && Number(tab?.meterFrameAgeMs ?? Infinity) < 1000
  && Number(tab?.captureAudioTrackCount || 0) > 0
));
const localLongRunReady = latestLongRun.passed === true
  && latestLongRun.version === manifest.version
  && Number(latestLongRun.requestedDurationMs || 0) >= 30000
  && Number(latestLongRun.signalTickDelta || 0) > 5
  && Number(latestLongRun.finalAudioTrackCount || 0) >= 1
  && latestLongRun.finalContextState === 'running'
  && Number(latestLongRun.finalOutputPeak || 0) <= 1
  && Number(latestLongRun.maxHeapGrowthBytes || 0) <= Number(latestLongRun.maxAllowedHeapGrowthBytes || Infinity);
const localLongRunEvidence = latestLongRun.version
  ? `latest=${latestLongRun.version}, passed=${Boolean(latestLongRun.passed)}, requested=${latestLongRun.requestedDurationMs || 0}ms, signalDelta=${latestLongRun.signalTickDelta || 0}, heapGrowth=${mb(latestLongRun.maxHeapGrowthBytes)}, finalTracks=${latestLongRun.finalAudioTrackCount || 0}, context=${latestLongRun.finalContextState || 'unknown'}`
  : 'no structured long-run report in tmp/latest-long-run.json';
function pocReportReady(report, expect) {
  if (!report || report.passed !== true || report.version !== manifest.version) {
    return false;
  }
  const expected = Array.isArray(expect) ? expect : [expect];
  if (!expected.includes(String(report.scenario?.expect || ''))) {
    return false;
  }
  const tab = report.tab || {};
  return report.phase === 'capture-active'
    && report.stopPhase === 'capture-stopped'
    && report.stopOk === true
    && tab.capturePipelineMode === 'leveler-v3'
    && tab.captureState === 'processing'
    && tab.captureContextState === 'running'
    && ['leveler-worklet', 'worklet', 'analyser-fallback'].includes(tab.meterMode)
    && Number(tab.meterFrameAgeMs ?? Infinity) < 1000
    && Number(tab.captureAudioTrackCount || 0) >= 1;
}
function scenarioPlayerVolume(report) {
  return Number(report?.scenario?.playerVolume);
}

function reportOutputDelta(report) {
  const observed = Number(report?.observed?.maxOutputDeltaDb);
  if (Number.isFinite(observed)) {
    return observed;
  }
  const inputDb = Number(report?.tab?.averageInputDb);
  const outputDb = Number(report?.tab?.averageOutputDb);
  return Number.isFinite(inputDb) && Number.isFinite(outputDb) ? outputDb - inputDb : NaN;
}

function reportOutputDb(report) {
  return Number(report?.tab?.averageOutputDb);
}

function reportLiftCeilingDb(report) {
  return Number(report?.tab?.playerVolumeLiftCeilingDb);
}

const pocReduceReady = pocReportReady(latestPocReports.reduce, 'reduce')
  && Number(latestPocReports.reduce?.tab?.averageReductionDb || 0) > 0.5;
const pocLiftReady = pocReportReady(latestPocReports.lift, 'lift')
  && Number(latestPocReports.lift?.observed?.maxOutputDeltaDb || 0) > 3;
const pocLiftLowVolumeReady = pocReportReady(latestPocReports.liftLowVolume, 'lift')
  && /[?&]gain=/i.test(String(latestPocReports.liftLowVolume?.scenario?.page || ''))
  && Number.isFinite(scenarioPlayerVolume(latestPocReports.liftLowVolume))
  && scenarioPlayerVolume(latestPocReports.liftLowVolume) > 0
  && scenarioPlayerVolume(latestPocReports.liftLowVolume) < 0.5
  && Number(latestPocReports.liftLowVolume?.tab?.currentLiftDb || 0) >= 8
  && reportOutputDelta(latestPocReports.liftLowVolume) >= 8
  && Number.isFinite(reportLiftCeilingDb(latestPocReports.liftLowVolume))
  && Number.isFinite(reportOutputDb(latestPocReports.liftLowVolume))
  && reportOutputDb(latestPocReports.liftLowVolume) <= reportLiftCeilingDb(latestPocReports.liftLowVolume) + 3;
const pocLowPlayerVolumeHoldReady = pocReportReady(latestPocReports.lowPlayerVolumeHold, ['hold', 'hold-low-player-volume'])
  && Number.isFinite(scenarioPlayerVolume(latestPocReports.lowPlayerVolumeHold))
  && scenarioPlayerVolume(latestPocReports.lowPlayerVolumeHold) > 0
  && scenarioPlayerVolume(latestPocReports.lowPlayerVolumeHold) < 0.5
  && Math.abs(Number(latestPocReports.lowPlayerVolumeHold?.tab?.currentGainDb || 0)) <= 1.5
  && Number(latestPocReports.lowPlayerVolumeHold?.observed?.maxLiftDb || 0) <= 1.5
  && Number(latestPocReports.lowPlayerVolumeHold?.observed?.maxReductionDb || 0) <= 1.5;
const pocMutedReady = pocReportReady(latestPocReports.muted, 'muted-during-capture')
  && latestPocReports.muted?.tab?.playerMuted === true
  && Number(latestPocReports.muted?.tab?.averageOutputPeak || 0) <= 0.002;
const dynamicVideoSwitchReady = latestSwitchReports.dynamicVideoReplace?.passed === true
  && latestSwitchReports.dynamicVideoReplace?.version === manifest.version
  && ['dynamic-video-replace.html', 'switching-audio.html'].includes(String(latestSwitchReports.dynamicVideoReplace?.page || ''))
  && Number(latestSwitchReports.dynamicVideoReplace?.afterTicks || 0) > Number(latestSwitchReports.dynamicVideoReplace?.beforeTicks || 0) + 12
  && Number.isFinite(Number(latestSwitchReports.dynamicVideoReplace?.tab?.averageInputDb))
  && Number(latestSwitchReports.dynamicVideoReplace?.tab?.captureAudioTrackCount || 0) >= 1
  && latestSwitchReports.dynamicVideoReplace?.tab?.captureState === 'processing'
  && latestSwitchReports.dynamicVideoReplace?.tab?.capturePipelineMode === 'leveler-v3'
  && Number(latestSwitchReports.dynamicVideoReplace?.tab?.lastSignalAgeMs ?? Infinity) < 2500
  && Number(latestSwitchReports.dynamicVideoReplace?.pageStateAfter?.switchCount || 0) >= 1;
const pocEvidence = [
  `reduce=${pocReduceReady ? 'pass' : 'missing'}`,
  `lift=${pocLiftReady ? 'pass' : 'missing'}`,
  `liftLowVolume=${pocLiftLowVolumeReady ? 'pass' : 'missing'}`,
  `lowPlayerHold=${pocLowPlayerVolumeHoldReady ? 'pass' : 'missing'}`,
  `muted=${pocMutedReady ? 'pass' : 'missing'}`,
  `dynamicSwitch=${dynamicVideoSwitchReady ? 'pass' : 'missing'}`
].join(', ');

const results = [
  status(
    'MV3 manifest and permissions',
    manifest.manifest_version === 3
      && Array.isArray(manifest.permissions)
      && manifest.permissions.includes('tabCapture')
      && manifest.permissions.includes('offscreen')
      ? 'verified'
      : 'missing',
    `version=${manifest.version || 'unknown'}`
  ),
  status(
    'Research and architecture documents',
    requiredDocs.every(exists) && /tabCapture/.test(architecture) && /offscreen/.test(architecture) && /tabCapture/.test(research)
      ? 'partial'
      : 'missing',
    requiredDocs.filter((item) => !exists(item)).join(', ') || 'required docs exist'
  ),
  status(
    'Tab capture to offscreen route',
    /chrome\.tabCapture\.getMediaStreamId/.test(background) && /getUserMedia/.test(offscreen) && /AudioContext/.test(offscreen)
      ? (pocReduceReady || pocLiftReady || pocMutedReady ? 'verified' : 'partial')
      : 'missing',
    (pocReduceReady || pocLiftReady || pocMutedReady)
      ? `latest structured E2E proves tabCapture/offscreen path: ${pocEvidence}`
      : 'code path exists; behavior requires E2E'
  ),
  status(
    'Diagnostics state and audio meters',
    /capture:state/.test(background) && /averageInputDb/.test(offscreen) && /averageOutputDb/.test(offscreen)
      ? 'partial'
      : 'missing',
    diagnosticsCurrent
      ? diagnosticsVersionMatchesManifest
        ? 'diagnostics fresh and runtime version matches disk'
        : `diagnostics fresh but runtime version ${diagnostics.version || 'unknown'} != disk ${manifest.version || 'unknown'}`
      : 'diagnostics stale or unavailable'
  ),
  status(
    'DSP unit coverage',
    exists('tools/dsp_unit_tests.js') && /computeLevelerGainDb/.test(readText('tools/dsp_unit_tests.js'))
      ? 'partial'
      : 'missing',
    'basic gain policy tests exist'
  ),
  status(
    'Local extension E2E coverage',
    exists('tools/e2e_poc_smoke.js') && exists('tools/e2e_stability_smoke.js') && exists('tools/e2e_long_run_smoke.js')
      ? (pocReduceReady && pocLiftReady && pocLiftLowVolumeReady && pocLowPlayerVolumeHoldReady && pocMutedReady && localLongRunReady ? 'verified' : 'partial')
      : 'missing',
    pocReduceReady && pocLiftReady && pocLiftLowVolumeReady && pocLowPlayerVolumeHoldReady && pocMutedReady && localLongRunReady
      ? `structured E2E reports current: ${pocEvidence}; ${localLongRunEvidence}`
      : `run scripts separately for current pass/fail; ${pocEvidence}; long-run: ${localLongRunEvidence}`
  ),
  status(
    'Local test pages',
    requiredPages.every(exists) ? 'verified' : 'missing',
    requiredPages.filter((item) => !exists(item)).join(', ') || `${requiredPages.length} pages present`
  ),
  status(
    'Compact controls and site settings',
    (popupHtml.match(/type="range"/g) || []).length === 2
      && !/data-preset=/.test(popupHtml)
      && /preset: 'custom'/.test(popupJs)
      && /preset: 'standard'/.test(core)
      && /SITE_SETTINGS_KEY/.test(background)
      && /readSettingsForUrl\(tabUrl\)/.test(background)
      && ['WVB_GET_OPTIONS_STATE', 'WVB_SAVE_SITE_SETTINGS', 'WVB_DELETE_SITE_SETTINGS', 'WVB_RESET_SETTINGS', 'WVB_SET_LOCAL_DIAGNOSTICS'].every((type) => background.includes(type))
      && ['siteKey', 'siteCut', 'siteLift', 'siteList', 'resetSettings', 'downloadJson', 'languageSelect', 'themeSelect'].every((id) => monitorHtml.includes(`id="${id}"`))
      && /type: 'WVB_SAVE_SITE_SETTINGS'/.test(monitorJs)
      ? 'verified'
      : 'missing',
    'popup exposes only cut/lift strength; settings are remembered by hostname; monitor/options manages site defaults, reset, diagnostics, and export'
  ),
  status(
    'Real site matrix',
    !diagnosticsVersionMatchesManifest
      ? 'blocked'
      : processingRealSiteTabs.length >= 6
      ? 'verified'
      : processingRealSiteTabs.length > 0
        ? 'partial'
        : /Bilibili/.test(testMatrix) && /抖音/.test(testMatrix)
          ? 'blocked'
          : 'missing',
    !diagnosticsVersionMatchesManifest
      ? `runtime version ${diagnostics.version || 'unknown'} != disk ${manifest.version || 'unknown'}; real-site results prove only the loaded runtime`
      : processingRealSiteTabs.length > 0
      ? `${processingRealSiteTabs.length} real-site tab(s) currently processing; full baseline requires YouTube, Bilibili, and Douyin video/live coverage`
      : 'requires current Chrome runtime access and site playback'
  ),
  status(
    'Current diagnostics from user Chrome',
    diagnosticsCurrent && diagnosticsVersionMatchesManifest && realSiteTabs.length > 0
      ? 'verified'
      : 'blocked',
    diagnosticsCurrent
      ? diagnosticsVersionMatchesManifest
        ? realSiteTabs.length > 0
          ? `fresh diagnostics include ${realSiteTabs.length} YouTube/Douyin/Bilibili tab(s); processing=${processingRealSiteTabs.length}`
          : 'fresh diagnostics are not a known real-site tab'
        : `runtime version ${diagnostics.version || 'unknown'} != disk ${manifest.version || 'unknown'}`
      : `stale=${diagnosticsAgeMs == null ? 'unknown' : diagnosticsAgeMs}ms`
  ),
  status(
    'AudioWorklet or OfflineAudioContext integration tests',
    /new AudioWorkletNode\(this\.context, 'wvb-limiter-processor'/.test(offscreen) && exists('offscreen/limiter-worklet.js') && exists('tools/offline_audio_graph_tests.js') ? 'verified' : 'partial',
    /new AudioWorkletNode\(this\.context, 'wvb-limiter-processor'/.test(offscreen) && exists('offscreen/limiter-worklet.js') && exists('tools/offline_audio_graph_tests.js')
      ? 'AudioWorklet limiter is in the offscreen graph and OfflineAudioContext graph test covers the worklet path'
      : 'AudioWorklet limiter or OfflineAudioContext graph coverage is incomplete'
  ),
  status(
    'Long-run leak test',
    localLongRunReady ? 'verified' : (exists('tools/e2e_long_run_smoke.js') ? 'partial' : 'missing'),
    localLongRunReady
      ? `structured local hold report passed: ${localLongRunEvidence}`
      : (exists('tools/e2e_long_run_smoke.js') ? `hold test exists but latest report is insufficient: ${localLongRunEvidence}` : 'no 30-minute track/context/memory monitor test')
  ),
  status(
    'Content script complexity risk',
    !exists('content/engine.js') && countLines('content/bridge.js') <= 350 ? 'verified' : 'partial',
    !exists('content/engine.js')
      ? `legacy content/engine.js removed; bridge lines=${countLines('content/bridge.js')}`
      : `content/engine.js lines=${countLines('content/engine.js')}`
  )
];

const processingScenarioIds = new Set(
  matrixReport.matrix
    .filter((item) => item.status === 'processing')
    .map((item) => item.id)
);
const requiredRealSiteScenarios = ['youtube-video', 'youtube-live', 'bilibili-video', 'bilibili-live', 'douyin-short', 'douyin-live'];
const missingRealSiteScenarios = requiredRealSiteScenarios.filter((id) => !processingScenarioIds.has(id));
const localE2eEvidence = [
  exists('tools/e2e_poc_smoke.js'),
  exists('tools/e2e_stability_smoke.js'),
  exists('tools/e2e_long_run_smoke.js')
].every(Boolean);
const multiCaptureAssert = readText('tools/assert_multi_capture.js');
const stabilitySmoke = readText('tools/e2e_stability_smoke.js');
const diagnosticsReady = diagnosticsCurrent && diagnosticsVersionMatchesManifest;
const activeCaptureReady = diagnosticsReady
  && processingRealSiteTabs.length > 0
  && processingRealSiteTabs.every((tab) => !tab.captureError);

function hardRequirement(name, ok, evidence) {
  return { name, state: ok ? 'verified' : 'unproven', evidence };
}

const hardRequirements = [
  hardRequirement(
    '插件能正常开启',
    (pocReduceReady || pocLiftReady || pocMutedReady) && /capture:popup-click/.test(background) && /captureState/.test(background),
    (pocReduceReady || pocLiftReady || pocMutedReady)
      ? `latest structured E2E starts capture: ${pocEvidence}`
      : 'local E2E scripts exist; background has popup-triggered capture state timeline'
  ),
  hardRequirement(
    '开启后声音不会消失',
    /this\.outputAnalyser\.connect\(this\.context\.destination\)/.test(offscreen) && (pocReduceReady || pocLiftReady),
    (pocReduceReady || pocLiftReady)
      ? `offscreen graph reconnects captured stream to destination; latest audible E2E: ${pocEvidence}`
      : 'offscreen graph reconnects captured stream to AudioContext.destination; latest structured E2E missing'
  ),
  hardRequirement(
    '关闭后声音恢复原状',
    /track\.stop\(\)/.test(offscreen) && /this\.context\.close\(\)/.test(offscreen) && /WVB_STOP_TAB_CAPTURE/.test(background) && (pocReduceReady || pocLiftReady || pocMutedReady),
    (pocReduceReady || pocLiftReady || pocMutedReady)
      ? `stop path stops tracks and closes AudioContext; latest E2E stop clean: ${pocEvidence}`
      : 'stop path exists; latest structured stop evidence missing'
  ),
  hardRequirement(
    '不出现双声/回声',
    /each capture session owns its settings/.test(multiCaptureAssert)
      && /const existing = sessions\.get\(numericTabId\);[\s\S]*?existing\.stop\(\)/.test(offscreen)
      && /sessions\.set\(numericTabId, session\)/.test(offscreen),
    'one session replaces only the previous session for the same tab; other tabs keep independent pipelines'
  ),
  hardRequirement(
    '不出现明显爆音或 clipping',
    /LIMITER_CEILING_DB/.test(offscreen) && /overall output never clips/.test(readText('tools/offline_audio_tests.js')),
    'limiter is present and offline PCM test asserts no clipping'
  ),
  hardRequirement(
    '小声音能被提高',
    /quiet voice is lifted clearly/.test(readText('tools/offline_audio_tests.js')) && /currentLiftDb/.test(offscreen) && pocLiftReady && pocLiftLowVolumeReady,
    pocLiftReady && pocLiftLowVolumeReady
      ? `offline PCM and latest lift E2E prove quiet lift, including low-player-volume source lift: outputDelta=${Number(reportOutputDelta(latestPocReports.liftLowVolume)).toFixed(2)} dB`
      : 'offline PCM covers quiet lift; latest structured lift and low-player-volume lift E2E are required'
  ),
  hardRequirement(
    '大声音能被压低',
    /loud input is reduced/.test(readText('tools/dsp_unit_tests.js')) && /currentReductionDb/.test(offscreen) && pocReduceReady,
    pocReduceReady
      ? `DSP unit test and latest reduce E2E prove reduction: reduction=${Number(latestPocReports.reduce?.tab?.averageReductionDb || 0).toFixed(2)} dB`
      : 'DSP unit test covers reduction; latest structured reduce E2E missing'
  ),
  hardRequirement(
    '播放器音量调低不会被误当成小声素材',
    /liftRmsDb/.test(core) && /volumeCompensationDb/.test(offscreen) && pocLowPlayerVolumeHoldReady,
    pocLowPlayerVolumeHoldReady
      ? `low player-volume hold E2E proves no false lift: playerVolume=${scenarioPlayerVolume(latestPocReports.lowPlayerVolumeHold)}, currentGain=${Number(latestPocReports.lowPlayerVolumeHold?.tab?.currentGainDb || 0).toFixed(2)} dB`
      : 'latest low-player-volume hold E2E missing; this guards the small-sound algorithm against false boosting'
  ),
  hardRequirement(
    'YouTube、B站、抖音的视频与直播完成基础播放测试',
    missingRealSiteScenarios.length === 0 && diagnosticsReady,
    missingRealSiteScenarios.length
      ? `missing live processing evidence: ${missingRealSiteScenarios.join(', ')}`
      : 'all required real-site scenarios processing in fresh diagnostics'
  ),
  hardRequirement(
    '连续开关 10 次不坏',
    /WVB_E2E_CYCLES \|\| 10/.test(stabilitySmoke) && /for \(let index = 1; index <= cycles; index \+= 1\)/.test(stabilitySmoke),
    'e2e_stability_smoke implements 10-cycle start/stop coverage'
  ),
  hardRequirement(
    '页面刷新后还能重新开启',
    /reload restart/.test(stabilitySmoke),
    'e2e_stability_smoke implements reload restart check'
  ),
  hardRequirement(
    '切换视频后不残留旧状态',
    dynamicVideoSwitchReady,
    dynamicVideoSwitchReady
      ? `same-tab dynamic video replacement E2E passed: beforeTicks=${latestSwitchReports.dynamicVideoReplace.beforeTicks}, afterTicks=${latestSwitchReports.dynamicVideoReplace.afterTicks}`
      : 'same-tab dynamic video replacement E2E missing; owner replacement alone does not prove next-video switching'
  ),
  hardRequirement(
    'popup 显示真实状态',
    /captureActive/.test(readText('popup/index.js')) && /captureState/.test(readText('popup/index.js')) && /extensionReloadRequired/.test(readText('popup/index.js')),
    'popup renders capture state and runtime mismatch flags'
  ),
  hardRequirement(
    '有诊断日志',
    /events/.test(background) && /latest-diagnostics\.json/.test(readText('tools/current_runtime_audit.js')),
    'background events and local diagnostics audit are implemented'
  ),
  hardRequirement(
    '有自动测试',
    exists('tools/run_all_checks.js') && exists('tools/offline_audio_tests.js') && exists('tools/e2e_poc_smoke.js'),
    'static, DSP, offline audio, and E2E test entrypoints exist'
  ),
  hardRequirement(
    '没有明显内存泄漏',
    localLongRunReady,
    localLongRunReady
      ? `structured local long-run evidence: ${localLongRunEvidence}`
      : `local long-run evidence insufficient: ${localLongRunEvidence}; real-site 30-minute proof is still separate`
  ),
  hardRequirement(
    '没有把错误藏起来',
    /captureError/.test(background) && /failedErrors/.test(background) && /events: diagnosticEvents/.test(background),
    'status aggregates capture errors, failed errors, and recent events'
  )
];

const completionBlockers = [];
if (!diagnosticsReady) {
  completionBlockers.push(
    diagnosticsCurrent
      ? `主 Chrome 运行版本 ${diagnostics.version || 'unknown'} != 磁盘版本 ${manifest.version || 'unknown'}，需要刷新解包扩展`
      : '主 Chrome diagnostics 不新鲜，不能证明当前真实运行状态'
  );
}
if (missingRealSiteScenarios.length) {
  completionBlockers.push(`真实站点矩阵未完成：${missingRealSiteScenarios.join(', ')}`);
}
if (hardRequirements.find((item) => item.name === '没有明显内存泄漏')?.state !== 'verified') {
  completionBlockers.push('长时间内存/音频 track 监控证据不足');
}
completionBlockers.push('完整 30 分钟真实站点连续使用矩阵仍未完成');

const counts = results.reduce((acc, item) => {
  acc[item.state] = (acc[item.state] || 0) + 1;
  return acc;
}, {});

if (asJson) {
  console.log(JSON.stringify({
    version: manifest.version || null,
    counts,
    results,
    hardRequirements,
    completionBlockers
  }, null, 2));
} else {
  console.log(`Acceptance audit for WebVolumeBalancer ${manifest.version || 'unknown'}`);
  for (const item of results) {
    console.log(`${item.state.toUpperCase().padEnd(8)} ${item.name} - ${item.evidence}`);
  }
  console.log('Hard acceptance requirements:');
  for (const item of hardRequirements) {
    console.log(`${item.state.toUpperCase().padEnd(8)} ${item.name} - ${item.evidence}`);
  }
  if (completionBlockers.length) {
    console.log('Completion blockers:');
    for (const item of completionBlockers) {
      console.log(`BLOCKER  ${item}`);
    }
  }
  console.log(`Summary: ${JSON.stringify(counts)}`);
}

if (strict && (results.some((item) => item.state !== 'verified') || hardRequirements.some((item) => item.state !== 'verified') || completionBlockers.length)) {
  process.exit(1);
}
