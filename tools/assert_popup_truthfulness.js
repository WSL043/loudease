const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup', 'index.html'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup', 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup', 'index.css'), 'utf8');

const checks = [
  ['popup omits presets and modes', !/data-preset|presetBar|presetButton/.test(html)],
  ['manual strength edits become custom preset', /preset: 'custom'/.test(popup)],
  ['committed strength changes flush persistence immediately', /addEventListener\('change',[\s\S]*?flushPersistSettings\(\{ siteScoped: true \}\)/.test(popup) && /function flushPersistSettings\(options = \{\}\)/.test(popup)],
  ['popup exposes exactly two strength controls', (html.match(/type="range"/g) || []).length === 2],
  ['popup can disable strength controls', /function setStrengthControlsEnabled\(enabled\)/.test(popup)],
  ['disabled controls set input disabled', /dial\.input\.disabled = !enabled;/.test(popup)],
  ['no-waveform state keeps settings adjustable', !/analysisSilent >= active[\s\S]*?setStrengthControlsEnabled\(false\);/.test(popup)],
  ['no-waveform state says unprocessed', /label: '未处理', title: '无波形'/.test(popup)],
  ['no-waveform state explains full-tab fallback', /text: '普通接管无输入'/.test(popup) && /text: '可用整页接管'/.test(popup)],
  ['popup exposes manual full-tab capture when normal path is unavailable', /WVB_START_TAB_CAPTURE/.test(popup) && /captureButton/.test(popup)],
  ['popup explicitly ensures observer before trusting empty frame status', /function ensureObserverOnce\(\)/.test(popup) && /WVB_ENSURE_OBSERVER/.test(popup) && /respondingFrames/.test(popup)],
  ['popup requests stream id during capture button action', /function getTabCaptureStreamId\(tabId\)/.test(popup) && /tabCapture\?\.getMediaStreamId/.test(popup) && /streamId = await getTabCaptureStreamId/.test(popup)],
  ['popup can attempt capture automatically once after opening', /function maybeAutoStartCapture\(status\)/.test(popup) && /function shouldAutoStartCapture\(status\)/.test(popup) && /popup-open-auto/.test(popup) && /autoCaptureAttempted/.test(popup)],
  ['popup supports promise-based tabCapture stream id', /maybePromise/.test(popup) && /typeof maybePromise\.then === 'function'/.test(popup) && /maybePromise\.then\(settleStreamId/.test(popup)],
  ['popup passes stream id failure detail to background fallback', /let streamIdError = '';/.test(popup) && /streamIdError = String\(error\?\.message \|\| error\)/.test(popup) && /streamIdError/.test(popup)],
  ['popup logs capture clicks before stream id request', /WVB_CAPTURE_CLICK/.test(popup) && /capture:popup-click/.test(fs.readFileSync(path.join(root, 'background.js'), 'utf8'))],
  ['popup stream id request cannot hang forever', /CAPTURE_STREAM_ID_TIMEOUT_MS/.test(popup) && /capturePermissionTimeout/.test(popup)],
  ['popup waits long enough for slow tabCapture authorization', /CAPTURE_STREAM_ID_TIMEOUT_MS = 5000/.test(popup)],
  ['popup reports capture stream id errors to background', /WVB_CAPTURE_ERROR/.test(popup) && /popup-get-stream-id/.test(popup)],
  ['popup treats missing captureAvailable as available fallback', /const captureAvailable = status\.captureAvailable !== false;/.test(popup)],
  ['popup keeps capture error visible after refresh', /captureState === 'error' \|\| captureError/.test(popup) && /\\u6574\\u9875\\u63a5\\u7ba1\\u5931\\u8d25/.test(popup)],
  ['popup renders active tab capture before stale page telemetry', /if \(captureActive\)[\s\S]*?return;[\s\S]*?if \(sourceAlreadyConnected \|\| status\.needsPageReload\)/.test(popup)],
  ['popup does not treat missing signal age as active waveform', /const signalTicks = finiteNumber\(status\.signalTickCount\);/.test(popup) && /signalTicks > 0 && lastSignalAgeMs != null && lastSignalAgeMs < 2500/.test(popup) && /已连接，未检测到声音/.test(popup)],
  ['popup reports net positive gain as lift before limiter reduction', /function displayEffectForStatus\(status, reductionDb, liftDb\)/.test(popup) && /const displayReductionDb = displayLiftDb > 0\.15 \? negativeGainDb : Math\.max\(reductionDb, negativeGainDb\);/.test(popup) && /lift = displayedEffect\.kind === 'lift' \? displayedEffect\.amount : 0;/.test(popup)],
  ['capture remains wired without a redundant visible stop action', /WVB_STOP_TAB_CAPTURE/.test(popup) && !/stop|停止/i.test(html)],
  ['no-frame fallback exposes full-tab capture', /title: frames > 0 \? '无声音' : '页面未回传'/.test(popup) && /setCaptureVisible\(captureAvailable, false\);/.test(popup)],
  ['stale engine state still exposes full-tab capture', /if \(status\.staleEngine\)/.test(popup) && /setCaptureVisible\(captureAvailable, captureActive\);/.test(popup)],
  ['disabled controls can still be visually dimmed elsewhere', /\.strengthControl\.isUnavailable/.test(css)],
  ['disabled ranges use native disabled semantics', /dial\.input\.disabled = !enabled;/.test(popup)],
  ['global control saves are serialized instead of dropped', /saveQueue = saveQueue\.then\(operation, operation\)/.test(popup) && !/if \(saving\) \{\s*return;\s*\}/.test(popup)],
  ['slider persistence failures remain visible', /pendingSettingsError = t\('settingsSaveFailed'/.test(popup) && /setNotices\(\[\]\)/.test(popup)],
  ['zero strengths report original audio instead of active balancing', /cutStrength\) <= 0 && percentValue\(settings\?\.liftStrength\) <= 0/.test(popup) && /statusOriginalAudio/.test(popup)]
];

let failed = false;
for (const [name, pass] of checks) {
  if (pass) {
    console.log(`OK   ${name}`);
  } else {
    console.error(`FAIL ${name}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
