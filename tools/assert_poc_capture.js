const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'content', 'bridge.js'), 'utf8');
const harness = fs.readFileSync(path.join(root, 'e2e', 'harness.js'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'tools', 'e2e_poc_smoke.js'), 'utf8');

const checks = [
  ['offscreen pipeline is programme-leveler-v4', /const PIPELINE_MODE = 'programme-leveler-v4';/.test(offscreen)],
  ['offscreen reports the exact programme-control policy revision', /POLICY_REVISION/.test(offscreen) && /controlPolicyRevision: POLICY_REVISION/.test(offscreen)],
  ['offscreen graph reconnects captured stream through a fail-closed startup gate', /this\.source = this\.context\.createMediaStreamSource\(this\.stream\);/.test(offscreen) && /this\.source\.connect\(this\.leveler\);[\s\S]*?this\.leveler\.connect\(this\.playerGain\);/.test(offscreen) && /this\.outputGain\.connect\(this\.limiter\);[\s\S]*?this\.limiter\.connect\(this\.playerGain\);/.test(offscreen) && /this\.startupGain\.gain\.value = 0;/.test(offscreen) && /this\.playerGain\.connect\(this\.startupGain\);[\s\S]*?this\.startupGain\.connect\(this\.outputAnalyser\);[\s\S]*?this\.outputAnalyser\.connect\(this\.context\.destination\);/.test(offscreen)],
  ['offscreen graph has continuous input and output meters', /this\.source\.connect\(this\.meter, 0, 0\);/.test(offscreen) && /this\.kHighpass\.connect\(this\.meter, 0, 1\);/.test(offscreen) && /this\.playerGain\.connect\(this\.meter, 0, 2\);/.test(offscreen) && /this\.outputKHighpass\.connect\(this\.meter, 0, 3\);/.test(offscreen) && /this\.outputAnalyser\.connect\(this\.context\.destination\);/.test(offscreen) && /outputMomentaryDb/.test(offscreen)],
  ['offscreen graph has an AudioWorklet safety limiter with compressor fallback', /audioWorklet\.addModule\(chrome\.runtime\.getURL\('offscreen\/limiter-worklet\.js'\)\)/.test(offscreen) && /new AudioWorkletNode\(this\.context, 'wvb-limiter-processor'/.test(offscreen) && /createDynamicsCompressor\(\)/.test(offscreen) && /LIMITER_CEILING_DB/.test(offscreen) && /limiterReductionDb/.test(offscreen)],
  ['offscreen graph has AGC gain smoothing', /function readEnergy/.test(offscreen) && /smoothGain\(targetDb, timeConstant, frameStartGainDb/.test(offscreen) && /rampAudioParam/.test(offscreen) && /linearRampToValueAtTime/.test(offscreen)],
  ['offscreen state machine reports startup progress', /state: 'offscreen-starting'/.test(offscreen) && /this\.setState\('audio-context-created'\)/.test(offscreen) && /this\.setState\(this\.context\.state === 'running' \? 'processing' : this\.context\.state\)/.test(offscreen)],
  ['offscreen reports track and context diagnostics', /trackSummary\(track\)/.test(offscreen) && /contextState: context\?\.state/.test(offscreen) && /audioTrackCount: stream\.audioTrackCount/.test(offscreen)],
  ['offscreen separates capture ownership from live DSP frames', /const connected = !this\.destroyed/.test(offscreen) && /const dspLive = connected/.test(offscreen) && /startupGateOpen: this\.startupGateOpen/.test(offscreen) && /levelerConfigured:/.test(offscreen)],
  ['offscreen reports live settings diagnostics', /settingsEnabled: this\.settings\.enabled !== false/.test(offscreen) && /settingsCutStrength: this\.settings\.cutStrength/.test(offscreen) && /settingsLiftStrength: this\.settings\.liftStrength/.test(offscreen)],
  ['offscreen cleanup removes listeners, stops tracks, disconnects nodes, closes context', /removeEventListener/.test(offscreen) && /node\?\.disconnect\(\)/.test(offscreen) && /track\.stop\(\)/.test(offscreen) && /this\.context\.close\(\)/.test(offscreen)],
  ['offscreen does not answer background-owned runtime messages', /startsWith\('WVB_OFFSCREEN_'\)/.test(offscreen) && /return false;/.test(offscreen)],
  ['background emits capture state timeline', /capture:state/.test(background) && /previous: previous\?\.state \|\| 'none'/.test(background)],
  ['background resyncs stale capture settings from offscreen status', /function reconcileCaptureSettings\(tabId, capture = \{\}, reason = ''\)/.test(background) && /capture:settings-resync/.test(background) && /await reconcileCaptureSettings\(tabId, status, 'capture-status'\)/.test(background)],
  ['background exposes capture diagnostics even without content frames', /for \(const \[tabId\] of captureStatuses\.entries\(\)\)/.test(background) && /frames: \[\]/.test(background)],
  ['background aggregates capture track, policy, and context state', /captureContextState/.test(background) && /captureAudioTrackCount/.test(background) && /capturePipelineMode/.test(background) && /captureControlPolicyRevision/.test(background)],
  ['background preserves offscreen start status detail', /const captureStatus = response\?\.status/.test(background) && /\.\.\.captureStatus,[\s\S]*?engineVersion: captureStatus\.engineVersion \|\| CURRENT_VERSION/.test(background)],
  ['background counts only connected captures and current DSP frames', /processedCount: captureConnected \? 1 : 0/.test(background) && /activeProcessorCount: captureDspLive \? 1 : 0/.test(background)],
  ['legacy content page audio processing is deleted during PoC', !fs.existsSync(path.join(root, 'content', 'engine.js')) && /processedCount: 0/.test(bridge) && !/AudioContext|createMediaElementSource|captureStream/.test(bridge)],
  ['E2E harness requests tabCapture from a click path', /chrome\.tabCapture\.getMediaStreamId/.test(harness) && /addEventListener\('click', start\)/.test(harness)],
  ['E2E smoke uses isolated profile and local test page', /--user-data-dir=/.test(smoke) && /startStaticServer/.test(smoke) && /simple-audio\.html/.test(smoke)],
  ['E2E staging excludes generated build output', /entry\.name === 'tmp' \|\| entry\.name === 'dist' \|\| entry\.name === '\.git'/.test(smoke)],
  ['E2E smoke writes structured current-version scenario reports', /latest-e2e-poc-\$\{String\(scenario\.expect\)/.test(smoke) && /latest-e2e-poc\.json/.test(smoke) && /version: manifestVersion/.test(smoke) && /writeJson\(scenarioReportPath, report\)/.test(smoke)]
];

let failed = false;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`OK   ${name}`);
  } else {
    failed = true;
    console.error(`FAIL ${name}`);
  }
}

if (failed) {
  process.exit(1);
}
