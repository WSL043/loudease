(() => {
  try {
    if (typeof window.__WEB_VOLUME_BALANCER_BRIDGE_CLEANUP__ === 'function') {
      window.__WEB_VOLUME_BALANCER_BRIDGE_CLEANUP__();
    }
  } catch (_) {}

  const bridgeToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const STORAGE_KEY = 'webVolumeBalancer.settings';
  const SITE_SETTINGS_KEY = 'webVolumeBalancer.siteSettings';
  const STATUS_INTERVAL_MS = 1500;
  const MUTATION_DEBOUNCE_MS = 350;
  const MAX_TEXT = 240;
  const MAX_SCAN_NODES = 1800;
  const MAX_MEDIA_ITEMS = 64;
  const VOLUME_CONFLICT_EPSILON = 0.05;
  const MEDIA_EVENTS = ['volumechange', 'play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata'];

  window.__WEB_VOLUME_BALANCER_BRIDGE__ = true;
  window.__WEB_VOLUME_BALANCER_BRIDGE_TOKEN__ = bridgeToken;
  window.__WEB_VOLUME_BALANCER_BRIDGE_VERSION__ = chrome.runtime?.getManifest?.().version || '';

  let currentSettings = {
    enabled: true,
    respectPlayerVolume: true,
    preset: 'standard',
    cutStrength: 100,
    liftStrength: 100
  };
  let observer = null;
  let mutationTimer = null;
  let statusTimer = null;
  let storageChangeListener = null;
  let runtimeMessageListener = null;
  const observedMedia = new WeakSet();
  const mediaListeners = new Map();

  function stillCurrent() {
    return window.__WEB_VOLUME_BALANCER_BRIDGE_TOKEN__ === bridgeToken;
  }

  function finiteNumber(value, fallback = 0) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function percent(value, fallback = 100) {
    return clamp(finiteNumber(value, fallback), 0, 100);
  }

  function text(value, max = MAX_TEXT) {
    return String(value || '').slice(0, max);
  }

  function normalizeSettings(input = {}) {
    return {
      enabled: input.enabled !== false,
      respectPlayerVolume: input.respectPlayerVolume !== false,
      preset: text(input.preset || 'standard', 24),
      cutStrength: percent(input.cutStrength, 100),
      liftStrength: percent(input.liftStrength, 100),
      version: text(input.version, 24)
    };
  }

  function extensionVersion() {
    try {
      return text(chrome.runtime?.getManifest?.().version, 24);
    } catch (_) {
      return '';
    }
  }

  function mediaSourceKind(media) {
    if (media?.srcObject) {
      return 'srcObject';
    }
    const source = String(media?.currentSrc || media?.src || '');
    if (!source) {
      return 'empty';
    }
    if (source.startsWith('blob:')) {
      return 'blob';
    }
    if (source.startsWith('data:')) {
      return 'data';
    }
    if (/^https?:/i.test(source)) {
      return 'url';
    }
    return 'other';
  }

  function sanitizeMediaSource(value) {
    const source = String(value || '').trim();
    if (!source) {
      return '';
    }
    if (/^(blob|data|mediastream):/i.test(source)) {
      return `${source.slice(0, source.indexOf(':')).toLowerCase()}:`;
    }
    try {
      const parsed = new URL(source, location.href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `${parsed.protocol}`;
      }
      return text(`${parsed.origin}${parsed.pathname}`, 220);
    } catch (_) {
      return '';
    }
  }

  function mediaDetail(media, index) {
    const currentTime = finiteNumber(media.currentTime, 0);
    const duration = Number.isFinite(Number(media.duration)) ? Number(media.duration) : null;
    return {
      index,
      tag: text(media.tagName, 12),
      src: sanitizeMediaSource(media.currentSrc || media.src),
      sourceKind: mediaSourceKind(media),
      paused: Boolean(media.paused),
      ended: Boolean(media.ended),
      muted: Boolean(media.muted),
      volume: finiteNumber(media.volume, 1),
      readyState: finiteNumber(media.readyState, 0),
      networkState: finiteNumber(media.networkState, 0),
      currentTime,
      duration,
      width: finiteNumber(media.clientWidth, 0),
      height: finiteNumber(media.clientHeight, 0),
      videoWidth: finiteNumber(media.videoWidth, 0),
      videoHeight: finiteNumber(media.videoHeight, 0),
      audible: isAudible(media)
    };
  }

  function isAudible(media) {
    return Boolean(
      media
      && !media.paused
      && !media.ended
      && !media.muted
      && finiteNumber(media.volume, 1) > 0
      && finiteNumber(media.readyState, 0) >= 2
    );
  }

  function isActiveMedia(media) {
    return Boolean(
      media
      && !media.paused
      && !media.ended
      && finiteNumber(media.readyState, 0) >= 2
    );
  }

  function playerState(media) {
    const active = media.filter(isActiveMedia);
    if (active.length === 0) {
      return {
        playerActiveMediaCount: 0,
        playerMuted: false,
        playerVolumeCap: 1,
        playerMaxVolumeCap: 1,
        playerMinVolumeCap: 1,
        playerVolumeKnown: media.length > 0,
        playerVolumeConflict: false
      };
    }
    let maxVolumeCap = 0;
    let minNonZeroVolumeCap = 1;
    let nonZeroVolumeCount = 0;
    let mutedCount = 0;
    for (const item of active) {
      const volume = item.muted ? 0 : clamp(finiteNumber(item.volume, 1), 0, 1);
      maxVolumeCap = Math.max(maxVolumeCap, volume);
      if (volume > 0.001) {
        minNonZeroVolumeCap = Math.min(minNonZeroVolumeCap, volume);
        nonZeroVolumeCount += 1;
      }
      if (item.muted || volume <= 0) {
        mutedCount += 1;
      }
    }
    const allMuted = mutedCount === active.length;
    const minVolumeCap = nonZeroVolumeCount > 0 ? minNonZeroVolumeCap : 0;
    const volumeConflict = nonZeroVolumeCount > 1 && (maxVolumeCap - minVolumeCap) > VOLUME_CONFLICT_EPSILON;
    return {
      playerActiveMediaCount: active.length,
      playerMuted: allMuted,
      playerVolumeCap: volumeConflict ? minVolumeCap : maxVolumeCap,
      playerMaxVolumeCap: maxVolumeCap,
      playerMinVolumeCap: minVolumeCap,
      playerVolumeKnown: true,
      playerVolumeConflict: volumeConflict
    };
  }

  function bindMedia(media) {
    if (!media || observedMedia.has(media)) {
      return;
    }
    observedMedia.add(media);
    const eventNames = [];
    for (const eventName of MEDIA_EVENTS) {
      media.addEventListener(eventName, reportStatus, { passive: true });
      eventNames.push(eventName);
    }
    mediaListeners.set(media, eventNames);
  }

  function pruneMediaListeners() {
    for (const [media, eventNames] of mediaListeners.entries()) {
      if (media.isConnected) {
        continue;
      }
      for (const eventName of eventNames) {
        media.removeEventListener(eventName, reportStatus);
      }
      mediaListeners.delete(media);
      observedMedia.delete(media);
    }
  }

  function collectMedia(root, output, seen, budget) {
    if (!root || output.length >= MAX_MEDIA_ITEMS || budget.count >= MAX_SCAN_NODES) {
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let element = walker.nextNode();
    while (element) {
      budget.count += 1;
      if (budget.count >= MAX_SCAN_NODES || output.length >= MAX_MEDIA_ITEMS) {
        return;
      }
      if ((element.localName === 'video' || element.localName === 'audio') && !seen.has(element)) {
        seen.add(element);
        output.push(element);
      }
      if (element.shadowRoot) {
        collectMedia(element.shadowRoot, output, seen, budget);
      }
      element = walker.nextNode();
    }
  }

  function scanMedia() {
    pruneMediaListeners();
    const media = [];
    collectMedia(document, media, new Set(), { count: 0 });
    media.forEach(bindMedia);
    return media;
  }

  async function sendRuntime(message) {
    if (!stillCurrent()) {
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (_) {
      return null;
    }
  }

  function buildStatus() {
    const media = scanMedia();
    const audible = media.filter(isAudible);
    const state = playerState(media);
    return {
      mediaCount: media.length,
      processedCount: 0,
      activeProcessorCount: 0,
      limitedCount: 0,
      audibleCount: audible.length,
      measuringCount: 0,
      autoplayBlockedCount: 0,
      analysisSilentCount: 0,
      averageLiftDb: 0,
      averageReductionDb: 0,
      averageInputDb: null,
      averageInputPeak: 0,
      playerActiveMediaCount: state.playerActiveMediaCount,
      playerMuted: state.playerMuted,
      playerVolumeCap: state.playerVolumeCap,
      playerMaxVolumeCap: state.playerMaxVolumeCap,
      playerMinVolumeCap: state.playerMinVolumeCap,
      playerVolumeKnown: state.playerVolumeKnown,
      playerVolumeConflict: state.playerVolumeConflict,
      averageTargetPercent: 50,
      settingsPreset: currentSettings.preset,
      settingsCutStrength: currentSettings.cutStrength,
      settingsLiftStrength: currentSettings.liftStrength,
      engineVersion: '',
      bridgeVersion: extensionVersion(),
      needsPageReload: false,
      failedErrors: [],
      mediaDetails: media.slice(0, 8).map(mediaDetail),
      debugEvents: [],
      settingsEnabled: currentSettings.enabled,
      settingsRespectPlayerVolume: currentSettings.respectPlayerVolume,
      href: text(location.href, 180)
    };
  }

  function reportStatus() {
    if (!stillCurrent()) {
      cleanup();
      return;
    }
    sendRuntime({ type: 'WVB_FRAME_STATUS', status: buildStatus() }).catch(() => {});
  }

  function scheduleStatus() {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(reportStatus, MUTATION_DEBOUNCE_MS);
  }

  async function syncSettings() {
    if (!stillCurrent()) {
      return;
    }
    const settings = await sendRuntime({ type: 'WVB_GET_SETTINGS' });
    if (settings && !settings.error) {
      currentSettings = normalizeSettings(settings);
      reportStatus();
    }
  }

  function startObserver() {
    if (observer || !document.documentElement) {
      return;
    }
    observer = new MutationObserver((records) => {
      const touchesMedia = records.some((record) => Array.from(record.addedNodes)
        .concat(Array.from(record.removedNodes))
        .some((node) => node?.nodeType === Node.ELEMENT_NODE && (
          node.localName === 'video'
          || node.localName === 'audio'
          || node.shadowRoot
          || node.querySelector?.('video,audio')
        )));
      if (touchesMedia) {
        scheduleStatus();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function cleanup() {
    window.clearInterval(statusTimer);
    window.clearTimeout(mutationTimer);
    observer?.disconnect();
    for (const [media, eventNames] of mediaListeners.entries()) {
      for (const eventName of eventNames) {
        media.removeEventListener(eventName, reportStatus);
      }
    }
    mediaListeners.clear();
    if (storageChangeListener) {
      chrome.storage?.onChanged?.removeListener?.(storageChangeListener);
      storageChangeListener = null;
    }
    if (runtimeMessageListener) {
      chrome.runtime?.onMessage?.removeListener?.(runtimeMessageListener);
      runtimeMessageListener = null;
    }
    document.removeEventListener('visibilitychange', reportStatus);
    document.removeEventListener('DOMContentLoaded', startObserver);
    window.removeEventListener('pagehide', cleanup);
    statusTimer = null;
    mutationTimer = null;
    observer = null;
  }

  window.__WEB_VOLUME_BALANCER_BRIDGE_CLEANUP__ = cleanup;

  storageChangeListener = (changes, area) => {
    if (!stillCurrent()) {
      return;
    }
    if (area === 'sync' && (changes[STORAGE_KEY] || changes[SITE_SETTINGS_KEY])) {
      syncSettings();
    }
  };
  chrome.storage?.onChanged?.addListener(storageChangeListener);

  runtimeMessageListener = (message, _sender, sendResponse) => {
    if (!stillCurrent()) {
      return false;
    }
    if (message?.type === 'WVB_REFRESH_SETTINGS') {
      syncSettings();
    }
    if (message?.type === 'WVB_APPLY_SETTINGS') {
      currentSettings = normalizeSettings(message.settings || currentSettings);
      reportStatus();
    }
    if (message?.type === 'WVB_COLLECT_STATUS') {
      const status = buildStatus();
      sendRuntime({ type: 'WVB_FRAME_STATUS', status })
        .finally(() => sendResponse({ ok: true, status }));
      return true;
    }
    return false;
  };
  chrome.runtime?.onMessage?.addListener(runtimeMessageListener);

  window.addEventListener('pagehide', cleanup, { once: true });
  document.addEventListener('visibilitychange', reportStatus);

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }
  syncSettings();
  reportStatus();
  statusTimer = window.setInterval(reportStatus, STATUS_INTERVAL_MS);
})();
