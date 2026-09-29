// LoudEase automatic mode.
//
// Runs in the extension's isolated content-script world on ordinary HTTP(S)
// frames. When a page plays audible, eligible media, it routes that element
// through the same programme-leveler AudioWorklet used by tab capture, so no
// per-tab click is needed. Elements Chrome would silence (cross-origin without
// CORS, DRM, or a page-owned Web Audio graph) are never attached; the popup
// falls back to the user-invoked tabCapture path for those.
(() => {
  'use strict';
  if (globalThis.__LOUDEASE_AUTO_ENGINE__) return;
  globalThis.__LOUDEASE_AUTO_ENGINE__ = true;

  const POLICY_URL = chrome.runtime.getURL('shared/programme-leveler-policy.js');
  const WORKLET_URL = chrome.runtime.getURL('offscreen/leveler-worklet.js');
  const MEDIA_EVENTS = ['playing', 'play', 'pause', 'volumechange', 'loadstart', 'emptied', 'ended', 'encrypted'];
  const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'];
  const SCAN_DEBOUNCE_MS = 400;
  const DEEP_SCAN_MIN_INTERVAL_MS = 4000;
  const MAX_SCAN_NODES = 2500;
  const MAX_ENTRIES = 8;
  const RESUME_WAIT_MS = 300;
  const CONFIGURE_TIMEOUT_MS = 1500;
  const WATCHDOG_INTERVAL_MS = 2000;
  const STALE_STATE_MS = 4000;

  const entries = new Map();
  const watched = new WeakSet();
  const skipped = new WeakMap();
  const attaching = new WeakSet();
  const blockedReasons = new Map();
  let config = null;
  let configPromise = null;
  let context = null;
  let workletPromise = null;
  let engineFailure = '';
  let contextSuspendedForGesture = false;
  let observer = null;
  let scanTimer = null;
  let watchdogTimer = null;
  let lastDeepScanAt = 0;
  let orphaned = false;

  const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function send(message) {
    if (orphaned) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch((error) => {
        if (/context invalidated/i.test(String(error?.message || error))) orphaned = true;
        return null;
      });
    } catch (_) {
      orphaned = true;
      return Promise.resolve(null);
    }
  }

  function fingerprint(value) {
    let hash = 0x811c9dc5;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  const programmeIds = new WeakMap();

  // Douyin feed swipes reuse both the page URL and an opaque media source, so
  // read the id from links inside this player's own container only.
  function visibleProgrammeId(media) {
    if (!/^(www\.)?douyin\.com$/i.test(location.hostname)) return '';
    const container = media.closest?.('.basePlayerContainer');
    if (!container) return programmeIds.get(media) || '';
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
    const ids = new Set();
    let node;
    let visited = 0;
    while ((node = walker.nextNode()) && visited < 800) {
      visited += 1;
      if (node.tagName !== 'A') continue;
      try {
        const link = new URL(node.getAttribute('href') || '', location.href);
        const id = link.searchParams.get('aweme_id') || '';
        if (link.protocol === 'https:' && /^(www\.)?douyin\.com$/i.test(link.hostname)
          && link.pathname.startsWith('/search/') && /^\d{15,22}$/.test(id)) ids.add(id);
      } catch (_) {}
    }
    if (!node && ids.size === 1) programmeIds.set(media, `douyin:${[...ids][0]}`);
    return programmeIds.get(media) || '';
  }

  function sourceIdentity(media) {
    const visibleId = visibleProgrammeId(media);
    if (visibleId) return visibleId;
    if (media.srcObject) return 'srcObject';
    const source = String(media.currentSrc || media.src || '');
    if (/^(blob|data|mediastream):/i.test(source)) return source.slice(0, source.indexOf(':') + 1);
    try {
      const parsed = new URL(source, location.href);
      return `${parsed.origin}${parsed.pathname}`.slice(0, 220);
    } catch (_) {
      return '';
    }
  }

  // Transient blob/srcObject identities are not programme boundaries; the
  // location plus a stable source path is.
  function programmeKey(media) {
    return fingerprint(`${location.href}\n${sourceIdentity(media)}`);
  }

  function isAudible(media) {
    return Boolean(media && !media.paused && !media.ended && !media.muted
      && finite(media.volume, 1) > 0 && finite(media.readyState, 0) >= 2);
  }

  // Returns '' when the element can be attached safely, 'pending' while its
  // source is unknown, or a permanent reason code. createMediaElementSource
  // silences cross-origin media without CORS and protected (EME) media, and
  // throws for elements another script already routed through Web Audio.
  function ineligibleReason(media) {
    if (media.mediaKeys) return 'drm';
    if (media.srcObject) return '';
    const source = String(media.currentSrc || media.src || '');
    if (!source) return 'pending';
    if (/^(blob|data|mediastream):/i.test(source)) return '';
    try {
      if (new URL(source, location.href).origin === location.origin) return '';
    } catch (_) {
      return 'cross-origin';
    }
    return media.crossOrigin !== null ? '' : 'cross-origin';
  }

  function isEnabled() {
    return Boolean(config && config.autoEnabled && config.settings && config.settings.enabled !== false);
  }

  function wantsProcessing() {
    return isEnabled() && config.captured !== true;
  }

  async function loadConfig(force = false) {
    if (config && !force) return config;
    if (!configPromise) {
      configPromise = send({ type: 'WVB_AUTO_CONFIG', href: location.href })
        .then((response) => {
          if (response && response.ok !== false && response.settings) config = response;
          return config;
        })
        .finally(() => { configPromise = null; });
    }
    return configPromise;
  }

  function levelerMessage(entry) {
    const media = entry.media;
    const volume = media.muted ? 0 : clamp(finite(media.volume, 1), 0, 1);
    return {
      type: 'configure',
      configSequence: entry.configSequence += 1,
      settings: config.settings,
      playerVolumeCap: volume,
      playerVolumeReliable: true,
      playerMuted: Boolean(media.muted),
      allowUnknownVolumeLift: false,
      programmeKey: programmeKey(media)
    };
  }

  function configureEntry(entry) {
    if (!entry.leveler || !config) return;
    entry.leveler.port.postMessage(levelerMessage(entry));
  }

  function route(entry) {
    if (!context || entry.dead) return;
    const mode = wantsProcessing() && !entry.failed ? 'process' : 'bypass';
    if (entry.mode === mode) return;
    try { entry.source.disconnect(); } catch (_) {}
    try { entry.leveler.disconnect(); } catch (_) {}
    if (mode === 'process') {
      entry.source.connect(entry.leveler);
      entry.leveler.connect(context.destination);
    } else {
      entry.source.connect(context.destination);
    }
    entry.mode = mode;
  }

  async function ensureContext() {
    if (!context) {
      context = new AudioContext();
      context.addEventListener('statechange', () => {
        if (context.state !== 'running') context.resume().catch(() => {});
      });
    }
    if (context.state !== 'running') {
      await Promise.race([
        context.resume().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, RESUME_WAIT_MS))
      ]);
    }
    return context.state === 'running';
  }

  function ensureWorklet() {
    if (!workletPromise) {
      workletPromise = (async () => {
        await context.audioWorklet.addModule(POLICY_URL);
        await context.audioWorklet.addModule(WORKLET_URL);
      })().catch((error) => {
        engineFailure = String(error?.message || error).slice(0, 160) || 'worklet-failed';
        throw error;
      });
    }
    return workletPromise;
  }

  function waitForGesture() {
    if (contextSuspendedForGesture) return;
    contextSuspendedForGesture = true;
    const retry = () => {
      for (const name of GESTURE_EVENTS) document.removeEventListener(name, retry, true);
      contextSuspendedForGesture = false;
      // Resume inside the gesture so Chrome's autoplay policy allows it.
      context?.resume?.().catch(() => {});
      scheduleScan(0);
    };
    for (const name of GESTURE_EVENTS) document.addEventListener(name, retry, { capture: true, passive: true });
  }

  function block(media, reason) {
    skipped.set(media, reason);
    blockedReasons.set(media, reason);
    notifyChange();
  }

  async function attach(media) {
    if (entries.has(media) || skipped.has(media) || attaching.has(media) || entries.size >= MAX_ENTRIES) return;
    if (!isAudible(media)) return;
    attaching.add(media);
    try {
      await attachNow(media);
    } finally {
      attaching.delete(media);
    }
  }

  async function attachNow(media) {
    const reason = ineligibleReason(media);
    if (reason === 'pending') return;
    if (reason) {
      block(media, reason);
      return;
    }
    const current = await loadConfig();
    if (!current || !current.autoEnabled || current.settings.enabled === false) return;
    if (entries.has(media) || !isAudible(media)) return;

    let entry = null;
    try {
      if (!await ensureContext()) {
        waitForGesture();
        return;
      }
      await ensureWorklet();
      const leveler = new AudioWorkletNode(context, 'wvb-leveler-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      entry = {
        media,
        leveler,
        source: null,
        mode: 'none',
        failed: false,
        dead: false,
        configSequence: 0,
        configuredSequence: 0,
        state: null,
        lastStateAt: 0,
        attachedAt: Date.now()
      };
      const configured = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), CONFIGURE_TIMEOUT_MS);
        leveler.port.onmessage = (event) => {
          const data = event.data || {};
          if (data.type === 'configured') {
            entry.configuredSequence = Math.max(entry.configuredSequence, finite(data.configSequence, 0));
            clearTimeout(timer);
            resolve(true);
          } else if (data.type === 'state') {
            entry.state = data;
            entry.lastStateAt = Date.now();
          }
        };
      });
      leveler.onprocessorerror = () => {
        entry.failed = true;
        route(entry);
      };
      configureEntry(entry);
      // Never hook the element until the worklet is ready: once the source
      // node exists the element's audio only reaches speakers through us.
      if (!await configured) {
        leveler.disconnect();
        return;
      }
      entry.source = context.createMediaElementSource(media);
      entries.set(media, entry);
      route(entry);
      startWatchdog();
      notifyChange();
    } catch (error) {
      if (entry) entry.dead = true;
      const message = String(error?.name || '') + String(error?.message || '');
      if (/InvalidState|already connected/i.test(message)) block(media, 'page-audio-graph');
      else if (!engineFailure) engineFailure = message.slice(0, 160) || 'attach-failed';
    }
  }

  function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
      const now = Date.now();
      for (const [media, entry] of entries) {
        if (!media.isConnected && media.paused) {
          entry.dead = true;
          try { entry.source.disconnect(); entry.leveler.disconnect(); } catch (_) {}
          entries.delete(media);
          continue;
        }
        // A silent or stalled worklet must never leave audio muted: fall back
        // to a direct connection if state reports stop while playing.
        const stalled = isAudible(media) && entry.mode === 'process'
          && now - Math.max(entry.lastStateAt, entry.attachedAt) > STALE_STATE_MS;
        if (stalled) {
          entry.failed = true;
          route(entry);
        }
        if (context && context.state !== 'running' && isAudible(media)) context.resume().catch(() => {});
      }
      if (entries.size === 0) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
        notifyChange();
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  function watch(media) {
    if (watched.has(media)) {
      attach(media);
      return;
    }
    watched.add(media);
    const handler = (event) => {
      if (event.type === 'encrypted') {
        if (!entries.has(media)) block(media, 'drm');
        return;
      }
      if (event.type === 'loadstart' || event.type === 'emptied') skipped.delete(media);
      const entry = entries.get(media);
      if (entry) {
        configureEntry(entry);
        return;
      }
      if (event.type === 'playing' || event.type === 'volumechange' || event.type === 'play') attach(media);
    };
    for (const name of MEDIA_EVENTS) media.addEventListener(name, handler, { passive: true });
    attach(media);
  }

  function scanRoot(root, budget) {
    if (!root || budget.count >= MAX_SCAN_NODES) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let element = walker.nextNode();
    while (element && budget.count < MAX_SCAN_NODES) {
      budget.count += 1;
      if (element.localName === 'video' || element.localName === 'audio') watch(element);
      if (element.shadowRoot) {
        observeRoot(element.shadowRoot);
        scanRoot(element.shadowRoot, budget);
      }
      element = walker.nextNode();
    }
  }

  function scan() {
    scanTimer = null;
    for (const media of document.querySelectorAll('video,audio')) watch(media);
    const now = Date.now();
    // Shadow DOM needs a tree walk; keep it rare and bounded.
    if (now - lastDeepScanAt >= DEEP_SCAN_MIN_INTERVAL_MS) {
      lastDeepScanAt = now;
      scanRoot(document, { count: 0 });
    }
  }

  function scheduleScan(delay = SCAN_DEBOUNCE_MS) {
    if (scanTimer) return;
    scanTimer = setTimeout(scan, delay);
  }

  const observedRoots = new WeakSet();
  function observeRoot(root) {
    if (!observer || observedRoots.has(root)) return;
    observedRoots.add(root);
    try { observer.observe(root, { childList: true, subtree: true }); } catch (_) {}
  }

  function start() {
    // Media events do not bubble, but capturing on the document still sees
    // light-DOM elements, including ones a scan has not reached yet.
    const onCapture = (event) => {
      const target = event.target;
      if (target && (target.localName === 'video' || target.localName === 'audio')) watch(target);
    };
    document.addEventListener('playing', onCapture, { capture: true, passive: true });
    document.addEventListener('volumechange', onCapture, { capture: true, passive: true });
    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scheduleScan();
            return;
          }
        }
      }
    });
    observeRoot(document.documentElement);
    scan();
  }

  function notifyChange() {
    send({ type: 'WVB_AUTO_CHANGED', summary: summary() });
  }

  function summary() {
    const list = [...entries.values()].filter((entry) => !entry.dead);
    const live = list.filter((entry) => entry.mode !== 'none');
    const processing = live.filter((entry) => entry.mode === 'process' && !entry.failed);
    const primary = processing
      .filter((entry) => entry.state && isAudible(entry.media))
      .sort((a, b) => b.lastStateAt - a.lastStateAt)[0] || processing[0] || null;
    const state = primary?.state || {};
    const now = Date.now();
    const reasons = {};
    let blocked = 0;
    for (const [media, reason] of blockedReasons) {
      if (!media.isConnected && media.paused) { blockedReasons.delete(media); continue; }
      if (isAudible(media)) {
        blocked += 1;
        reasons[reason] = (reasons[reason] || 0) + 1;
      }
    }
    return {
      version: chrome.runtime.getManifest().version,
      autoEnabled: Boolean(config?.autoEnabled),
      attachedCount: live.length,
      processingCount: processing.length,
      bypassCount: live.length - processing.length,
      failedCount: live.filter((entry) => entry.failed).length,
      audibleCount: live.filter((entry) => isAudible(entry.media)).length,
      blockedAudibleCount: blocked,
      blockedReasons: reasons,
      engineFailure,
      contextState: context?.state || 'none',
      waitingForGesture: contextSuspendedForGesture,
      signalTickCount: finite(state.signalTickCount, 0),
      lastSignalAgeMs: primary && primary.state ? (state.signalActive ? 0 : now - primary.lastStateAt) : null,
      signalActive: state.signalActive === true,
      averageInputDb: primary ? finite(state.lastInputDb, -91) : null,
      averageOutputDb: primary ? finite(state.lastOutputDb, -91) : null,
      currentGainDb: finite(state.currentGainDb, 0),
      averageLiftDb: finite(state.currentLiftDb, 0),
      averageReductionDb: finite(state.currentReductionDb, 0) + finite(state.currentLimiterReductionDb, 0),
      quietDeficitDb: finite(state.quietDeficitDb, 0),
      requestedLiftDb: finite(state.requestedLiftDb, 0),
      effectiveMaxLiftDb: finite(state.effectiveMaxLiftDb, 0),
      playerMuted: primary ? Boolean(primary.media.muted) : false,
      playerVolumeCap: primary ? (primary.media.muted ? 0 : finite(primary.media.volume, 1)) : 1
    };
  }

  function applyConfig(next) {
    if (next && next.settings) config = next;
    for (const entry of entries.values()) {
      route(entry);
      configureEntry(entry);
    }
    scheduleScan(0);
    notifyChange();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'WVB_AUTO_COLLECT') {
      sendResponse({ ok: true, summary: summary() });
      return false;
    }
    if (message.type === 'WVB_AUTO_REFRESH') {
      loadConfig(true).then((next) => applyConfig(next));
      return false;
    }
    if (message.type === 'WVB_APPLY_SETTINGS' && config && message.settings) {
      applyConfig({ ...config, settings: { ...config.settings, ...message.settings } });
      return false;
    }
    return false;
  });

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((key) => key.startsWith('webVolumeBalancer.'))) {
      if (config) loadConfig(true).then((next) => applyConfig(next));
    }
  });

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
