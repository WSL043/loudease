const els = {
  version: document.getElementById('version'),
  tabCount: document.getElementById('tabCount'),
  sourceCount: document.getElementById('sourceCount'),
  updatedAt: document.getElementById('updatedAt'),
  health: document.getElementById('health'),
  settingsHealth: document.getElementById('settingsHealth'),
  tabs: document.getElementById('tabs'),
  events: document.getElementById('events'),
  refreshNow: document.getElementById('refreshNow'),
  shareFeedback: document.getElementById('shareFeedback'),
  shareReport: document.getElementById('shareReport'),
  copyJson: document.getElementById('copyJson'),
  downloadJson: document.getElementById('downloadJson'),
  reportJson: document.getElementById('reportJson'),
  reloadExtension: document.getElementById('reloadExtension'),
  languageSelect: document.getElementById('languageSelect'),
  themeSelect: document.getElementById('themeSelect'),
  globalEnabled: document.getElementById('globalEnabled'),
  globalRespect: document.getElementById('globalRespect'),
  globalCut: document.getElementById('globalCut'),
  globalLift: document.getElementById('globalLift'),
  globalCutValue: document.getElementById('globalCutValue'),
  globalLiftValue: document.getElementById('globalLiftValue'),
  /* WVB_DEV_DIAGNOSTICS_START */
  localDiagnostics: document.getElementById('localDiagnostics'),
  /* WVB_DEV_DIAGNOSTICS_END */
  resetSettings: document.getElementById('resetSettings'),
  siteForm: document.getElementById('siteForm'),
  siteKey: document.getElementById('siteKey'),
  siteCut: document.getElementById('siteCut'),
  siteLift: document.getElementById('siteLift'),
  siteCutValue: document.getElementById('siteCutValue'),
  siteLiftValue: document.getElementById('siteLiftValue'),
  deleteSite: document.getElementById('deleteSite'),
  siteList: document.getElementById('siteList')
};

const { get: t, apply: applyI18n, initialize: initializeI18n } = globalThis.WebVolumeBalancerI18n;
const uiPreferences = globalThis.WebVolumeBalancerUiPreferences;
const LANGUAGE_OPTIONS = [
  ['en', 'English'], ['zh_CN', '简体中文'], ['zh_TW', '繁體中文'], ['ja', '日本語'], ['ko', '한국어'],
  ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['pt_BR', 'Português (Brasil)'], ['ru', 'Русский'], ['ar', 'العربية']
];

let lastSnapshot = null;
let lastOptionsState = null;
let currentUiPreferences = { ...uiPreferences.DEFAULTS };
let activeView = 'general';
let globalSaveTimer = null;
let globalSaveRevision = 0;
let diagnosticsRequestRevision = 0;
let previewState = {
  version: 'preview',
  settings: { enabled: true, respectPlayerVolume: true, preset: 'custom', cutStrength: 100, liftStrength: 100 },
  siteSettings: {},
  /* WVB_DEV_DIAGNOSTICS_START */
  localDiagnosticsEnabled: false
  /* WVB_DEV_DIAGNOSTICS_END */
};

function extensionMessage(payload) {
  if (globalThis.chrome?.runtime?.sendMessage) {
    return chrome.runtime.sendMessage(payload);
  }
  if (payload?.type === 'WVB_GET_DIAGNOSTICS') {
    return Promise.resolve({ version: 'preview', now: Date.now(), tabs: [], events: [] });
  }
  if (payload?.type === 'WVB_GET_OPTIONS_STATE') {
    return Promise.resolve(structuredClone(previewState));
  }
  if (payload?.type === 'WVB_SAVE_SETTINGS') {
    previewState.settings = { ...previewState.settings, ...(payload.settings || {}), preset: 'custom' };
    return Promise.resolve({ ...previewState.settings });
  }
  if (payload?.type === 'WVB_SAVE_SITE_SETTINGS') {
    const key = normalizeSiteKey(payload.siteKey);
    if (!key) return Promise.resolve({ ok: false, error: 'invalid site key' });
    previewState.siteSettings[key] = { ...(payload.settings || {}), preset: 'custom' };
    return Promise.resolve({ ok: true, state: structuredClone(previewState) });
  }
  if (payload?.type === 'WVB_DELETE_SITE_SETTINGS') {
    delete previewState.siteSettings[normalizeSiteKey(payload.siteKey)];
    return Promise.resolve({ ok: true, state: structuredClone(previewState) });
  }
  if (payload?.type === 'WVB_RESET_SETTINGS') {
    previewState.settings = { enabled: true, respectPlayerVolume: true, preset: 'standard', cutStrength: 100, liftStrength: 100 };
    previewState.siteSettings = {};
    return Promise.resolve({ ok: true, state: structuredClone(previewState) });
  }
  /* WVB_DEV_DIAGNOSTICS_START */
  if (payload?.type === 'WVB_SET_LOCAL_DIAGNOSTICS') {
    previewState.localDiagnosticsEnabled = payload.enabled === true;
    return Promise.resolve({ ok: true, state: structuredClone(previewState) });
  }
  /* WVB_DEV_DIAGNOSTICS_END */
  return Promise.resolve({ ok: true });
}

function fmtDb(value, sign = false) {
  const next = Number(value) || 0;
  if (Math.abs(next) < 0.05) return '0 dB';
  return `${sign && next > 0 ? '+' : ''}${next.toFixed(1)} dB`;
}

function fmtAge(ms) {
  if (!Number.isFinite(ms)) return '--';
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function clampPercent(value, fallback = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function normalizeSiteKey(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function setRange(input, output, value) {
  const next = clampPercent(value);
  input.value = String(next);
  input.style.setProperty('--value', `${next}%`);
  output.textContent = String(next);
}

function bindRange(input, output, onChange) {
  input.addEventListener('input', () => {
    setRange(input, output, input.value);
    onChange?.();
  });
  input.addEventListener('change', () => onChange?.({ flush: true }));
}

function installPreferenceOptions() {
  els.languageSelect.replaceChildren(...LANGUAGE_OPTIONS.map(([value, label]) => new Option(label, value)));
  els.themeSelect.replaceChildren(
    new Option(t('themeSystem', undefined, 'System'), 'system'),
    new Option(t('themeLight', undefined, 'Light'), 'light'),
    new Option(t('themeDark', undefined, 'Dark'), 'dark')
  );
  els.languageSelect.value = currentUiPreferences.locale;
  els.themeSelect.value = currentUiPreferences.theme;
}

async function applyUiPreferences(next) {
  currentUiPreferences = uiPreferences.normalize(next);
  uiPreferences.applyTheme(currentUiPreferences.theme);
  await initializeI18n(currentUiPreferences.locale);
  applyI18n();
  installPreferenceOptions();
  renderOptionsState(lastOptionsState || previewState, { preserveEditor: true });
  if (lastSnapshot) renderDiagnostics(lastSnapshot);
}

function switchView(name) {
  activeView = ['general', 'sites', 'diagnostics'].includes(name) ? name : 'general';
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('isActive', button.dataset.view === activeView));
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    const selected = panel.dataset.viewPanel === activeView;
    panel.hidden = !selected;
    panel.classList.toggle('isActive', selected);
  });
  if (activeView === 'diagnostics') loadDiagnostics().catch(reportDiagnosticsError);
}

function tabBadge(tab) {
  if (tab.staleEngine) return `<span class="badge warn">${t('statusNeedsRefresh', undefined, 'Needs refresh')}</span>`;
  if (tab.captureDspLive === true || (Number(tab.activeProcessorCount) || 0) > 0) return `<span class="badge">${t('statusPlaying', undefined, 'Playing')}</span>`;
  if (tab.captureConnected === true) return `<span class="badge">${t('statusCaptured', undefined, 'Connected')}</span>`;
  if ((Number(tab.captureActive) || 0) > 0 || tab.capture?.active) return `<span class="badge warn">${t('statusConnecting', undefined, 'Connecting')}</span>`;
  return `<span class="badge off">${t('statusIdle', undefined, 'Idle')}</span>`;
}

function renderFrames(frames = []) {
  if (!frames.length) return `<div class="empty compact">${t('noPageStatus', undefined, 'No page status received yet.')}</div>`;
  return frames.map((frame) => `
    <div class="frame">
      <div class="frameHeader"><strong>${t('frameLabel', undefined, 'Frame')} ${escapeHtml(frame.frameId)}</strong><span class="muted">${fmtAge(frame.ageMs)}</span></div>
      <p class="muted"><code>${escapeHtml(frame.href || frame.url || '--')}</code></p>
      <div class="metrics">
        <div class="metric"><span>${t('versionLabel', undefined, 'Runtime')}</span><strong>${escapeHtml(frame.engineVersion || '--')}</strong></div>
        <div class="metric"><span>${t('mediaLabel', undefined, 'Media')}</span><strong>${frame.processedCount}/${frame.mediaCount}</strong></div>
        <div class="metric"><span>${t('reductionLabel', undefined, 'Reduction')}</span><strong>${fmtDb(frame.averageReductionDb)}</strong></div>
      </div>
    </div>`).join('');
}

function renderTabs(tabs = []) {
  if (!tabs.length) {
    els.tabs.innerHTML = `<div class="empty">${t('noPageStatus', undefined, 'No page status received yet.')}</div>`;
    return;
  }
  els.tabs.innerHTML = tabs.map((tab) => `
    <article class="tabCard">
      <div class="tabTop"><strong>${t('tabLabel', undefined, 'Tab')} ${escapeHtml(tab.tabId)}</strong>${tabBadge(tab)}</div>
      <p class="muted"><code>${escapeHtml(tab.url || tab.capture?.tabUrl || '--')}</code></p>
      <div class="metrics">
        <div class="metric"><span>${t('mediaLabel', undefined, 'Media')}</span><strong>${tab.processedCount}/${tab.mediaCount}</strong></div>
        <div class="metric"><span>${t('reductionLabel', undefined, 'Reduction')}</span><strong>${fmtDb(tab.averageReductionDb)}</strong></div>
        <div class="metric"><span>${t('liftLabel', undefined, 'Lift')}</span><strong>${fmtDb(tab.averageLiftDb, true)}</strong></div>
      </div>
      <div class="frames">${renderFrames(tab.frames)}</div>
    </article>`).join('');
}

function renderEvents(events = []) {
  if (!events.length) {
    els.events.innerHTML = `<div class="empty">${t('noEvents', undefined, 'No background events')}</div>`;
    return;
  }
  els.events.innerHTML = events.slice(0, 40).map((event) => `
    <article class="event"><div class="eventHeader"><strong>${escapeHtml(event.type)}</strong><span class="muted">${new Date(event.at).toLocaleTimeString()}</span></div><pre>${escapeHtml(JSON.stringify(event.detail || {}, null, 2))}</pre></article>`).join('');
}

function fillSiteForm(siteKey = '', settings = {}) {
  els.siteKey.value = siteKey;
  setRange(els.siteCut, els.siteCutValue, settings.cutStrength);
  setRange(els.siteLift, els.siteLiftValue, settings.liftStrength);
}

function renderSiteList(siteSettings = {}) {
  const entries = Object.entries(siteSettings).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) {
    els.siteList.innerHTML = `<div class="empty compact">${t('noSiteDefaults', undefined, 'No site rules yet.')}</div>`;
    return;
  }
  els.siteList.innerHTML = entries.map(([siteKey, settings]) => `
    <button class="siteRow" type="button" data-site="${escapeHtml(siteKey)}"><strong>${escapeHtml(siteKey)}</strong><span>${t('reductionLabel', undefined, 'Reduction')} ${clampPercent(settings.cutStrength)}</span><span>${t('liftLabel', undefined, 'Lift')} ${clampPercent(settings.liftStrength)}</span></button>`).join('');
}

function renderOptionsState(state, options = {}) {
  lastOptionsState = state || {};
  const settings = lastOptionsState.settings || {};
  const sites = lastOptionsState.siteSettings || {};
  els.version.textContent = `v${lastOptionsState.version || '--'}`;
  els.globalEnabled.checked = settings.enabled !== false;
  els.globalRespect.checked = settings.respectPlayerVolume !== false;
  setRange(els.globalCut, els.globalCutValue, settings.cutStrength);
  setRange(els.globalLift, els.globalLiftValue, settings.liftStrength);
  /* WVB_DEV_DIAGNOSTICS_START */
  els.localDiagnostics.checked = lastOptionsState.localDiagnosticsEnabled === true;
  /* WVB_DEV_DIAGNOSTICS_END */
  renderSiteList(sites);
  if (!options.preserveEditor && !els.siteKey.value) fillSiteForm('', settings);
  els.settingsHealth.textContent = t('settingsSummary', [String(lastOptionsState.version || '--'), String(Object.keys(sites).length)], `v${lastOptionsState.version || '--'}, ${Object.keys(sites).length} sites`);
}

async function loadOptionsState() {
  renderOptionsState(await extensionMessage({ type: 'WVB_GET_OPTIONS_STATE' }));
}

function readGlobalSettings() {
  return {
    enabled: els.globalEnabled.checked,
    respectPlayerVolume: els.globalRespect.checked,
    preset: 'custom',
    cutStrength: clampPercent(els.globalCut.value),
    liftStrength: clampPercent(els.globalLift.value)
  };
}

function scheduleGlobalSave({ flush = false } = {}) {
  clearTimeout(globalSaveTimer);
  const revision = ++globalSaveRevision;
  const save = async () => {
    els.settingsHealth.textContent = t('saving', undefined, 'Saving');
    const settings = readGlobalSettings();
    const response = await extensionMessage({ type: 'WVB_SAVE_SETTINGS', settings });
    if (revision !== globalSaveRevision) return;
    lastOptionsState = { ...(lastOptionsState || {}), settings: response || settings };
    renderOptionsState(lastOptionsState, { preserveEditor: true });
    els.settingsHealth.textContent = t('saved', undefined, 'Saved');
  };
  globalSaveTimer = flush ? null : setTimeout(() => save().catch(reportSettingsError), 180);
  if (flush) save().catch(reportSettingsError);
}

async function saveSiteSettings(event) {
  event.preventDefault();
  els.settingsHealth.textContent = t('saving', undefined, 'Saving');
  const response = await extensionMessage({
    type: 'WVB_SAVE_SITE_SETTINGS',
    siteKey: els.siteKey.value,
    settings: { preset: 'custom', cutStrength: clampPercent(els.siteCut.value), liftStrength: clampPercent(els.siteLift.value) }
  });
  if (response?.ok === false) throw new Error(response.error || t('statusError', undefined, 'Error'));
  renderOptionsState(response.state || await extensionMessage({ type: 'WVB_GET_OPTIONS_STATE' }), { preserveEditor: true });
  els.settingsHealth.textContent = t('saved', undefined, 'Saved');
}

async function deleteSiteSettings() {
  const siteKey = els.siteKey.value.trim();
  if (!siteKey) {
    els.settingsHealth.textContent = t('selectSiteFirst', undefined, 'Select a site first');
    return;
  }
  const response = await extensionMessage({ type: 'WVB_DELETE_SITE_SETTINGS', siteKey });
  if (response?.ok === false) throw new Error(response.error || t('statusError', undefined, 'Error'));
  fillSiteForm('', response.state?.settings || lastOptionsState?.settings || {});
  renderOptionsState(response.state || await extensionMessage({ type: 'WVB_GET_OPTIONS_STATE' }));
  els.settingsHealth.textContent = t('deleted', undefined, 'Deleted');
}

async function resetSettings() {
  if (!confirm(t('confirmReset', undefined, 'Reset all global settings and site defaults?'))) return;
  els.settingsHealth.textContent = t('resetting', undefined, 'Resetting');
  const response = await extensionMessage({ type: 'WVB_RESET_SETTINGS' });
  if (response?.ok === false) throw new Error(response.error || t('statusError', undefined, 'Error'));
  fillSiteForm('', response.state?.settings || {});
  renderOptionsState(response.state || await extensionMessage({ type: 'WVB_GET_OPTIONS_STATE' }));
  els.settingsHealth.textContent = t('resetDone', undefined, 'Reset complete');
}

/* WVB_DEV_DIAGNOSTICS_START */
async function toggleLocalDiagnostics() {
  const response = await extensionMessage({ type: 'WVB_SET_LOCAL_DIAGNOSTICS', enabled: els.localDiagnostics.checked });
  if (response?.ok === false) throw new Error(response.error || t('statusError', undefined, 'Error'));
  renderOptionsState(response.state || await extensionMessage({ type: 'WVB_GET_OPTIONS_STATE' }), { preserveEditor: true });
}
/* WVB_DEV_DIAGNOSTICS_END */

function renderDiagnostics(snapshot) {
  lastSnapshot = snapshot;
  const tabs = snapshot.tabs || [];
  els.tabCount.textContent = String(tabs.length);
  els.sourceCount.textContent = String(tabs.reduce((sum, tab) => sum + (tab.captureConnected === true || Number(tab.activeProcessorCount) > 0 ? 1 : 0), 0));
  els.updatedAt.textContent = new Date(snapshot.now || Date.now()).toLocaleTimeString();
  els.health.textContent = tabs.some((tab) => tab.staleEngine) ? t('staleEngineFound', undefined, 'Outdated runtime found') : t('liveRefresh', undefined, 'Refreshing live');
  els.reportJson.textContent = JSON.stringify(supportReport(snapshot), null, 2);
  renderTabs(tabs);
  renderEvents(snapshot.events || []);
}

function supportReport(snapshot = {}) {
  const sanitizeError = (value) => String(value || '')
    .replace(/https?:\/\/\S+/gi, '[url removed]')
    .replace(/[a-z]:\\[^\s]+/gi, '[path removed]')
    .slice(0, 500);
  const tabs = snapshot.tabs || [];
  const eventCounts = {};
  const recentErrors = [];
  for (const event of snapshot.events || []) {
    const type = String(event.type || 'unknown');
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    const error = sanitizeError(event.detail?.error || event.detail?.message || '');
    if (error && !recentErrors.includes(error)) recentErrors.push(error);
  }
  return {
    schemaVersion: 1,
    reportScope: 'manual-support-snapshot',
    product: 'LoudEase',
    version: String(snapshot.version || lastOptionsState?.version || '--'),
    generatedAt: new Date(snapshot.now || Date.now()).toISOString(),
    settings: {
      enabled: lastOptionsState?.settings?.enabled !== false,
      respectPlayerVolume: lastOptionsState?.settings?.respectPlayerVolume !== false,
      cutStrength: clampPercent(lastOptionsState?.settings?.cutStrength),
      liftStrength: clampPercent(lastOptionsState?.settings?.liftStrength)
    },
    summary: {
      sessions: tabs.length,
      connectedSources: tabs.reduce((sum, tab) => sum + (tab.captureConnected === true || Number(tab.activeProcessorCount) > 0 ? 1 : 0), 0),
      mediaElements: tabs.reduce((sum, tab) => sum + (Number(tab.mediaCount) || 0), 0),
      processedElements: tabs.reduce((sum, tab) => sum + (Number(tab.processedCount) || 0), 0)
    },
    sessions: tabs.map((tab) => ({
      mediaCount: Number(tab.mediaCount) || 0,
      processedCount: Number(tab.processedCount) || 0,
      captureActive: Boolean(tab.captureActive || tab.capture?.active),
      captureConnected: tab.captureConnected === true,
      dspLive: tab.captureDspLive === true,
      startupGateOpen: tab.startupGateOpen === true,
      captureState: String(tab.captureState || tab.capture?.state || ''),
      captureContextState: String(tab.captureContextState || ''),
      captureAudioTrackCount: Number(tab.captureAudioTrackCount) || 0,
      audibleCount: Number(tab.audibleCount) || 0,
      signalTickCount: Number(tab.signalTickCount) || 0,
      lastSignalAgeMs: tab.lastSignalAgeMs == null ? null : Number(tab.lastSignalAgeMs) || 0,
      averageInputDb: tab.averageInputDb == null ? null : Number(tab.averageInputDb),
      averageOutputDb: tab.averageOutputDb == null ? null : Number(tab.averageOutputDb),
      currentGainDb: Number(tab.currentGainDb) || 0,
      averageReductionDb: Number(tab.averageReductionDb) || 0,
      averageLiftDb: Number(tab.averageLiftDb) || 0,
      limiterMode: String(tab.limiterMode || ''),
      limiterActive: Boolean(tab.limiterActive),
      limiterReductionDb: Number(tab.limiterReductionDb) || 0,
      limiterTickCount: Number(tab.limiterTickCount) || 0,
      staleEngine: Boolean(tab.staleEngine),
      errors: (tab.failedErrors || []).map(sanitizeError)
    })),
    eventCounts,
    recentErrors: recentErrors.slice(0, 12)
  };
}

async function loadDiagnostics() {
  const revision = diagnosticsRequestRevision += 1;
  const snapshot = await extensionMessage({ type: 'WVB_GET_DIAGNOSTICS' });
  if (revision !== diagnosticsRequestRevision) {
    return;
  }
  renderDiagnostics(snapshot);
}

async function copyDiagnostics() {
  if (!lastSnapshot) await loadDiagnostics();
  await navigator.clipboard.writeText(JSON.stringify(supportReport(lastSnapshot), null, 2));
  els.health.textContent = t('diagnosticsCopied', undefined, 'Diagnostics copied');
}

async function openExternal(url) {
  if (globalThis.chrome?.tabs?.create) {
    await chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function shareListeningFeedback() {
  await openExternal('https://github.com/WSL043/loudease/issues/new?template=feedback.yml');
  els.health.textContent = t('feedbackOpened', undefined, 'Listening feedback form opened.');
}

async function shareDiagnostics() {
  await copyDiagnostics();
  await openExternal('https://github.com/WSL043/loudease/issues/new?template=audio-quality.yml');
  els.health.textContent = t('reportCopiedOpenIssue', undefined, 'Report copied. Paste it into the GitHub form.');
}

async function downloadDiagnostics() {
  if (!lastSnapshot) await loadDiagnostics();
  const url = URL.createObjectURL(new Blob([JSON.stringify(supportReport(lastSnapshot), null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `loudease-support-report-${Date.now()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  els.health.textContent = t('diagnosticsDownloaded', undefined, 'Diagnostics downloaded');
}

function reportSettingsError(error) { els.settingsHealth.textContent = String(error?.message || error); }
function reportDiagnosticsError(error) { els.health.textContent = String(error?.message || error); }

function bind() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  els.refreshNow.addEventListener('click', () => Promise.all([loadOptionsState(), activeView === 'diagnostics' ? loadDiagnostics() : null]).catch(reportSettingsError));
  els.languageSelect.addEventListener('change', async () => {
    await applyUiPreferences(await uiPreferences.save({ locale: els.languageSelect.value }));
    els.settingsHealth.textContent = t('saved', undefined, 'Saved');
  });
  els.themeSelect.addEventListener('change', async () => {
    currentUiPreferences = await uiPreferences.save({ theme: els.themeSelect.value });
    uiPreferences.applyTheme(currentUiPreferences.theme);
    els.settingsHealth.textContent = t('saved', undefined, 'Saved');
  });
  els.globalEnabled.addEventListener('change', () => scheduleGlobalSave({ flush: true }));
  els.globalRespect.addEventListener('change', () => scheduleGlobalSave({ flush: true }));
  bindRange(els.globalCut, els.globalCutValue, scheduleGlobalSave);
  bindRange(els.globalLift, els.globalLiftValue, scheduleGlobalSave);
  bindRange(els.siteCut, els.siteCutValue);
  bindRange(els.siteLift, els.siteLiftValue);
  els.siteForm.addEventListener('submit', (event) => saveSiteSettings(event).catch(reportSettingsError));
  els.deleteSite.addEventListener('click', () => deleteSiteSettings().catch(reportSettingsError));
  els.resetSettings.addEventListener('click', () => resetSettings().catch(reportSettingsError));
  /* WVB_DEV_DIAGNOSTICS_START */
  els.localDiagnostics.addEventListener('change', () => toggleLocalDiagnostics().catch(reportSettingsError));
  /* WVB_DEV_DIAGNOSTICS_END */
  els.siteList.addEventListener('click', (event) => {
    const row = event.target.closest('[data-site]');
    if (!row) return;
    const siteKey = row.dataset.site || '';
    fillSiteForm(siteKey, lastOptionsState?.siteSettings?.[siteKey] || lastOptionsState?.settings || {});
    els.settingsHealth.textContent = t('editingSite', siteKey, `Editing ${siteKey}`);
  });
  els.copyJson.addEventListener('click', () => copyDiagnostics().catch(reportDiagnosticsError));
  els.shareFeedback.addEventListener('click', () => shareListeningFeedback().catch(reportDiagnosticsError));
  els.shareReport.addEventListener('click', () => shareDiagnostics().catch(reportDiagnosticsError));
  els.downloadJson.addEventListener('click', () => downloadDiagnostics().catch(reportDiagnosticsError));
  els.reloadExtension.addEventListener('click', () => {
    if (globalThis.chrome?.runtime?.reload) setTimeout(() => chrome.runtime.reload(), 80);
  });
}

async function start() {
  currentUiPreferences = await uiPreferences.read();
  await applyUiPreferences(currentUiPreferences);
  bind();
  fillSiteForm('', { cutStrength: 100, liftStrength: 100 });
  await Promise.all([loadOptionsState(), loadDiagnostics()]);
  switchView('general');
  setInterval(() => {
    if (activeView === 'diagnostics') loadDiagnostics().catch(reportDiagnosticsError);
  }, 1000);
}

start().catch((error) => {
  els.settingsHealth.textContent = String(error?.message || error);
});
