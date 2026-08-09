const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmpDir = path.join(root, 'tmp');
const runner = path.join(__dirname, 'e2e_poc_smoke.js');
const manifestVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
})();

const scenarios = [
  {
    id: 'loud-cut',
    page: 'simple-audio.html?gain=0.8',
    expect: 'reduce',
    report: 'latest-e2e-poc-reduce.json',
    minSignalTicks: 50,
    minReductionDb: 3
  },
  {
    id: 'low-volume-source-lift',
    page: 'simple-audio.html?gain=0.02',
    expect: 'lift',
    report: 'latest-e2e-poc-lift-low-volume.json',
    playerVolume: 0.25,
    minSignalTicks: 60,
    minLiftDb: 8,
    minLiftOutputDeltaDb: 8
  },
  {
    id: 'quiet-lift',
    page: 'quiet-dialog.html',
    expect: 'lift',
    report: 'latest-e2e-poc-lift.json',
    minSignalTicks: 60,
    minLiftDb: 3,
    minLiftOutputDeltaDb: 3
  },
  {
    id: 'low-player-hold',
    page: 'simple-audio.html?gain=0.2',
    expect: 'hold',
    report: 'latest-e2e-poc-low-player-volume-hold.json',
    playerVolume: 0.25,
    minSignalTicks: 60,
    maxHoldGainDb: 1.5
  },
  {
    id: 'mute-boundary',
    page: 'simple-audio.html?gain=0.2',
    expect: 'muted-during-capture',
    report: 'latest-e2e-poc-muted-during-capture.json',
    minSignalTicks: 50
  },
  {
    id: 'burst-recovery',
    page: 'burst-volume.html',
    expect: 'burst',
    report: 'latest-e2e-poc-burst.json',
    minSignalTicks: 220,
    minReductionDb: 3
  }
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

fs.mkdirSync(tmpDir, { recursive: true });
const verbose = process.env.WVB_CAPTURE_VERBOSE === '1';
const results = [];

for (const scenario of scenarios) {
  const reportPath = path.join(tmpDir, scenario.report);
  fs.rmSync(reportPath, { force: true });
  console.log(`[capture-matrix] start ${scenario.id}`);
  const run = spawnSync(process.execPath, [runner], {
    cwd: root,
    stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: verbose ? undefined : 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: Number(process.env.WVB_CAPTURE_SCENARIO_TIMEOUT_MS || 180000),
    env: {
      ...process.env,
      WVB_E2E_PAGE: scenario.page,
      WVB_E2E_EXPECT: scenario.expect,
      WVB_E2E_PLAYER_VOLUME: scenario.playerVolume == null ? '' : String(scenario.playerVolume),
      WVB_E2E_MIN_SIGNAL_TICKS: String(scenario.minSignalTicks),
      WVB_E2E_MIN_REDUCTION_DB: String(scenario.minReductionDb || 1),
      WVB_E2E_MIN_LIFT_DB: String(scenario.minLiftDb || 1),
      WVB_E2E_MIN_LIFT_OUTPUT_DELTA_DB: String(scenario.minLiftOutputDeltaDb || 3),
      WVB_E2E_MAX_HOLD_GAIN_DB: String(scenario.maxHoldGainDb || 1.5),
      WVB_E2E_REQUIRE_POPUP_AUTOCAPTURE: '1',
      WVB_E2E_SILENT_SINK: '1',
      WVB_E2E_HEADLESS: process.env.WVB_E2E_HEADLESS || '1',
      WVB_E2E_HOLD_MS: '0',
      WVB_E2E_MUTE_AUDIO: '0',
      WVB_E2E_CAPTURE_ONLY: '0'
    }
  });
  const report = readJson(reportPath);
  const tab = report?.tab || {};
  const passed = run.status === 0
    && report?.passed === true
    && report?.version === manifestVersion
    && report?.silentSink === true
    && report?.nativeAudioOutputOpened === false
    && report?.phase === 'capture-active'
    && report?.stopPhase === 'capture-stopped'
    && report?.stopOk === true
    && tab.capturePipelineMode === 'programme-leveler-v4'
    && tab.captureContextState === 'running'
    && tab.silentSink === true
    && ['leveler-worklet', 'worklet', 'analyser-fallback'].includes(tab.meterMode)
    && Number(tab.meterFrameAgeMs ?? Infinity) < 1000
    && Number(tab.signalTickCount || 0) >= scenario.minSignalTicks
    && Number(tab.workletHardClippedSamples || 0) === 0
    && Number(tab.workletMaxHardClipOvershoot || 0) <= 1e-9;
  results.push({ id: scenario.id, passed, exitCode: run.status, report });
  if (!passed && !verbose) {
    const tail = `${run.stdout || ''}\n${run.stderr || ''}`
      .trim()
      .split(/\r?\n/)
      .slice(-30)
      .join('\n');
    if (tail) console.log(tail);
  }
  console.log(`[capture-matrix] ${passed ? 'PASS' : 'FAIL'} ${scenario.id}`);
}

const aggregate = {
  version: manifestVersion,
  generatedAt: new Date().toISOString(),
  isolatedProfiles: true,
  silentAudio: true,
  results
};
const aggregatePath = path.join(tmpDir, 'latest-local-capture-matrix-e2e.json');
fs.writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);
const failed = results.filter((result) => !result.passed);
console.log(`[capture-matrix] completed=${results.length - failed.length}/${results.length} report=${aggregatePath}`);
process.exit(failed.length ? 1 : 0);
