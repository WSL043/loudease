const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmpDir = path.join(root, 'tmp');
const runSuffix = `${Date.now()}-${process.pid}`;
const profileDir = path.join(tmpDir, `e2e-stability-profile-${runSuffix}`);
const extensionDir = path.join(tmpDir, `e2e-stability-extension-${runSuffix}`);
const testPagesDir = path.join(root, 'test-pages');
const longRunReportPath = path.join(tmpDir, 'latest-long-run.json');
const scenarioPage = process.env.WVB_E2E_PAGE || 'switching-audio.html';
const scenarioSlug = scenarioPage.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'page';
const switchReportPath = path.join(tmpDir, `latest-e2e-switch-${scenarioSlug}.json`);
const latestSwitchReportPath = path.join(tmpDir, 'latest-e2e-switch.json');
const cycles = Number(process.env.WVB_E2E_CYCLES || 10);
const holdMs = Number(process.env.WVB_E2E_HOLD_MS || 0);
const holdSampleMs = Number(process.env.WVB_E2E_HOLD_SAMPLE_MS || 5000);
const maxHeapGrowthBytes = Number(process.env.WVB_E2E_MAX_HEAP_GROWTH_MB || 32) * 1024 * 1024;
const silentSink = process.env.WVB_E2E_SILENT_SINK === '1';
const MIN_SWITCH_LIFT_DB = 4;
const manifestVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
})();

function log(message) {
  console.log(`[e2e-stability] ${message}`);
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

function cleanupRunDirectories() {
  for (const directory of [profileDir, extensionDir]) {
    assertInside(tmpDir, directory);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (fs.existsSync(directory)) {
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
    const requestPath = url.pathname === '/' ? `/${scenarioPage}` : url.pathname;
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
    if (entry.name === 'tmp' || entry.name === '.git') {
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

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (_) {
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
      if ((first & 0x0f) === 1) {
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
    this.sendFrame(JSON.stringify({ id, method, params }));
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
  while (Date.now() - startedAt < 10000) {
    const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find(predicate);
    if (target?.webSocketDebuggerUrl) {
      const cdp = new CdpSocket(target.webSocketDebuggerUrl);
      await cdp.connect();
      return { target, cdp };
    }
    await sleep(200);
  }
  throw new Error('Target not found.');
}

async function configureSilentSink(debugPort, extensionId, sockets) {
  if (!silentSink) {
    return;
  }
  const target = await connectTarget(
    debugPort,
    (item) => item.url === `chrome-extension://${extensionId}/background.js`
  );
  sockets.push(target.cdp);
  const configured = await evaluateValue(target.cdp, `(${async function setSilentSink(key) {
    await chrome.storage.local.set({ [key]: true });
    const stored = await chrome.storage.local.get(key);
    return stored[key] === true;
  }})(${JSON.stringify('webVolumeBalancer.e2eSilentSink')})`);
  if (configured !== true) {
    throw new Error('Failed to configure the silent AudioContext sink.');
  }
  log('silent AudioContext sink configured; DSP remains live without hardware audio output');
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
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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

async function waitForPageReady(cdp, timeoutMs = 10000) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await evaluateValue(cdp, `(() => ({
      readyState: document.readyState,
      hasStart: Boolean(document.querySelector('#start')),
      href: location.href
    }))()`).catch((error) => ({ error: String(error?.message || error) }));
    if (latest?.readyState === 'complete' && latest?.hasStart) {
      return latest;
    }
    await sleep(150);
  }
  throw new Error(`Page did not become ready after reload: ${JSON.stringify(latest)}`);
}

async function waitHarnessPhase(cdp, phase, timeoutMs = 12000) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await evaluateValue(cdp, 'window.__WVB_E2E_STATUS__ || null').catch((error) => ({ phase: 'error', error: String(error.message || error) }));
    if (latest?.phase === phase) {
      return latest;
    }
    if (latest?.phase === 'error') {
      throw new Error(`Harness error while waiting for ${phase}: ${latest.error}`);
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for harness phase ${phase}: ${JSON.stringify(latest)}`);
}

async function readRuntimeStatus(cdp, targetPrefix) {
  return await evaluateValue(cdp, `(${async function readStatus(prefix) {
    const send = (message) => new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { error: String(error.message || error) } : response);
      });
    });
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.id && String(item.url || '').startsWith(prefix));
    if (!tab?.id) {
      return { phase: 'missing-tab', tabs };
    }
    const status = await send({ type: 'WVB_GET_STATUS', tabId: tab.id, tabUrl: tab.url, ensure: false });
    const diagnostics = await send({ type: 'WVB_GET_DIAGNOSTICS' });
    const diagnosticTab = Array.isArray(diagnostics?.tabs)
      ? diagnostics.tabs.find((item) => Number(item.tabId) === Number(tab.id))
      : null;
    return {
      phase: 'status',
      tabId: tab.id,
      status,
      diagnosticTab,
      recentEvents: Array.isArray(diagnostics?.events) ? diagnostics.events.slice(0, 20) : []
    };
  }})(${JSON.stringify(targetPrefix)})`);
}

async function readDiagnostics(cdp) {
  return await evaluateValue(cdp, `(${async function getDiagnostics() {
    return await chrome.runtime.sendMessage({ type: 'WVB_GET_DIAGNOSTICS' });
  }})()`);
}

async function invokeActionForGrantAndStopAutoCapture({
  browserCdp,
  debugPort,
  extensionId,
  targetId,
  targetPrefix,
  sockets
}) {
  await browserCdp.command('Extensions.triggerAction', { id: extensionId, targetId });
  await sleep(500);
  const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;
  const popup = await connectTarget(debugPort, (target) => target.type === 'page' && target.url.startsWith(popupUrl));
  sockets.push(popup.cdp);
  const stopped = await evaluateValue(popup.cdp, `(${async function stopAutoCapture(prefix) {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.id && String(item.url || '').startsWith(prefix));
    if (!tab?.id) {
      return { ok: false, error: 'missing target tab' };
    }
    const before = await chrome.runtime.sendMessage({ type: 'WVB_GET_STATUS', tabId: tab.id, tabUrl: tab.url, ensure: false });
    if (before?.captureActive) {
      const stop = await chrome.runtime.sendMessage({ type: 'WVB_STOP_TAB_CAPTURE', tabId: tab.id });
      return { ok: Boolean(stop?.ok), stopped: true, before };
    }
    return { ok: true, stopped: false, before };
  }})(${JSON.stringify(targetPrefix)})`).catch((error) => ({ ok: false, error: String(error?.message || error) }));
  log(`action grant auto-capture cleanup ${JSON.stringify({
    ok: Boolean(stopped?.ok),
    stopped: Boolean(stopped?.stopped),
    error: stopped?.error || ''
  })}`);
  await sleep(250);
}

function activeCaptureOwners(diagnostics) {
  return (Array.isArray(diagnostics?.tabs) ? diagnostics.tabs : [])
    .filter((tab) => tab?.captureActive)
    .map((tab) => ({
      tabId: Number(tab.tabId),
      url: String(tab.url || ''),
      capturePipelineMode: String(tab.capturePipelineMode || ''),
      captureAudioTrackCount: Number(tab.captureAudioTrackCount || 0),
      meterMode: String(tab.meterMode || ''),
      meterFrameAgeMs: tab.meterFrameAgeMs == null ? null : Number(tab.meterFrameAgeMs),
      signalTickCount: Number(tab.signalTickCount || 0),
      captureContextState: String(tab.captureContextState || '')
    }));
}

function assertActiveCapture(snapshot, label) {
  const status = snapshot?.tab || snapshot?.status || snapshot?.diagnosticTab || {};
  if (!status.captureActive) {
    throw new Error(`${label}: captureActive=false ${JSON.stringify(status)}`);
  }
  if (status.capturePipelineMode !== 'programme-leveler-v4') {
    throw new Error(`${label}: unexpected pipeline ${status.capturePipelineMode}`);
  }
  if (Number(status.captureAudioTrackCount || status.capture?.audioTrackCount || 0) < 1) {
    throw new Error(`${label}: no captured audio track ${JSON.stringify(status)}`);
  }
  if (!['leveler-worklet', 'worklet', 'analyser-fallback'].includes(status.meterMode)) {
    throw new Error(`${label}: audio meter did not start ${JSON.stringify(status)}`);
  }
  if (Number(status.meterFrameAgeMs ?? Infinity) >= 1000) {
    throw new Error(`${label}: audio meter is stale ${JSON.stringify(status)}`);
  }
  if (Number(status.signalTickCount || status.capture?.signalTickCount || 0) < 1) {
    throw new Error(`${label}: no measured signal ${JSON.stringify(status)}`);
  }
  if (status.captureError) {
    throw new Error(`${label}: capture error ${status.captureError}`);
  }
  if (silentSink && status.silentSink !== true) {
    throw new Error(`${label}: silent AudioContext sink is not active ${JSON.stringify(status)}`);
  }
}

async function assertStopped(cdp, targetPrefix, label) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < 8000) {
    latest = await readRuntimeStatus(cdp, targetPrefix);
    const status = latest?.status || {};
    if (!status.captureActive) {
      return latest;
    }
    await sleep(200);
  }
  throw new Error(`${label}: capture did not stop ${JSON.stringify(latest)}`);
}

async function readHeap(cdp) {
  try {
    return await cdp.command('Runtime.getHeapUsage');
  } catch (_) {
    return null;
  }
}

async function assertHoldStable(debugPort, extensionId, harnessCdp, targetPrefix) {
  if (holdMs <= 0) {
    return;
  }

  const offscreenUrl = `chrome-extension://${extensionId}/offscreen/index.html`;
  const offscreen = await connectTarget(debugPort, (target) => target.url === offscreenUrl);
  let baselineStatus = null;
  let latestStatus = null;
  let baselineHeap = null;
  let latestHeap = null;
  let baselineTicks = 0;
  let finalTicks = 0;
  let baselineStartedAt = 0;
  let sampleCount = 0;
  let maxObservedOutputPeak = 0;
  let maxObservedHeapGrowthBytes = 0;
  const startedAt = Date.now();

  const writeLongRunReport = (extra = {}) => {
    const latest = latestStatus?.status || {};
    writeJson(longRunReportPath, {
      version: manifestVersion,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      requestedDurationMs: holdMs,
      sampleMs: holdSampleMs,
      cycles,
      passed: false,
      baselineTicks,
      finalTicks,
      signalTickDelta: finalTicks - baselineTicks,
      sampleCount,
      baselineStartedAt,
      latestStartedAt: Number(latest.capture?.startedAt || latest.startedAt || 0),
      baselineHeapBytes: baselineHeap?.usedSize ?? null,
      finalHeapBytes: latestHeap?.usedSize ?? null,
      maxHeapGrowthBytes: maxObservedHeapGrowthBytes,
      maxAllowedHeapGrowthBytes: maxHeapGrowthBytes,
      maxObservedOutputPeak,
      finalContextState: latest.captureContextState || '',
      finalSilentSink: latest.silentSink === true,
      finalAudioTrackCount: Number(latest.captureAudioTrackCount || latest.capture?.audioTrackCount || 0),
      finalTrackCount: Number(latest.captureTrackCount || latest.capture?.trackCount || 0),
      finalOutputPeak: Number(latest.averageOutputPeak || 0),
      finalCaptureActive: Boolean(latest.captureActive),
      ...extra
    });
  };

  try {
    baselineStatus = await readRuntimeStatus(harnessCdp, targetPrefix);
    assertActiveCapture(baselineStatus, 'long-run baseline');
    baselineHeap = await readHeap(offscreen.cdp);
    baselineTicks = Number(baselineStatus?.status?.signalTickCount || 0);
    baselineStartedAt = Number(baselineStatus?.status?.capture?.startedAt || baselineStatus?.status?.startedAt || 0);
    const deadline = Date.now() + holdMs;
    log(`long-run hold started durationMs=${holdMs} baselineTicks=${baselineTicks} baselineHeap=${baselineHeap?.usedSize ?? 'n/a'}`);

    while (Date.now() < deadline) {
      await sleep(Math.min(holdSampleMs, Math.max(100, deadline - Date.now())));
      sampleCount += 1;
      latestStatus = await readRuntimeStatus(harnessCdp, targetPrefix);
      assertActiveCapture(latestStatus, 'long-run sample');
      const status = latestStatus.status || {};
      maxObservedOutputPeak = Math.max(maxObservedOutputPeak, Number(status.averageOutputPeak || 0));
      if (status.captureContextState && status.captureContextState !== 'running') {
        throw new Error(`long-run context not running: ${JSON.stringify(status)}`);
      }
      if (Number(status.averageOutputPeak || 0) > 1) {
        throw new Error(`long-run output clipped: ${JSON.stringify(status)}`);
      }
      const nextStartedAt = Number(status.capture?.startedAt || status.startedAt || 0);
      if (baselineStartedAt && nextStartedAt && nextStartedAt !== baselineStartedAt) {
        throw new Error(`long-run capture restarted unexpectedly: ${baselineStartedAt} -> ${nextStartedAt}`);
      }
      latestHeap = await readHeap(offscreen.cdp);
      if (baselineHeap?.usedSize != null && latestHeap?.usedSize != null) {
        const growth = Number(latestHeap.usedSize) - Number(baselineHeap.usedSize);
        maxObservedHeapGrowthBytes = Math.max(maxObservedHeapGrowthBytes, growth);
        if (growth > maxHeapGrowthBytes) {
          throw new Error(`long-run heap growth too high: ${growth} bytes`);
        }
      }
    }

    latestStatus = await readRuntimeStatus(harnessCdp, targetPrefix);
    assertActiveCapture(latestStatus, 'long-run final');
    finalTicks = Number(latestStatus?.status?.signalTickCount || 0);
    if (finalTicks <= baselineTicks + 5) {
      throw new Error(`long-run signal ticks did not advance: ${baselineTicks} -> ${finalTicks}`);
    }
    latestHeap = latestHeap || await readHeap(offscreen.cdp);
    writeLongRunReport({ passed: true });
    log(`long-run hold passed finalTicks=${finalTicks} finalHeap=${latestHeap?.usedSize ?? 'n/a'}`);
  } catch (error) {
    writeLongRunReport({
      passed: false,
      error: String(error?.message || error)
    });
    throw error;
  } finally {
    offscreen.cdp.close();
  }
}

async function assertMultiOwnerPersistence({
  browserCdp,
  debugPort,
  extensionId,
  origin,
  firstPageUrl,
  firstHarnessCdp,
  sockets
}) {
  const secondPageUrl = `${origin}/quiet-dialog.html?multi-owner-persistence=1`;
  const secondTab = await browserCdp.command('Target.createTarget', { url: secondPageUrl, forTab: true });
  const secondPage = await connectTarget(debugPort, (target) => target.type === 'page' && target.url === secondPageUrl);
  sockets.push(secondPage.cdp);
  await waitForPageReady(secondPage.cdp);
  await clickReadyElement(secondPage.cdp, '#start');
  await invokeActionForGrantAndStopAutoCapture({
    browserCdp,
    debugPort,
    extensionId,
    targetId: secondTab.targetId,
    targetPrefix: secondPageUrl,
    sockets
  });

  const secondHarnessUrl = `chrome-extension://${extensionId}/e2e/harness.html?targetPrefix=${encodeURIComponent(secondPageUrl)}`;
  await browserCdp.command('Target.createTarget', { url: secondHarnessUrl, forTab: true });
  const secondHarness = await connectTarget(debugPort, (target) => target.type === 'page' && target.url.startsWith(secondHarnessUrl));
  sockets.push(secondHarness.cdp);

  await clickReadyElement(secondHarness.cdp, '#start');
  const secondActive = await waitHarnessPhase(secondHarness.cdp, 'capture-active');
  assertActiveCapture(secondActive, 'multi-owner second active');

  const firstStillActive = await readRuntimeStatus(firstHarnessCdp, firstPageUrl);
  assertActiveCapture(firstStillActive, 'multi-owner first remains active');
  const diagnostics = await readDiagnostics(secondHarness.cdp);
  const owners = activeCaptureOwners(diagnostics);
  if (owners.length < 2 || !owners.some((owner) => owner.url === firstPageUrl) || !owners.some((owner) => owner.url === secondPageUrl)) {
    throw new Error(`multi-owner invariant failed ${JSON.stringify(owners)}`);
  }

  await clickReadyElement(secondHarness.cdp, '#stop');
  const secondStopped = await waitHarnessPhase(secondHarness.cdp, 'stopped');
  if (secondStopped?.response?.ok !== true) {
    throw new Error(`multi-owner second stop failed ${JSON.stringify(secondStopped?.response)}`);
  }
  await assertStopped(secondHarness.cdp, secondPageUrl, 'multi-owner second stopped');
  const firstAfterSecondStop = await readRuntimeStatus(firstHarnessCdp, firstPageUrl);
  assertActiveCapture(firstAfterSecondStop, 'multi-owner first survives second stop');
  await clickReadyElement(firstHarnessCdp, '#stop');
  await waitHarnessPhase(firstHarnessCdp, 'stopped');
  await assertStopped(firstHarnessCdp, firstPageUrl, 'multi-owner first stopped');
  log(`multi-owner persistence passed ${JSON.stringify(owners)}`);
}

async function main() {
  if (process.env.CI !== 'true' && process.env.WVB_E2E_ALLOW_LOCAL_AUDIO !== '1' && !silentSink) {
    throw new Error('Local audio E2E is disabled by default because it emits test tones. Set WVB_E2E_ALLOW_LOCAL_AUDIO=1 only when a silent audio endpoint is selected.');
  }
  const chrome = findChrome();
  fs.mkdirSync(tmpDir, { recursive: true });
  assertInside(tmpDir, profileDir);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  stageExtensionForE2e();

  const { server, origin } = await startStaticServer();
  const debugPort = await reserveFreePort();
  const pageUrl = `${origin}/${scenarioPage}`;
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-logging=stderr',
    '--v=1',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1000,800',
    'about:blank'
  ];
  if (process.env.WVB_E2E_HEADLESS === '1') {
    args.push('--headless=new');
  }
  if (silentSink) {
    args.push('--disable-audio-output');
  }

  log(`launching isolated Chrome profile at ${profileDir}`);
  if (silentSink) log('silent AudioContext sink requested');
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
    await configureSilentSink(debugPort, extensionId, sockets);

    const createdTab = await browserCdp.command('Target.createTarget', { url: pageUrl, forTab: true });
    const page = await connectTarget(debugPort, (target) => target.type === 'page' && target.url === pageUrl);
    sockets.push(page.cdp);
    await clickReadyElement(page.cdp, '#start');
    let pageState = null;
    if (scenarioPage === 'dynamic-video-replace.html') {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 5000) {
        const currentState = await evaluateValue(page.cdp, 'window.__WVB_SWITCH_STATE__ || null');
        if (typeof currentState?.text === 'string' && currentState.text !== 'idle') {
          pageState = currentState;
          break;
        }
        await sleep(100);
      }
    } else {
      pageState = await evaluateValue(page.cdp, 'window.__WVB_SWITCH_STATE__ || null');
    }
    log(`page state ${JSON.stringify(pageState)}`);
    await invokeActionForGrantAndStopAutoCapture({
      browserCdp,
      debugPort,
      extensionId,
      targetId: createdTab.targetId,
      targetPrefix: origin,
      sockets
    });

    const harnessUrl = `chrome-extension://${extensionId}/e2e/harness.html?targetPrefix=${encodeURIComponent(origin)}`;
    await browserCdp.command('Target.createTarget', { url: harnessUrl, forTab: true });
    const harness = await connectTarget(debugPort, (target) => target.type === 'page' && target.url.startsWith(harnessUrl));
    sockets.push(harness.cdp);

    for (let index = 1; index <= cycles; index += 1) {
      await clickReadyElement(harness.cdp, '#start');
      const active = await waitHarnessPhase(harness.cdp, 'capture-active');
      assertActiveCapture(active, `cycle ${index} active`);
      await clickReadyElement(harness.cdp, '#stop');
      const stopped = await waitHarnessPhase(harness.cdp, 'stopped');
      if (stopped?.response?.ok !== true) {
        throw new Error(`cycle ${index}: stop response failed ${JSON.stringify(stopped?.response)}`);
      }
      await assertStopped(harness.cdp, origin, `cycle ${index} stopped`);
      log(`cycle ${index}/${cycles} passed`);
    }

    await page.cdp.command('Page.reload', { ignoreCache: true });
    await waitForPageReady(page.cdp);
    await clickReadyElement(page.cdp, '#start');
    await invokeActionForGrantAndStopAutoCapture({
      browserCdp,
      debugPort,
      extensionId,
      targetId: createdTab.targetId,
      targetPrefix: origin,
      sockets
    });
    await clickReadyElement(harness.cdp, '#start');
    const afterReload = await waitHarnessPhase(harness.cdp, 'capture-active');
    assertActiveCapture(afterReload, 'after reload active');
    await clickReadyElement(harness.cdp, '#stop');
    await waitHarnessPhase(harness.cdp, 'stopped');
    await assertStopped(harness.cdp, origin, 'after reload stopped');
    log('reload restart passed');

    await clickReadyElement(harness.cdp, '#start');
    const beforeSwitch = await waitHarnessPhase(harness.cdp, 'capture-active');
    assertActiveCapture(beforeSwitch, 'switch active before change');
    const beforeStatus = await readRuntimeStatus(harness.cdp, origin);
    const beforeTicks = Number(beforeStatus?.status?.signalTickCount || 0);
    await evaluateValue(page.cdp, `(() => {
      document.getElementById('switch').click();
      return window.__WVB_SWITCH_STATE__ || null;
    })()`, { userGesture: true });
    let switchedPageState = null;
    if (scenarioPage === 'dynamic-video-replace.html') {
      const expectedSwitchCount = Number(pageState?.switchCount || 0) + 1;
      const pageSwitchStartedAt = Date.now();
      while (Date.now() - pageSwitchStartedAt < 5000) {
        switchedPageState = await evaluateValue(page.cdp, 'window.__WVB_SWITCH_STATE__ || null');
        if (Number(switchedPageState?.switchCount || 0) >= expectedSwitchCount) {
          break;
        }
        await sleep(100);
      }
      if (Number(switchedPageState?.switchCount || 0) < expectedSwitchCount) {
        throw new Error(`dynamic page did not report media replacement ${JSON.stringify(switchedPageState)}`);
      }
    } else {
      switchedPageState = await evaluateValue(page.cdp, 'window.__WVB_SWITCH_STATE__ || null');
    }

    let afterSwitch = null;
    const switchStartedAt = Date.now();
    while (Date.now() - switchStartedAt < 8000) {
      afterSwitch = await readRuntimeStatus(harness.cdp, origin);
      const status = afterSwitch?.status || {};
      const hasFreshSignal = Number(status.signalTickCount || 0) > beforeTicks + 12
        && Number.isFinite(Number(status.averageInputDb));
      const quietSwitchSettled = Number(status.averageLiftDb || 0) >= MIN_SWITCH_LIFT_DB
        || Number(status.currentLiftDb || 0) >= MIN_SWITCH_LIFT_DB
        || Number(status.currentGainDb || 0) >= MIN_SWITCH_LIFT_DB;
      if (
        status.captureActive &&
        hasFreshSignal &&
        quietSwitchSettled
      ) {
        break;
      }
      await sleep(250);
    }
    assertActiveCapture(afterSwitch, 'switch active after change');
    const switchedStatus = afterSwitch.status || {};
    if (Number(switchedStatus.signalTickCount || 0) <= beforeTicks + 12) {
      throw new Error(`switch did not continue measuring signal ${JSON.stringify(switchedStatus)}`);
    }
    if (Number(switchedStatus.averageLiftDb || 0) < MIN_SWITCH_LIFT_DB && Number(switchedStatus.currentLiftDb || 0) < MIN_SWITCH_LIFT_DB) {
      throw new Error(`quiet switched source was not lifted ${JSON.stringify(switchedStatus)}`);
    }
    log(`switch test passed ${JSON.stringify({
      beforeTicks,
      afterTicks: switchedStatus.signalTickCount,
      inputDb: switchedStatus.averageInputDb,
      liftDb: switchedStatus.averageLiftDb,
      gainDb: switchedStatus.currentGainDb
    })}`);
    const switchReport = {
      version: manifestVersion,
      generatedAt: new Date().toISOString(),
      passed: true,
      page: scenarioPage,
      phase: 'switch-passed',
      beforeTicks,
      afterTicks: Number(switchedStatus.signalTickCount || 0),
      pageStateBefore: pageState,
      pageStateAfter: switchedPageState,
      tab: {
        captureActive: Boolean(switchedStatus.captureActive),
        captureState: String(switchedStatus.captureState || ''),
        capturePipelineMode: String(switchedStatus.capturePipelineMode || ''),
        captureContextState: String(switchedStatus.captureContextState || ''),
        captureAudioTrackCount: Number(switchedStatus.captureAudioTrackCount || 0),
        signalTickCount: Number(switchedStatus.signalTickCount || 0),
        lastSignalAgeMs: switchedStatus.lastSignalAgeMs == null ? null : Number(switchedStatus.lastSignalAgeMs),
        averageInputDb: switchedStatus.averageInputDb ?? null,
        averageOutputDb: switchedStatus.averageOutputDb ?? null,
        averageLiftDb: Number(switchedStatus.averageLiftDb || 0),
        currentGainDb: Number(switchedStatus.currentGainDb || 0),
        captureError: String(switchedStatus.captureError || '')
      }
    };
    writeJson(switchReportPath, switchReport);
    writeJson(latestSwitchReportPath, switchReport);

    await assertHoldStable(debugPort, extensionId, harness.cdp, origin);

    await assertMultiOwnerPersistence({
      browserCdp,
      debugPort,
      extensionId,
      origin,
      firstPageUrl: pageUrl,
      firstHarnessCdp: harness.cdp,
      sockets
    });
    await sleep(250);
    if (silentSink && nativeAudioOutputOpened) {
      throw new Error('Native WASAPI output opened during a silent stability run.');
    }
    log('stability smoke passed');
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
    cleanupRunDirectories();
  }
}

main().catch((error) => {
  console.error(`[e2e-stability] FAIL ${error.message}`);
  process.exit(1);
});
