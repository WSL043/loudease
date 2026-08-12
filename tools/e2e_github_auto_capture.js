const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmpRoot = path.join(root, 'tmp');
const runRoot = path.join(tmpRoot, `github-auto-capture-${Date.now()}-${process.pid}`);
const extensionDir = path.join(runRoot, 'extension');
const reportPath = path.join(tmpRoot, 'latest-github-auto-capture.json');
const TEST_HOST = 'loudease-auto.test';
const SILENT_SINK_KEY = 'webVolumeBalancer.e2eSilentSink';

function log(message) {
  console.log(`[auto-capture-e2e] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside ${parent}: ${child}`);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome executable not found. Set CHROME_PATH to chrome.exe.');
  return found;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function extensionIdFromPublicKey(der) {
  const hex = crypto.createHash('sha256').update(der).digest().subarray(0, 16).toString('hex');
  return Array.from(hex, (character) => String.fromCharCode(97 + Number.parseInt(character, 16))).join('');
}

function stageExtension() {
  const built = spawnSync(process.execPath, [path.join(root, 'tools', 'build_extension.js'), 'dev'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (built.status !== 0) process.exit(built.status || 1);
  copyDirectory(path.join(root, 'dist', 'github-dev'), extensionDir);

  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.key = publicDer.toString('base64');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionIdFromPublicKey(publicDer);
}

function startTestServer() {
  const page = fs.readFileSync(path.join(root, 'test-pages', 'simple-audio.html'));
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(page);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || null)}`));
      else pending.resolve(message.result || {});
    });
  }

  command(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket?.close(); } catch (_) {}
  }
}

async function waitForJson(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (_) {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectTarget(port, targetId, urlPrefix) {
  const startedAt = Date.now();
  let latest = [];
  while (Date.now() - startedAt < 10000) {
    latest = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = latest.find((item) => item.id === targetId)
      || latest.find((item) => String(item.url || '').startsWith(urlPrefix));
    if (target?.webSocketDebuggerUrl) {
      const connection = new CdpConnection(target.webSocketDebuggerUrl);
      await connection.connect();
      await connection.command('Runtime.enable');
      return connection;
    }
    await sleep(100);
  }
  throw new Error(`Target not found for ${urlPrefix}: ${latest.map((item) => `${item.type}:${item.url}`).join(' | ')}`);
}

async function evaluate(connection, expression, userGesture = false) {
  const result = await connection.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

async function launchChrome(chromePath, profileDir, debugPort, extensionId, allowlisted) {
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    `--host-resolver-rules=MAP ${TEST_HOST} 127.0.0.1`,
    '--no-proxy-server',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-media-suspend',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-audio-output',
    '--window-position=-32000,-32000',
    '--window-size=800,600',
    'about:blank'
  ];
  if (allowlisted) args.push(`--allowlisted-extension-id=${extensionId}`);
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  let nativeOutputOpened = false;
  child.stderr?.on('data', (chunk) => {
    const next = chunk.toString('utf8');
    stderr = `${stderr}${next}`.slice(-12000);
    nativeOutputOpened ||= /WASAPIAudioOutputStream/i.test(next);
  });
  const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const browser = new CdpConnection(version.webSocketDebuggerUrl);
  await browser.connect();
  return {
    browser,
    browserVersion: String(version.Browser || ''),
    child,
    stderr: () => stderr,
    nativeOutputOpened: () => nativeOutputOpened
  };
}

async function closeChrome(runtime) {
  try { await runtime.browser.command('Browser.close'); } catch (_) {}
  runtime.browser.close();
  await Promise.race([new Promise((resolve) => runtime.child.once('exit', resolve)), sleep(5000)]);
  if (runtime.child.exitCode == null) runtime.child.kill();
}

async function createPage(runtime, debugPort, url) {
  const created = await runtime.browser.command('Target.createTarget', { url, forTab: true });
  const page = await connectTarget(debugPort, created.targetId, url);
  await evaluate(page, 'new Promise((resolve) => document.readyState === \'complete\' ? resolve(true) : addEventListener(\'load\', () => resolve(true), { once: true }))');
  return page;
}

async function openMonitor(runtime, debugPort, extensionId) {
  const url = `chrome-extension://${extensionId}/monitor/index.html?auto-capture-e2e=1`;
  const created = await runtime.browser.command('Target.createTarget', { url, forTab: true });
  const monitor = await connectTarget(debugPort, created.targetId, url);
  const configured = await evaluate(monitor, `(async () => {
    await chrome.storage.local.set({ ${JSON.stringify(SILENT_SINK_KEY)}: true });
    const stored = await chrome.storage.local.get(${JSON.stringify(SILENT_SINK_KEY)});
    return stored[${JSON.stringify(SILENT_SINK_KEY)}] === true;
  })()`);
  if (!configured) throw new Error('Silent AudioContext sink could not be configured.');
  return monitor;
}

async function readStatus(monitor, urlPrefix) {
  return await evaluate(monitor, `(${async function read(prefix) {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => String(item.url || item.pendingUrl || '').startsWith(prefix));
    if (!tab?.id) return { found: false, tabs: tabs.map((item) => ({ id: item.id, url: item.url, pendingUrl: item.pendingUrl })) };
    const status = await chrome.runtime.sendMessage({
      type: 'WVB_GET_STATUS',
      tabId: tab.id,
      tabUrl: String(tab.url || tab.pendingUrl || prefix),
      ensure: false
    });
    return { found: true, tabId: tab.id, status };
  }})(${JSON.stringify(urlPrefix)})`);
}

async function waitForStatus(monitor, urlPrefix, predicate, timeoutMs, label) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await readStatus(monitor, urlPrefix);
    if (predicate(latest)) return latest;
    await sleep(100);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(latest)}`);
}

async function runPhase({ chromePath, extensionId, origin, allowlisted }) {
  const debugPort = await reservePort();
  const profileDir = path.join(runRoot, allowlisted ? 'profile-allowlisted' : 'profile-baseline');
  const runtime = await launchChrome(chromePath, profileDir, debugPort, extensionId, allowlisted);
  try {
    const loaded = await runtime.browser.command('Extensions.loadUnpacked', { path: extensionDir, enableInIncognito: false });
    if (loaded.id !== extensionId) throw new Error(`Extension ID mismatch: expected ${extensionId}, got ${loaded.id}`);
    const monitor = await openMonitor(runtime, debugPort, extensionId);
    const firstUrl = `${origin}/first`;

    if (!allowlisted) {
      const firstPage = await createPage(runtime, debugPort, firstUrl);
      const denied = await waitForStatus(
        monitor,
        firstUrl,
        (item) => /Extension has not been invoked for the current page/i.test(String(item?.status?.captureError || item?.status?.error || '')),
        5000,
        'non-allowlisted automatic capture rejection'
      );
      firstPage.close();
      monitor.close();
      if (runtime.nativeOutputOpened()) throw new Error('Baseline Chrome opened a native WASAPI output stream.');
      return {
        browserVersion: runtime.browserVersion,
        denied: true,
        error: denied.status.captureError || denied.status.error || ''
      };
    }

    const secondUrl = `${origin}/second`;
    const [firstPage, secondPage] = await Promise.all([
      createPage(runtime, debugPort, firstUrl),
      createPage(runtime, debugPort, secondUrl)
    ]);
    const firstPrePlay = await waitForStatus(
      monitor,
      firstUrl,
      (item) => item?.status?.captureActive === true && item?.status?.captureState === 'processing',
      10000,
      'first tab pre-play capture'
    );
    await evaluate(firstPage, "document.querySelector('#start').click(); true", true);
    const firstSignal = await waitForStatus(
      monitor,
      firstUrl,
      (item) => Number(item?.status?.signalTickCount || 0) > 10,
      10000,
      'first tab captured signal'
    );

    const secondPrePlay = await waitForStatus(
      monitor,
      secondUrl,
      (item) => item?.status?.captureActive === true && item?.status?.captureState === 'processing',
      10000,
      'new tab pre-play capture'
    );
    await evaluate(secondPage, "document.querySelector('#start').click(); true", true);
    const secondSignal = await waitForStatus(
      monitor,
      secondUrl,
      (item) => Number(item?.status?.signalTickCount || 0) > 10,
      10000,
      'new tab captured signal'
    );

    const diagnostics = await evaluate(monitor, `(async () => {
      return await chrome.runtime.sendMessage({ type: 'WVB_GET_DIAGNOSTICS' });
    })()`);
    const offscreenCreationErrors = (diagnostics?.events || []).filter((event) => (
      event?.type === 'capture:auto-error'
      && /Only a single offscreen document may be created/i.test(String(event?.detail?.error || ''))
    ));
    if (offscreenCreationErrors.length > 0) {
      throw new Error(`Concurrent automatic capture raced offscreen creation: ${JSON.stringify(offscreenCreationErrors)}`);
    }

    const summarize = (item) => ({
      tabId: item.tabId,
      captureActive: item.status.captureActive,
      captureState: item.status.captureState,
      contextState: item.status.captureContextState,
      signalTickCount: item.status.signalTickCount,
      audioTrackCount: item.status.captureAudioTrackCount,
      silentSink: item.status.silentSink,
      captureError: item.status.captureError || ''
    });
    const result = {
      browserVersion: runtime.browserVersion,
      concurrentPrePlayCapture: true,
      firstPrePlay: summarize(firstPrePlay),
      firstSignal: summarize(firstSignal),
      secondPrePlay: summarize(secondPrePlay),
      secondSignal: summarize(secondSignal)
    };
    for (const status of [result.firstPrePlay, result.firstSignal, result.secondPrePlay, result.secondSignal]) {
      if (status.contextState !== 'running' || status.audioTrackCount !== 1 || status.silentSink !== true || status.captureError) {
        throw new Error(`Invalid automatic capture state: ${JSON.stringify(status)}`);
      }
    }
    firstPage.close();
    secondPage.close();
    monitor.close();
    if (runtime.nativeOutputOpened()) throw new Error('Allowlisted Chrome opened a native WASAPI output stream.');
    return result;
  } finally {
    await closeChrome(runtime);
  }
}

async function main() {
  fs.mkdirSync(tmpRoot, { recursive: true });
  assertInside(tmpRoot, runRoot);
  fs.mkdirSync(runRoot, { recursive: true });
  const chromePath = findChrome();
  const extensionId = stageExtension();
  const { server, port } = await startTestServer();
  const origin = `http://${TEST_HOST}:${port}`;
  try {
    log(`extension id ${extensionId}`);
    log('checking the normal Chrome denial path');
    const baseline = await runPhase({ chromePath, extensionId, origin, allowlisted: false });
    log('checking allowlisted pre-play capture in the first and second tabs');
    const allowlisted = await runPhase({ chromePath, extensionId, origin, allowlisted: true });
    const report = {
      passed: true,
      generatedAt: new Date().toISOString(),
      chromeVersion: allowlisted.browserVersion,
      extensionVersion: JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')).version,
      extensionId,
      silentOutput: true,
      baseline,
      allowlisted
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assertInside(tmpRoot, runRoot);
    fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
