// End-to-end check for automatic mode: no popup click, no tabCapture.
//
// Loads dist/github-dev in an isolated Chrome profile, opens local pages that
// play audio on their own, and asserts through the service worker that the
// content-script engine attached (or safely declined) without any user gesture.
// Requires Node 22+ (global WebSocket) and a local Chrome. Run:
//   npm run build:dev && node tools/e2e_auto_mode.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const extensionDir = path.join(root, 'dist', 'github-dev');
const profileDir = path.join(root, 'tmp', `e2e-auto-${Date.now()}`);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH.');
  return found;
}

function wav({ gain, seconds = 40, sampleRate = 8000 }) {
  const samples = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((index / sampleRate) * 440 * 2 * Math.PI) * gain;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2);
  }
  return buffer;
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

setTimeout(() => { console.error('e2e timeout'); process.exit(2); }, 240000).unref();

async function main() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('Run npm run build:dev first.');
  const media = await listen((request, response) => {
    const url = new URL(request.url, 'http://x');
    const gain = Number(url.searchParams.get('gain') || 0.5);
    const headers = { 'content-type': 'audio/wav' };
    if (url.searchParams.get('cors') === '1') headers['access-control-allow-origin'] = '*';
    response.writeHead(200, headers);
    response.end(wav({ gain }));
  });
  const site = await listen((request, response) => {
    const url = new URL(request.url, 'http://x');
    const gain = url.searchParams.get('gain') || '0.8';
    const headers = { 'content-type': 'text/html' };
    if (url.pathname === '/csp') {
      headers['content-security-policy'] = "default-src 'none'; media-src *; script-src 'unsafe-inline'";
    }
    if (url.pathname === '/tone.wav') {
      response.writeHead(200, { 'content-type': 'audio/wav' });
      response.end(wav({ gain: Number(gain) }));
      return;
    }
    const remote = `http://127.0.0.1:${media.port}/tone.wav?gain=${gain}`;
    const body = {
      '/same': `<audio id=a src="/tone.wav?gain=${gain}" loop></audio>`,
      '/csp': `<audio id=a src="/tone.wav?gain=${gain}" loop></audio>`,
      '/cross': `<audio id=a src="${remote}" loop></audio>`,
      '/cors': `<audio id=a src="${remote}&cors=1" crossorigin="anonymous" loop></audio>`,
      '/shadow': '<div id=h></div><script>const r=document.getElementById("h").attachShadow({mode:"open"});'
        + `r.innerHTML='<audio id=a src="/tone.wav?gain=${gain}" loop></audio>';window.a=r.getElementById("a");</script>`,
      '/muted': `<audio id=a src="/tone.wav?gain=${gain}" loop muted></audio>`,
      // Protected media is silenced by createMediaElementSource: a ClearKey MediaKeys object stands in for EME.
      '/drm': `<audio id=a loop></audio><script>(async()=>{const e=document.getElementById('a');const k=await navigator.requestMediaKeySystemAccess('org.w3.clearkey',[{initDataTypes:['keyids'],audioCapabilities:[{contentType:'audio/mp4; codecs="mp4a.40.2"'}]}]);await e.setMediaKeys(await k.createMediaKeys());e.src='/tone.wav?gain=${gain}';setTimeout(()=>e.play().catch(()=>{}),300);})();</script>`,
      // A page that already routes the element through Web Audio owns it; a second source node would throw.
      '/ownedgraph': `<audio id=a src="/tone.wav?gain=${gain}" loop></audio><script>const c=new AudioContext();c.createMediaElementSource(document.getElementById('a')).connect(c.destination);</script>`
    }[url.pathname];
    if (!body) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, headers);
    response.end(`<!doctype html><meta charset=utf-8><title>t</title>${body}<script>`
      + 'addEventListener("load",()=>{const e=window.a||document.getElementById("a");e.play().catch(()=>{});});</script>');
  });

  fs.mkdirSync(profileDir, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(findChrome(), [
    `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, '--no-first-run',
    '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--enable-unsafe-extension-debugging', ...(process.env.WVB_E2E_HEADLESS === '1' ? ['--headless=new'] : []), 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  let socket;
  let nextId = 0;
  const pending = new Map();
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  };

  try {
    let version;
    for (let attempt = 0; attempt < 60 && !version; attempt += 1) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (_) { await sleep(250); }
    }
    if (!version) throw new Error('Chrome did not expose CDP.');
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve) => { socket.onopen = resolve; });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiter = message.id && pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    };

    console.log('cdp ready');
    const loaded = await command('Extensions.loadUnpacked', { path: extensionDir });
    console.log('extension loaded', loaded.id);
    const extensionId = loaded.id;
    // Messages sent from the service worker never reach its own listener, so
    // drive the extension through a neutral extension page instead.
    const pageTarget = await command('Target.createTarget', { url: `chrome-extension://${extensionId}/monitor/index.html` });
    const { sessionId: workerSession } = await command('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
    await sleep(1500);
    const inWorker = async (expression) => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, workerSession);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed');
      return result.result.value;
    };
    const statusFor = (pathname) => inWorker(`(async()=>{
      const tabs=await chrome.tabs.query({});
      const tab=tabs.find(t=>String(t.url).startsWith('http://127.0.0.1:${site.port}${pathname}'));
      if(!tab) return {missing:true};
      return await new Promise(r=>chrome.runtime.sendMessage({type:'WVB_GET_STATUS',tabId:tab.id,tabUrl:tab.url,refreshFrame:true,ensure:false},r));
    })()`);
    const waitStatus = async (pathname, predicate, timeoutMs = 12000) => {
      const started = Date.now();
      let last = null;
      while (Date.now() - started < timeoutMs) {
        last = await statusFor(pathname);
        if (predicate(last)) return last;
        await sleep(400);
      }
      return last;
    };
    const open = async (pathname) => {
      await command('Target.createTarget', { url: `http://127.0.0.1:${site.port}${pathname}` });
    };

    // Fresh install opens the welcome page and seeds the UI language from the browser.
    let welcome = null;
    for (let attempt = 0; attempt < 20 && !welcome; attempt += 1) {
      const { targetInfos } = await command('Target.getTargets');
      welcome = targetInfos.find((target) => target.url === `chrome-extension://${extensionId}/popup/welcome.html`);
      if (!welcome) await sleep(300);
    }
    check('install opens the welcome page', Boolean(welcome));
    if (welcome) {
      const { sessionId: welcomeSession } = await command('Target.attachToTarget', { targetId: welcome.targetId, flatten: true });
      await sleep(800);
      const heading = await command('Runtime.evaluate', { expression: 'document.querySelector("h1").textContent', returnByValue: true }, welcomeSession);
      check('welcome page renders localized text', /LoudEase/.test(heading.result.value || ''), heading.result.value);
      if (process.env.WVB_E2E_SHOT) {
        const shot = await command('Page.captureScreenshot', { format: 'png' }, welcomeSession);
        fs.writeFileSync(process.env.WVB_E2E_SHOT, Buffer.from(shot.data, 'base64'));
      }
    }

    // Optional real-site probe: node tools/e2e_auto_mode.js --url https://example.com/watch
    const urlIndex = process.argv.indexOf('--url');
    if (urlIndex > 0) {
      const target = process.argv[urlIndex + 1];
      const origin = new URL(target).origin;
      await command('Target.createTarget', { url: target });
      const probe = () => inWorker(`(async()=>{
        const tabs=await chrome.tabs.query({});
        const tab=tabs.find(t=>String(t.url).startsWith(${JSON.stringify(origin)}));
        if(!tab) return {missing:true};
        return await new Promise(r=>chrome.runtime.sendMessage({type:'WVB_GET_STATUS',tabId:tab.id,tabUrl:tab.url,refreshFrame:true,ensure:false},r));
      })()`);
      let last = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(1000);
        last = await probe();
        if (last.autoActive && Number(last.signalTickCount) > 30) break;
      }
      const ok = Boolean(last?.autoActive && Number(last.signalTickCount) > 0);
      check(`real site ${origin}`, ok, { autoActive: last?.autoActive, gainDb: last?.currentGainDb, signalTicks: last?.signalTickCount, auto: last?.auto });
      process.exitCode = ok ? 0 : 1;
      return;
    }

    // 1. Loud same-origin audio: attaches with no gesture and reduces level.
    await open('/same?gain=0.8');
    let status = await waitStatus('/same', (s) => s.autoActive && Number(s.signalTickCount) > 20 && Number(s.currentGainDb) < -2);
    check('same-origin audio attaches with no click', status.autoActive === true, { processing: status.auto?.processingCount });
    check('loud audio is reduced', Number(status.currentGainDb) < -2, { gainDb: status.currentGainDb });
    check('tab capture was not used', status.captureActive !== true);

    // 2. Quiet audio is lifted.
    await open('/csp?gain=0.02');
    status = await waitStatus('/csp', (s) => s.autoActive && Number(s.signalTickCount) > 60 && Number(s.currentGainDb) > 2, 20000);
    check('quiet audio is lifted under a strict page CSP', Number(status.currentGainDb) > 2, { gainDb: status.currentGainDb, auto: status.auto });

    // 3. Shadow DOM media is discovered.
    await open('/shadow?gain=0.8');
    status = await waitStatus('/shadow', (s) => s.autoActive);
    check('media inside a shadow root attaches', status.autoActive === true, status.auto);

    // 4. Cross-origin media without CORS would be silenced: never attach.
    await open('/cross?gain=0.8');
    status = await waitStatus('/cross', (s) => (s.auto?.blockedAudibleCount || 0) > 0);
    check('cross-origin media is declined, not silenced', status.autoActive !== true && (status.auto?.blockedAudibleCount || 0) > 0, status.auto);

    // 5. Cross-origin media with CORS is safe to attach.
    await open('/cors?gain=0.8');
    status = await waitStatus('/cors', (s) => s.autoActive);
    check('CORS-enabled cross-origin media attaches', status.autoActive === true, status.auto);

    // 6. Muted media stays untouched until it becomes audible.
    await open('/muted?gain=0.8');
    await sleep(2500);
    status = await statusFor('/muted');
    check('muted media is not attached', status.autoActive !== true && (status.auto?.attachedCount || 0) === 0, status.auto);

    // 6b. Protected media and page-owned graphs are declined, never silenced.
    await open('/drm?gain=0.8');
    status = await waitStatus('/drm', (s) => (s.auto?.blockedAudibleCount || 0) > 0, 8000);
    check('DRM (MediaKeys) media is declined', status.autoActive !== true && status.auto?.blockedReasons?.drm > 0, status.auto?.blockedReasons);
    await open('/ownedgraph?gain=0.8');
    status = await waitStatus('/ownedgraph', (s) => (s.auto?.blockedAudibleCount || 0) > 0, 8000);
    check('page-owned Web Audio graph is declined', status.autoActive !== true && status.auto?.blockedReasons?.['page-audio-graph'] > 0, status.auto?.blockedReasons);

    // 7. Disabling a site detaches processing without breaking playback.
    await inWorker(`chrome.runtime.sendMessage({type:'WVB_SET_AUTO_MODE',siteEnabled:false,tabUrl:'http://127.0.0.1:${site.port}/same'})`);
    status = await waitStatus('/same', (s) => s.autoActive !== true);
    check('per-site disable bypasses processing', status.autoActive !== true && (status.auto?.bypassCount || 0) >= 1, status.auto);
    await inWorker(`chrome.runtime.sendMessage({type:'WVB_SET_AUTO_MODE',siteEnabled:true,tabUrl:'http://127.0.0.1:${site.port}/same'})`);
    status = await waitStatus('/same', (s) => s.autoActive === true);
    check('per-site re-enable resumes processing', status.autoActive === true, status.auto);
  } finally {
    try { socket?.close(); } catch (_) {}
    chrome.kill();
    media.server.close();
    site.server.close();
    await sleep(500);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  }
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
