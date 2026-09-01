const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmpDir = path.join(root, 'tmp');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function findChrome() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
      ]
    : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const chrome = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!chrome) throw new Error('Google Chrome was not found');
  return chrome;
}

function safeRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
  const absolute = path.resolve(root, pathname || 'store/assets-source.html');
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('request escaped the repository root');
  }
  return absolute;
}

function startServer() {
  const server = http.createServer((request, response) => {
    try {
      const filePath = safeRequestPath(request.url || '/');
      const body = fs.readFileSync(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
      });
      response.end(body);
    } catch (_) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function pngSize(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  if (header.length < 24 || header.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error(`Chrome did not create a PNG: ${filePath}`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

async function render(chrome, origin, shot) {
  const suffix = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const profileDir = path.join(tmpDir, `asset-profile-${suffix}`);
  const outputPath = path.join(root, shot.output);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = [
    '--headless=new',
    '--hide-scrollbars',
    '--disable-audio-output',
    '--disable-component-update',
    '--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=2500',
    `--window-size=${shot.width},${shot.height}`,
    `--user-data-dir=${profileDir}`,
    `--screenshot=${outputPath}`,
    `${origin}${shot.url}`
  ];
  if (shot.dark) args.splice(1, 0, '--force-dark-mode');
  let stderr = '';
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Chrome exited ${code}: ${stderr}`)));
    });
    const actual = pngSize(outputPath);
    if (actual.width !== shot.width || actual.height !== shot.height) {
      throw new Error(`${shot.output} is ${actual.width}x${actual.height}, expected ${shot.width}x${shot.height}`);
    }
    console.log(`Rendered ${shot.output} (${shot.width}x${shot.height})`);
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function main() {
  fs.mkdirSync(tmpDir, { recursive: true });
  const chrome = findChrome();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const previewVersion = encodeURIComponent(manifest.version);
  const { server, port } = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  const shots = [
    { url: '/popup/index.html', output: 'docs/popup-screenshot-light.png', width: 340, height: 275 },
    { url: '/popup/index.html', output: 'docs/popup-screenshot-dark.png', width: 340, height: 275, dark: true },
    { url: `/monitor/index.html?previewVersion=${previewVersion}`, output: 'docs/settings-screenshot-light.png', width: 1080, height: 616 },
    { url: `/monitor/index.html?previewVersion=${previewVersion}`, output: 'docs/settings-screenshot-dark.png', width: 1080, height: 616, dark: true },
    { url: '/store/assets-source.html?asset=balancing', output: 'store/assets/screenshot-balancing-1280x800.png', width: 1280, height: 800 },
    { url: '/store/assets-source.html?asset=settings', output: 'store/assets/screenshot-settings-1280x800.png', width: 1280, height: 800 },
    { url: '/store/assets-source.html?asset=promo', output: 'store/assets/promo-small-440x280.png', width: 440, height: 280 },
    { url: '/store/assets-source.html?asset=process', output: 'docs/processing-flow.png', width: 1200, height: 420 }
  ];
  try {
    for (const shot of shots) await render(chrome, origin, shot);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
