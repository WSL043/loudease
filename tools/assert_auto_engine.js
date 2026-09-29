const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const engine = read('content/auto-engine.js');
const background = read('background.js');
const manifest = JSON.parse(read('manifest.json'));
const popup = read('popup/index.js');

const orderOf = (a, b) => engine.indexOf(a) >= 0 && engine.indexOf(a) < engine.indexOf(b);
const checks = [
  ['engine is a static content script on http(s) frames', manifest.content_scripts?.some((entry) => entry.js?.includes('content/auto-engine.js') && entry.all_frames === true && entry.matches?.includes('https://*/*'))],
  ['leveler worklet files are web-accessible with a dynamic URL', manifest.web_accessible_resources?.some((entry) => entry.use_dynamic_url === true && entry.resources?.includes('offscreen/leveler-worklet.js') && entry.resources?.includes('shared/programme-leveler-policy.js'))],
  ['no prototype patching or main-world code', !/prototype\s*\./.test(engine) && !/world\s*:\s*['"]MAIN/.test(JSON.stringify(manifest)) && !/HTMLMediaElement\.prototype/.test(engine)],
  ['engine never declares a new capture path', !/chrome\.tabCapture|getDisplayMedia|captureStream/.test(engine)],
  ['DRM, cross-origin and page-owned graphs are declined', /media\.mediaKeys/.test(engine) && /'drm'/.test(engine) && /'cross-origin'/.test(engine) && /'page-audio-graph'/.test(engine) && /'encrypted'/.test(engine)],
  ['cross-origin media is attached only when CORS was requested', /media\.crossOrigin !== null/.test(engine)],
  ['only audible elements attach', /if \(!isAudible\(media\)\) return;/.test(engine)],
  ['worklet is configured before the element source exists', orderOf('await configured', 'createMediaElementSource(media)')],
  ['context must be running before the worklet loads', orderOf('await ensureContext()', 'await ensureWorklet()') && /waitForGesture\(\)/.test(engine)],
  ['processor errors and stalled state bypass to the destination', /onprocessorerror/.test(engine) && /STALE_STATE_MS/.test(engine) && /entry\.source\.connect\(context\.destination\)/.test(engine)],
  ['capture takes precedence over automatic processing', /config\.captured !== true/.test(engine) && /notifyAutoEngine\(tabId\)/.test(background)],
  ['engine does not poll the service worker', !/setInterval\([^)]*send\(/.test(engine) && /WVB_AUTO_COLLECT/.test(engine)],
  ['live call sites are excluded from automatic mode', /CALL_HOSTS/.test(engine) && /meet\\.google\\.com/.test(engine)],
  ['global and per-site switches exist', /WVB_SET_AUTO_MODE/.test(background) && /disabledSites/.test(background) && /autoSite/.test(popup)],
  ['popup falls back to tab capture only when automatic mode cannot attach', /blockedAudibleCount/.test(popup) && /status\.autoActive/.test(popup)]
];

let failed = false;
for (const [name, pass] of checks) {
  if (pass) console.log(`OK   ${name}`);
  else { console.error(`FAIL ${name}`); failed = true; }
}
if (failed) process.exit(1);
