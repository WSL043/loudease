const elements = {
  app: document.getElementById('app'),
  version: document.getElementById('version'),
  enabled: document.getElementById('enabled'),
  statusLabel: document.getElementById('statusLabel'),
  stateTitle: document.getElementById('stateTitle'),
  stateSub: document.getElementById('stateSub'),
  effectRing: document.getElementById('app'),
  effectValue: document.getElementById('effectValue'),
  effectCaption: document.getElementById('effectCaption'),
  sourceValue: document.getElementById('sourceValue'),
  audibleValue: document.getElementById('audibleValue'),
  protectValue: document.getElementById('protectValue'),
  noticeStrip: document.getElementById('noticeStrip'),
  captureButton: document.getElementById('captureButton'),
  reloadButton: document.getElementById('reloadButton'),
  healthLabel: document.getElementById('healthLabel'),
  themeButton: document.getElementById('themeButton'),
  settingsButton: document.getElementById('settingsButton'),
  respectPlayerVolume: document.getElementById('respectPlayerVolume'),
  cutDial: document.getElementById('cutDial'),
  liftDial: document.getElementById('liftDial'),
  cutRange: document.getElementById('cutRange'),
  liftRange: document.getElementById('liftRange'),
  cutValue: document.getElementById('cutValue'),
  liftValue: document.getElementById('liftValue'),
  levelVisual: document.getElementById('levelVisual'),
  inputWaveBars: Array.from(document.querySelectorAll('.inputLevel i')),
  outputWaveBars: Array.from(document.querySelectorAll('.outputLevel i'))
};

const { get: t, apply: applyI18n, initialize: initializeI18n } = globalThis.WebVolumeBalancerI18n;
const { STORAGE_KEY: UI_PREFERENCES_KEY, read: readUiPreferences, save: saveUiPreferences, applyTheme } = globalThis.WebVolumeBalancerUiPreferences;

let settings = null;
let saving = false;
let activeTabId = null;
let activeTabUrl = '';
let persistTimer = null;
let persistQueue = Promise.resolve();
let saveQueue = Promise.resolve();
let settingsRevision = 0;
let pendingSettingsError = '';
let pendingWriteCount = 0;
let strengthGestureActive = false;
let observerEnsuredAt = 0;
let autoCaptureAttempted = false;
let autoCaptureRunning = false;
let currentUiPreferences = { theme: 'system', locale: 'en' };
const colorSchemeQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

const query = new URLSearchParams(location.search);
const e2eTabId = Number(query.get('e2eTabId'));
const e2eTabUrl = query.get('e2eTabUrl') || '';
const DEFAULT_STRENGTH = 100;
const CAPTURE_STREAM_ID_TIMEOUT_MS = 5000;
const {
  finite: finiteNumber,
  clamp,
  normalizeSettings: normalizeCoreSettings
} = globalThis.WebVolumeBalancerCore;
const dialConfigs = [
  { key: 'cutStrength', control: elements.cutDial, input: elements.cutRange, value: elements.cutValue },
  { key: 'liftStrength', control: elements.liftDial, input: elements.liftRange, value: elements.liftValue }
];
let mockSettings = {
  enabled: true,
  respectPlayerVolume: true,
  preset: 'standard',
  cutStrength: 50,
  liftStrength: 50,
  siteKey: '',
  siteScoped: false,
  version: '0.7.1'
};

function message(payload) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.resolve(mockMessage(payload));
  }
  return chrome.runtime.sendMessage(payload);
}

function mockMessage(payload) {
  if (payload.type === 'WVB_GET_STATUS') {
    return {
      respondingFrames: 1,
      mediaCount: 1,
      processedCount: 1,
      activeProcessorCount: 1,
      audibleCount: 1,
      limitedCount: 0,
      measuringCount: 0,
      autoplayBlockedCount: 0,
      averageLiftDb: 0,
      averageReductionDb: 3.2,
      averageInputDb: -18.4,
      averageTargetPercent: 50,
      captureActive: true,
      captureAvailable: true,
      captureState: 'processing',
      captureContextState: 'running',
      captureAudioTrackCount: 1,
      signalTickCount: 240,
      lastSignalAgeMs: 12,
      settingsCutStrength: mockSettings.cutStrength,
      settingsLiftStrength: mockSettings.liftStrength,
      failedErrors: []
    };
  }
  if (payload.type === 'WVB_SAVE_SETTINGS') {
    mockSettings = {
      ...mockSettings,
      ...normalizeSettings({ ...mockSettings, ...(payload.settings || {}) })
    };
  }
  return { ...mockSettings };
}

function percentValue(value, fallback = DEFAULT_STRENGTH) {
  return clamp(finiteNumber(value, fallback), 0, 100);
}

function normalizeSettings(input = {}) {
  const normalized = normalizeCoreSettings(input);
  return {
    ...normalized,
    preset: input.preset || normalized.preset || 'custom',
    siteKey: input.siteKey || '',
    siteScoped: input.siteScoped === true,
    version: input.version
  };
}

function countText(value) {
  return String(Math.max(0, Math.round(value)));
}

function effectiveTheme(theme = currentUiPreferences.theme) {
  if (theme === 'dark' || theme === 'light') {
    return theme;
  }
  return colorSchemeQuery?.matches ? 'dark' : 'light';
}

function renderThemeButton() {
  const activeTheme = effectiveTheme();
  const label = activeTheme === 'dark'
    ? t('switchToLightTheme', undefined, 'Switch to light theme')
    : t('switchToDarkTheme', undefined, 'Switch to dark theme');
  elements.themeButton.dataset.effectiveTheme = activeTheme;
  elements.themeButton.title = label;
  elements.themeButton.setAttribute('aria-label', label);
  elements.themeButton.setAttribute('aria-pressed', activeTheme === 'dark' ? 'true' : 'false');
}

async function toggleTheme() {
  const nextTheme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  elements.themeButton.disabled = true;
  try {
    currentUiPreferences = await saveUiPreferences({ theme: nextTheme });
    applyTheme(currentUiPreferences.theme);
    renderThemeButton();
  } finally {
    elements.themeButton.disabled = false;
  }
}

const INPUT_LEVEL_SHAPE = Object.freeze([0.32, 0.72, 1, 0.5, 0.84, 0.4, 0.68]);
const OUTPUT_LEVEL_SHAPE = Object.freeze([0.72, 0.86, 0.76, 0.9, 0.74, 0.82, 0.7]);

function levelScale(db) {
  if (!Number.isFinite(Number(db))) {
    return 0;
  }
  return clamp((Number(db) + 60) / 54, 0, 1);
}

function setLevelBars(bars, shape, level) {
  for (let index = 0; index < bars.length; index += 1) {
    const height = 5 + (33 * Math.max(0.08, level) * shape[index % shape.length]);
    bars[index].style.setProperty('--h', `${height.toFixed(1)}px`);
  }
}

function updateLevelVisual(status) {
  const inputDb = status.averageInputDb == null ? null : finiteNumber(status.averageInputDb);
  const currentGainDb = status.currentGainDb == null ? 0 : finiteNumber(status.currentGainDb);
  const outputDb = status.averageOutputDb == null
    ? (inputDb == null ? null : inputDb + currentGainDb)
    : finiteNumber(status.averageOutputDb);
  const signalTicks = finiteNumber(status.signalTickCount);
  const signalAge = status.lastSignalAgeMs == null ? null : finiteNumber(status.lastSignalAgeMs);
  const active = signalTicks > 0 && signalAge != null && signalAge < 2500;
  elements.levelVisual.dataset.active = active ? 'true' : 'false';
  setLevelBars(elements.inputWaveBars, INPUT_LEVEL_SHAPE, active ? levelScale(inputDb) : 0);
  setLevelBars(elements.outputWaveBars, OUTPUT_LEVEL_SHAPE, active ? levelScale(outputDb) : 0);
}

function setStrength(key, value, { live = true, persist = true } = {}) {
  if (!settings) {
    return;
  }
  settings = normalizeSettings({
    ...settings,
    preset: 'custom',
    [key]: percentValue(value)
  });
  settingsRevision += 1;
  render();
  if (live) {
    pushSettingsToPage(settings);
  }
  if (persist) {
    schedulePersistSettings({ siteScoped: true });
  }
}

function bindStrengthControl(dial) {
  dial.input.addEventListener('pointerdown', () => {
    strengthGestureActive = true;
  });

  dial.input.addEventListener('input', () => {
    strengthGestureActive = true;
    setStrength(dial.key, dial.input.value);
  });

  dial.input.addEventListener('change', () => {
    flushPersistSettings({ siteScoped: true });
    strengthGestureActive = false;
  });

  dial.input.addEventListener('pointercancel', () => {
    strengthGestureActive = false;
  });
}

function setVisualState(name) {
  elements.app.dataset.state = name || 'loading';
}

function setHeadline({ state = 'loading', label = t('statusChecking', undefined, 'Checking'), title = t('statusConnecting', undefined, 'Connecting'), sub = t('statusReadingTab', undefined, 'Reading the active tab') }) {
  setVisualState(state);
  if (elements.statusLabel.textContent !== label) elements.statusLabel.textContent = label;
  if (elements.stateTitle.textContent !== title) elements.stateTitle.textContent = title;
  if (elements.stateSub.textContent !== sub) elements.stateSub.textContent = sub;
  const announcement = `${label}. ${title}. ${sub}`;
  if (elements.healthLabel.textContent !== announcement) elements.healthLabel.textContent = announcement;
}

function setEffect({ value = '--', caption = 'dB', amount = 0 }) {
  elements.effectValue.textContent = value;
  elements.effectCaption.textContent = caption;
  const arc = Math.min(92, Math.max(10, 10 + amount * 5.4));
  elements.effectRing.style.setProperty('--arc', `${arc}%`);
}

function setNotices(notices = []) {
  if (pendingSettingsError && !notices.some((notice) => notice.text === pendingSettingsError)) {
    notices = [...notices, { tone: 'danger', text: pendingSettingsError }];
  }
  elements.noticeStrip.replaceChildren();
  elements.noticeStrip.hidden = notices.length === 0;
  for (const notice of notices) {
    const chip = document.createElement('span');
    chip.className = `noticeChip ${notice.tone || ''}`.trim();
    chip.textContent = notice.text;
    elements.noticeStrip.append(chip);
  }
}

function setReloadVisible(visible) {
  elements.reloadButton.hidden = !visible;
}

function setCaptureVisible(visible, active = false) {
  elements.captureButton.hidden = !visible;
  elements.captureButton.hidden = !visible || active;
  elements.captureButton.textContent = t('recoverCapture', undefined, 'Reconnect tab audio');
}

function setReadouts(status) {
  updateLevelVisual(status);
  const media = finiteNumber(status.mediaCount);
  const processed = finiteNumber(status.processedCount);
  const active = finiteNumber(status.activeProcessorCount);
  const audible = finiteNumber(status.audibleCount);
  const connected = audible > 0 ? active : processed;

  elements.sourceValue.textContent = connected > 0 ? countText(connected) : '--';
  elements.audibleValue.textContent = media > 0 ? countText(audible) : '--';
  elements.protectValue.textContent = settings?.respectPlayerVolume !== false ? '开' : '关';
}

function displayEffectForStatus(status, reductionDb, liftDb) {
  const hasCurrentGain = status.currentGainDb != null && Number.isFinite(Number(status.currentGainDb));
  const currentGainDb = hasCurrentGain ? finiteNumber(status.currentGainDb, 0) : 0;
  const positiveGainDb = hasCurrentGain ? Math.max(0, currentGainDb) : liftDb;
  const negativeGainDb = hasCurrentGain ? Math.max(0, -currentGainDb) : reductionDb;
  const displayLiftDb = Math.max(0, positiveGainDb);
  const displayReductionDb = displayLiftDb > 0.15 ? negativeGainDb : Math.max(reductionDb, negativeGainDb);
  if (displayLiftDb > 0.15) {
    return { kind: 'lift', amount: displayLiftDb };
  }
  if (displayReductionDb > 0.15) {
    return { kind: 'reduction', amount: displayReductionDb };
  }
  return { kind: 'neutral', amount: 0 };
}

function setStateBusy() {
  setHeadline({
    state: 'watching',
    label: t('statusSaving', undefined, 'Saving'),
    title: t('statusSaving', undefined, 'Saving'),
    sub: t('statusApplying', undefined, 'Applying changes')
  });
  setEffect({ value: '--', caption: 'dB', amount: 0 });
  setNotices([]);
  setReloadVisible(false);
  elements.healthLabel.textContent = '写入设置';
}

function render() {
  if (!settings) {
    return;
  }
  elements.enabled.checked = settings.enabled !== false;
  elements.respectPlayerVolume.checked = settings.respectPlayerVolume !== false;
  renderDials();
}

function renderDials() {
  if (!settings) {
    return;
  }
  for (const dial of dialConfigs) {
    const value = percentValue(settings[dial.key]);
    const rounded = Math.round(value);
    dial.value.textContent = String(rounded);
    dial.input.value = String(rounded);
    dial.input.style.setProperty('--strength', `${rounded}%`);
  }
}

function setStrengthControlsEnabled(enabled) {
  for (const dial of dialConfigs) {
    dial.input.disabled = !enabled;
    dial.control.classList.toggle('isUnavailable', !enabled);
  }
}

async function load() {
  currentUiPreferences = await readUiPreferences();
  applyTheme(currentUiPreferences.theme);
  await initializeI18n(currentUiPreferences.locale);
  applyI18n();
  renderThemeButton();
  await findActiveTab();
  const payload = await message({ type: 'WVB_GET_SETTINGS', tabUrl: activeTabUrl });
  settings = normalizeSettings(payload || {});
  pendingSettingsError = '';
  const fallbackVersion = globalThis.chrome?.runtime?.getManifest?.().version || '--';
  elements.version.textContent = `v${settings.version || fallbackVersion}`;
  render();
  await ensureObserverOnce().catch(() => null);
  await refreshStatus({ allowAutoCapture: true });
  window.setInterval(refreshStatus, 1000);
}

function save(next, options = {}) {
  settings = normalizeSettings(next);
  settingsRevision += 1;
  const revision = settingsRevision;
  const snapshot = normalizeSettings(settings);
  saving = true;
  render();
  setStateBusy();
  const operation = async () => {
    pendingWriteCount += 1;
    try {
      const payload = await message({
        type: 'WVB_SAVE_SETTINGS',
        settings: snapshot,
        tabUrl: activeTabUrl,
        tabId: activeTabId,
        siteScoped: options.siteScoped === true,
        globalOnly: options.globalOnly === true
      });
      pendingSettingsError = '';
      if (revision === settingsRevision) {
        settings = normalizeSettings(payload || snapshot);
        render();
        await pushSettingsToPage(settings);
        await refreshStatus();
      }
    } catch (error) {
      pendingSettingsError = t('settingsSaveFailed', undefined, 'Settings could not be saved');
      if (revision === settingsRevision) {
        render();
        setNotices([]);
      }
    } finally {
      pendingWriteCount = Math.max(0, pendingWriteCount - 1);
      if (revision === settingsRevision) {
        saving = false;
      }
    }
  };
  saveQueue = saveQueue.then(operation, operation);
  return saveQueue;
}

async function persistSettings(next, options = {}, revision = settingsRevision) {
  pendingWriteCount += 1;
  try {
    const payload = await message({
      type: 'WVB_SAVE_SETTINGS',
      settings: normalizeSettings(next),
      tabUrl: activeTabUrl,
      tabId: activeTabId,
      siteScoped: options.siteScoped === true,
      globalOnly: options.globalOnly === true
    });
    if (revision === settingsRevision) {
      pendingSettingsError = '';
      settings = normalizeSettings(payload || next);
      render();
    }
  } catch (_) {
    pendingSettingsError = t('settingsSaveFailed', undefined, 'Settings could not be saved');
    if (revision === settingsRevision) {
      render();
      setNotices([]);
    }
  } finally {
    pendingWriteCount = Math.max(0, pendingWriteCount - 1);
  }
}

async function syncExternalSettings() {
  if (strengthGestureActive || pendingWriteCount > 0) {
    return;
  }
  const revision = settingsRevision;
  const payload = await message({ type: 'WVB_GET_SETTINGS', tabUrl: activeTabUrl });
  if (revision !== settingsRevision || strengthGestureActive || pendingWriteCount > 0) {
    return;
  }
  settings = normalizeSettings(payload || settings || {});
  settingsRevision += 1;
  render();
  await pushSettingsToPage(settings);
}

async function syncUiPreferences() {
  currentUiPreferences = await readUiPreferences();
  applyTheme(currentUiPreferences.theme);
  await initializeI18n(currentUiPreferences.locale);
  applyI18n();
  renderThemeButton();
  await refreshStatus({ allowAutoCapture: false });
}

function handleStorageChanged(changes, areaName) {
  if (areaName !== 'sync') {
    return;
  }
  if (changes?.[UI_PREFERENCES_KEY]) {
    syncUiPreferences().catch(() => {});
  }
  if (strengthGestureActive || pendingWriteCount > 0) {
    return;
  }
  syncExternalSettings().catch(() => {});
}

function schedulePersistSettings(options = {}) {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => flushPersistSettings(options), 180);
}

function flushPersistSettings(options = {}) {
  window.clearTimeout(persistTimer);
  persistTimer = null;
  if (!settings) {
    return;
  }
  const snapshot = normalizeSettings(settings);
  const revision = settingsRevision;
  persistQueue = persistQueue
    .then(() => persistSettings(snapshot, options, revision))
    .catch(() => {});
}

async function pushSettingsToPage(next = settings) {
  if (!activeTabId) {
    await findActiveTab();
  }
  if (!activeTabId || !globalThis.chrome?.tabs?.sendMessage) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: 'WVB_APPLY_SETTINGS', settings: normalizeSettings(next) });
  } catch (_) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: 'WVB_REFRESH_SETTINGS' });
    } catch (_) {}
  }
}

async function reloadCurrentPage() {
  if (!activeTabId) {
    await findActiveTab();
  }
  if (!activeTabId) {
    return;
  }
  elements.reloadButton.disabled = true;
  elements.healthLabel.textContent = '正在强制刷新';
  try {
    const response = await message({ type: 'WVB_FORCE_RELOAD_TAB', tabId: activeTabId });
    if (response?.ok) {
      window.close();
      return;
    }
  } catch (_) {}
  try {
    await message({ type: 'WVB_CLEAR_TAB_STATE', tabId: activeTabId });
  } catch (_) {}
  if (globalThis.chrome?.tabs?.reload) {
    await chrome.tabs.reload(activeTabId, { bypassCache: true });
    window.close();
  } else {
    elements.reloadButton.disabled = false;
  }
}

async function setTabCapture(nextActive, status, reason) {
  const active = Boolean(status?.captureActive);
  if (active === nextActive) {
    return { ok: true, alreadyActive: active };
  }
  await message({
    type: 'WVB_CAPTURE_CLICK',
    tabId: activeTabId,
    tabUrl: activeTabUrl,
    action: nextActive ? 'start' : 'stop',
    reason
  }).catch(() => {});
  let streamId = '';
  let streamIdError = '';
  if (nextActive) {
    try {
      streamId = await getTabCaptureStreamId(activeTabId);
    } catch (error) {
      streamIdError = String(error?.message || error);
      await message({
        type: 'WVB_CAPTURE_ERROR',
        tabId: activeTabId,
        tabUrl: activeTabUrl,
        stage: 'popup-get-stream-id',
        error: streamIdError
      }).catch(() => {});
    }
  }
  return await message({
    type: nextActive ? 'WVB_START_TAB_CAPTURE' : 'WVB_STOP_TAB_CAPTURE',
    tabId: activeTabId,
    tabUrl: activeTabUrl,
    streamId,
    streamIdError
  });
}

async function toggleTabCapture() {
  if (!activeTabId) {
    await findActiveTab();
  }
  if (!activeTabId) {
    return;
  }
  elements.captureButton.disabled = true;
  try {
    const status = await message({ type: 'WVB_GET_STATUS', tabId: activeTabId, tabUrl: activeTabUrl, ensure: false });
    const active = Boolean(status?.captureActive);
    const response = await setTabCapture(!active, status, 'manual');
    if (!response?.ok) {
      renderStatus({ ...(status || {}), failedErrors: [response?.error || t('captureFailed', undefined, 'Tab audio connection failed')] });
      return;
    }
    await refreshStatus({ allowAutoCapture: false });
  } catch (error) {
    renderStatus({ failedErrors: [String(error?.message || error)] });
  } finally {
    elements.captureButton.disabled = false;
  }
}

function shouldAutoStartCapture(status) {
  if (autoCaptureAttempted || autoCaptureRunning) {
    return false;
  }
  if (settings?.enabled === false || !activeTabId || !/^https?:\/\//i.test(activeTabUrl)) {
    return false;
  }
  if (!status || status.unsupported || status.captureAvailable === false || status.captureActive) {
    return false;
  }
  if (String(status.captureState || '') === 'error' || status.captureError) {
    return false;
  }
  if (Boolean(status.playerMuted) || finiteNumber(status.playerVolumeCap, 1) <= 0) {
    return false;
  }
  return finiteNumber(status.mediaCount) > 0
    || finiteNumber(status.audibleCount) > 0
    || Boolean(status.tabAudibleHint)
    || Boolean(status.mediaTargetHint);
}

async function maybeAutoStartCapture(status) {
  if (!shouldAutoStartCapture(status)) {
    return false;
  }
  autoCaptureAttempted = true;
  autoCaptureRunning = true;
  elements.captureButton.disabled = true;
  try {
    const response = await setTabCapture(true, status, 'popup-open-auto');
    if (!response?.ok) {
      renderStatus({ ...(status || {}), failedErrors: [response?.error || t('captureFailed', undefined, 'Tab audio connection failed')] });
      return false;
    }
    await refreshStatus({ allowAutoCapture: false });
    return true;
  } catch (error) {
    renderStatus({ ...(status || {}), failedErrors: [String(error?.message || error)] });
    return false;
  } finally {
    autoCaptureRunning = false;
    elements.captureButton.disabled = false;
  }
}

function getTabCaptureStreamId(tabId) {
  return new Promise((resolve, reject) => {
    const api = globalThis.chrome?.tabCapture?.getMediaStreamId;
    if (!api) {
      reject(new Error('当前 Chrome 不支持整页音频接管'));
      return;
    }
    let settled = false;
    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const settleStreamId = (streamId) => {
      if (!streamId) {
        settle(reject, new Error(t('capturePermissionMissing', undefined, 'Chrome did not grant tab audio access')));
        return;
      }
      settle(resolve, streamId);
    };
    const timer = setTimeout(() => {
      settle(reject, new Error(t('capturePermissionTimeout', undefined, 'Tab audio access timed out')));
    }, CAPTURE_STREAM_ID_TIMEOUT_MS);
    const options = { targetTabId: tabId };
    try {
      const maybePromise = api.call(chrome.tabCapture, options);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(settleStreamId, (error) => {
          settle(reject, new Error(error?.message || String(error || t('captureFailed', undefined, 'Tab audio connection failed'))));
        });
        return;
      }
    } catch (_) {}

    try {
      api.call(chrome.tabCapture, options, (streamId) => {
        const error = chrome.runtime?.lastError;
        if (error || !streamId) {
          settle(reject, new Error(error?.message || t('capturePermissionMissing', undefined, 'Chrome did not grant tab audio access')));
          return;
        }
        settleStreamId(streamId);
      });
    } catch (error) {
      settle(reject, error);
    }
  });
}

function bind() {
  elements.enabled.addEventListener('change', () => {
    save({ ...settings, enabled: elements.enabled.checked }, { globalOnly: true });
  });

  elements.respectPlayerVolume.addEventListener('change', () => {
    save({ ...settings, respectPlayerVolume: elements.respectPlayerVolume.checked }, { globalOnly: true });
  });

  for (const dial of dialConfigs) {
    bindStrengthControl(dial);
  }

  elements.reloadButton.addEventListener('click', reloadCurrentPage);
  elements.captureButton.addEventListener('click', toggleTabCapture);
  elements.themeButton.addEventListener('click', () => toggleTheme().catch(() => {}));
  colorSchemeQuery?.addEventListener?.('change', () => {
    if (currentUiPreferences.theme === 'system') {
      renderThemeButton();
    }
  });
  elements.settingsButton.addEventListener('click', async () => {
    if (globalThis.chrome?.runtime?.openOptionsPage) {
      await chrome.runtime.openOptionsPage();
      return;
    }
    location.assign('../monitor/index.html');
  });

  globalThis.chrome?.storage?.onChanged?.addListener(handleStorageChanged);
}

async function findActiveTab() {
  if (Number.isInteger(e2eTabId) && e2eTabId > 0) {
    activeTabId = e2eTabId;
    activeTabUrl = e2eTabUrl;
    return;
  }
  if (!globalThis.chrome?.tabs?.query) {
    activeTabId = 1;
    activeTabUrl = 'https://example.test/watch';
    return;
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tabs[0]?.id || null;
    activeTabUrl = tabs[0]?.url || '';
  } catch (_) {
    activeTabId = null;
    activeTabUrl = '';
  }
}

async function refreshStatus(options = {}) {
  if (!activeTabId) {
    await findActiveTab();
  }
  if (!activeTabId) {
    renderStatus({ respondingFrames: 0, mediaCount: 0, processedCount: 0, audibleCount: 0, limitedCount: 0 });
    return;
  }
  try {
    let status = await message({
      type: 'WVB_GET_STATUS',
      tabId: activeTabId,
      tabUrl: activeTabUrl,
      ensure: false,
      refreshFrame: true
    });
    if (finiteNumber(status?.respondingFrames, 0) <= 0) {
      const ensured = await ensureObserverOnce();
      if (ensured?.status) {
        status = ensured.status || {};
      }
    }
    if (options.allowAutoCapture !== false && await maybeAutoStartCapture(status || {})) {
      return;
    }
    renderStatus(status || {});
  } catch (error) {
    renderStatus({
      injection: { error: String(error?.message || error) },
      failedErrors: [String(error?.message || error)]
    });
  }
}

async function ensureObserverOnce() {
  if (!activeTabId) {
    return null;
  }
  const now = Date.now();
  if (now - observerEnsuredAt < 3000) {
    return null;
  }
  observerEnsuredAt = now;
  return await message({
    type: 'WVB_ENSURE_OBSERVER',
    tabId: activeTabId,
    tabUrl: activeTabUrl
  });
}

function renderStatus(status) {
  const enabled = settings?.enabled !== false;
  const processed = finiteNumber(status.processedCount);
  const media = finiteNumber(status.mediaCount);
  const audible = finiteNumber(status.audibleCount);
  const active = finiteNumber(status.activeProcessorCount);
  const limited = finiteNumber(status.limitedCount);
  const autoplayBlocked = finiteNumber(status.autoplayBlockedCount);
  const analysisSilent = finiteNumber(status.analysisSilentCount);
  const frames = finiteNumber(status.respondingFrames);
  let reduction = percentValue(settings?.cutStrength) > 0 ? Math.max(0, finiteNumber(status.averageReductionDb)) : 0;
  let lift = percentValue(settings?.liftStrength) > 0 ? Math.max(0, finiteNumber(status.averageLiftDb)) : 0;
  const displayedEffect = displayEffectForStatus(status, reduction, lift);
  reduction = displayedEffect.kind === 'reduction' ? displayedEffect.amount : 0;
  lift = displayedEffect.kind === 'lift' ? displayedEffect.amount : 0;
  const averageInputDb = status.averageInputDb == null ? null : finiteNumber(status.averageInputDb);
  const captureActive = Boolean(status.captureActive);
  const captureAvailable = status.captureAvailable !== false;
  const captureState = String(status.captureState || '');
  const captureError = String(status.captureError || '');
  const playerMuted = Boolean(status.playerMuted) || finiteNumber(status.playerVolumeCap, 1) <= 0;
  const lastSignalAgeMs = status.lastSignalAgeMs == null ? null : finiteNumber(status.lastSignalAgeMs);
  const signalTicks = finiteNumber(status.signalTickCount);
  const hasFreshSignal = signalTicks > 0 && lastSignalAgeMs != null && lastSignalAgeMs < 2500;
  const failedErrors = Array.isArray(status.failedErrors) ? status.failedErrors.filter(Boolean) : [];
  const sourceAlreadyConnected = failedErrors.some((error) => /already connected previously|different MediaElementSourceNode/i.test(String(error)));
  const notices = [];

  setReadouts(status);
  setStrengthControlsEnabled(true);
  setReloadVisible(false);
  setCaptureVisible(false, captureActive);

  if (limited > 0) {
    notices.push({ tone: 'warning', text: `受限 ${Math.round(limited)}` });
  }
  if (failedErrors.length > 0) {
    notices.push({ tone: 'danger', text: '错误' });
  }

  if (!enabled) {
    setHeadline({ state: 'off', label: '关闭', title: '已暂停', sub: '原声通过' });
    setEffect({ value: '关闭', caption: '未处理', amount: 0 });
    setNotices(notices);
    elements.healthLabel.textContent = '点开关恢复';
    return;
  }

  if (status.unsupported) {
    setHeadline({ state: 'warning', label: '不可用', title: '不能接入', sub: '页面受限' });
    setEffect({ value: '--', caption: '受限', amount: 0 });
    setNotices([{ tone: 'warning', text: '浏览器限制' }, ...notices]);
    elements.healthLabel.textContent = '换普通网页';
    return;
  }

  if (captureState === 'error' || captureError) {
    setHeadline({ state: 'danger', label: '\u5931\u8d25', title: '\u6574\u9875\u63a5\u7ba1\u5931\u8d25', sub: 'Chrome \u6ca1\u6709\u63a5\u5230\u6807\u7b7e\u97f3\u9891' });
    setEffect({ value: '--', caption: '\u9519\u8bef', amount: 0 });
    setNotices([{ tone: 'danger', text: '\u63a5\u7ba1\u5931\u8d25' }, ...notices]);
    setCaptureVisible(captureAvailable, false);
    elements.healthLabel.textContent = captureError || '\u6ca1\u6709\u63a5\u5230\u6574\u9875\u97f3\u9891';
    return;
  }

  if (captureActive) {
    if (playerMuted) {
      setHeadline({ state: 'watching', label: '静音', title: '播放器静音', sub: '不会输出声音' });
      setEffect({ value: '0', caption: '音量', amount: 0 });
      setCaptureVisible(true, true);
      setNotices(notices);
      elements.healthLabel.textContent = '尊重播放器音量';
      return;
    }
    if (!hasFreshSignal) {
      setHeadline({ state: 'watching', label: '整页', title: '等待波形', sub: '已连接，未检测到声音' });
      setEffect({ value: '--', caption: '无输入', amount: 0 });
      setCaptureVisible(true, true);
      setNotices(notices);
      elements.healthLabel.textContent = '等待当前视频发声';
      return;
    }
    if (audible > 0 && displayedEffect.kind === 'lift') {
      setHeadline({ state: 'working', label: '\u6574\u9875', title: '\u63d0\u5347\u4e2d', sub: `${countText(audible)} \u4e2a\u58f0\u97f3` });
      setEffect({ value: `+${displayedEffect.amount.toFixed(1)}`, caption: 'dB', amount: displayedEffect.amount });
    } else if (audible > 0 && displayedEffect.kind === 'reduction') {
      setHeadline({ state: 'working', label: '\u6574\u9875', title: '\u538b\u4f4e\u4e2d', sub: `${countText(audible)} \u4e2a\u58f0\u97f3` });
      setEffect({ value: `-${displayedEffect.amount.toFixed(1)}`, caption: 'dB', amount: displayedEffect.amount });
    } else {
      setHeadline({ state: 'working', label: '\u6574\u9875', title: '\u5df2\u63a5\u7ba1', sub: averageInputDb == null ? '\u5904\u7406\u6807\u7b7e\u97f3\u9891' : `\u8f93\u5165 ${averageInputDb.toFixed(1)} dB` });
      setEffect({ value: '0', caption: 'dB', amount: 0.2 });
    }
    setCaptureVisible(true, true);
    setNotices(notices);
    elements.healthLabel.textContent = '\u6574\u9875\u97f3\u9891\u94fe\u8def\u4e2d';
    return;
  }

  if (sourceAlreadyConnected || status.needsPageReload) {
    setHeadline({ state: 'warning', label: '受限', title: active > 0 ? '已接管' : '当前元素受限', sub: active > 0 ? `${countText(active)} 个声音` : '刷新页面或等新元素' });
    setEffect({ value: active > 0 ? '旧核' : '--', caption: active > 0 ? '运行' : '受限', amount: active > 0 ? 1.2 : 0 });
    setNotices([{ tone: 'warning', text: '旧连接' }, ...notices]);
    setReloadVisible(true);
    elements.healthLabel.textContent = '当前 video 已被占用';
    return;
  }

  if (status.staleEngine) {
    if (status.extensionReloadRequired || status.mixedRuntime) {
      setHeadline({ state: 'warning', label: '\u9700\u5237\u65b0', title: '\u6269\u5c55\u7248\u672c\u6df7\u7528', sub: '\u5237\u65b0\u6269\u5c55\uff0c\u4e0d\u8981\u5237\u65b0\u89c6\u9891\u9875' });
      setEffect({ value: '--', caption: '\u5f85\u5237\u65b0', amount: 0 });
      setNotices([{ tone: 'warning', text: '\u6269\u5c55\u65e7\u540e\u53f0' }, ...notices]);
      setCaptureVisible(captureAvailable, captureActive);
      setReloadVisible(false);
      elements.healthLabel.textContent = 'chrome://extensions \u91cc\u70b9\u8fd9\u4e2a\u6269\u5c55\u7684\u5237\u65b0';
      return;
    }
    setHeadline({ state: 'warning', label: '旧内核', title: active > 0 ? '降级运行' : '等待接管', sub: active > 0 ? `${countText(active)} 个声音` : '不刷新当前页' });
    setEffect({ value: active > 0 ? '旧核' : '--', caption: active > 0 ? '运行' : '待机', amount: active > 0 ? 1.2 : 0 });
    setNotices([{ tone: 'warning', text: '旧版本' }, ...notices]);
    setCaptureVisible(captureAvailable, captureActive);
    setReloadVisible(false);
    elements.healthLabel.textContent = '不会自动刷新';
    return;
  }

  if (failedErrors.length > 0 && processed === 0) {
    setHeadline({ state: 'danger', label: '失败', title: '未接管', sub: '音频被占用' });
    setEffect({ value: '--', caption: '错误', amount: 0 });
    setNotices(notices);
    setReloadVisible(false);
    elements.healthLabel.textContent = failedErrors[0];
    return;
  }

  if (audible > 0 && active === 0 && autoplayBlocked > 0) {
    setHeadline({ state: 'warning', label: '待操作', title: '未接管', sub: '点一下页面' });
    setEffect({ value: '--', caption: '待接管', amount: 0 });
    setNotices([{ tone: 'warning', text: '浏览器限制' }, ...notices]);
    elements.healthLabel.textContent = '页面点击后接管';
    return;
  }

  if (audible > 0 && active === 0) {
    setHeadline({ state: 'warning', label: '未接入', title: '当前声音未接入', sub: `${countText(audible)} 个声音` });
    setEffect({ value: '--', caption: '未接入', amount: 0 });
    setNotices(notices.length > 0 ? notices : [{ tone: 'warning', text: processed > 0 ? '切换中' : '等待接管' }]);
    setCaptureVisible(captureAvailable, false);
    elements.healthLabel.textContent = processed > 0 ? '已接管的不是当前声音' : '未进入音频链路';
    return;
  }

  if (autoplayBlocked > 0 && processed === 0) {
    setHeadline({ state: 'warning', label: '等待', title: '先播放', sub: '需要页面操作' });
    setEffect({ value: '--', caption: '等待', amount: 0 });
    setNotices([{ tone: 'warning', text: '自动播放' }, ...notices]);
    elements.healthLabel.textContent = '点播放后接管';
    return;
  }

  if (active > 0 || processed > 0) {
    if (captureActive) {
      if (audible > 0 && reduction > 0.15) {
        setHeadline({ state: 'working', label: '整页', title: '压低中', sub: `${countText(audible)} 个声音` });
        setEffect({ value: `-${reduction.toFixed(1)}`, caption: 'dB', amount: reduction });
      } else if (audible > 0 && lift > 0.15) {
        setHeadline({ state: 'working', label: '整页', title: '提升中', sub: `${countText(audible)} 个声音` });
        setEffect({ value: `+${lift.toFixed(1)}`, caption: 'dB', amount: lift });
      } else {
        setHeadline({ state: 'working', label: '整页', title: '已接管', sub: averageInputDb == null ? '处理标签音频' : `输入 ${averageInputDb.toFixed(1)} dB` });
        setEffect({ value: '0', caption: 'dB', amount: 0.2 });
      }
      setCaptureVisible(true, true);
      setNotices(notices);
      elements.healthLabel.textContent = '整页音频链路中';
      return;
    }
    if (audible > 0 && active > 0 && analysisSilent >= active && reduction <= 0.15 && lift <= 0.15) {
      setHeadline({ state: 'warning', label: '未处理', title: '无波形', sub: `${countText(audible)} 个声音` });
      setEffect({ value: '--', caption: '无输入', amount: 0 });
      setNotices(notices.length > 0 ? notices : [{ tone: 'warning', text: '普通接管无输入' }, { tone: 'warning', text: '可用整页接管' }]);
      setCaptureVisible(captureAvailable, false);
      elements.healthLabel.textContent = '普通链路读不到波形';
      return;
    }
    if (audible > 0 && reduction > 0.15) {
      setHeadline({ state: 'working', label: '生效中', title: '压低中', sub: `${countText(audible)} 个声音` });
      setEffect({ value: `-${reduction.toFixed(1)}`, caption: 'dB', amount: reduction });
    } else if (audible > 0 && lift > 0.15) {
      setHeadline({ state: 'working', label: '生效中', title: '提升中', sub: `${countText(audible)} 个声音` });
      setEffect({ value: `+${lift.toFixed(1)}`, caption: 'dB', amount: lift });
    } else if (audible > 0) {
      setHeadline({ state: 'working', label: '已接管', title: '未调整', sub: averageInputDb == null ? `${countText(audible)} 个声音` : `输入 ${averageInputDb.toFixed(1)} dB` });
      setEffect({ value: '0', caption: 'dB', amount: 0.2 });
    } else {
      setHeadline({ state: 'watching', label: '已接管', title: '待声音', sub: `${countText(processed)} 个音源` });
      setEffect({ value: '--', caption: '静音', amount: 0 });
    }
    setNotices(notices);
    elements.healthLabel.textContent = audible > 0 ? '未超过当前处理阈值' : '等待播放';
    return;
  }

  if (media > 0) {
    setHeadline({ state: 'watching', label: '待播放', title: '检测到媒体', sub: `${countText(media)} 个媒体` });
    setEffect({ value: '--', caption: '未发声', amount: 0 });
    setCaptureVisible(captureAvailable, false);
    setNotices(notices);
    elements.healthLabel.textContent = '可先整页接管';
    return;
  }

  if (status.injection?.error && !status.injection?.skipped) {
    setHeadline({ state: 'danger', label: '失败', title: '拒绝接入', sub: '脚本受限' });
    setEffect({ value: '--', caption: '错误', amount: 0 });
    setNotices([{ tone: 'danger', text: '接入失败' }, ...notices]);
    elements.healthLabel.textContent = status.injection.error;
    return;
  }

  setHeadline({
    state: frames > 0 ? 'watching' : 'warning',
    label: frames > 0 ? '监听中' : '未接入',
    title: frames > 0 ? '无声音' : '页面未回传',
    sub: frames > 0 ? '打开音频' : '可尝试整页接管'
  });
  setEffect({ value: '--', caption: '待机', amount: 0 });
  setCaptureVisible(captureAvailable, false);
  setNotices(notices);
  elements.healthLabel.textContent = frames > 0 ? '等待声音' : '等待页面回传';
}

function renderCompactStatus(status) {
  const enabled = settings?.enabled !== false;
  const processed = finiteNumber(status.processedCount);
  const media = finiteNumber(status.mediaCount);
  const audible = finiteNumber(status.audibleCount);
  const active = finiteNumber(status.activeProcessorCount);
  const frames = finiteNumber(status.respondingFrames);
  const captureActive = Boolean(status.captureActive);
  const captureAvailable = status.captureAvailable !== false;
  const failedErrors = Array.isArray(status.failedErrors) ? status.failedErrors.filter(Boolean) : [];
  const needsReload = Boolean(status.needsPageReload) || failedErrors.some((error) => /already connected previously|different MediaElementSourceNode/i.test(String(error)));
  const playerMuted = Boolean(status.playerMuted) || finiteNumber(status.playerVolumeCap, 1) <= 0;
  const signalAge = status.lastSignalAgeMs == null ? null : finiteNumber(status.lastSignalAgeMs);
  const hasFreshSignal = finiteNumber(status.signalTickCount) > 0 && signalAge != null && signalAge < 2500;

  setReadouts(status);
  setStrengthControlsEnabled(true);
  setReloadVisible(false);
  setCaptureVisible(false, captureActive);
  setNotices([]);

  if (!enabled) {
    setHeadline({ state: 'off', label: t('statusOff', undefined, 'Off'), title: t('statusPaused', undefined, 'Balancing paused'), sub: t('statusOriginalAudio', undefined, 'Original audio passes through') });
    setEffect({ value: '--', caption: 'dB', amount: 0 });
    return;
  }
  if (status.unsupported) {
    setHeadline({ state: 'warning', label: t('statusUnavailable', undefined, 'Unavailable'), title: t('statusRestrictedPage', undefined, 'Restricted page'), sub: t('statusRestrictedPageHelp', undefined, 'Chrome does not allow audio access here') });
    setEffect({ value: '--', caption: 'dB', amount: 0 });
    return;
  }
  if (String(status.captureState || '') === 'error' || status.captureError) {
    setHeadline({ state: 'danger', label: t('statusError', undefined, 'Error'), title: t('captureFailed', undefined, 'Tab audio connection failed'), sub: t('captureRecoveryHelp', undefined, 'Reconnect to try again') });
    setEffect({ value: '--', caption: 'dB', amount: 0 });
    setCaptureVisible(captureAvailable, false);
    return;
  }
  if (captureActive && playerMuted) {
    setHeadline({ state: 'watching', label: t('statusMuted', undefined, 'Muted'), title: t('statusPlayerMuted', undefined, 'Player is muted'), sub: t('statusNoAudioOutput', undefined, 'No audio is being output') });
    setEffect({ value: '0', caption: 'dB', amount: 0 });
    return;
  }
  if (captureActive && !hasFreshSignal) {
    setHeadline({ state: 'watching', label: t('statusConnected', undefined, 'Connected'), title: t('statusWaitingForAudio', undefined, 'Waiting for audio'), sub: t('statusNoSignalConfirmed', undefined, 'Connected, but no signal is detected') });
    setEffect({ value: '--', caption: 'dB', amount: 0 });
    return;
  }
  if (captureActive && hasFreshSignal && percentValue(settings?.cutStrength) <= 0 && percentValue(settings?.liftStrength) <= 0) {
    setHeadline({
      state: 'watching',
      label: t('statusConnected', undefined, 'Connected'),
      title: t('statusOriginalAudio', undefined, 'Original audio passes through'),
      sub: t('statusPaused', undefined, 'Balancing paused')
    });
    setEffect({ value: '0', caption: 'dB', amount: 0 });
    return;
  }
  if (captureActive || (active > 0 && processed > 0 && audible > 0)) {
    const reduction = percentValue(settings?.cutStrength) > 0 ? Math.max(0, finiteNumber(status.averageReductionDb)) : 0;
    const lift = percentValue(settings?.liftStrength) > 0 ? Math.max(0, finiteNumber(status.averageLiftDb)) : 0;
    const effect = displayEffectForStatus(status, reduction, lift);
    const titleKey = effect.kind === 'lift' ? 'statusLifting' : effect.kind === 'reduction' ? 'statusReducing' : 'statusBalancing';
    const titleFallback = effect.kind === 'lift' ? 'Lifting quiet audio' : effect.kind === 'reduction' ? 'Reducing loud audio' : 'Balancing audio';
    const value = effect.kind === 'lift' ? `+${effect.amount.toFixed(1)}` : effect.kind === 'reduction' ? `-${effect.amount.toFixed(1)}` : '0';
    setHeadline({ state: 'working', label: t('statusActive', undefined, 'Active'), title: t(titleKey, undefined, titleFallback), sub: t('statusSignalConfirmed', undefined, 'Live audio signal confirmed') });
    setEffect({ value, caption: 'dB', amount: effect.amount });
    return;
  }
  if (needsReload) {
    setHeadline({ state: 'warning', label: t('statusActionRequired', undefined, 'Action required'), title: t('statusReconnectRequired', undefined, 'Audio connection needs recovery'), sub: t('statusReloadHelp', undefined, 'Reload this page to reconnect') });
    setEffect({ value: '--', caption: 'dB', amount: 0 });
    setReloadVisible(true);
    return;
  }
  if (status.staleEngine || (failedErrors.length > 0 && processed === 0) || (audible > 0 && active === 0)) {
    setHeadline({ state: 'warning', label: t('statusActionRequired', undefined, 'Action required'), title: t('statusNotConnected', undefined, 'Audio is not connected'), sub: t('captureRecoveryHelp', undefined, 'Reconnect to try again') });
    setEffect({ value: '--', caption: 'dB', amount: 0 });
    setCaptureVisible(captureAvailable, false);
    return;
  }
  setHeadline({ state: 'watching', label: t('statusReady', undefined, 'Ready'), title: media > 0 ? t('statusMediaDetected', undefined, 'Media detected') : t('statusWaitingForMedia', undefined, 'Waiting for media'), sub: frames > 0 ? t('statusPlayToBegin', undefined, 'Play audio to begin balancing') : t('statusCheckingConnection', undefined, 'Checking the page connection') });
  setEffect({ value: '--', caption: 'dB', amount: 0 });
}

renderStatus = renderCompactStatus;
bind();
window.addEventListener('pagehide', () => {
  strengthGestureActive = false;
  flushPersistSettings({ siteScoped: true });
  globalThis.chrome?.storage?.onChanged?.removeListener(handleStorageChanged);
}, { once: true });
load().catch((error) => {
  setHeadline({ state: 'danger', label: t('statusError', undefined, 'Error'), title: t('statusLoadFailed', undefined, 'Could not load status'), sub: t('statusReopenPopup', undefined, 'Close and reopen the popup') });
  setEffect({ value: '--', caption: 'dB', amount: 0 });
  setNotices([]);
  elements.healthLabel.textContent = String(error?.message || error);
});
