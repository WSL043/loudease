const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const SCENARIOS = [
  { id: 'youtube-video', label: 'YouTube 视频' },
  { id: 'youtube-live', label: 'YouTube 直播' },
  { id: 'bilibili-video', label: 'Bilibili 普通视频' },
  { id: 'bilibili-live', label: 'Bilibili 直播' },
  { id: 'douyin-short', label: '抖音短视频' },
  { id: 'douyin-live', label: '抖音直播' },
  { id: 'generic-html5', label: '通用 HTML5 audio/video' }
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { __error: String(error?.message || error) };
  }
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(items) {
  return items.filter((item) => item != null && item !== '');
}

function safeUrl(raw) {
  try {
    return new URL(String(raw || ''));
  } catch (_) {
    return null;
  }
}

function tabUrls(tab) {
  const urls = compact([tab?.url, tab?.frameUrl, tab?.href]);
  for (const frame of asArray(tab?.frames)) {
    urls.push(...compact([frame.url, frame.href]));
  }
  return Array.from(new Set(urls.map(String)));
}

function classifyUrl(raw) {
  const parsed = safeUrl(raw);
  if (!parsed) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if ((host === 'www.youtube.com' || host === 'youtube.com') && /^\/live\//.test(pathname)) {
    return 'youtube-live';
  }
  if (((host === 'www.youtube.com' || host === 'youtube.com') && (/^\/watch/.test(pathname) || /^\/shorts\//.test(pathname))) || host === 'youtu.be') {
    return 'youtube-video';
  }
  if (host === 'live.bilibili.com') {
    return 'bilibili-live';
  }
  if ((host === 'www.bilibili.com' || host === 'bilibili.com') && (/^\/video\//.test(pathname) || /^\/bangumi\/play\//.test(pathname))) {
    return 'bilibili-video';
  }
  if (host === 'live.douyin.com' || ((host === 'www.douyin.com' || host === 'douyin.com') && /^\/root\/live\//.test(pathname))) {
    return 'douyin-live';
  }
  if (host === 'www.douyin.com' || host === 'douyin.com') {
    return 'douyin-short';
  }
  if ((host === '127.0.0.1' || host === 'localhost') && /\/(test-pages|simple-|dynamic-|spa-|iframe-|multi-|live-like-|burst-|quiet-|switching-)/.test(pathname)) {
    return 'generic-html5';
  }
  return null;
}

function tabScenarios(tab) {
  const ids = new Set();
  for (const url of tabUrls(tab)) {
    const id = classifyUrl(url);
    if (id) {
      ids.add(id);
    }
  }
  if (!ids.size && finiteNumber(tab?.mediaCount) > 0) {
    ids.add('generic-html5');
  }
  return Array.from(ids);
}

function frameMediaCount(tab) {
  return asArray(tab?.frames).reduce((sum, frame) => sum + finiteNumber(frame?.mediaCount), 0);
}

function collectErrors(tab) {
  const errors = [];
  if (tab?.captureError) {
    errors.push(String(tab.captureError));
  }
  for (const item of asArray(tab?.failedErrors)) {
    errors.push(String(item));
  }
  for (const frame of asArray(tab?.frames)) {
    for (const item of asArray(frame?.failedErrors)) {
      errors.push(String(item));
    }
  }
  return Array.from(new Set(errors.filter(Boolean)));
}

function effectKind(reductionDb, liftDb) {
  const reducing = reductionDb > 0.5;
  const lifting = liftDb > 0.5;
  if (reducing && lifting) {
    return 'mixed';
  }
  if (reducing) {
    return 'reduce';
  }
  if (lifting) {
    return 'lift';
  }
  return 'neutral';
}

function liftDiagnosis(tab) {
  if (!tab) {
    return 'missing-tab';
  }
  if (!tab.captureProcessing && !tab.pageProcessing) {
    return tab.mediaCount > 0 || tab.audibleCount > 0 ? 'media-not-captured' : 'no-media';
  }
  if (tab.playerMuted || tab.playerVolumeCap <= 0.01) {
    return 'player-volume-gated';
  }
  if (tab.signalTickCount <= 0 || (tab.lastSignalAgeMs != null && tab.lastSignalAgeMs > 2500)) {
    return 'no-fresh-signal';
  }
  if (tab.liftDb > 0.5) {
    return 'lifting';
  }
  if (tab.targetReductionDb > 0.5 || tab.reductionDb > 0.5) {
    return 'currently-reducing';
  }
  if (tab.inputDb == null && tab.controlInputDb == null) {
    return 'no-meter';
  }
  if (tab.quietDeficitDb <= 0.5) {
    return 'input-not-below-target';
  }
  if (tab.requestedLiftDb > 0.5 && tab.effectiveLiftBudgetDb <= 0.5) {
    return 'blocked-by-bounded-lift-budget';
  }
  if (tab.targetGainDb <= 0.5 && tab.requestedLiftDb > 0.5) {
    return 'blocked-by-safety-cut';
  }
  return 'neutral';
}

function summarizeTab(tab) {
  const mediaCount = Math.max(finiteNumber(tab?.mediaCount), frameMediaCount(tab));
  const activeProcessorCount = finiteNumber(tab?.activeProcessorCount);
  const captureProcessing = Boolean(tab?.captureActive)
    && tab?.captureState === 'processing'
    && tab?.capturePipelineMode === 'programme-leveler-v4'
    && tab?.captureContextState === 'running'
    && (tab?.meterMode === 'worklet' || tab?.meterMode === 'analyser-fallback')
    && tab?.meterFrameAgeMs != null
    && finiteNumber(tab?.meterFrameAgeMs) < 1000
    && finiteNumber(tab?.captureAudioTrackCount) > 0;
  const pageProcessing = activeProcessorCount > 0;
  const reductionDb = Math.max(
    finiteNumber(tab?.currentReductionDb),
    finiteNumber(tab?.averageReductionDb),
    finiteNumber(tab?.limiterReductionDb)
  );
  const liftDb = Math.max(finiteNumber(tab?.currentLiftDb), finiteNumber(tab?.averageLiftDb));
  const errors = collectErrors(tab);
  const effect = effectKind(reductionDb, liftDb);
  const summary = {
    tabId: tab?.tabId ?? null,
    title: tab?.title || '',
    url: tabUrls(tab)[0] || '',
    scenarios: tabScenarios(tab),
    mediaCount,
    audibleCount: finiteNumber(tab?.audibleCount),
    processedCount: finiteNumber(tab?.processedCount),
    activeProcessorCount,
    captureActive: Boolean(tab?.captureActive),
    captureState: tab?.captureState || 'unknown',
    capturePipelineMode: tab?.capturePipelineMode || '',
    captureContextState: tab?.captureContextState || '',
    captureAudioTrackCount: finiteNumber(tab?.captureAudioTrackCount),
    captureProcessing,
    pageProcessing,
    inputDb: tab?.averageInputDb ?? null,
    controlInputDb: tab?.controlInputDb ?? null,
    outputDb: tab?.averageOutputDb ?? null,
    inputPeak: tab?.averageInputPeak ?? null,
    outputPeak: tab?.averageOutputPeak ?? null,
    liftPeak: tab?.liftPeak ?? null,
    currentGainDb: tab?.currentGainDb ?? null,
    targetGainDb: finiteNumber(tab?.targetGainDb),
    targetLiftDb: finiteNumber(tab?.targetLiftDb),
    targetReductionDb: finiteNumber(tab?.targetReductionDb),
    requestedLiftDb: finiteNumber(tab?.requestedLiftDb),
    quietDeficitDb: finiteNumber(tab?.quietDeficitDb),
    peakHeadroomDb: finiteNumber(tab?.peakHeadroomDb),
    rawPeakHeadroomDb: finiteNumber(tab?.rawPeakHeadroomDb),
    liftLimiterBudgetDb: finiteNumber(tab?.liftLimiterBudgetDb),
    effectiveLiftBudgetDb: finiteNumber(tab?.effectiveLiftBudgetDb),
    playerMuted: Boolean(tab?.playerMuted),
    playerVolumeCap: finiteNumber(tab?.playerVolumeCap, 1),
    playerActiveMediaCount: finiteNumber(tab?.playerActiveMediaCount),
    reductionDb,
    liftDb,
    effect,
    dspActive: effect !== 'neutral',
    signalTickCount: finiteNumber(tab?.signalTickCount),
    silentTickCount: finiteNumber(tab?.silentTickCount),
    limiterTickCount: finiteNumber(tab?.limiterTickCount),
    lastSignalAgeMs: tab?.lastSignalAgeMs ?? null,
    mediaStateAgeMs: tab?.mediaStateAgeMs ?? null,
    errors
  };
  summary.liftDiagnosis = liftDiagnosis(summary);
  return summary;
}

function tabScore(tab) {
  return (tab.captureProcessing ? 1000 : 0)
    + (tab.pageProcessing ? 200 : 0)
    + (tab.mediaCount > 0 ? 100 : 0)
    + (tab.audibleCount > 0 ? 80 : 0)
    + (tab.reductionDb > 0.5 ? 40 : 0)
    + (tab.liftDb > 0.5 ? 30 : 0)
    - (tab.errors.length ? 100 : 0);
}

function scenarioStatus(tab) {
  if (!tab) {
    return 'missing';
  }
  if (tab.errors.length) {
    return 'error';
  }
  if (tab.captureProcessing) {
    return 'processing';
  }
  if (tab.pageProcessing) {
    return 'page-processing-only';
  }
  if (tab.mediaCount > 0 || tab.audibleCount > 0) {
    return 'media-not-captured';
  }
  return 'seen-no-media';
}

function buildReport(diagnostics, options = {}) {
  const now = options.now || Date.now();
  const manifest = options.manifest || readJson(path.join(root, 'manifest.json'));
  const diskVersion = manifest?.version || null;
  const runtimeVersion = diagnostics?.version || null;
  const runtimeVersionMatchesDisk = Boolean(diskVersion && runtimeVersion && diskVersion === runtimeVersion);
  const tabs = asArray(diagnostics?.tabs).map(summarizeTab);
  const ageMs = diagnostics?.now ? now - Number(diagnostics.now) : null;
  const diagnosticsFresh = ageMs != null && ageMs <= finiteNumber(diagnostics?.statusTtlMs, 8000) + 2000;
  const activeCaptureTabs = tabs.filter((tab) => tab.captureProcessing);
  const matrix = SCENARIOS.map((scenario) => {
    const candidates = tabs
      .filter((tab) => tab.scenarios.includes(scenario.id))
      .sort((a, b) => tabScore(b) - tabScore(a));
    const best = candidates[0] || null;
    return {
      id: scenario.id,
      label: scenario.label,
      status: scenarioStatus(best),
      tab: best,
      evidence: {
        hasTab: Boolean(best),
        hasMedia: Boolean(best && best.mediaCount > 0),
        captureProcessing: Boolean(best?.captureProcessing),
        runtimeVersionMatchesDisk,
        hasReduction: Boolean(best && best.reductionDb > 0.5),
        hasLift: Boolean(best && best.liftDb > 0.5),
        hasDspAction: Boolean(best && best.dspActive),
        effect: best?.effect || 'missing',
        liftDiagnosis: best?.liftDiagnosis || 'missing-tab',
        noErrors: Boolean(best && best.errors.length === 0)
      }
    };
  });
  const warnings = [];
  if (!diagnosticsFresh) {
    warnings.push(`diagnostics stale or missing: ageMs=${ageMs ?? 'unknown'}`);
  }
  if (diskVersion && runtimeVersion && !runtimeVersionMatchesDisk) {
    warnings.push(`runtime version ${runtimeVersion} does not match disk version ${diskVersion}; real-site results prove only the loaded runtime`);
  }
  return {
    checkedAt: new Date(now).toISOString(),
    version: runtimeVersion,
    diskVersion,
    runtimeVersionMatchesDisk,
    diagnosticsAgeMs: ageMs,
    diagnosticsFresh,
    tabCount: tabs.length,
    activeCaptureTabs: activeCaptureTabs.map((tab) => ({
      tabId: tab.tabId,
      title: tab.title,
      url: tab.url,
      scenarios: tab.scenarios,
      inputDb: tab.inputDb,
      outputDb: tab.outputDb,
      effect: tab.effect,
      liftDiagnosis: tab.liftDiagnosis
    })),
    multipleCaptureTabs: activeCaptureTabs.length > 1
      ? activeCaptureTabs.map((tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        scenarios: tab.scenarios,
        inputDb: tab.inputDb,
        outputDb: tab.outputDb,
        effect: tab.effect,
        liftDiagnosis: tab.liftDiagnosis
      }))
      : [],
    warnings,
    matrix,
    events: asArray(diagnostics?.events).slice(0, 10)
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function selfTest() {
  const fixture = {
    version: 'self-test',
    now: Date.now(),
    statusTtlMs: 8000,
    tabs: [
      {
        tabId: 1,
        url: 'https://live.douyin.com/123',
        title: 'Douyin live',
        mediaCount: 1,
        audibleCount: 1,
        activeProcessorCount: 1,
        captureActive: true,
        captureState: 'processing',
        capturePipelineMode: 'programme-leveler-v4',
        captureContextState: 'running',
        captureAudioTrackCount: 1,
        meterMode: 'worklet',
        meterFrameAgeMs: 5,
        currentReductionDb: 6.5,
        frames: [{ url: 'https://live.douyin.com/123', mediaCount: 1 }]
      },
      {
        tabId: 2,
        url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
        title: 'Bilibili video',
        mediaCount: 1,
        audibleCount: 1,
        captureActive: false,
        captureState: 'idle',
        frames: [{ url: 'https://www.bilibili.com/video/BV1xx411c7mD/', mediaCount: 1 }]
      },
      {
        tabId: 3,
        url: 'https://www.youtube.com/live/example',
        title: 'YouTube live',
        mediaCount: 1,
        audibleCount: 1,
        captureActive: true,
        captureState: 'processing',
        capturePipelineMode: 'programme-leveler-v4',
        captureContextState: 'running',
        captureAudioTrackCount: 1,
        meterMode: 'worklet',
        meterFrameAgeMs: 5,
        frames: []
      }
    ],
    events: []
  };
  const report = buildReport(fixture);
  const douyinLive = report.matrix.find((item) => item.id === 'douyin-live');
  const bilibiliVideo = report.matrix.find((item) => item.id === 'bilibili-video');
  const youtubeLive = report.matrix.find((item) => item.id === 'youtube-live');
  assert(douyinLive.status === 'processing', 'douyin live should be processing');
  assert(douyinLive.evidence.hasReduction, 'douyin live should expose reduction evidence');
  assert(bilibiliVideo.status === 'media-not-captured', 'bilibili video should be seen but not captured');
  assert(youtubeLive.status === 'processing', 'youtube live should be processing');
  console.log('OK   site matrix self-test passed');
}

function printText(report) {
  console.log(`Site matrix audit runtime=${report.version || 'unknown'} disk=${report.diskVersion || 'unknown'} matches=${report.runtimeVersionMatchesDisk} fresh=${report.diagnosticsFresh} ageMs=${report.diagnosticsAgeMs ?? 'unknown'}`);
  for (const warning of report.warnings || []) {
    console.log(`WARNING              ${warning}`);
  }
  for (const item of report.matrix) {
    const tab = item.tab;
    const detail = tab
      ? `tab=${tab.tabId} media=${tab.mediaCount} capture=${tab.captureState} gain=${tab.currentGainDb ?? '--'}dB reduce=${tab.reductionDb.toFixed(2)}dB lift=${tab.liftDb.toFixed(2)}dB liftWhy=${tab.liftDiagnosis} errors=${tab.errors.length}`
      : 'not observed';
    console.log(`${item.status.toUpperCase().padEnd(20)} ${item.label} - ${detail}`);
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const diagnostics = readJson(path.join(root, 'tmp', 'latest-diagnostics.json'));
  const report = buildReport(diagnostics);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
  if (process.argv.includes('--strict')) {
    const required = ['youtube-video', 'youtube-live', 'bilibili-video', 'bilibili-live', 'douyin-short', 'douyin-live'];
    if (!report.diagnosticsFresh) {
      console.error('FAIL diagnostics are stale or missing');
      process.exit(1);
    }
    if (!report.runtimeVersionMatchesDisk) {
      console.error(`FAIL runtime version ${report.version || 'unknown'} does not match disk version ${report.diskVersion || 'unknown'}`);
      process.exit(1);
    }
    const missing = report.matrix.filter((item) => required.includes(item.id) && item.status !== 'processing');
    if (missing.length) {
      console.error(`FAIL required real-site scenarios not processing: ${missing.map((item) => item.id).join(', ')}`);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  SCENARIOS,
  buildReport,
  classifyUrl,
  summarizeTab,
  scenarioStatus,
  selfTest
};
