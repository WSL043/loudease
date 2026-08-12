const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmpDir = path.join(root, 'tmp');
const runSuffix = `${Date.now()}-${process.pid}`;
const profileDir = path.join(tmpDir, `e2e-profile-${runSuffix}`);
const extensionDir = path.join(tmpDir, `e2e-extension-${runSuffix}`);
const testPagesDir = path.join(root, 'test-pages');
const externalPageUrl = String(process.env.WVB_E2E_URL || '').trim();
const scenarioExpect = process.env.WVB_E2E_EXPECT || 'reduce';
const requirePopupAutoCapture = process.env.WVB_E2E_REQUIRE_POPUP_AUTOCAPTURE === '1';
const checkPopupStrengthPersistence = process.env.WVB_E2E_CHECK_SLIDER_PERSIST === '1';
const captureHoldMs = Math.max(0, Number(process.env.WVB_E2E_HOLD_MS || 0));
const holdSampleMs = Math.max(250, Number(process.env.WVB_E2E_HOLD_SAMPLE_MS || 5000));
const maxHoldHeapGrowthBytes = Math.max(1, Number(process.env.WVB_E2E_MAX_HEAP_GROWTH_MB || 32)) * 1024 * 1024;
const maxHoldSignalAgeMs = Math.max(1000, Number(process.env.WVB_E2E_MAX_SIGNAL_AGE_MS || 10000));
const playerVolume = process.env.WVB_E2E_PLAYER_VOLUME === ''
  ? NaN
  : Number(process.env.WVB_E2E_PLAYER_VOLUME);
const scenario = {
  page: process.env.WVB_E2E_PAGE || 'simple-audio.html',
  expect: scenarioExpect,
  minReductionDb: Number(process.env.WVB_E2E_MIN_REDUCTION_DB || 1),
  minLiftDb: Number(process.env.WVB_E2E_MIN_LIFT_DB || 1),
  minLiftOutputDeltaDb: Number(process.env.WVB_E2E_MIN_LIFT_OUTPUT_DELTA_DB || 3),
  maxHoldGainDb: Number(process.env.WVB_E2E_MAX_HOLD_GAIN_DB || 1.5),
  playerVolume: Number.isFinite(playerVolume) ? Math.max(0, Math.min(1, playerVolume)) : null,
  minSignalTicks: Number(process.env.WVB_E2E_MIN_SIGNAL_TICKS || (
    scenarioExpect === 'burst'
      ? 220
      : (scenarioExpect === 'muted'
          ? 0
          : (scenarioExpect === 'lift' ? 60 : 40))
  ))
};
const manifestVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
})();
const reportId = String(process.env.WVB_E2E_REPORT_ID || '').replace(/[^a-z0-9_-]+/gi, '-');
const scenarioReportName = reportId
  ? `latest-real-site-${reportId}.json`
  : `latest-e2e-poc-${String(scenario.expect).replace(/[^a-z0-9_-]+/gi, '-')}.json`;
const scenarioReportPath = path.join(tmpDir, scenarioReportName);
const latestReportPath = path.join(tmpDir, 'latest-e2e-poc.json');
const scenarioReportNames = new Set([scenarioReportName]);
if (scenario.expect === 'hold' && scenario.playerVolume != null && scenario.playerVolume < 0.98) {
  scenarioReportNames.add('latest-e2e-poc-low-player-volume-hold.json');
}
if (scenario.expect === 'lift' && scenario.playerVolume != null && scenario.playerVolume < 0.98 && /[?&]gain=/i.test(scenario.page)) {
  scenarioReportNames.add('latest-e2e-poc-lift-low-volume.json');
}

function log(message) {
  console.log(`[e2e] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (child.exitCode != null) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(timeoutMs)
  ]);
}

function cleanupRunDirectories({ tolerateTransientLocks = false } = {}) {
  for (const directory of [profileDir, extensionDir]) {
    assertInside(tmpDir, directory);
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      if (tolerateTransientLocks && ['EBUSY', 'EPERM'].includes(error?.code)) {
        log(`deferred cleanup for Windows-locked run directory ${path.basename(directory)}`);
        continue;
      }
      throw error;
    }
    if (fs.existsSync(directory)) {
      if (tolerateTransientLocks) {
        log(`deferred cleanup for run directory ${path.basename(directory)}`);
        continue;
      }
      throw new Error(`E2E run directory was not removed: ${directory}`);
    }
  }
}

function writeJson(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  } catch (error) {
    log(`failed to write ${filePath}: ${error?.message || error}`);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Chrome executable not found. Set CHROME_PATH to chrome.exe.');
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside ${parent}: ${child}`);
  }
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const requestPath = url.pathname === '/' ? `/${scenario.page}` : url.pathname;
    const fullPath = path.resolve(testPagesDir, `.${decodeURIComponent(requestPath)}`);
    assertInside(testPagesDir, fullPath);
    fs.readFile(fullPath, (error, bytes) => {
      if (error) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(bytes);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'tmp' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }
    if (/\.(zip|crx|pem)$/i.test(entry.name)) {
      continue;
    }
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function stageExtensionForE2e() {
  assertInside(tmpDir, extensionDir);
  fs.rmSync(extensionDir, { recursive: true, force: true });
  copyDir(root, extensionDir);
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.options_page = 'e2e/harness.html';
  manifest.permissions = Array.from(new Set([...(manifest.permissions || []), 'tabs']));
  manifest.host_permissions = Array.from(new Set([...(manifest.host_permissions || []), 'http://127.0.0.1/*']));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method || 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${body.slice(0, 200)}`));
        }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function waitForCdp(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      return await httpJson(endpoint);
    } catch (_) {
      await sleep(200);
    }
  }
  throw new Error('Chrome DevTools endpoint did not start.');
}

class CdpSocket {
  constructor(wsUrl) {
    this.wsUrl = new URL(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.socket = null;
  }

  async connect() {
    const key = crypto.randomBytes(16).toString('base64');
    const port = Number(this.wsUrl.port || 80);
    this.socket = net.connect(port, this.wsUrl.hostname);
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    this.socket.write([
      `GET ${this.wsUrl.pathname}${this.wsUrl.search} HTTP/1.1`,
      `Host: ${this.wsUrl.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      ''
    ].join('\r\n'));
    await this.readHandshake();
    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (error) => {
      for (const item of this.pending.values()) {
        item.reject(error);
      }
      this.pending.clear();
    });
  }

  readHandshake() {
    return new Promise((resolve, reject) => {
      let data = Buffer.alloc(0);
      const onData = (chunk) => {
        data = Buffer.concat([data, chunk]);
        const marker = data.indexOf('\r\n\r\n');
        if (marker === -1) {
          return;
        }
        this.socket.off('data', onData);
        const header = data.slice(0, marker).toString('utf8');
        if (!/^HTTP\/1\.1 101/i.test(header)) {
          reject(new Error(`WebSocket handshake failed: ${header}`));
          return;
        }
        this.buffer = data.slice(marker + 4);
        resolve();
      };
      this.socket.on('data', onData);
      this.socket.once('error', reject);
    });
  }

  sendFrame(text) {
    const payload = Buffer.from(text);
    const mask = crypto.randomBytes(4);
    const headerLength = payload.length < 126 ? 6 : 8;
    const frame = Buffer.alloc(headerLength + payload.length);
    frame[0] = 0x81;
    if (payload.length < 126) {
      frame[1] = 0x80 | payload.length;
      mask.copy(frame, 2);
      for (let i = 0; i < payload.length; i += 1) {
        frame[6 + i] = payload[i] ^ mask[i % 4];
      }
    } else {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(payload.length, 2);
      mask.copy(frame, 4);
      for (let i = 0; i < payload.length; i += 1) {
        frame[8 + i] = payload[i] ^ mask[i % 4];
      }
    }
    this.socket.write(frame);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        throw new Error('Large WebSocket frames are not supported by this smoke test.');
      }
      const masked = Boolean(second & 0x80);
      const maskOffset = masked ? 4 : 0;
      if (this.buffer.length < offset + maskOffset + length) {
        return;
      }
      let payload = this.buffer.slice(offset + maskOffset, offset + maskOffset + length);
      if (masked) {
        const mask = this.buffer.slice(offset, offset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      this.buffer = this.buffer.slice(offset + maskOffset + length);
      const opcode = first & 0x0f;
      if (opcode === 1) {
        this.onMessage(payload.toString('utf8'));
      }
    }
  }

  onMessage(text) {
    const message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result || {});
      }
    }
  }

  command(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    this.sendFrame(payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  close() {
    this.socket?.destroy();
  }
}

async function connectTarget(port, predicate) {
  const startedAt = Date.now();
  let latestTargets = [];
  while (Date.now() - startedAt < 10000) {
    const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
    latestTargets = targets;
    const target = targets.find(predicate);
    if (target?.webSocketDebuggerUrl) {
      const cdp = new CdpSocket(target.webSocketDebuggerUrl);
      await cdp.connect();
      return { target, cdp };
    }
    await sleep(200);
  }
  throw new Error(`Target not found: ${latestTargets.map((target) => `${target.type}:${target.id || ''}:${target.url}`).join(' | ')}`);
}

async function clickElement(cdp, selector) {
  await cdp.command('Runtime.enable');
  await cdp.command('Page.enable');
  let point = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    const result = await cdp.command('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`
    });
    point = result.result?.value;
    if (point) {
      break;
    }
    await sleep(100);
  }
  if (!point) {
    const context = await cdp.command('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ url: location.href, title: document.title, body: document.body ? document.body.innerText.slice(0, 200) : '' })`
    }).catch(() => null);
    throw new Error(`Element not found: ${selector}; page=${JSON.stringify(context?.result?.value || null)}`);
  }
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

async function clickReadyElement(cdp, selector) {
  await cdp.command('Runtime.enable');
  await cdp.command('Page.enable');
  let point = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const result = await cdp.command('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element || element.hidden || element.disabled) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: element.textContent || '' };
      })()`
    });
    point = result.result?.value;
    if (point) {
      break;
    }
    await sleep(150);
  }
  if (!point) {
    const context = await cdp.command('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ url: location.href, title: document.title, body: document.body ? document.body.innerText.slice(0, 500) : '' })`
    }).catch(() => null);
    throw new Error(`Ready element not found: ${selector}; page=${JSON.stringify(context?.result?.value || null)}`);
  }
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

async function readHarnessStatus(cdp) {
  const result = await cdp.command('Runtime.evaluate', {
    returnByValue: true,
    expression: 'window.__WVB_E2E_STATUS__ || null'
  });
  return result.result?.value || null;
}

async function evaluateValue(cdp, expression, options = {}) {
  const result = await cdp.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: Boolean(options.userGesture)
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed';
    throw new Error(text);
  }
  return result.result?.value || null;
}

async function configureSilentSinkInExtensionPage(browserCdp, debugPort, extensionId) {
  const pageUrl = `chrome-extension://${extensionId}/e2e/harness.html?silent-config=1`;
  const created = await browserCdp.command('Target.createTarget', { url: pageUrl, forTab: true });
  const page = await connectTarget(debugPort, (target) => (
    target.id === created.targetId || target.url === pageUrl
  ));
  try {
    const configured = await evaluateValue(page.cdp, `(${async function configureSilentSink(key) {
      await chrome.storage.local.set({ [key]: true });
      const stored = await chrome.storage.local.get(key);
      return stored[key] === true;
    }})(${JSON.stringify('webVolumeBalancer.e2eSilentSink')})`);
    if (configured !== true) {
      throw new Error('Failed to configure the silent AudioContext sink in extension storage.');
    }
  } finally {
    page.cdp.close();
    await browserCdp.command('Target.closeTarget', { targetId: created.targetId }).catch(() => null);
  }
  log('silent AudioContext sink configured from a deterministic extension page');
}

async function prepareExternalMedia(cdp, timeoutMs) {
  await cdp.command('Runtime.enable');
  await cdp.command('Page.enable');
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await evaluateValue(cdp, `(${async function startSiteMedia() {
      const consentPattern = /^(accept all|accept|i agree|agree|同意|接受|全部接受|我知道了|继续访问)$/i;
      for (const button of document.querySelectorAll('button, [role="button"]')) {
        const text = String(button.textContent || button.getAttribute('aria-label') || '').trim();
        const rect = button.getBoundingClientRect();
        if (consentPattern.test(text) && rect.width > 2 && rect.height > 2) {
          button.click();
          break;
        }
      }

      const playPattern = /^(play|播放|继续播放|点击播放|unmute|取消静音)|play video|播放视频/i;
      for (const control of document.querySelectorAll('button, [role="button"], .ytp-large-play-button, .ytp-play-button, .bpx-player-ctrl-play')) {
        const label = String(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '').trim();
        const rect = control.getBoundingClientRect();
        if (playPattern.test(label) && rect.width > 2 && rect.height > 2) {
          control.click();
          break;
        }
      }

      const media = Array.from(document.querySelectorAll('audio,video'));
      const playResults = await Promise.all(media.map(async (item) => {
        try {
          item.muted = false;
          if (Number(item.volume) <= 0.01) item.volume = 1;
          await Promise.race([
            item.play(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('play-timeout')), 1500))
          ]);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error?.message || error) };
        }
      }));
      const states = media.map((item, index) => ({
        index,
        tag: item.tagName.toLowerCase(),
        paused: item.paused,
        muted: item.muted,
        volume: item.volume,
        readyState: item.readyState,
        networkState: item.networkState,
        currentTime: Number(item.currentTime) || 0,
        duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
        error: item.error ? String(item.error.message || item.error.code || item.error) : '',
        play: playResults[index]
      }));
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        mediaCount: states.length,
        playingCount: states.filter((item) => !item.paused && item.readyState >= 2).length,
        states
      };
    }})()`, { userGesture: true }).catch((error) => ({ error: String(error?.message || error) }));
    if (Number(latest?.playingCount || 0) > 0) {
      await sleep(1000);
      const advanced = await evaluateValue(cdp, `(() => ({
        url: location.href,
        title: document.title,
        times: Array.from(document.querySelectorAll('audio,video')).map((item) => Number(item.currentTime) || 0)
      }))()`);
      latest.advancedTimes = advanced?.times || [];
      latest.url = advanced?.url || latest.url;
      latest.title = advanced?.title || latest.title;
      return latest;
    }
    await sleep(500);
  }
  return latest;
}

async function readExternalMediaState(cdp) {
  if (!cdp) return null;
  return await evaluateValue(cdp, `(() => ({
    url: location.href,
    title: document.title,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    media: Array.from(document.querySelectorAll('audio,video')).map((item, index) => ({
      index,
      tag: item.tagName.toLowerCase(),
      paused: item.paused,
      ended: item.ended,
      muted: item.muted,
      volume: item.volume,
      readyState: item.readyState,
      networkState: item.networkState,
      currentTime: Number(item.currentTime) || 0,
      duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
      error: item.error ? String(item.error.message || item.error.code || item.error) : ''
    }))
  }))()`).catch((error) => ({ error: String(error?.message || error) }));
}

async function readPopupCaptureStatus(cdp, targetPrefix, fallbackPageUrl) {
  return await evaluateValue(cdp, `(${async function readCapture(prefix, fallbackUrl) {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((tab) => String(tab.url || '').startsWith(prefix))
      || tabs.find((tab) => tab.active)
      || tabs[0];
    if (!target?.id) return { error: 'missing-target-tab', tabs };
    return await chrome.runtime.sendMessage({
      type: 'WVB_GET_STATUS',
      tabId: target.id,
      tabUrl: String(target.url || fallbackUrl),
      ensure: false
    });
  }})(${JSON.stringify(targetPrefix)}, ${JSON.stringify(fallbackPageUrl)})`, { userGesture: true });
}

async function stopPopupCapture(cdp, targetPrefix, fallbackPageUrl) {
  return await evaluateValue(cdp, `(${async function stopCapture(prefix, fallbackUrl) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((tab) => String(tab.url || '').startsWith(prefix))
      || tabs.find((tab) => tab.active)
      || tabs[0];
    if (!target?.id) return { stopPhase: 'error', stopResponse: { ok: false, error: 'missing-target-tab' } };
    const tabUrl = String(target.url || fallbackUrl);
    const stopResponse = await chrome.runtime.sendMessage({ type: 'WVB_STOP_TAB_CAPTURE', tabId: target.id });
    let stopTab = null;
    for (let index = 0; index < 24; index += 1) {
      stopTab = await chrome.runtime.sendMessage({
        type: 'WVB_GET_STATUS',
        tabId: target.id,
        tabUrl,
        ensure: false
      });
      if (!stopTab?.captureActive) {
        return { stopPhase: 'capture-stopped', stopResponse, stopTab };
      }
      await sleep(250);
    }
    return { stopPhase: 'capture-still-active', stopResponse, stopTab };
  }})(${JSON.stringify(targetPrefix)}, ${JSON.stringify(fallbackPageUrl)})`, { userGesture: true });
}

async function holdCapture({ debugPort, extensionId, popupCdp, pageCdp, targetPrefix, pageUrl, sockets, initialStatus }) {
  const offscreenUrl = `chrome-extension://${extensionId}/offscreen/index.html`;
  const offscreen = await connectTarget(debugPort, (target) => target.url === offscreenUrl);
  sockets.push(offscreen.cdp);
  const baselineHeap = await offscreen.cdp.command('Runtime.getHeapUsage').catch(() => null);
  const baselineTicks = Number(initialStatus?.signalTickCount || 0);
  const startedAt = Date.now();
  const deadline = startedAt + captureHoldMs;
  const samples = [];
  let latestStatus = initialStatus;
  let finalHeap = baselineHeap;
  let maxHeapGrowthBytes = 0;
  let maxOutputPeak = Number(initialStatus?.averageOutputPeak || 0);
  let previousSignalTicks = baselineTicks;

  log(`capture hold started durationMs=${captureHoldMs} sampleMs=${holdSampleMs} baselineTicks=${baselineTicks}`);
  while (Date.now() < deadline) {
    await sleep(Math.min(holdSampleMs, Math.max(1, deadline - Date.now())));
    latestStatus = await readPopupCaptureStatus(popupCdp, targetPrefix, pageUrl);
    if (!latestStatus?.captureActive || latestStatus.captureState !== 'processing') {
      throw new Error(`capture hold lost the active session: ${JSON.stringify(latestStatus)}`);
    }
    if (latestStatus.captureContextState !== 'running' || Number(latestStatus.meterFrameAgeMs ?? Infinity) >= 1000) {
      throw new Error(`capture hold DSP became stale: ${JSON.stringify(latestStatus)}`);
    }
    if (latestStatus.captureError) {
      throw new Error(`capture hold reported an error: ${latestStatus.captureError}`);
    }
    const signalTicks = Number(latestStatus.signalTickCount || 0);
    const signalAgeMs = Number(latestStatus.lastSignalAgeMs ?? Infinity);
    if (!Number.isFinite(signalAgeMs) || signalAgeMs > maxHoldSignalAgeMs || signalTicks <= previousSignalTicks) {
      const mediaState = await readExternalMediaState(pageCdp);
      throw new Error(`capture hold input stopped progressing: ${JSON.stringify({ previousSignalTicks, signalTicks, signalAgeMs, maxHoldSignalAgeMs, mediaState })}`);
    }
    previousSignalTicks = signalTicks;
    if (process.env.WVB_E2E_SILENT_SINK === '1' && latestStatus.silentSink !== true) {
      throw new Error('capture hold lost the silent AudioContext sink');
    }
    if (Number(latestStatus.workletHardClippedSamples || 0) > 0 || Number(latestStatus.workletMaxHardClipOvershoot || 0) > 1e-9) {
      throw new Error(`capture hold detected hard clipping: ${JSON.stringify(latestStatus)}`);
    }
    maxOutputPeak = Math.max(maxOutputPeak, Number(latestStatus.averageOutputPeak || 0));
    finalHeap = await offscreen.cdp.command('Runtime.getHeapUsage').catch(() => finalHeap);
    if (baselineHeap?.usedSize != null && finalHeap?.usedSize != null) {
      maxHeapGrowthBytes = Math.max(maxHeapGrowthBytes, Number(finalHeap.usedSize) - Number(baselineHeap.usedSize));
      if (maxHeapGrowthBytes > maxHoldHeapGrowthBytes) {
        throw new Error(`capture hold heap growth too high: ${maxHeapGrowthBytes} bytes`);
      }
    }
    samples.push({
      atMs: Date.now() - startedAt,
      signalTickCount: Number(latestStatus.signalTickCount || 0),
      lastSignalAgeMs: latestStatus.lastSignalAgeMs == null ? null : Number(latestStatus.lastSignalAgeMs),
      inputDb: latestStatus.averageInputDb ?? null,
      outputDb: latestStatus.averageOutputDb ?? null,
      gainDb: Number(latestStatus.currentGainDb || 0),
      reductionDb: Number(latestStatus.averageReductionDb || 0),
      outputPeak: Number(latestStatus.averageOutputPeak || 0),
      heapBytes: finalHeap?.usedSize ?? null
    });
    log(`capture hold sample ${samples.length} ticks=${samples.at(-1).signalTickCount} gain=${samples.at(-1).gainDb.toFixed(2)}dB`);
  }

  const finalTicks = Number(latestStatus?.signalTickCount || 0);
  if (finalTicks <= baselineTicks + 5) {
    throw new Error(`capture hold signal ticks did not advance: ${baselineTicks} -> ${finalTicks}`);
  }
  const hold = {
    passed: true,
    requestedDurationMs: captureHoldMs,
    durationMs: Date.now() - startedAt,
    sampleMs: holdSampleMs,
    baselineTicks,
    finalTicks,
    signalTickDelta: finalTicks - baselineTicks,
    baselineHeapBytes: baselineHeap?.usedSize ?? null,
    finalHeapBytes: finalHeap?.usedSize ?? null,
    maxHeapGrowthBytes,
    maxAllowedHeapGrowthBytes: maxHoldHeapGrowthBytes,
    maxAllowedSignalAgeMs: maxHoldSignalAgeMs,
    maxOutputPeak,
    samples
  };
  log(`capture hold passed durationMs=${hold.durationMs} tickDelta=${hold.signalTickDelta} heapGrowth=${hold.maxHeapGrowthBytes}`);
  return { hold, latestStatus };
}

async function main() {
  const muteAudio = process.env.WVB_E2E_MUTE_AUDIO === '1';
  const silentSink = process.env.WVB_E2E_SILENT_SINK === '1';
  const captureOnly = muteAudio || process.env.WVB_E2E_CAPTURE_ONLY === '1';
  if (process.env.CI !== 'true' && process.env.WVB_E2E_ALLOW_LOCAL_AUDIO !== '1' && !muteAudio && !silentSink) {
    throw new Error('Local audio E2E is disabled by default because it emits test tones. Set WVB_E2E_MUTE_AUDIO=1 for a muted browser run, or WVB_E2E_ALLOW_LOCAL_AUDIO=1 only when a silent audio endpoint is selected.');
  }
  const chrome = findChrome();
  fs.mkdirSync(tmpDir, { recursive: true });
  assertInside(tmpDir, profileDir);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  stageExtensionForE2e();

  const { server, origin } = await startStaticServer();
  const debugPort = await reserveFreePort();
  const pageUrl = externalPageUrl || `${origin}/${scenario.page}`;
  const targetPrefix = externalPageUrl ? new URL(pageUrl).origin : origin;
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-logging=stderr',
    '--v=1',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-media-suspend',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-component-update',
    '--disable-features=CalculateNativeWinOcclusion,MediaPlaybackWhileNotVisiblePermissionPolicy',
    '--window-size=1000,800',
    'about:blank'
  ];
  if (process.env.WVB_E2E_HEADLESS === '1') {
    args.push('--headless=new');
  }
  if (muteAudio) {
    args.push('--mute-audio');
  }
  if (silentSink) {
    args.push('--disable-audio-output');
  }

  log(`launching isolated Chrome profile at ${profileDir}`);
  log(`scenario page=${externalPageUrl || scenario.page} expect=${scenario.expect}`);
  if (silentSink) log('fake browser output and a silent AudioContext sink requested; DSP remains live without hardware audio output');
  if (captureOnly) log('capture-only verification enabled; signal and gain assertions are skipped');
  const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let chromeStderr = '';
  let stderrProbeTail = '';
  let nativeAudioOutputOpened = false;
  child.stderr?.on('data', (chunk) => {
    const next = chunk.toString('utf8');
    const probe = `${stderrProbeTail}${next}`;
    nativeAudioOutputOpened ||= /WASAPIAudioOutputStream/i.test(probe);
    stderrProbeTail = probe.slice(-128);
    chromeStderr += next;
    if (chromeStderr.length > 12000) {
      chromeStderr = chromeStderr.slice(-12000);
    }
  });
  const sockets = [];
  try {
    const version = await waitForCdp(debugPort);
    const browserCdp = new CdpSocket(version.webSocketDebuggerUrl);
    await browserCdp.connect();
    sockets.push(browserCdp);

    const loaded = await browserCdp.command('Extensions.loadUnpacked', { path: extensionDir, enableInIncognito: false });
    const extensionId = loaded.id;
    if (!extensionId) {
      throw new Error('Extensions.loadUnpacked did not return an extension id.');
    }
    log(`loaded extension id ${extensionId}`);
    if (silentSink) {
      await configureSilentSinkInExtensionPage(browserCdp, debugPort, extensionId);
    }

    const createdTab = await browserCdp.command('Target.createTarget', { url: pageUrl, forTab: true });
    const page = await connectTarget(debugPort, (target) => target.type === 'page' && (
      target.id === createdTab.targetId
      || target.url.startsWith(targetPrefix)
    ));
    sockets.push(page.cdp);
    let externalPlayback = null;
    if (externalPageUrl) {
      externalPlayback = await prepareExternalMedia(
        page.cdp,
        Math.max(5000, Number(process.env.WVB_E2E_SITE_SETTLE_MS || 12000))
      );
      log(`external playback ${JSON.stringify(externalPlayback)}`);
      if (Number(externalPlayback?.playingCount || 0) < 1) {
        throw new Error(`No playing media was found on the real site: ${JSON.stringify(externalPlayback)}`);
      }
    } else {
      await clickElement(page.cdp, '#start');
    }
    if (scenario.playerVolume != null) {
      await evaluateValue(page.cdp, `((volume) => {
        for (const media of document.querySelectorAll('audio,video')) {
          media.muted = false;
          media.volume = volume;
          media.dispatchEvent(new Event('volumechange'));
        }
        window.__WVB_TEST_PLAYER_VOLUME__ = volume;
        return Array.from(document.querySelectorAll('audio,video')).map((media) => ({ volume: media.volume, muted: media.muted, paused: media.paused }));
      })(${JSON.stringify(scenario.playerVolume)})`);
      await sleep(250);
    }
    if (scenario.expect === 'muted') {
      await evaluateValue(page.cdp, `(() => {
        for (const media of document.querySelectorAll('audio,video')) {
          media.muted = false;
          media.volume = 0;
        }
        return Array.from(document.querySelectorAll('audio,video')).map((media) => ({ volume: media.volume, muted: media.muted, paused: media.paused }));
      })()`);
      await sleep(250);
    }

    const targets = await httpJson(`http://127.0.0.1:${debugPort}/json/list`);
    log(`targets ${targets.map((target) => `${target.type}:${target.url}`).join(' | ')}`);
    for (const target of targets.filter((item) => /chrome-extension:\/\//.test(item.url) && item.webSocketDebuggerUrl)) {
      const probe = new CdpSocket(target.webSocketDebuggerUrl);
      await probe.connect();
      sockets.push(probe);
      const manifest = await evaluateValue(probe, `(() => {
        try {
          const manifest = chrome.runtime?.getManifest?.();
          return manifest ? { name: manifest.name, version: manifest.version, background: manifest.background, options_page: manifest.options_page } : null;
        } catch (error) {
          return { error: String(error?.message || error) };
        }
      })()`).catch((error) => ({ error: String(error?.message || error) }));
      log(`extension target manifest ${target.type}:${target.url} => ${JSON.stringify(manifest)}`);
    }
    const targetInfos = await browserCdp.command('Target.getTargets');
    log(`targetInfos ${targetInfos.targetInfos.map((target) => `${target.type}:${target.targetId}:${target.url}`).join(' | ')}`);
    await browserCdp.command('Extensions.triggerAction', { id: extensionId, targetId: createdTab.targetId });
    log('extension action triggered');
    const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;
    const popup = await connectTarget(debugPort, (target) => target.url.startsWith(popupUrl));
    sockets.push(popup.cdp);
    log(`popup target ${popup.target.type}:${popup.target.url}`);
    if (checkPopupStrengthPersistence) {
      const sliderReady = await evaluateValue(popup.cdp, `(${async function waitForStrengthControl(targetOrigin) {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const send = (message) => new Promise((resolve) => {
          chrome.runtime.sendMessage(message, (response) => {
            const error = chrome.runtime.lastError;
            resolve(error ? { error: String(error.message || error) } : response);
          });
        });
        let input = null;
        let output = null;
        const controlStartedAt = Date.now();
        while (Date.now() - controlStartedAt < 5000) {
          input = document.querySelector('#cutRange');
          output = document.querySelector('#cutValue');
          if (input && output) break;
          await sleep(100);
        }
        if (!input || !output) {
          return {
            ok: false,
            error: 'missing-strength-control',
            readyState: document.readyState,
            url: location.href,
            bodyChildCount: document.body?.children?.length ?? null
          };
        }
        const tabs = await chrome.tabs.query({});
        const target = tabs.find((tab) => String(tab.url || '').startsWith(targetOrigin))
          || tabs.find((tab) => tab.active)
          || tabs[0];
        if (!target?.url) {
          return { ok: false, error: 'missing-target-tab' };
        }
        let initialized = false;
        let initialSaved = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          initialSaved = await send({ type: 'WVB_GET_SETTINGS', tabUrl: String(target.url) });
          const initialValue = Number(initialSaved?.cutStrength);
          if (
            !input.disabled
            && initialSaved?.siteKey === '127.0.0.1'
            && Number(input.value) === initialValue
            && Number(output.textContent) === initialValue
          ) {
            const rect = input.getBoundingClientRect();
            initialized = rect.width > 20 && rect.height > 0;
            break;
          }
          await sleep(100);
        }
        if (!initialized) {
          return {
            ok: false,
            error: 'popup-initialization-timeout',
            inputValue: Number(input.value),
            outputValue: Number(output.textContent),
            initialSaved
          };
        }
        const rect = input.getBoundingClientRect();
        return {
          ok: true,
          initialValue: Number(input.value),
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        };
      }})(${JSON.stringify(targetPrefix)})`, { userGesture: true });
      if (!sliderReady?.ok) {
        throw new Error(`Popup strength control did not initialize: ${JSON.stringify(sliderReady)}`);
      }
      const sliderX = Number(sliderReady.left) + (Number(sliderReady.width) * 0.37);
      const sliderY = Number(sliderReady.top) + (Number(sliderReady.height) / 2);
      await popup.cdp.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sliderX, y: sliderY });
      await popup.cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: sliderX, y: sliderY, button: 'left', buttons: 1, clickCount: 1 });
      await popup.cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sliderX, y: sliderY, button: 'left', buttons: 0, clickCount: 1 });
      const sliderResult = await evaluateValue(popup.cdp, `(${async function verifyStrengthPersistence(initialValue, targetOrigin) {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const send = (message) => new Promise((resolve) => {
          chrome.runtime.sendMessage(message, (response) => {
            const error = chrome.runtime.lastError;
            resolve(error ? { error: String(error.message || error) } : response);
          });
        });
        const input = document.querySelector('#cutRange');
        const output = document.querySelector('#cutValue');
        const tabs = await chrome.tabs.query({});
        const target = tabs.find((tab) => String(tab.url || '').startsWith(targetOrigin))
          || tabs.find((tab) => tab.active)
          || tabs[0];
        if (!input || !output || !target?.url) {
          return { ok: false, error: 'missing-persistence-target' };
        }
        let selectedValue = Number(input.value);
        let saved = null;
        let stableMatches = 0;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          selectedValue = Number(input.value);
          saved = await send({ type: 'WVB_GET_SETTINGS', tabUrl: String(target.url) });
          const matches = selectedValue !== Number(initialValue)
            && Number(output.textContent) === selectedValue
            && Number(saved?.cutStrength) === selectedValue
            && saved?.siteScoped === false;
          stableMatches = matches ? stableMatches + 1 : 0;
          if (stableMatches >= 3) {
            break;
          }
          await sleep(100);
        }
        return {
          ok: stableMatches >= 3,
          inputValue: Number(input.value),
          outputValue: Number(output.textContent),
          stableMatches,
          saved
        };
      }})(${JSON.stringify(sliderReady.initialValue)}, ${JSON.stringify(targetPrefix)})`, { userGesture: true });
      log(`slider persistence ${JSON.stringify(sliderResult)}`);
      if (!sliderResult?.ok) {
        throw new Error(`Popup strength persistence failed: ${JSON.stringify(sliderResult)}`);
      }
      await evaluateValue(popup.cdp, `(() => { document.querySelector('#cutRange')?.focus(); return true; })()`, { userGesture: true });
      await popup.cdp.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 });
      await popup.cdp.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 });
      await sleep(500);
    }
    if (requirePopupAutoCapture) {
      log('popup auto capture required; not clicking capture button');
    } else {
      await sleep(750);
      const preClickStatus = await evaluateValue(popup.cdp, `(${async function preClickCaptureStatus(targetOrigin) {
        const send = (message) => new Promise((resolve) => {
          chrome.runtime.sendMessage(message, (response) => {
            const error = chrome.runtime.lastError;
            resolve(error ? { error: String(error.message || error) } : response);
          });
        });
        const queryTabs = (query) => new Promise((resolve) => {
          chrome.tabs.query(query, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
        });
        const tabs = await queryTabs({});
        const target = tabs.find((tab) => String(tab.url || '').startsWith(targetOrigin))
          || tabs.find((tab) => tab.active)
          || tabs[0];
        if (!target?.id) {
          return { captureActive: false, error: 'no-target-tab' };
        }
        return await send({ type: 'WVB_GET_STATUS', tabId: target.id, tabUrl: target.url || '', ensure: false });
      }})(${JSON.stringify(targetPrefix)})`, { userGesture: true }).catch((error) => ({ error: String(error?.message || error) }));
      if (preClickStatus?.captureActive) {
        log('popup auto capture became active before manual button click');
      } else {
        await clickReadyElement(popup.cdp, '#captureButton');
        log('capture button clicked');
      }
    }

    const status = await evaluateValue(popup.cdp, `(${async function waitForCapture(targetOrigin, fallbackPageUrl, minSignalTicks, expectation, deferStop) {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const send = (message) => new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          resolve(error ? { error: String(error.message || error) } : response);
        });
      });
      const queryTabs = (query) => new Promise((resolve) => {
        chrome.tabs.query(query, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
      });
      const tabs = await queryTabs({});
      const target = tabs.find((tab) => String(tab.url || '').startsWith(targetOrigin))
        || tabs.find((tab) => tab.active)
        || tabs[0];
      if (!target?.id) {
        return { phase: 'error', error: 'Popup could not see target tab.', tabs };
      }
      const tabUrl = String(target.url || fallbackPageUrl);
      let latest = null;
      let runtimeMuteApplied = false;
      const observed = {
        maxReductionDb: 0,
        maxLiftDb: 0,
        minGainDb: 0,
        maxGainDb: 0,
        maxInputPeak: 0,
        maxOutputPeak: 0,
        maxLimiterTickCount: 0,
        maxOutputDeltaDb: -Infinity
      };
      for (let index = 0; index < 32; index += 1) {
        const tabStatus = await send({
          type: 'WVB_GET_STATUS',
          tabId: target.id,
          tabUrl,
          ensure: false
        }).catch((error) => ({ error: String(error?.message || error) }));
        observed.maxReductionDb = Math.max(observed.maxReductionDb, Number(tabStatus?.averageReductionDb) || 0);
        observed.maxLiftDb = Math.max(observed.maxLiftDb, Number(tabStatus?.averageLiftDb) || 0);
        observed.minGainDb = Math.min(observed.minGainDb, Number(tabStatus?.currentGainDb) || 0);
        observed.maxGainDb = Math.max(observed.maxGainDb, Number(tabStatus?.currentGainDb) || 0);
        observed.maxInputPeak = Math.max(observed.maxInputPeak, Number(tabStatus?.averageInputPeak) || 0);
        observed.maxOutputPeak = Math.max(observed.maxOutputPeak, Number(tabStatus?.averageOutputPeak) || 0);
        observed.maxLimiterTickCount = Math.max(observed.maxLimiterTickCount, Number(tabStatus?.limiterTickCount) || 0);
        if (Number.isFinite(Number(tabStatus?.averageInputDb)) && Number.isFinite(Number(tabStatus?.averageOutputDb))) {
          observed.maxOutputDeltaDb = Math.max(
            observed.maxOutputDeltaDb,
            Number(tabStatus.averageOutputDb) - Number(tabStatus.averageInputDb)
          );
        }
        latest = {
          phase: tabStatus?.captureActive ? 'capture-active' : 'capture-waiting',
          tab: tabStatus,
          diagnosticsError: tabStatus?.error || '',
          observed
        };
        const hasCapturedSignal = Number(tabStatus?.capture?.signalTickCount || tabStatus?.signalTickCount || 0) >= minSignalTicks;
        if (expectation === 'muted-during-capture' && tabStatus?.captureActive && hasCapturedSignal && !runtimeMuteApplied) {
          await chrome.scripting.executeScript({
            target: { tabId: target.id },
            func: () => {
              for (const media of document.querySelectorAll('audio,video')) {
                media.muted = false;
                media.volume = 0;
                media.dispatchEvent(new Event('volumechange'));
              }
            }
          }).catch(() => {});
          runtimeMuteApplied = true;
          await sleep(500);
          continue;
        }
        if (
          tabStatus?.captureActive &&
          tabStatus?.capturePipelineMode === 'programme-leveler-v4' &&
          ['leveler-worklet', 'worklet', 'analyser-fallback'].includes(tabStatus?.meterMode) &&
          Number(tabStatus?.meterFrameAgeMs ?? Infinity) < 1000 &&
          hasCapturedSignal &&
          (expectation !== 'muted-during-capture' || (runtimeMuteApplied && Boolean(tabStatus.playerMuted) && Number(tabStatus.playerVolumeCap) <= 0.01))
        ) {
          break;
        }
        await sleep(250);
      }
      if (expectation === 'burst' && latest?.tab?.captureActive && observed.maxReductionDb > 0) {
        for (let index = 0; index < 30; index += 1) {
          await sleep(100);
          const recoveryStatus = await send({
            type: 'WVB_GET_STATUS',
            tabId: target.id,
            tabUrl,
            ensure: false
          }).catch((error) => ({ error: String(error?.message || error) }));
          observed.maxReductionDb = Math.max(observed.maxReductionDb, Number(recoveryStatus?.averageReductionDb) || 0);
          observed.minGainDb = Math.min(observed.minGainDb, Number(recoveryStatus?.currentGainDb) || 0);
          observed.maxInputPeak = Math.max(observed.maxInputPeak, Number(recoveryStatus?.averageInputPeak) || 0);
          if (
            recoveryStatus?.captureActive
            && Number(recoveryStatus.averageInputPeak) < 0.08
            && Number(recoveryStatus.currentGainDb) > -3
          ) {
            latest.tab = recoveryStatus;
            latest.recoveryVerified = true;
            break;
          }
        }
      }
      const diagnostics = await send({ type: 'WVB_GET_DIAGNOSTICS' }).catch((error) => ({ error: String(error?.message || error), events: [] }));
      if (latest) {
        latest.recentEvents = Array.isArray(diagnostics.events) ? diagnostics.events.slice(0, 20) : [];
        latest.observed = observed;
      }
      if (deferStop) {
        latest.stopPhase = 'capture-held';
      } else {
        latest.stopResponse = await send({ type: 'WVB_STOP_TAB_CAPTURE', tabId: target.id })
          .catch((error) => ({ ok: false, error: String(error?.message || error) }));
        for (let index = 0; index < 24; index += 1) {
          const stoppedStatus = await send({
            type: 'WVB_GET_STATUS',
            tabId: target.id,
            tabUrl,
            ensure: false
          }).catch((error) => ({ error: String(error?.message || error) }));
          latest.stopTab = stoppedStatus;
          if (!stoppedStatus?.captureActive) {
            latest.stopPhase = 'capture-stopped';
            break;
          }
          await sleep(250);
        }
        if (!latest.stopPhase) {
          latest.stopPhase = 'capture-still-active';
        }
      }
      return latest || { phase: 'error' };
    }})(${JSON.stringify(targetPrefix)}, ${JSON.stringify(pageUrl)}, ${JSON.stringify(scenario.minSignalTicks)}, ${JSON.stringify(scenario.expect)}, ${JSON.stringify(captureHoldMs > 0)})`, { userGesture: true });
    log('status polled');
    if (captureHoldMs > 0 && status?.phase === 'capture-active') {
      let holdFailure = null;
      try {
        const held = await holdCapture({
          debugPort,
          extensionId,
          popupCdp: popup.cdp,
          pageCdp: externalPageUrl ? page.cdp : null,
          targetPrefix,
          pageUrl,
          sockets,
          initialStatus: status.tab || {}
        });
        status.hold = held.hold;
        status.tab = held.latestStatus;
      } catch (error) {
        holdFailure = error;
        status.hold = {
          passed: false,
          requestedDurationMs: captureHoldMs,
          error: String(error?.message || error)
        };
      }
      const stopped = await stopPopupCapture(popup.cdp, targetPrefix, pageUrl);
      Object.assign(status, stopped);
      if (holdFailure) throw holdFailure;
    }
    const afterTargets = await httpJson(`http://127.0.0.1:${debugPort}/json/list`);
    log(`after targets ${afterTargets.map((target) => `${target.type}:${target.url}`).join(' | ')}`);
    const offscreenTarget = afterTargets.find((target) => target.url === `chrome-extension://${extensionId}/offscreen/index.html`);
    if (offscreenTarget?.webSocketDebuggerUrl) {
      const offscreen = new CdpSocket(offscreenTarget.webSocketDebuggerUrl);
      await offscreen.connect();
      sockets.push(offscreen);
      const probe = await evaluateValue(offscreen, `(() => ({
        href: location.href,
        readyState: document.readyState,
        hasChromeRuntime: Boolean(chrome?.runtime),
        hasCore: Boolean(globalThis.WebVolumeBalancerCore),
        ready: globalThis.__WVB_OFFSCREEN_READY__ || '',
        error: globalThis.__WVB_OFFSCREEN_ERROR__ || '',
        scripts: Array.from(document.scripts).map((script) => script.src),
        body: document.body ? document.body.innerText : ''
      }))()`).catch((error) => ({ error: String(error?.message || error) }));
      log(`offscreen probe ${JSON.stringify(probe)}`);
    }
    console.log(JSON.stringify(status, null, 2));
    if (status?.phase !== 'capture-active') {
      throw new Error(`Capture did not become active: ${status?.phase || 'unknown'}`);
    }
    const tab = status.tab || {};
    if (tab.capturePipelineMode !== 'programme-leveler-v4') {
      throw new Error(`Unexpected pipeline mode: ${tab.capturePipelineMode}`);
    }
    if (tab.staleEngine) {
      throw new Error('page engine still reports staleEngine=true after runtime version sync');
    }
    if (!tab.captureActive) {
      throw new Error('captureActive was false');
    }
    if (!['leveler-worklet', 'worklet', 'analyser-fallback'].includes(tab.meterMode)) {
      throw new Error(`Audio meter did not start: ${tab.meterMode || 'none'} ${tab.meterError || ''}`);
    }
    if (Number(tab.meterFrameAgeMs ?? Infinity) >= 1000) {
      throw new Error(`Audio meter became stale: ${tab.meterFrameAgeMs}`);
    }
    const signalTicks = Number(tab.capture?.signalTickCount || tab.signalTickCount || 0);
    if (silentSink && tab.silentSink !== true) {
      throw new Error(`Silent AudioContext sink was not active: ${JSON.stringify({ silentSink: tab.silentSink, captureState: tab.captureState, captureError: tab.captureError })}`);
    }
    if (!captureOnly && scenario.expect !== 'muted' && signalTicks < scenario.minSignalTicks) {
      throw new Error('capture became active but no input signal was measured');
    }
    if (!captureOnly && scenario.expect !== 'muted' && !Number.isFinite(Number(tab.averageInputDb))) {
      throw new Error('capture signal was measured but averageInputDb was missing');
    }
    if (!captureOnly && scenario.expect !== 'muted' && !Number.isFinite(Number(tab.averageOutputDb))) {
      throw new Error('capture signal was measured but averageOutputDb was missing');
    }
    const observed = status.observed || {};
    if (!captureOnly && scenario.expect === 'reduce') {
      if (Number(tab.averageReductionDb) < scenario.minReductionDb) {
        throw new Error(`leveler did not reduce enough: ${tab.averageReductionDb}`);
      }
      if (Number(tab.currentGainDb) > -scenario.minReductionDb) {
        throw new Error(`leveler currentGainDb did not show active reduction: ${tab.currentGainDb}`);
      }
    }
    if (!captureOnly && scenario.expect === 'lift') {
      if (Number(observed.maxLiftDb || tab.averageLiftDb) < scenario.minLiftDb) {
        throw new Error(`leveler did not lift the quiet test tone enough: ${tab.averageLiftDb}`);
      }
      if (Number(tab.currentGainDb) < scenario.minLiftDb) {
        throw new Error(`leveler currentGainDb did not show active lift: ${tab.currentGainDb}`);
      }
      const outputDeltaDb = Number(tab.averageOutputDb) - Number(tab.averageInputDb);
      const observedOutputDeltaDb = Math.max(outputDeltaDb, Number(observed.maxOutputDeltaDb));
      if (!Number.isFinite(observedOutputDeltaDb) || observedOutputDeltaDb < scenario.minLiftOutputDeltaDb) {
        throw new Error(`leveler did not raise actual output enough: input=${tab.averageInputDb} output=${tab.averageOutputDb} maxDelta=${observed.maxOutputDeltaDb}`);
      }
      const outputCeilingDb = Number(tab.playerVolumeLiftCeilingDb);
      if (scenario.playerVolume != null && scenario.playerVolume < 0.98 && Number.isFinite(outputCeilingDb) && Number(tab.averageOutputDb) > outputCeilingDb + 3) {
        throw new Error(`leveler exceeded player-volume-aware lift ceiling: ${JSON.stringify({ outputDb: tab.averageOutputDb, outputCeilingDb, playerVolume: scenario.playerVolume })}`);
      }
    }
    if (!captureOnly && scenario.expect === 'hold') {
      const currentGain = Math.abs(Number(tab.currentGainDb) || 0);
      const liftDb = Number(observed.maxLiftDb || tab.averageLiftDb) || 0;
      const reductionDb = Number(observed.maxReductionDb || tab.averageReductionDb) || 0;
      if (currentGain > scenario.maxHoldGainDb || liftDb > scenario.maxHoldGainDb || reductionDb > scenario.maxHoldGainDb) {
        throw new Error(`leveler should hold low player-volume normal source near unity: ${JSON.stringify({ currentGain, liftDb, reductionDb })}`);
      }
    }
    if (!captureOnly && scenario.expect === 'burst') {
      if (Number(observed.maxReductionDb) < scenario.minReductionDb) {
        throw new Error(`burst scenario did not reduce during the observation window: ${observed.maxReductionDb}`);
      }
      if (status.recoveryVerified !== true) {
        throw new Error(`burst scenario did not return near unity during a quiet interval: ${tab.currentGainDb}`);
      }
    }
    if (!captureOnly && (scenario.expect === 'muted' || scenario.expect === 'muted-during-capture')) {
      if (!tab.playerMuted || Number(tab.playerVolumeCap) > 0.01) {
        throw new Error(`player mute state was not respected: ${JSON.stringify({ playerMuted: tab.playerMuted, playerVolumeCap: tab.playerVolumeCap })}`);
      }
      if (Number(tab.averageOutputPeak || 0) > 0.002) {
        throw new Error(`muted player still produced output peak: ${tab.averageOutputPeak}`);
      }
    }
    if (status.stopPhase !== 'capture-stopped') {
      throw new Error(`Capture did not stop cleanly: ${status.stopPhase || 'unknown'}`);
    }
    if (status.stopResponse?.ok !== true) {
      throw new Error(`Capture stop returned an error: ${status.stopResponse?.error || 'unknown'}`);
    }
    await sleep(150);
    if (silentSink && nativeAudioOutputOpened) {
      throw new Error('Native WASAPI output opened during a silent E2E run.');
    }
    const report = {
      version: manifestVersion,
      generatedAt: new Date().toISOString(),
      passed: true,
      captureOnly,
      silentSink,
      nativeAudioOutputOpened,
      requestedUrl: externalPageUrl || null,
      finalUrl: externalPlayback?.url || pageUrl,
      pageTitle: externalPlayback?.title || '',
      externalPlayback,
      hold: status.hold || null,
      scenario,
      phase: status.phase,
      stopPhase: status.stopPhase,
      stopOk: status.stopResponse?.ok === true,
      tab: {
        captureActive: Boolean(tab.captureActive),
        captureState: tab.captureState || '',
        capturePipelineMode: tab.capturePipelineMode || '',
        captureContextState: tab.captureContextState || '',
        silentSink: tab.silentSink === true,
        captureTrackCount: Number(tab.captureTrackCount || 0),
        captureAudioTrackCount: Number(tab.captureAudioTrackCount || 0),
        meterMode: tab.meterMode || '',
        meterFrameAgeMs: tab.meterFrameAgeMs == null ? null : Number(tab.meterFrameAgeMs),
        signalTickCount: Number(tab.signalTickCount || 0),
        lastSignalAgeMs: tab.lastSignalAgeMs == null ? null : Number(tab.lastSignalAgeMs),
        averageInputDb: tab.averageInputDb ?? null,
        averageOutputDb: tab.averageOutputDb ?? null,
        averageLiftDb: Number(tab.averageLiftDb || 0),
        averageReductionDb: Number(tab.averageReductionDb || 0),
        currentGainDb: Number(tab.currentGainDb || 0),
        currentLiftDb: Number(tab.currentLiftDb || 0),
        currentReductionDb: Number(tab.currentReductionDb || 0),
        limiterReductionDb: Number(tab.limiterReductionDb || 0),
        limiterTickCount: Number(tab.limiterTickCount || 0),
        workletHardClippedSamples: Number(tab.workletHardClippedSamples || 0),
        workletMaxHardClipOvershoot: Number(tab.workletMaxHardClipOvershoot || 0),
        effectiveMaxLiftDb: Number(tab.effectiveMaxLiftDb || 0),
        playerVolumeLiftCeilingDb: Number(tab.playerVolumeLiftCeilingDb == null ? -31 : tab.playerVolumeLiftCeilingDb),
        averageInputPeak: Number(tab.averageInputPeak || 0),
        averageOutputPeak: Number(tab.averageOutputPeak || 0),
        playerMuted: Boolean(tab.playerMuted),
        playerVolumeCap: Number(tab.playerVolumeCap == null ? 1 : tab.playerVolumeCap),
        playerVolumeKnown: tab.playerVolumeKnown === true,
        captureError: tab.captureError || ''
      },
      observed: status.observed || {}
    };
    for (const reportName of scenarioReportNames) {
      writeJson(path.join(tmpDir, reportName), report);
    }
    writeJson(scenarioReportPath, report);
    writeJson(latestReportPath, report);
    log('PoC smoke passed');
  } finally {
    for (const socket of sockets) {
      socket.close();
    }
    if (chromeStderr.trim()) {
      log(`chrome stderr tail ${chromeStderr.trim().split(/\r?\n/).slice(-20).join(' || ')}`);
    }
    child.kill();
    await waitForChildExit(child);
    server.close();
    // Chromium can briefly retain a profile lock after its parent process has
    // exited on Windows. Each run uses unique directories, so a transient
    // cleanup lock must not turn an otherwise valid audio result into a test
    // failure.
    cleanupRunDirectories({ tolerateTransientLocks: true });
  }
}

main().catch((error) => {
  console.error(`[e2e] FAIL ${error.message}`);
  process.exit(1);
});
