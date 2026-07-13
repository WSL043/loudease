const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmpDir = path.join(root, 'tmp');

function assert(name, condition, details = '') {
  if (!condition) {
    console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function contentType(fullPath) {
  if (/\.js$/i.test(fullPath)) return 'text/javascript; charset=utf-8';
  if (/\.html$/i.test(fullPath)) return 'text/html; charset=utf-8';
  if (/\.css$/i.test(fullPath)) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const requestPath = url.pathname === '/' ? '/test-pages/offline-audio-graph.html' : url.pathname;
    const fullPath = path.resolve(root, `.${decodeURIComponent(requestPath)}`);
    assertInside(root, fullPath);
    fs.readFile(fullPath, (error, bytes) => {
      if (error) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': contentType(fullPath) });
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

async function waitForDevToolsPort(profileDir, child, stderr) {
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (child.exitCode != null) {
      throw new Error(`Chrome exited before CDP startup (code ${child.exitCode}).\n${stderr()}`);
    }
    try {
      const [portLine] = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch (_) {
      // Chrome writes DevToolsActivePort after the profile and CDP socket are ready.
    }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools endpoint did not start.\n${stderr()}`);
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
    this.socket = net.connect(Number(this.wsUrl.port || 80), this.wsUrl.hostname);
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
        throw new Error('Large WebSocket frames are not supported by this test.');
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

async function evaluateValue(cdp, expression) {
  const result = await cdp.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed';
    throw new Error(text);
  }
  return result.result?.value || null;
}

async function main() {
  fs.mkdirSync(tmpDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(tmpDir, 'offline-audio-graph-profile-'));
  assertInside(tmpDir, profileDir);

  const { server, origin } = await startStaticServer();
  const chrome = findChrome();
  const pageUrl = `${origin}/test-pages/offline-audio-graph.html`;
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ];
  const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let chromeStderr = '';
  child.stderr?.on('data', (chunk) => {
    chromeStderr += chunk.toString('utf8');
    if (chromeStderr.length > 8000) {
      chromeStderr = chromeStderr.slice(-8000);
    }
  });

  const sockets = [];
  try {
    const debugPort = await waitForDevToolsPort(profileDir, child, () => chromeStderr.slice(-4000));
    const version = await waitForCdp(debugPort);
    const browserCdp = new CdpSocket(version.webSocketDebuggerUrl);
    await browserCdp.connect();
    sockets.push(browserCdp);
    await browserCdp.command('Target.createTarget', { url: pageUrl, forTab: true });
    const page = await connectTarget(debugPort, (target) => target.type === 'page' && target.url === pageUrl);
    sockets.push(page.cdp);
    await page.cdp.command('Runtime.enable');
    await page.cdp.command('Page.enable');
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10000) {
      const ready = await evaluateValue(page.cdp, `typeof window.runOfflineGraphTest === 'function'`);
      if (ready) {
        break;
      }
      await sleep(100);
    }
    const ready = await evaluateValue(page.cdp, `typeof window.runOfflineGraphTest === 'function'`);
    if (!ready) {
      const context = await evaluateValue(page.cdp, `({
        url: location.href,
        title: document.title,
        body: document.body ? document.body.innerText.slice(0, 500) : '',
        coreLoaded: Boolean(window.WebVolumeBalancerCore)
      })`);
      throw new Error(`offline graph test page did not initialize: ${JSON.stringify(context)}`);
    }
    const output = await evaluateValue(page.cdp, `window.runOfflineGraphTest()`);

    assert('offline graph test returned result', output && typeof output === 'object');
    assert('offline graph reported pass', output?.passed === true, JSON.stringify(output, null, 2));
    assert('OfflineAudioContext rendered full buffer', output?.checks?.graphRendered === true, JSON.stringify(output?.checks || {}));
    assert('quiet voice lifted in Web Audio graph', output?.checks?.quietVoiceLifted === true, JSON.stringify(output?.metrics?.quietVoice || {}));
    assert('loud tone reduced in Web Audio graph', output?.checks?.loudToneReduced === true, JSON.stringify(output?.metrics?.loudTone || {}));
    assert('burst controlled in Web Audio graph', output?.checks?.burstControlled === true, JSON.stringify(output?.metrics?.burst || {}));
    assert('output does not clip in Web Audio graph', output?.checks?.outputNotClipped === true, `peak=${output?.outputPeak}`);
    assert('graph uses OfflineAudioContext source gain worklet limiter destination', output?.graph?.context === 'OfflineAudioContext' && output?.graph?.gain === 'GainNode' && output?.graph?.limiter === 'AudioWorkletNode', JSON.stringify(output?.graph || {}));

    if (process.exitCode) {
      console.log(JSON.stringify(output, null, 2));
      process.exit(process.exitCode);
    }
  } finally {
    for (const socket of sockets) {
      socket.close();
    }
    child.kill();
    server.close();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2000)
    ]);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (_) {
      // A terminating Chrome process may briefly retain profile files on Windows.
    }
  }
}

main().catch((error) => {
  console.error(`FAIL offline audio graph test: ${error.stack || error}`);
  process.exit(1);
});
