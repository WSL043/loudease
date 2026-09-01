const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup', 'index.html'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup', 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup', 'index.css'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

const checks = [
  ['popup explains only genuinely blocked quiet lift', /function liftBlockedNotice/.test(popup) && /playerVolumeConflict/.test(popup) && /playerVolumeKnown/.test(popup) && /quietDeficitDb/.test(popup) && /effectiveMaxLiftDb/.test(popup)],
  ['popup omits presets and modes', !/data-preset|presetBar|presetButton/.test(html)],
  ['manual strength edits become custom preset', /preset: 'custom'/.test(popup)],
  ['committed strength changes flush persistence immediately', /addEventListener\('change',[\s\S]*?flushPersistSettings\(strengthSaveOptions\(\)\)/.test(popup) && /function flushPersistSettings\(options = \{\}\)/.test(popup)],
  ['slider edits do not silently create site overrides', /function strengthSaveOptions\(\)[\s\S]*?siteScoped: settings\?\.siteScoped === true/.test(popup) && !/flushPersistSettings\(\{ siteScoped: true \}\)/.test(popup)],
  ['popup exposes exactly two strength controls', (html.match(/type="range"/g) || []).length === 2],
  ['popup can disable strength controls', /function setStrengthControlsEnabled\(enabled\)/.test(popup)],
  ['disabled controls set input disabled', /dial\.input\.disabled = !enabled;/.test(popup)],
  ['waiting-for-audio state keeps settings adjustable', /setStrengthControlsEnabled\(true\);/.test(popup) && !/statusWaitingForAudio[\s\S]*?setStrengthControlsEnabled\(false\)/.test(popup)],
  ['popup uses one localized compact status renderer', (popup.match(/function renderStatus\(/g) || []).length === 1 && /statusWaitingForAudio/.test(popup) && /statusActionRequired/.test(popup) && /statusBalancing/.test(popup) && !/[\u3400-\u9fff]/u.test(popup)],
  ['popup exposes manual full-tab capture when recovery is needed', /WVB_START_TAB_CAPTURE/.test(popup) && /captureButton/.test(popup) && /setCaptureVisible\(captureAvailable, false\)/.test(popup)],
  ['popup explicitly ensures observer before trusting empty frame status', /function ensureObserverOnce\(\)/.test(popup) && /WVB_ENSURE_OBSERVER/.test(popup) && /respondingFrames/.test(popup)],
  ['popup requests stream id during capture button action', /function getTabCaptureStreamId\(tabId\)/.test(popup) && /tabCapture\?\.getMediaStreamId/.test(popup) && /streamId = await getTabCaptureStreamId/.test(popup)],
  ['popup can attempt capture automatically once after opening', /function maybeAutoStartCapture\(status\)/.test(popup) && /function shouldAutoStartCapture\(status\)/.test(popup) && /popup-open-auto/.test(popup) && /autoCaptureAttempted/.test(popup)],
  ['popup supports promise-based tabCapture stream id', /maybePromise/.test(popup) && /typeof maybePromise\.then === 'function'/.test(popup) && /maybePromise\.then\(settleStreamId/.test(popup)],
  ['popup passes stream id failure detail to background fallback', /let streamIdError = '';/.test(popup) && /streamIdError = String\(error\?\.message \|\| error\)/.test(popup) && /streamIdError/.test(popup)],
  ['popup logs capture clicks before stream id request', /WVB_CAPTURE_CLICK/.test(popup) && /capture:popup-click/.test(background)],
  ['popup stream id request cannot hang forever', /CAPTURE_STREAM_ID_TIMEOUT_MS/.test(popup) && /capturePermissionTimeout/.test(popup)],
  ['popup waits long enough for slow tabCapture authorization', /CAPTURE_STREAM_ID_TIMEOUT_MS = 5000/.test(popup)],
  ['popup reports capture stream id errors to background', /WVB_CAPTURE_ERROR/.test(popup) && /popup-get-stream-id/.test(popup)],
  ['popup treats missing captureAvailable as available fallback', /const captureAvailable = status\.captureAvailable !== false;/.test(popup)],
  ['popup keeps capture errors visible after refresh', /String\(status\.captureState \|\| ''\) === 'error' \|\| status\.captureError/.test(popup) && /captureFailed/.test(popup) && /captureRecoveryHelp/.test(popup)],
  ['popup renders live capture states before stale page telemetry', /if \(captureActive && playerMuted\)[\s\S]*?if \(captureActive && !hasFreshSignal\)[\s\S]*?if \(captureActive \|\| \(active > 0 && processed > 0 && audible > 0\)\)[\s\S]*?if \(needsReload\)/.test(popup)],
  ['popup does not treat missing signal age as active waveform', /const signalTicks = finiteNumber\(status\.signalTickCount\);/.test(popup) && /signalTicks > 0 && signalAge != null && signalAge < 2500/.test(popup) && /const hasFreshSignal = finiteNumber\(status\.signalTickCount\) > 0 && signalAge != null && signalAge < 2500;/.test(popup)],
  ['popup reports net positive gain as lift before reduction', /function displayEffectForStatus\(status, reductionDb, liftDb\)/.test(popup) && /const displayReductionDb = displayLiftDb > 0\.15 \? negativeGainDb : Math\.max\(reductionDb, negativeGainDb\);/.test(popup) && /effect\.kind === 'lift'/.test(popup)],
  ['capture remains wired without a redundant visible stop action', /WVB_STOP_TAB_CAPTURE/.test(popup) && !/stop|停止/i.test(html)],
  ['stale or failed state exposes full-tab recovery', /status\.staleEngine \|\| \(failedErrors\.length > 0 && processed === 0\)/.test(popup) && /setCaptureVisible\(captureAvailable, false\);/.test(popup)],
  ['disabled controls can still be visually dimmed elsewhere', /\.strengthControl\.isUnavailable/.test(css)],
  ['disabled ranges use native disabled semantics', /dial\.input\.disabled = !enabled;/.test(popup)],
  ['global control saves are serialized instead of dropped', /saveQueue = saveQueue\.then\(operation, operation\)/.test(popup)],
  ['slider persistence failures remain visible', /pendingSettingsError = t\('settingsSaveFailed'/.test(popup) && /setNotices\(\[\]\)/.test(popup)],
  ['zero strengths report original audio instead of active balancing', /cutStrength\) <= 0 && percentValue\(settings\?\.liftStrength\) <= 0/.test(popup) && /statusOriginalAudio/.test(popup)],
  ['level visualization reflects recent runtime history instead of a fixed decorative shape', /inputLevelHistory/.test(popup) && /outputLevelHistory/.test(popup) && /pushLevelHistory/.test(popup) && !/INPUT_LEVEL_SHAPE|OUTPUT_LEVEL_SHAPE/.test(popup)]
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
