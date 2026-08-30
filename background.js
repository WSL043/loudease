import './shared/core.js';
import './shared/programme-leveler-policy.js';

const STORAGE_KEY = 'webVolumeBalancer.settings';
const SITE_SETTINGS_KEY = 'webVolumeBalancer.siteSettings';
const STATUS_TTL_MS = 8000;
const INJECTION_RETRY_MS = 1600;
const DIAGNOSTIC_EVENT_LIMIT = 160;
const TAB_HINT_TTL_MS = 30000;
const CAPTURE_MEDIA_REFRESH_INTERVAL_MS = 1000;
/* WVB_DEV_DIAGNOSTICS_START */
const LOCAL_DIAGNOSTICS_URL = 'http://127.0.0.1:18765/loudease';
const LOCAL_DIAGNOSTICS_INTERVAL_MS = 1000;
const LOCAL_DIAGNOSTICS_STORAGE_KEY = 'webVolumeBalancer.localDiagnosticsEnabled';
const E2E_SILENT_SINK_STORAGE_KEY = 'webVolumeBalancer.e2eSilentSink';
/* WVB_DEV_DIAGNOSTICS_END */
const CURRENT_VERSION = chrome.runtime.getManifest().version;
const OFFSCREEN_MESSAGE_RETRY_MS = 120;
const OFFSCREEN_MESSAGE_ATTEMPTS = 60;

const {
  DEFAULT_SETTINGS,
  clamp,
  finite,
  normalizeSettings,
  isAlreadyConnectedError
} = globalThis.WebVolumeBalancerCore;
const { DEFAULT_PARAMS: PROGRAMME_PARAMS } = globalThis.LoudEaseProgrammePolicy;

function parseVersion(version) {
  return String(version || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

function classifyEngineVersion(engineVersion) {
  const version = String(engineVersion || '').trim();
  if (!version || version === CURRENT_VERSION) {
    return { stale: false, newer: false, mixed: false, version };
  }
  const comparison = compareVersions(version, CURRENT_VERSION);
  return {
    stale: true,
    newer: comparison > 0,
    mixed: comparison > 0,
    version
  };
}

function classifyFrameRuntime(status = {}) {
  const engine = classifyEngineVersion(status.engineVersion);
  const bridge = classifyEngineVersion(status.bridgeVersion);
  const stale = engine.stale || bridge.stale;
  const newer = engine.newer || bridge.newer;
  return {
    stale,
    newer,
    mixed: newer,
    engineVersion: engine.version,
    bridgeVersion: bridge.version
  };
}

const frameStatuses = new Map();
const injectionAttempts = new Map();
const captureStatuses = new Map();
const captureSettingsResyncAt = new Map();
const captureNavigationRevisions = new Map();
const tabHints = new Map();
const lastProgrammeKeys = new Map();
const diagnosticEvents = [];
/* WVB_DEV_DIAGNOSTICS_START */
let localDiagnosticsAvailable = false;
let localDiagnosticsEnabled = false;
let lastLocalDiagnosticsAt = 0;
/* WVB_DEV_DIAGNOSTICS_END */
let offscreenPort = null;
let offscreenRequestId = 1;
const offscreenRequests = new Map();
let offscreenCreationPromise = null;
let offscreenCloseTimer = null;
let offscreenCloseGeneration = 0;

function addEvent(type, detail = {}) {
  diagnosticEvents.push({
    type,
    detail,
    at: Date.now()
  });
  if (diagnosticEvents.length > DIAGNOSTIC_EVENT_LIMIT) {
    diagnosticEvents.splice(0, diagnosticEvents.length - DIAGNOSTIC_EVENT_LIMIT);
  }
}

function unsupportedStatus() {
  return {
    unsupported: true,
    mediaCount: 0,
    processedCount: 0,
    limitedCount: 0,
    audibleCount: 0,
    measuringCount: 0,
    autoplayBlockedCount: 0,
    analysisSilentCount: 0,
    averageInputDb: null,
    averageInputPeak: 0,
    respondingFrames: 0
  };
}

function mediaTargetUrl(url) {
  return /(^|\/\/)(www\.)?(douyin|bilibili)\.com\b|(^|\/\/)live\.(douyin|bilibili)\.com\b/i.test(String(url || ''));
}

function rememberTabHint(tab) {
  const tabId = Number(tab?.id);
  if (!Number.isInteger(tabId)) {
    return null;
  }
  const url = String(tab.url || tab.pendingUrl || '');
  const hint = {
    tabId,
    url,
    title: String(tab.title || ''),
    audible: Boolean(tab.audible),
    active: Boolean(tab.active),
    status: String(tab.status || ''),
    discarded: Boolean(tab.discarded),
    muted: Boolean(tab.mutedInfo?.muted),
    mediaTarget: mediaTargetUrl(url),
    lastSeenAt: Date.now()
  };
  tabHints.set(tabId, hint);
  return hint;
}

function pruneTabHints() {
  const now = Date.now();
  for (const [tabId, hint] of tabHints.entries()) {
    if (now - Number(hint.lastSeenAt || 0) > TAB_HINT_TTL_MS) {
      tabHints.delete(tabId);
    }
  }
}

async function refreshTabHints(options = {}) {
  try {
    const url = ['http://*/*', 'https://*/*'];
    const batches = options.includeAll === true
      ? [await chrome.tabs.query({ url })]
      : await Promise.all([
        chrome.tabs.query({ url, active: true }),
        chrome.tabs.query({ url, audible: true })
      ]);
    const byId = new Map();
    for (const tab of batches.flat()) {
      if (Number.isInteger(tab?.id)) {
        byId.set(tab.id, tab);
      }
    }
    const tabs = [...byId.values()];
    tabs.forEach(rememberTabHint);
    pruneTabHints();
    return tabs;
  } catch (error) {
    addEvent('tabs:hint-error', { error: String(error?.message || error) });
    pruneTabHints();
    return [];
  }
}

async function ensureTabInjectedIfUseful(tab, options = {}) {
  const hint = rememberTabHint(tab);
  if (!hint || !supportedPage(hint.url)) {
    return { ok: false, skipped: true, error: 'unsupported-page' };
  }
  if (!hint.mediaTarget && !hint.audible && !captureStatuses.get(hint.tabId)?.active) {
    return { ok: false, skipped: true, error: 'not-media-or-active' };
  }
  return await ensureInjected(hint.tabId, hint.url, { ...options, force: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachOffscreenPort(port) {
  if (port.name !== 'WVB_OFFSCREEN') {
    return;
  }
  offscreenPort = port;
  addEvent('offscreen:port-connected');
  port.onMessage.addListener((message) => {
    const requestId = Number(message?.requestId);
    if (!Number.isInteger(requestId) || !offscreenRequests.has(requestId)) {
      return;
    }
    const pending = offscreenRequests.get(requestId);
    if (pending.port !== port) {
      return;
    }
    offscreenRequests.delete(requestId);
    clearTimeout(pending.timer);
    if (message?.ok === false) {
      pending.reject(new Error(String(message.error || 'offscreen request failed')));
      return;
    }
    pending.resolve(message?.response);
  });
  port.onDisconnect.addListener(() => {
    const wasCurrentPort = offscreenPort === port;
    if (wasCurrentPort) {
      offscreenPort = null;
    }
    for (const [requestId, pending] of offscreenRequests.entries()) {
      if (pending.port !== port) {
        continue;
      }
      clearTimeout(pending.timer);
      pending.reject(new Error('offscreen port disconnected'));
      offscreenRequests.delete(requestId);
    }
    addEvent('offscreen:port-disconnected', { wasCurrentPort });
  });
}

function failureIsCurrent(status) {
  const details = Array.isArray(status?.mediaDetails) ? status.mediaDetails : [];
  if (details.length > 0) {
    return details.some((item) => {
      if (!item?.failed || !item?.audible) {
        return false;
      }
      const currentSrc = String(item.src || '');
      const errorSrc = String(item.lastErrorSrc || '');
      return !currentSrc || !errorSrc || currentSrc === errorSrc;
    });
  }
  return (Number(status?.audibleCount) || 0) > 0 && (Number(status?.activeProcessorCount) || 0) === 0;
}

function relevantFailedErrors(status) {
  const errors = Array.isArray(status?.failedErrors) ? status.failedErrors.filter(Boolean) : [];
  if (errors.length === 0) {
    return [];
  }
  return failureIsCurrent(status) ? errors : [];
}

async function readSettings() {
  const data = await chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SETTINGS });
  return normalizeSettings(data[STORAGE_KEY]);
}

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!/^https?:$/.test(parsed.protocol)) {
      return '';
    }
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function normalizeSiteKey(input = '') {
  let value = String(input || '').trim().toLowerCase();
  if (/^https?:\/\//i.test(value)) {
    value = siteKeyFromUrl(value);
  }
  value = value.replace(/^www\./, '');
  if (
    !value
    || value.length > 253
    || /[^a-z0-9.-]/.test(value)
    || value.includes('..')
    || value.startsWith('.')
    || value.endsWith('.')
  ) {
    return '';
  }
  return value;
}

function siteScopedSettings(input = {}) {
  const normalized = normalizeSettings(input);
  return {
    preset: normalized.preset,
    cutStrength: normalized.cutStrength,
    liftStrength: normalized.liftStrength
  };
}

async function readSiteSettings() {
  const data = await chrome.storage.sync.get({ [SITE_SETTINGS_KEY]: {} });
  const value = data[SITE_SETTINGS_KEY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function readSettingsForUrl(tabUrl = '') {
  const globalSettings = await readSettings();
  const siteKey = siteKeyFromUrl(tabUrl);
  if (!siteKey) {
    return globalSettings;
  }
  const siteSettings = await readSiteSettings();
  return normalizeSettings({
    ...globalSettings,
    ...(siteSettings[siteKey] || {})
  });
}

/* WVB_DEV_DIAGNOSTICS_START */
async function loadLocalDiagnosticsPreference() {
  try {
    const data = await chrome.storage.local.get({ [LOCAL_DIAGNOSTICS_STORAGE_KEY]: localDiagnosticsEnabled });
    localDiagnosticsEnabled = data[LOCAL_DIAGNOSTICS_STORAGE_KEY] === true;
  } catch (error) {
    addEvent('diagnostics:preference-error', { error: String(error?.message || error) });
  }
}
/* WVB_DEV_DIAGNOSTICS_END */

async function writeSettings(settings, options = {}) {
  const tabUrl = String(options.tabUrl || '');
  const tabId = Number(options.tabId);
  const siteKey = siteKeyFromUrl(tabUrl);
  const siteScoped = options.siteScoped === true && Boolean(siteKey);
  const globalOnly = options.globalOnly === true;

  if (siteScoped) {
    const siteSettings = await readSiteSettings();
    const current = await readSettingsForUrl(tabUrl);
    siteSettings[siteKey] = siteScopedSettings({ ...current, ...settings });
    await chrome.storage.sync.set({ [SITE_SETTINGS_KEY]: siteSettings });
    const effective = await readSettingsForUrl(tabUrl);
    if (Number.isInteger(tabId)) {
      await applyCaptureSettings(effective, tabId);
    } else {
      await applyEffectiveSettingsToActiveCaptures();
    }
    addEvent('settings:site-update', { siteKey, ...siteSettings[siteKey] });
    return effective;
  }

  const current = await readSettings();
  const next = normalizeSettings(globalOnly ? {
    ...current,
    enabled: settings.enabled,
    respectPlayerVolume: settings.respectPlayerVolume
  } : settings);
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  await refreshAction(next);
  const effective = tabUrl ? await readSettingsForUrl(tabUrl) : next;
  await applyEffectiveSettingsToActiveCaptures();
  addEvent('settings:update', next);
  return effective;
}

async function settingsPayload(tabUrl = '') {
  const siteKey = siteKeyFromUrl(tabUrl);
  const siteSettings = siteKey ? await readSiteSettings() : {};
  return {
    ...(await readSettingsForUrl(tabUrl)),
    siteKey,
    siteScoped: Boolean(siteKey && siteSettings[siteKey]),
    version: chrome.runtime.getManifest().version
  };
}

async function optionsState() {
  return {
    version: CURRENT_VERSION,
    settings: await readSettings(),
    siteSettings: await readSiteSettings(),
    /* WVB_DEV_DIAGNOSTICS_START */
    localDiagnosticsEnabled,
    localDiagnosticsAvailable
    /* WVB_DEV_DIAGNOSTICS_END */
  };
}

async function saveSiteSettingsFromOptions(siteKey, settings = {}) {
  const key = normalizeSiteKey(siteKey);
  if (!key) {
    return { ok: false, error: 'invalid site key' };
  }
  const siteSettings = await readSiteSettings();
  siteSettings[key] = siteScopedSettings(settings);
  await chrome.storage.sync.set({ [SITE_SETTINGS_KEY]: siteSettings });
  await applyEffectiveSettingsToActiveCaptures();
  addEvent('settings:site-options-update', { siteKey: key, ...siteSettings[key] });
  return { ok: true, siteKey: key, siteSettings: siteSettings[key], state: await optionsState() };
}

async function deleteSiteSettingsFromOptions(siteKey) {
  const key = normalizeSiteKey(siteKey);
  if (!key) {
    return { ok: false, error: 'invalid site key' };
  }
  const siteSettings = await readSiteSettings();
  delete siteSettings[key];
  await chrome.storage.sync.set({ [SITE_SETTINGS_KEY]: siteSettings });
  await applyEffectiveSettingsToActiveCaptures();
  addEvent('settings:site-options-delete', { siteKey: key });
  return { ok: true, siteKey: key, state: await optionsState() };
}

async function resetAllSettingsFromOptions() {
  await chrome.storage.sync.set({ [STORAGE_KEY]: normalizeSettings(DEFAULT_SETTINGS), [SITE_SETTINGS_KEY]: {} });
  const settings = await readSettings();
  await refreshAction(settings);
  await applyEffectiveSettingsToActiveCaptures();
  addEvent('settings:reset-all');
  return { ok: true, state: await optionsState() };
}

/* WVB_DEV_DIAGNOSTICS_START */
async function setLocalDiagnosticsFromOptions(enabled) {
  localDiagnosticsEnabled = enabled === true;
  await chrome.storage.local.set({ [LOCAL_DIAGNOSTICS_STORAGE_KEY]: localDiagnosticsEnabled });
  addEvent('diagnostics:local-options-toggle', { enabled: localDiagnosticsEnabled });
  lastLocalDiagnosticsAt = 0;
  if (localDiagnosticsEnabled) {
    await pushLocalDiagnostics();
  } else {
    localDiagnosticsAvailable = false;
  }
  return { ok: true, state: await optionsState() };
}
/* WVB_DEV_DIAGNOSTICS_END */

async function refreshAction(settings) {
  const titleKey = settings.enabled ? 'actionTitleEnabled' : 'actionTitlePaused';
  const fallbackTitle = settings.enabled
    ? 'LoudEase: enabled'
    : 'LoudEase: paused';
  await chrome.action.setTitle({
    title: chrome.i18n.getMessage(titleKey) || fallbackTitle
  });
  await chrome.action.setBadgeText({ text: '' });
}

function rememberStatus(sender, status) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    return;
  }

  const key = `${sender.frameId || 0}:${sender.documentId || sender.url || ''}`;
  let tabFrames = frameStatuses.get(tabId);
  if (!tabFrames) {
    tabFrames = new Map();
    frameStatuses.set(tabId, tabFrames);
  }

  tabFrames.set(key, {
    ...status,
    frameId: Number.isInteger(sender.frameId) ? sender.frameId : 0,
    url: sender.url || '',
    receivedAt: Date.now()
  });
  applyTabMediaState(tabId).catch(() => {});
}

function rememberCollectedStatus(tabId, status) {
  if (!Number.isInteger(tabId) || !status || typeof status !== 'object') {
    return;
  }
  let tabFrames = frameStatuses.get(tabId);
  if (!tabFrames) {
    tabFrames = new Map();
    frameStatuses.set(tabId, tabFrames);
  }
  tabFrames.set('0:collected-status', {
    ...status,
    frameId: 0,
    url: String(status.href || ''),
    receivedAt: Date.now()
  });
}

function mediaStateFromStatuses(tabId, statuses = []) {
  const hint = tabHints.get(tabId) || null;
  const tabMuted = Boolean(hint?.muted);
  const tabAudible = Boolean(hint?.audible);
  let activeCount = 0;
  let mutedActiveCount = 0;
  let maxVolumeCap = 0;
  let minVolumeCap = 1;
  let hasVolumeConflict = false;
  let hasMediaVolume = false;
  let knownVolumeCount = 0;
  const activeProgrammeKeys = new Set();
  const fallbackProgrammeKeys = new Set();

  for (const status of statuses) {
    const frameActiveCount = Number(status.playerActiveMediaCount) || 0;
    const frameProgrammeKey = String(status.programmeKey || '').slice(0, 64);
    if (frameProgrammeKey) {
      fallbackProgrammeKeys.add(frameProgrammeKey);
      if (frameActiveCount > 0) activeProgrammeKeys.add(frameProgrammeKey);
    }
    if (frameActiveCount <= 0) {
      continue;
    }
    activeCount += frameActiveCount;
    const frameMuted = Boolean(status.playerMuted);
    const frameVolume = Math.max(0, Math.min(1, finite(status.playerVolumeCap, 1)));
    const frameVolumeKnown = status.playerVolumeKnown === true;
    if (frameVolumeKnown) {
      hasMediaVolume = true;
      knownVolumeCount += frameActiveCount;
      maxVolumeCap = Math.max(maxVolumeCap, frameVolume);
      if (frameVolume > 0.001) {
        minVolumeCap = Math.min(minVolumeCap, frameVolume);
      } else {
        minVolumeCap = Math.min(minVolumeCap, 0);
      }
      hasVolumeConflict = hasVolumeConflict || Boolean(status.playerVolumeConflict);
    }
    if (frameMuted || frameVolume <= 0 || tabMuted) {
      mutedActiveCount += frameActiveCount;
    }
  }

  let programmeKey = '';
  if (activeProgrammeKeys.size > 0) {
    programmeKey = Array.from(activeProgrammeKeys).sort().join(':').slice(0, 240);
    lastProgrammeKeys.set(tabId, programmeKey);
  } else if (lastProgrammeKeys.has(tabId)) {
    programmeKey = lastProgrammeKeys.get(tabId);
  } else {
    programmeKey = Array.from(fallbackProgrammeKeys).sort().join(':').slice(0, 240);
  }

  if (!hasMediaVolume) {
    return {
      playerActiveMediaCount: activeCount,
      playerMuted: tabMuted,
      playerVolumeCap: tabMuted ? 0 : 1,
      playerMaxVolumeCap: tabMuted ? 0 : 1,
      playerMinVolumeCap: tabMuted ? 0 : 1,
      playerVolumeKnown: false,
      playerVolumeConflict: false,
      programmeKey,
      tabMuted,
      tabAudibleHint: tabAudible
    };
  }
  const safeMinVolumeCap = minVolumeCap === 1 && maxVolumeCap === 0 ? 0 : minVolumeCap;
  const allDetectedMuted = activeCount > 0 && mutedActiveCount >= activeCount;
  const pageMuteReliable = allDetectedMuted && !tabAudible;
  const audibleVolumeMismatch = allDetectedMuted && tabAudible && !tabMuted;
  hasVolumeConflict = hasVolumeConflict || (knownVolumeCount > 1 && (maxVolumeCap - safeMinVolumeCap) > 0.05);

  return {
    playerActiveMediaCount: activeCount,
    playerMuted: tabMuted || pageMuteReliable,
    playerVolumeCap: tabMuted || pageMuteReliable ? 0 : (audibleVolumeMismatch ? 1 : (hasVolumeConflict ? safeMinVolumeCap : maxVolumeCap)),
    playerMaxVolumeCap: tabMuted || pageMuteReliable ? 0 : (audibleVolumeMismatch ? 1 : maxVolumeCap),
    playerMinVolumeCap: tabMuted || pageMuteReliable ? 0 : (audibleVolumeMismatch ? 1 : safeMinVolumeCap),
    playerVolumeKnown: !audibleVolumeMismatch,
    playerVolumeConflict: hasVolumeConflict || audibleVolumeMismatch,
    programmeKey,
    tabMuted,
    tabAudibleHint: tabAudible
  };
}

function currentTabMediaState(tabId) {
  const tabFrames = frameStatuses.get(tabId);
  if (!tabFrames) {
    return mediaStateFromStatuses(tabId, []);
  }
  const now = Date.now();
  const fresh = [];
  for (const status of tabFrames.values()) {
    if (now - status.receivedAt <= STATUS_TTL_MS) {
      fresh.push(status);
    }
  }
  return mediaStateFromStatuses(tabId, fresh);
}

async function applyTabMediaState(tabId) {
  const capture = captureStatus(tabId);
  if (!capture?.active || !offscreenPort) {
    return;
  }
  const mediaState = currentTabMediaState(tabId);
  await sendOffscreenMessage({
    type: 'WVB_OFFSCREEN_APPLY_MEDIA_STATE',
    tabId,
    mediaState
  });
}

async function collectFrameStatusNow(tabId, tabUrl = '') {
  if (!Number.isInteger(tabId) || (tabUrl && !supportedPage(tabUrl))) {
    return null;
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'WVB_COLLECT_STATUS' });
    if (response?.status && typeof response.status === 'object') {
      rememberCollectedStatus(tabId, response.status);
      await applyTabMediaState(tabId);
      return response.status;
    }
  } catch (_) {}
  return null;
}

async function refreshActiveCaptureMediaStates() {
  for (const [tabId, capture] of captureStatuses.entries()) {
    if (!capture?.active) {
      continue;
    }
    const hint = tabHints.get(tabId) || null;
    const status = await collectFrameStatusNow(tabId, hint?.url || '');
    if (!status) {
      const tabUrl = hint?.url || await tabUrlForCaptureSettings(tabId);
      if (supportedPage(tabUrl)) {
        await ensureInjected(tabId, tabUrl);
      }
    }
  }
}

function aggregateStatus(tabId) {
  const tabFrames = frameStatuses.get(tabId);
  if (!tabFrames) {
    const capture = captureStatus(tabId);
    if (capture?.active) {
      const captureConnected = capture.connected === true;
      const captureDspLive = capture.dspLive === true;
      return {
        mediaCount: 0,
        processedCount: captureConnected ? 1 : 0,
        activeProcessorCount: captureDspLive ? 1 : 0,
        limitedCount: 0,
        audibleCount: capture.audible ? 1 : 0,
        measuringCount: 0,
        autoplayBlockedCount: 0,
        analysisSilentCount: 0,
        respondingFrames: 0,
        averageLiftDb: finite(capture.averageLiftDb, 0),
        averageReductionDb: finite(capture.averageReductionDb, 0),
        averageInputDb: capture.averageInputDb == null ? null : finite(capture.averageInputDb, -91),
        momentaryInputDb: capture.momentaryInputDb == null ? null : finite(capture.momentaryInputDb, -91),
        shortTermInputDb: capture.shortTermInputDb == null ? null : finite(capture.shortTermInputDb, -91),
        controlInputDb: capture.controlInputDb == null ? null : finite(capture.controlInputDb, -91),
        averageInputPeak: finite(capture.averageInputPeak, 0),
        liftPeak: finite(capture.liftPeak, 0),
        averageTargetPercent: 50,
        captureActive: true,
        captureConnected,
        captureDspLive,
        startupGateOpen: capture.startupGateOpen === true,
        levelerConfigured: capture.levelerConfigured === true,
        captureAvailable: true,
        captureState: capture.state || 'processing',
        capturePipelineMode: capture.pipelineMode || '',
        captureControlPolicyRevision: capture.controlPolicyRevision || '',
        captureContextState: capture.contextState || '',
        /* WVB_DEV_DIAGNOSTICS_START */
        silentSink: capture.silentSink === true,
        /* WVB_DEV_DIAGNOSTICS_END */
        captureTrackCount: Number(capture.trackCount) || 0,
        captureAudioTrackCount: Number(capture.audioTrackCount) || 0,
        signalTickCount: Number(capture.signalTickCount) || 0,
        silentTickCount: Number(capture.silentTickCount) || 0,
        limiterTickCount: Number(capture.limiterTickCount) || 0,
        loudnessResetCount: Number(capture.loudnessResetCount) || 0,
        kWeightingMode: String(capture.kWeightingMode || ''),
        lastSignalAgeMs: capture.lastSignalAgeMs == null ? null : Number(capture.lastSignalAgeMs) || 0,
        currentGainDb: finite(capture.currentGainDb, 0),
        currentLiftDb: finite(capture.currentLiftDb, 0),
        currentReductionDb: finite(capture.currentReductionDb, 0),
        limiterReductionDb: finite(capture.limiterReductionDb, 0),
        limiterMode: String(capture.limiterMode || ''),
        limiterError: String(capture.limiterError || ''),
        meterMode: String(capture.meterMode || ''),
        meterError: String(capture.meterError || ''),
        meterSequence: Number(capture.meterSequence) || 0,
        meterFrameAgeMs: capture.meterFrameAgeMs == null ? null : Number(capture.meterFrameAgeMs) || 0,
        workletLimitedSamples: Number(capture.workletLimitedSamples) || 0,
        workletInputPeak: finite(capture.workletInputPeak, 0),
        workletOutputPeak: finite(capture.workletOutputPeak, 0),
        workletHardClippedSamples: Number(capture.workletHardClippedSamples) || 0,
        workletMaxHardClipOvershoot: finite(capture.workletMaxHardClipOvershoot, 0),
        effectiveLimiterCeilingDb: finite(capture.effectiveLimiterCeilingDb, 0),
        targetGainDb: finite(capture.targetGainDb, 0),
        targetLiftDb: finite(capture.targetLiftDb, 0),
        targetReductionDb: finite(capture.targetReductionDb, 0),
        effectiveMaxLiftDb: finite(capture.effectiveMaxLiftDb, 0),
        playerVolumeLiftCeilingDb: finite(capture.playerVolumeLiftCeilingDb, PROGRAMME_PARAMS.programmeTargetDb),
        peakHeadroomDb: finite(capture.peakHeadroomDb, 0),
        rawPeakHeadroomDb: finite(capture.rawPeakHeadroomDb, 0),
        liftLimiterBudgetDb: finite(capture.liftLimiterBudgetDb, 0),
        effectiveLiftBudgetDb: finite(capture.effectiveLiftBudgetDb, 0),
        quietDeficitDb: finite(capture.quietDeficitDb, 0),
        requestedLiftDb: finite(capture.requestedLiftDb, 0),
        playerVolumeCap: finite(capture.playerVolumeCap, 1),
        playerMaxVolumeCap: finite(capture.playerMaxVolumeCap, finite(capture.playerVolumeCap, 1)),
        playerMinVolumeCap: finite(capture.playerMinVolumeCap, finite(capture.playerVolumeCap, 1)),
        playerVolumeKnown: capture.playerVolumeKnown === true,
        playerVolumeConflict: Boolean(capture.playerVolumeConflict),
        playerMuted: Boolean(capture.playerMuted),
        playerActiveMediaCount: Number(capture.playerActiveMediaCount) || 0,
        settingsEnabled: capture.settingsEnabled !== false,
        settingsPreset: String(capture.settingsPreset || ''),
        settingsCutStrength: finite(capture.settingsCutStrength, DEFAULT_SETTINGS.cutStrength),
        settingsLiftStrength: finite(capture.settingsLiftStrength, DEFAULT_SETTINGS.liftStrength),
        settingsRespectPlayerVolume: capture.settingsRespectPlayerVolume !== false,
        mediaStateAgeMs: capture.mediaStateAgeMs == null ? null : Number(capture.mediaStateAgeMs) || 0,
        averageOutputDb: capture.averageOutputDb == null ? null : finite(capture.averageOutputDb, -91),
        outputMomentaryDb: capture.outputMomentaryDb == null ? null : finite(capture.outputMomentaryDb, -91),
        outputShortTermDb: capture.outputShortTermDb == null ? null : finite(capture.outputShortTermDb, -91),
        outputControlDb: capture.outputControlDb == null ? null : finite(capture.outputControlDb, -91),
        averageOutputPeak: finite(capture.averageOutputPeak, 0),
        captureError: capture.error || ''
      };
    }
    const hint = tabHints.get(tabId) || {};
    const hintedAudible = Boolean(hint.audible) && !Boolean(hint.muted);
    const hintedMedia = Boolean(hint.mediaTarget || hintedAudible);
    return {
      mediaCount: hintedMedia ? 1 : 0,
      processedCount: 0,
      activeProcessorCount: 0,
      limitedCount: 0,
      audibleCount: hintedAudible ? 1 : 0,
      measuringCount: 0,
      autoplayBlockedCount: 0,
      analysisSilentCount: 0,
      respondingFrames: 0,
      captureActive: false,
      captureAvailable: true,
      captureState: capture?.state || 'idle',
      capturePipelineMode: capture?.pipelineMode || '',
      captureControlPolicyRevision: capture?.controlPolicyRevision || '',
      captureContextState: capture?.contextState || '',
      captureTrackCount: Number(capture?.trackCount) || 0,
      captureAudioTrackCount: Number(capture?.audioTrackCount) || 0,
      limiterMode: capture?.limiterMode || '',
      limiterError: capture?.limiterError || '',
      meterMode: capture?.meterMode || '',
      meterError: capture?.meterError || '',
      meterSequence: Number(capture?.meterSequence) || 0,
      meterFrameAgeMs: capture?.meterFrameAgeMs == null ? null : Number(capture.meterFrameAgeMs) || 0,
      workletLimitedSamples: Number(capture?.workletLimitedSamples) || 0,
      workletInputPeak: finite(capture?.workletInputPeak, 0),
      workletOutputPeak: finite(capture?.workletOutputPeak, 0),
      workletHardClippedSamples: Number(capture?.workletHardClippedSamples) || 0,
      workletMaxHardClipOvershoot: finite(capture?.workletMaxHardClipOvershoot, 0),
      effectiveLimiterCeilingDb: finite(capture?.effectiveLimiterCeilingDb, 0),
      captureError: capture?.error || '',
      playerMuted: Boolean(hint.muted),
      playerVolumeCap: hint.muted ? 0 : 1,
      playerMaxVolumeCap: hint.muted ? 0 : 1,
      playerMinVolumeCap: hint.muted ? 0 : 1,
      playerVolumeKnown: false,
      playerVolumeConflict: false,
      playerActiveMediaCount: hintedMedia ? 1 : 0,
      tabMuted: Boolean(hint.muted),
      tabAudibleHint: Boolean(hint.audible),
      mediaTargetHint: Boolean(hint.mediaTarget)
    };
  }

  const now = Date.now();
  const fresh = [];
  for (const [key, status] of tabFrames.entries()) {
    if (now - status.receivedAt > STATUS_TTL_MS) {
      tabFrames.delete(key);
      continue;
    }
    fresh.push(status);
  }
  const mediaState = mediaStateFromStatuses(tabId, fresh);

  const totals = fresh.reduce((total, status) => {
    const processedCount = Number(status.processedCount) || 0;
    const activeProcessorCount = Number(status.activeProcessorCount) || 0;
    const weight = activeProcessorCount > 0 ? activeProcessorCount : 0;
    const versionState = classifyFrameRuntime(status);
    if (versionState.stale) {
      total.staleFrameCount += 1;
    }
    if (versionState.mixed) {
      total.mixedRuntimeCount += 1;
    }
    total.mediaCount += Number(status.mediaCount) || 0;
    total.processedCount += processedCount;
    total.activeProcessorCount += activeProcessorCount;
    const failedErrors = relevantFailedErrors(status);
    total.limitedCount += failedErrors.length > 0 ? (Number(status.limitedCount) || 0) : 0;
    total.audibleCount += Number(status.audibleCount) || 0;
    total.measuringCount += Number(status.measuringCount) || 0;
    total.autoplayBlockedCount += Number(status.autoplayBlockedCount) || 0;
    total.analysisSilentCount += Number(status.analysisSilentCount) || 0;
    total.liftDbSum += finite(status.averageLiftDb, 0) * weight;
    total.reductionSum += finite(status.averageReductionDb, 0) * weight;
    total.inputDbSum += finite(status.averageInputDb, -91) * weight;
    total.inputPeakSum += finite(status.averageInputPeak, 0) * weight;
    total.targetPercentSum += finite(status.averageTargetPercent, 50) * weight;
    total.failedErrors.push(...failedErrors);
    if (failedErrors.some(isAlreadyConnectedError)) {
      total.needsPageReload = true;
    }
    total.weight += weight;
    return total;
  }, { mediaCount: 0, processedCount: 0, activeProcessorCount: 0, limitedCount: 0, audibleCount: 0, measuringCount: 0, autoplayBlockedCount: 0, analysisSilentCount: 0, respondingFrames: fresh.length, staleFrameCount: 0, mixedRuntimeCount: 0, liftDbSum: 0, reductionSum: 0, inputDbSum: 0, inputPeakSum: 0, targetPercentSum: 0, weight: 0, failedErrors: [], needsPageReload: false });

  const capture = captureStatus(tabId);
  if (capture?.active) {
    const captureConnected = capture.connected === true;
    const captureDspLive = capture.dspLive === true;
    totals.processedCount += captureConnected ? 1 : 0;
    totals.activeProcessorCount += captureDspLive ? 1 : 0;
    totals.audibleCount = Math.max(totals.audibleCount, capture.audible ? 1 : 0);
    totals.liftDbSum += finite(capture.averageLiftDb, 0);
    totals.reductionSum += finite(capture.averageReductionDb, 0);
    totals.inputDbSum += finite(capture.averageInputDb, -91);
    totals.inputPeakSum += finite(capture.averageInputPeak, 0);
    totals.targetPercentSum += 50;
    totals.weight += 1;
  }
  const captureVolumeKnown = capture?.playerVolumeKnown === true;
  const mediaVolumeKnown = Boolean(mediaState.playerVolumeKnown);
  const effectiveVolumeKnown = captureVolumeKnown || mediaVolumeKnown;
  const effectivePlayerVolumeCap = captureVolumeKnown
    ? finite(capture.playerVolumeCap, mediaState.playerVolumeCap)
    : mediaState.playerVolumeCap;
  const effectivePlayerMaxVolumeCap = captureVolumeKnown
    ? finite(capture.playerMaxVolumeCap, mediaState.playerMaxVolumeCap)
    : mediaState.playerMaxVolumeCap;
  const effectivePlayerMinVolumeCap = captureVolumeKnown
    ? finite(capture.playerMinVolumeCap, mediaState.playerMinVolumeCap)
    : mediaState.playerMinVolumeCap;

  return {
    mediaCount: totals.mediaCount,
    processedCount: totals.processedCount,
    activeProcessorCount: totals.activeProcessorCount,
    limitedCount: totals.limitedCount,
    audibleCount: totals.audibleCount,
    measuringCount: totals.measuringCount,
    autoplayBlockedCount: totals.autoplayBlockedCount,
    analysisSilentCount: totals.analysisSilentCount,
    respondingFrames: totals.respondingFrames,
    staleEngine: totals.staleFrameCount > 0,
    mixedRuntime: totals.mixedRuntimeCount > 0,
    extensionReloadRequired: totals.mixedRuntimeCount > 0,
    needsPageReload: totals.needsPageReload,
    failedErrors: totals.failedErrors.slice(0, 5),
    averageLiftDb: totals.weight > 0 ? totals.liftDbSum / totals.weight : 0,
    averageReductionDb: totals.weight > 0 ? totals.reductionSum / totals.weight : 0,
    averageInputDb: totals.weight > 0 ? totals.inputDbSum / totals.weight : null,
    averageInputPeak: totals.weight > 0 ? totals.inputPeakSum / totals.weight : 0,
    averageTargetPercent: totals.weight > 0 ? totals.targetPercentSum / totals.weight : 50,
    playerActiveMediaCount: mediaState.playerActiveMediaCount,
    playerMuted: Boolean(capture?.playerMuted || mediaState.playerMuted),
    playerVolumeCap: effectivePlayerVolumeCap,
    playerMaxVolumeCap: effectivePlayerMaxVolumeCap,
    playerMinVolumeCap: effectivePlayerMinVolumeCap,
    playerVolumeKnown: effectiveVolumeKnown,
    playerVolumeConflict: Boolean(capture?.playerVolumeConflict || mediaState.playerVolumeConflict),
    tabMuted: Boolean(mediaState.tabMuted),
    tabAudibleHint: Boolean(mediaState.tabAudibleHint || tabHints.get(tabId)?.audible),
    mediaTargetHint: Boolean(tabHints.get(tabId)?.mediaTarget),
    settingsEnabled: capture?.settingsEnabled !== false,
    settingsPreset: String(capture?.settingsPreset || ''),
    settingsCutStrength: finite(capture?.settingsCutStrength, DEFAULT_SETTINGS.cutStrength),
    settingsLiftStrength: finite(capture?.settingsLiftStrength, DEFAULT_SETTINGS.liftStrength),
    settingsRespectPlayerVolume: capture?.settingsRespectPlayerVolume !== false,
    captureActive: Boolean(capture?.active),
    captureConnected: capture?.connected === true,
    captureDspLive: capture?.dspLive === true,
    startupGateOpen: capture?.startupGateOpen === true,
    levelerConfigured: capture?.levelerConfigured === true,
    captureAvailable: true,
    captureState: capture?.state || 'idle',
    capturePipelineMode: capture?.pipelineMode || '',
    captureControlPolicyRevision: capture?.controlPolicyRevision || '',
    captureContextState: capture?.contextState || '',
    /* WVB_DEV_DIAGNOSTICS_START */
    silentSink: capture?.silentSink === true,
    /* WVB_DEV_DIAGNOSTICS_END */
    captureTrackCount: Number(capture?.trackCount) || 0,
    captureAudioTrackCount: Number(capture?.audioTrackCount) || 0,
    signalTickCount: Number(capture?.signalTickCount) || 0,
    silentTickCount: Number(capture?.silentTickCount) || 0,
    limiterTickCount: Number(capture?.limiterTickCount) || 0,
    loudnessResetCount: Number(capture?.loudnessResetCount) || 0,
    kWeightingMode: String(capture?.kWeightingMode || ''),
    lastSignalAgeMs: capture?.lastSignalAgeMs == null ? null : Number(capture.lastSignalAgeMs) || 0,
    currentGainDb: finite(capture?.currentGainDb, 0),
    currentLiftDb: finite(capture?.currentLiftDb, 0),
    currentReductionDb: finite(capture?.currentReductionDb, 0),
    limiterReductionDb: finite(capture?.limiterReductionDb, 0),
    limiterMode: String(capture?.limiterMode || ''),
    limiterError: String(capture?.limiterError || ''),
    meterMode: String(capture?.meterMode || ''),
    meterError: String(capture?.meterError || ''),
    meterSequence: Number(capture?.meterSequence) || 0,
    meterFrameAgeMs: capture?.meterFrameAgeMs == null ? null : Number(capture.meterFrameAgeMs) || 0,
    workletLimitedSamples: Number(capture?.workletLimitedSamples) || 0,
    workletInputPeak: finite(capture?.workletInputPeak, 0),
    workletOutputPeak: finite(capture?.workletOutputPeak, 0),
    workletHardClippedSamples: Number(capture?.workletHardClippedSamples) || 0,
    workletMaxHardClipOvershoot: finite(capture?.workletMaxHardClipOvershoot, 0),
    effectiveLimiterCeilingDb: finite(capture?.effectiveLimiterCeilingDb, 0),
    targetGainDb: finite(capture?.targetGainDb, 0),
    targetLiftDb: finite(capture?.targetLiftDb, 0),
    targetReductionDb: finite(capture?.targetReductionDb, 0),
    effectiveMaxLiftDb: finite(capture?.effectiveMaxLiftDb, 0),
    playerVolumeLiftCeilingDb: finite(capture?.playerVolumeLiftCeilingDb, PROGRAMME_PARAMS.programmeTargetDb),
    peakHeadroomDb: finite(capture?.peakHeadroomDb, 0),
    rawPeakHeadroomDb: finite(capture?.rawPeakHeadroomDb, 0),
    liftLimiterBudgetDb: finite(capture?.liftLimiterBudgetDb, 0),
    effectiveLiftBudgetDb: finite(capture?.effectiveLiftBudgetDb, 0),
    quietDeficitDb: finite(capture?.quietDeficitDb, 0),
    requestedLiftDb: finite(capture?.requestedLiftDb, 0),
    momentaryInputDb: capture?.momentaryInputDb == null ? null : finite(capture.momentaryInputDb, -91),
    shortTermInputDb: capture?.shortTermInputDb == null ? null : finite(capture.shortTermInputDb, -91),
    controlInputDb: capture?.controlInputDb == null ? null : finite(capture.controlInputDb, -91),
    liftPeak: finite(capture?.liftPeak, 0),
    mediaStateAgeMs: capture?.mediaStateAgeMs == null ? null : Number(capture.mediaStateAgeMs) || 0,
    averageOutputDb: capture?.averageOutputDb == null ? null : finite(capture.averageOutputDb, -91),
    outputMomentaryDb: capture?.outputMomentaryDb == null ? null : finite(capture.outputMomentaryDb, -91),
    outputShortTermDb: capture?.outputShortTermDb == null ? null : finite(capture.outputShortTermDb, -91),
    outputControlDb: capture?.outputControlDb == null ? null : finite(capture.outputControlDb, -91),
    averageOutputPeak: finite(capture?.averageOutputPeak, 0),
    captureError: capture?.error || ''
  };
}

function captureStatus(tabId) {
  const status = captureStatuses.get(tabId);
  if (!status) {
    return null;
  }
  if (Date.now() - status.receivedAt > STATUS_TTL_MS) {
    captureStatuses.delete(tabId);
    return null;
  }
  return status;
}

function diagnosticsSnapshot() {
  const now = Date.now();
  const tabs = [];
  pruneTabHints();
  for (const [tabId, tabFrames] of frameStatuses.entries()) {
    const aggregate = aggregateStatus(tabId);
    const hint = tabHints.get(tabId) || null;
    const frames = [];
    for (const status of tabFrames.values()) {
      frames.push({
        frameId: status.frameId,
        url: status.url,
        href: status.href,
        ageMs: now - status.receivedAt,
        mediaCount: Number(status.mediaCount) || 0,
        processedCount: Number(status.processedCount) || 0,
        activeProcessorCount: Number(status.activeProcessorCount) || 0,
        limitedCount: Number(status.limitedCount) || 0,
        audibleCount: Number(status.audibleCount) || 0,
        measuringCount: Number(status.measuringCount) || 0,
        autoplayBlockedCount: Number(status.autoplayBlockedCount) || 0,
        analysisSilentCount: Number(status.analysisSilentCount) || 0,
        averageLiftDb: finite(status.averageLiftDb, 0),
        averageReductionDb: finite(status.averageReductionDb, 0),
        averageInputDb: status.averageInputDb == null ? null : finite(status.averageInputDb, -91),
        averageInputPeak: finite(status.averageInputPeak, 0),
        playerActiveMediaCount: Number(status.playerActiveMediaCount) || 0,
        playerMuted: Boolean(status.playerMuted),
        playerVolumeCap: finite(status.playerVolumeCap, 1),
        playerMaxVolumeCap: finite(status.playerMaxVolumeCap, finite(status.playerVolumeCap, 1)),
        playerMinVolumeCap: finite(status.playerMinVolumeCap, finite(status.playerVolumeCap, 1)),
        playerVolumeKnown: status.playerVolumeKnown === true,
        playerVolumeConflict: Boolean(status.playerVolumeConflict),
        settingsEnabled: status.settingsEnabled !== false,
        settingsPreset: String(status.settingsPreset || ''),
        settingsCutStrength: finite(status.settingsCutStrength, DEFAULT_SETTINGS.cutStrength),
        settingsLiftStrength: finite(status.settingsLiftStrength, DEFAULT_SETTINGS.liftStrength),
        settingsRespectPlayerVolume: status.settingsRespectPlayerVolume !== false,
        averageOutputDb: status.averageOutputDb == null ? null : finite(status.averageOutputDb, -91),
        averageOutputPeak: finite(status.averageOutputPeak, 0),
        currentGainDb: finite(status.currentGainDb, 0),
        currentLiftDb: finite(status.currentLiftDb, 0),
        currentReductionDb: finite(status.currentReductionDb, 0),
        limiterReductionDb: finite(status.limiterReductionDb, 0),
        limiterActive: Boolean(status.limiterActive),
        limiterTickCount: Number(status.limiterTickCount) || 0,
        signalTickCount: Number(status.signalTickCount) || 0,
        silentTickCount: Number(status.silentTickCount) || 0,
        mediaDetails: Array.isArray(status.mediaDetails) ? status.mediaDetails.slice(0, 8) : [],
        debugEvents: Array.isArray(status.debugEvents) ? status.debugEvents.slice(-20) : [],
        engineVersion: status.engineVersion || '',
        bridgeVersion: status.bridgeVersion || '',
        staleEngine: classifyFrameRuntime(status).stale,
        mixedRuntime: classifyFrameRuntime(status).mixed,
        failedErrors: relevantFailedErrors(status).slice(0, 5)
      });
    }
    tabs.push({
      tabId,
      url: hint?.url || frames.find((frame) => frame.href || frame.url)?.href || frames.find((frame) => frame.url)?.url || '',
      title: hint?.title || '',
      audibleHint: Boolean(hint?.audible),
      activeHint: Boolean(hint?.active),
      mutedHint: Boolean(hint?.muted),
      mediaTarget: Boolean(hint?.mediaTarget),
      diagnosticOnly: false,
      ...aggregate,
      capture: captureStatus(tabId),
      frames: frames.sort((a, b) => a.frameId - b.frameId)
    });
  }

  for (const [tabId] of captureStatuses.entries()) {
    if (frameStatuses.has(tabId)) {
      continue;
    }
    const capture = captureStatus(tabId);
    if (!capture) {
      continue;
    }
    tabs.push({
      tabId,
      url: tabHints.get(tabId)?.url || '',
      title: tabHints.get(tabId)?.title || '',
      audibleHint: Boolean(tabHints.get(tabId)?.audible),
      activeHint: Boolean(tabHints.get(tabId)?.active),
      mutedHint: Boolean(tabHints.get(tabId)?.muted),
      mediaTarget: Boolean(tabHints.get(tabId)?.mediaTarget),
      diagnosticOnly: false,
      ...aggregateStatus(tabId),
      capture,
      frames: []
    });
  }

  for (const [tabId, hint] of tabHints.entries()) {
    if (frameStatuses.has(tabId) || captureStatuses.has(tabId)) {
      continue;
    }
    if (!hint.mediaTarget && !hint.audible && !hint.active) {
      continue;
    }
    tabs.push({
      tabId,
      url: hint.url,
      title: hint.title,
      audibleHint: Boolean(hint.audible),
      activeHint: Boolean(hint.active),
      mutedHint: Boolean(hint.muted),
      mediaTarget: Boolean(hint.mediaTarget),
      diagnosticOnly: true,
      ...aggregateStatus(tabId),
      capture: null,
      frames: []
    });
  }

  return {
    version: CURRENT_VERSION,
    now,
    statusTtlMs: STATUS_TTL_MS,
    /* WVB_DEV_DIAGNOSTICS_START */
    localDiagnosticsEnabled,
    localDiagnosticsAvailable,
    /* WVB_DEV_DIAGNOSTICS_END */
    tabs: tabs.sort((a, b) => {
      const score = (item) => (
        (item.captureActive ? 64 : 0)
        + (item.activeProcessorCount > 0 ? 32 : 0)
        + (item.audibleHint ? 16 : 0)
        + (item.activeHint ? 8 : 0)
        + (item.mediaTarget ? 4 : 0)
        + Math.min(Number(item.respondingFrames) || 0, 3)
      );
      return score(b) - score(a) || a.tabId - b.tabId;
    }),
    events: diagnosticEvents.slice().reverse()
  };
}

async function offscreenDocumentExists() {
  const url = chrome.runtime.getURL('offscreen/index.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  cancelOffscreenIdleClose();
  if (!offscreenCreationPromise) {
    const creation = (async () => {
      if (await offscreenDocumentExists()) {
        return;
      }
      try {
        await chrome.offscreen.createDocument({
          url: 'offscreen/index.html',
          reasons: ['USER_MEDIA'],
          justification: 'Process the current tab audio for volume balancing after the user starts full-tab capture.'
        });
        addEvent('offscreen:created');
      } catch (error) {
        const message = String(error?.message || error);
        if (/Only a single offscreen document may be created/i.test(message) && await offscreenDocumentExists()) {
          addEvent('offscreen:creation-reused');
          return;
        }
        throw error;
      }
    })();
    offscreenCreationPromise = creation;
    creation.finally(() => {
      if (offscreenCreationPromise === creation) {
        offscreenCreationPromise = null;
      }
    }).catch(() => {});
  }
  await offscreenCreationPromise;
}

function cancelOffscreenIdleClose() {
  offscreenCloseGeneration += 1;
  if (offscreenCloseTimer) {
    clearTimeout(offscreenCloseTimer);
    offscreenCloseTimer = null;
  }
}

function scheduleOffscreenIdleClose() {
  cancelOffscreenIdleClose();
  const generation = offscreenCloseGeneration;
  offscreenCloseTimer = setTimeout(async () => {
    offscreenCloseTimer = null;
    if (generation !== offscreenCloseGeneration) {
      return;
    }
    if ([...captureStatuses.values()].some((capture) => capture?.active)) {
      return;
    }
    try {
      const exists = await offscreenDocumentExists();
      if (generation !== offscreenCloseGeneration || !exists) {
        return;
      }
      await chrome.offscreen.closeDocument();
      addEvent('offscreen:idle-close');
    } catch (error) {
      addEvent('offscreen:idle-close-error', { error: String(error?.message || error) });
    }
  }, 750);
}

async function sendOffscreenMessage(message) {
  for (let attempt = 1; attempt <= OFFSCREEN_MESSAGE_ATTEMPTS; attempt += 1) {
    if (offscreenPort) {
      const requestPort = offscreenPort;
      const requestId = offscreenRequestId;
      offscreenRequestId += 1;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          offscreenRequests.delete(requestId);
          reject(new Error('offscreen request timed out'));
        }, 10000);
        offscreenRequests.set(requestId, { resolve, reject, timer, port: requestPort });
        try {
          requestPort.postMessage({ ...message, requestId });
          if (attempt > 1) {
            addEvent('offscreen:message-retry-ok', { type: String(message?.type || ''), attempt });
          }
        } catch (error) {
          offscreenRequests.delete(requestId);
          clearTimeout(timer);
          reject(error);
        }
      });
    }
    if (attempt < OFFSCREEN_MESSAGE_ATTEMPTS) {
      await sleep(OFFSCREEN_MESSAGE_RETRY_MS);
    }
  }
  throw new Error('offscreen port not connected');
}

function rememberCaptureFailure(tabId, state, error, extra = {}) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  captureStatuses.set(tabId, {
    ...extra,
    tabId,
    active: false,
    state: state || 'error',
    error: String(error || ''),
    receivedAt: Date.now(),
    engineVersion: CURRENT_VERSION
  });
}

async function applyCaptureSettings(settings, tabId = null) {
  if (!offscreenPort) {
    return;
  }
  try {
    await sendOffscreenMessage({ type: 'WVB_OFFSCREEN_APPLY_SETTINGS', settings, tabId });
  } catch (_) {}
}

async function applyEffectiveSettingsToActiveCaptures() {
  for (const [tabId, capture] of captureStatuses.entries()) {
    if (!capture || capture.active === false) {
      continue;
    }
    const tabUrl = await tabUrlForCaptureSettings(tabId);
    await applyCaptureSettings(await readSettingsForUrl(tabUrl), tabId);
  }
}

async function tabUrlForCaptureSettings(tabId) {
  const hinted = String(tabHints.get(tabId)?.url || '');
  if (supportedPage(hinted)) {
    return hinted;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    rememberTabHint(tab);
    return String(tab?.url || '');
  } catch (_) {
    return '';
  }
}

function captureSettingsOutOfSync(capture = {}, effective = {}) {
  if (!capture || capture.active === false || !effective) {
    return false;
  }
  const enabled = effective.enabled !== false;
  if (capture.settingsEnabled !== undefined && (capture.settingsEnabled !== false) !== enabled) {
    return true;
  }
  if (capture.settingsRespectPlayerVolume !== undefined && (capture.settingsRespectPlayerVolume !== false) !== (effective.respectPlayerVolume !== false)) {
    return true;
  }
  if (capture.settingsCutStrength !== undefined && finite(capture.settingsCutStrength, -1) !== finite(effective.cutStrength, DEFAULT_SETTINGS.cutStrength)) {
    return true;
  }
  if (capture.settingsLiftStrength !== undefined && finite(capture.settingsLiftStrength, -1) !== finite(effective.liftStrength, DEFAULT_SETTINGS.liftStrength)) {
    return true;
  }
  if (capture.settingsPreset !== undefined && String(capture.settingsPreset || '') !== String(effective.preset || DEFAULT_SETTINGS.preset)) {
    return true;
  }
  return false;
}

async function reconcileCaptureSettings(tabId, capture = {}, reason = '') {
  if (!Number.isInteger(tabId) || !capture || capture.active === false) {
    return false;
  }
  const now = Date.now();
  if (now - Number(captureSettingsResyncAt.get(tabId) || 0) < 2000) {
    return false;
  }
  const tabUrl = await tabUrlForCaptureSettings(tabId);
  const effective = await readSettingsForUrl(tabUrl);
  if (!captureSettingsOutOfSync(capture, effective)) {
    return false;
  }
  captureSettingsResyncAt.set(tabId, now);
  await applyCaptureSettings(effective, tabId);
  addEvent('capture:settings-resync', {
    tabId,
    reason,
    effectiveEnabled: effective.enabled !== false,
    effectivePreset: effective.preset,
    effectiveCutStrength: effective.cutStrength,
    effectiveLiftStrength: effective.liftStrength,
    captureEnabled: capture.settingsEnabled !== false,
    capturePreset: String(capture.settingsPreset || ''),
    captureCutStrength: capture.settingsCutStrength,
    captureLiftStrength: capture.settingsLiftStrength
  });
  return true;
}

async function startTabCapture(tabId, tabUrl, providedStreamId = '', popupStreamIdError = '') {
  addEvent('capture:start-request', {
    tabId,
    hasProvidedStreamId: Boolean(providedStreamId),
    popupStreamIdError: Boolean(popupStreamIdError)
  });
  if (!Number.isInteger(tabId) || !supportedPage(tabUrl)) {
    addEvent('capture:start-error', { tabId, stage: 'validate-page', error: 'unsupported-page' });
    return { ok: false, error: '当前页面不能整页接管' };
  }
  let streamId = providedStreamId;
  const popupError = String(popupStreamIdError || '');
  if (!streamId && popupError) {
    addEvent('capture:stream-id-popup-failed', { tabId, error: popupError });
  }
  if (!streamId) {
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (error) {
      const message = String(error?.message || error);
      const combined = popupError ? `${popupError}; background: ${message}` : message;
      addEvent('capture:start-error', { tabId, stage: 'background-get-stream-id', error: combined });
      rememberCaptureFailure(tabId, 'error', combined, { stage: 'background-get-stream-id' });
      return { ok: false, error: combined };
    }
  }
  try {
    await ensureOffscreenDocument();
  } catch (error) {
    const message = String(error?.message || error);
    addEvent('capture:start-error', { tabId, stage: 'ensure-offscreen', error: message });
    return { ok: false, error: message };
  }
  let response;
  try {
    /* WVB_DEV_DIAGNOSTICS_START */
    const e2eSinkSetting = await chrome.storage.local.get({ [E2E_SILENT_SINK_STORAGE_KEY]: false });
    /* WVB_DEV_DIAGNOSTICS_END */
    response = await sendOffscreenMessage({
      type: 'WVB_OFFSCREEN_START_CAPTURE',
      tabId,
      streamId,
      nextSettings: await readSettingsForUrl(tabUrl),
      /* WVB_DEV_DIAGNOSTICS_START */
      e2eSilentSink: e2eSinkSetting[E2E_SILENT_SINK_STORAGE_KEY] === true,
      /* WVB_DEV_DIAGNOSTICS_END */
      mediaState: currentTabMediaState(tabId)
    });
  } catch (error) {
    const message = String(error?.message || error);
    addEvent('capture:start-error', { tabId, stage: 'offscreen-message', error: message });
    rememberCaptureFailure(tabId, 'error', message, { stage: 'offscreen-message' });
    return { ok: false, error: message };
  }
  if (!response?.ok) {
    const message = response?.error || '整页接管失败';
    addEvent('capture:start-error', { tabId, stage: 'offscreen-start', error: message });
    rememberCaptureFailure(tabId, 'error', message, { stage: 'offscreen-start' });
    return { ok: false, error: message };
  }
  const captureStatus = response?.status && typeof response.status === 'object' ? response.status : {};
  if (captureStatus.state === 'superseded' || captureStatus.active === false) {
    addEvent('capture:start-superseded', { tabId, state: String(captureStatus.state || '') });
    return { ok: true, superseded: true };
  }
  captureStatuses.set(tabId, {
    ...captureStatus,
    tabId,
    active: true,
    audible: Boolean(captureStatus.audible),
    receivedAt: Date.now(),
    engineVersion: captureStatus.engineVersion || CURRENT_VERSION
  });
  addEvent('capture:start', { tabId });
  return { ok: true };
}

async function stopTabCapture(tabId) {
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: 'invalid tabId' };
  }
  if (!offscreenPort && offscreenRequests.size === 0) {
    try {
      if (!await offscreenDocumentExists()) {
        captureStatuses.delete(tabId);
        captureSettingsResyncAt.delete(tabId);
        addEvent('capture:already-stopped', { tabId });
        return { ok: true, alreadyStopped: true };
      }
    } catch (error) {
      addEvent('capture:offscreen-check-error', { tabId, error: String(error?.message || error) });
    }
  }
  let response;
  try {
    response = await sendOffscreenMessage({ type: 'WVB_OFFSCREEN_STOP_CAPTURE', tabId });
  } catch (error) {
    const message = String(error?.message || error);
    addEvent('capture:stop-error', { tabId, error: message });
    rememberCaptureFailure(tabId, 'error', message, { stage: 'offscreen-stop' });
    return { ok: false, error: message };
  }
  if (!response?.ok) {
    const message = String(response?.error || 'offscreen stop was not acknowledged');
    addEvent('capture:stop-error', { tabId, error: message });
    rememberCaptureFailure(tabId, 'error', message, { stage: 'offscreen-stop' });
    return { ok: false, error: message };
  }
  captureStatuses.delete(tabId);
  captureSettingsResyncAt.delete(tabId);
  addEvent('capture:stop', { tabId });
  if (Number(response.remainingSessions) === 0) {
    scheduleOffscreenIdleClose();
  }
  return { ok: true };
}

/* WVB_DEV_DIAGNOSTICS_START */
async function pushLocalDiagnostics() {
  if (!localDiagnosticsEnabled) {
    localDiagnosticsAvailable = false;
    return;
  }
  const now = Date.now();
  if (now - lastLocalDiagnosticsAt < LOCAL_DIAGNOSTICS_INTERVAL_MS) {
    return;
  }
  lastLocalDiagnosticsAt = now;
  try {
    await refreshTabHints({ includeAll: true });
    const response = await fetch(LOCAL_DIAGNOSTICS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(diagnosticsSnapshot()),
      cache: 'no-store'
    });
    localDiagnosticsAvailable = response.ok;
  } catch (_) {
    localDiagnosticsAvailable = false;
  }
}
/* WVB_DEV_DIAGNOSTICS_END */

function supportedPage(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

async function clearTabState(tabId) {
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: 'invalid tabId' };
  }
  const stopped = await stopTabCapture(tabId);
  if (!stopped.ok) {
    addEvent('tab:clear-state-error', { tabId, error: stopped.error });
    return stopped;
  }
  frameStatuses.delete(tabId);
  injectionAttempts.delete(tabId);
  captureSettingsResyncAt.delete(tabId);
  captureNavigationRevisions.delete(tabId);
  tabHints.delete(tabId);
  lastProgrammeKeys.delete(tabId);
  addEvent('tab:clear-state', { tabId });
  return { ok: true };
}

async function ensureInjected(tabId, tabUrl, options = {}) {
  if (!Number.isInteger(tabId) || !supportedPage(tabUrl)) {
    return { ok: false, skipped: true, error: '当前页面不是普通网页' };
  }

  const now = Date.now();
  const last = injectionAttempts.get(tabId) || 0;
  if (!options.force && now - last < INJECTION_RETRY_MS) {
    return { ok: false, skipped: true, error: '等待上次接入完成' };
  }
  injectionAttempts.set(tabId, now);

  try {
    if (options.clearStatus) {
      frameStatuses.delete(tabId);
    }
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/bridge.js']
    });
    await chrome.tabs.sendMessage(tabId, { type: 'WVB_REFRESH_SETTINGS' }).catch(() => {});
    return { ok: true, bridgeOnly: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function ensureOpenTabsInjected(options = {}) {
  const tabs = await refreshTabHints();
  const candidates = tabs
    .filter((tab) => Number.isInteger(tab.id) && supportedPage(tab.url) && (tab.audible || tab.active || mediaTargetUrl(tab.url)))
    .slice(0, 16);
  const results = [];
  for (const tab of candidates) {
    const injection = await ensureInjected(tab.id, tab.url, { ...options, force: true });
    results.push({ tabId: tab.id, audible: Boolean(tab.audible), active: Boolean(tab.active), injection });
  }
  addEvent('tabs:ensure-open', { count: results.length, results });
  return results;
}

chrome.runtime.onInstalled.addListener(async () => {
  await writeSettings(await readSettings());
  await ensureOpenTabsInjected({ clearStatus: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshAction(await readSettings());
  await ensureOpenTabsInjected();
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  frameStatuses.delete(tabId);
  injectionAttempts.delete(tabId);
  captureSettingsResyncAt.delete(tabId);
  captureNavigationRevisions.delete(tabId);
  tabHints.delete(tabId);
  lastProgrammeKeys.delete(tabId);
  stopTabCapture(tabId).catch(() => {});
});

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo?.url) {
    const navigationRevision = Number(captureNavigationRevisions.get(tabId) || 0) + 1;
    captureNavigationRevisions.set(tabId, navigationRevision);
    const navigationUrl = String(changeInfo.url || '');
    frameStatuses.delete(tabId);
    injectionAttempts.delete(tabId);
    lastProgrammeKeys.delete(tabId);
    const previous = tabHints.get(tabId) || {};
    tabHints.set(tabId, {
      ...previous,
      url: navigationUrl,
      mediaTarget: mediaTargetUrl(changeInfo.url),
      lastSeenAt: Date.now()
    });
    addEvent('tab:url-change', { tabId, url: navigationUrl.slice(0, 180) });
    const activeCapture = captureStatus(tabId);
    if (activeCapture?.active) {
      readSettingsForUrl(navigationUrl)
        .then((effective) => {
          const stillCurrent = captureNavigationRevisions.get(tabId) === navigationRevision
            && String(tabHints.get(tabId)?.url || '') === navigationUrl;
          if (!stillCurrent) {
            addEvent('capture:navigation-settings-superseded', { tabId, url: navigationUrl.slice(0, 180) });
            return false;
          }
          return applyCaptureSettings(effective, tabId).then(() => true);
        })
        .then((applied) => {
          if (applied) addEvent('capture:navigation-settings-applied', { tabId, url: navigationUrl.slice(0, 180) });
        })
        .catch((error) => addEvent('capture:navigation-settings-error', {
          tabId,
          error: String(error?.message || error)
        }));
    }
  }
  if (changeInfo?.status === 'loading') {
    frameStatuses.delete(tabId);
    injectionAttempts.delete(tabId);
    lastProgrammeKeys.delete(tabId);
  }
  if (Object.prototype.hasOwnProperty.call(changeInfo || {}, 'audible') || Object.prototype.hasOwnProperty.call(changeInfo || {}, 'mutedInfo')) {
    chrome.tabs.get(tabId)
      .then((tab) => {
        rememberTabHint(tab);
        return applyTabMediaState(tabId);
      })
      .then(() => addEvent('tab:audio-hint-update', {
        tabId,
        audible: Boolean(tabHints.get(tabId)?.audible),
        muted: Boolean(tabHints.get(tabId)?.muted)
      }))
      .catch((error) => addEvent('tab:audio-hint-error', { tabId, error: String(error?.message || error) }));
  }
  if (changeInfo?.status === 'complete') {
    chrome.tabs.get(tabId)
      .then((tab) => ensureTabInjectedIfUseful(tab))
      .then((injection) => addEvent(injection.ok ? 'tab:update-inject-ok' : 'tab:update-inject-skip', { tabId, injection }))
      .catch((error) => addEvent('tab:update-inject-error', { tabId, error: String(error?.message || error) }));
  }
});

chrome.tabs?.onActivated?.addListener((activeInfo) => {
  const tabId = Number(activeInfo?.tabId);
  if (!Number.isInteger(tabId)) {
    return;
  }
  chrome.tabs.get(tabId)
    .then((tab) => ensureTabInjectedIfUseful(tab))
    .then((injection) => addEvent(injection.ok ? 'tab:active-inject-ok' : 'tab:active-inject-skip', { tabId, injection }))
    .catch((error) => addEvent('tab:active-inject-error', { tabId, error: String(error?.message || error) }));
});

/* WVB_DEV_DIAGNOSTICS_START */
loadLocalDiagnosticsPreference();

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes[LOCAL_DIAGNOSTICS_STORAGE_KEY]) {
    return;
  }
  localDiagnosticsEnabled = changes[LOCAL_DIAGNOSTICS_STORAGE_KEY].newValue === true;
  addEvent('diagnostics:local-toggle', { enabled: localDiagnosticsEnabled });
});
/* WVB_DEV_DIAGNOSTICS_END */

chrome.runtime.onConnect.addListener(attachOffscreenPort);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  (async () => {
    if (message.type === 'WVB_GET_SETTINGS') {
      return await settingsPayload(String(message.tabUrl || sender.tab?.url || ''));
    }

    if (message.type === 'WVB_SAVE_SETTINGS') {
      return await writeSettings(message.settings, {
        tabUrl: String(message.tabUrl || sender.tab?.url || ''),
        tabId: Number(message.tabId),
        siteScoped: message.siteScoped === true,
        globalOnly: message.globalOnly === true
      });
    }

    if (message.type === 'WVB_GET_OPTIONS_STATE') {
      return await optionsState();
    }

    if (message.type === 'WVB_SAVE_SITE_SETTINGS') {
      return await saveSiteSettingsFromOptions(message.siteKey, message.settings || {});
    }

    if (message.type === 'WVB_DELETE_SITE_SETTINGS') {
      return await deleteSiteSettingsFromOptions(message.siteKey);
    }

    if (message.type === 'WVB_RESET_SETTINGS') {
      return await resetAllSettingsFromOptions();
    }

    /* WVB_DEV_DIAGNOSTICS_START */
    if (message.type === 'WVB_SET_LOCAL_DIAGNOSTICS') {
      return await setLocalDiagnosticsFromOptions(message.enabled === true);
    }
    /* WVB_DEV_DIAGNOSTICS_END */

    if (message.type === 'WVB_GET_STATUS') {
      const tabId = Number(message.tabId);
      const tabUrl = String(message.tabUrl || '');
      if (tabUrl && !supportedPage(tabUrl)) {
        return unsupportedStatus();
      }
      if (message.refreshFrame === true) {
        await collectFrameStatusNow(tabId, tabUrl);
      }

      return aggregateStatus(tabId);
    }

    if (message.type === 'WVB_ENSURE_OBSERVER') {
      const tabId = Number(message.tabId);
      const tabUrl = String(message.tabUrl || '');
      if (tabUrl && !supportedPage(tabUrl)) {
        return { ok: false, skipped: true, error: 'unsupported-page', status: unsupportedStatus() };
      }
      const injection = await ensureInjected(tabId, tabUrl, { clearStatus: true, force: true });
      addEvent(injection.ok ? 'observer:ensure-ok' : 'observer:ensure-error', { tabId, tabUrl, injection });
      return { ...injection, status: aggregateStatus(tabId) };
    }

    if (message.type === 'WVB_GET_DIAGNOSTICS') {
      return diagnosticsSnapshot();
    }

    if (message.type === 'WVB_CLEAR_TAB_STATE') {
      return await clearTabState(Number(message.tabId));
    }

    if (message.type === 'WVB_FORCE_RELOAD_TAB') {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) {
        return { ok: false, error: 'invalid tabId' };
      }
      const cleared = await clearTabState(tabId);
      if (!cleared.ok) {
        return cleared;
      }
      await chrome.tabs.reload(tabId, { bypassCache: true });
      addEvent('tab:force-reload', { tabId });
      return { ok: true };
    }

    if (message.type === 'WVB_START_TAB_CAPTURE') {
      return await startTabCapture(
        Number(message.tabId),
        String(message.tabUrl || ''),
        String(message.streamId || ''),
        String(message.streamIdError || '')
      );
    }

    if (message.type === 'WVB_STOP_TAB_CAPTURE') {
      return await stopTabCapture(Number(message.tabId));
    }

    if (message.type === 'WVB_CAPTURE_CLICK') {
      addEvent('capture:popup-click', {
        tabId: Number(message.tabId),
        action: String(message.action || '')
      });
      return { ok: true };
    }

    if (message.type === 'WVB_CAPTURE_ERROR') {
      addEvent('capture:popup-error', {
        tabId: Number(message.tabId),
        stage: String(message.stage || ''),
        error: String(message.error || '')
      });
      return { ok: true };
    }

    if (message.type === 'WVB_CAPTURE_STATUS') {
      const status = message.status || {};
      const tabId = Number(status.tabId);
      if (Number.isInteger(tabId)) {
        const previous = captureStatuses.get(tabId);
        const nextState = String(status.state || (status.active === false ? 'stopped' : 'processing'));
        if (!previous || previous.state !== nextState) {
          addEvent('capture:state', {
            tabId,
            previous: previous?.state || 'none',
            state: nextState,
            pipelineMode: String(status.pipelineMode || ''),
            contextState: String(status.contextState || ''),
            audioTrackCount: Number(status.audioTrackCount) || 0
          });
        }
        if (nextState === 'error' || status.error) {
          addEvent('capture:error-status', {
            tabId,
            state: nextState,
            error: String(status.error || '')
          });
        }
        if (status.active === false) {
          if (nextState === 'error' || nextState === 'ended' || status.error) {
            captureStatuses.set(tabId, {
              ...status,
              active: false,
              receivedAt: Date.now()
            });
          } else {
            captureStatuses.delete(tabId);
          }
        } else {
          captureStatuses.set(tabId, {
            ...status,
            active: true,
            receivedAt: Date.now()
          });
          await reconcileCaptureSettings(tabId, status, 'capture-status');
        }
      }
      return { ok: true };
    }

    if (message.type === 'WVB_FRAME_STATUS') {
      rememberStatus(sender, message.status || {});
      return { ok: true };
    }

    return { ok: false, error: '未知消息' };
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});

/* WVB_DEV_DIAGNOSTICS_START */
setInterval(() => {
  pushLocalDiagnostics();
}, LOCAL_DIAGNOSTICS_INTERVAL_MS);
/* WVB_DEV_DIAGNOSTICS_END */

setInterval(() => {
  refreshActiveCaptureMediaStates().catch(() => {});
}, CAPTURE_MEDIA_REFRESH_INTERVAL_MS);
