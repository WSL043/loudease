const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmpDir = path.join(root, 'tmp');
const runner = path.join(__dirname, 'e2e_poc_smoke.js');

const scenarios = [
  {
    id: 'youtube-video',
    url: process.env.WVB_REAL_YOUTUBE_VIDEO_URL || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
  },
  {
    id: 'youtube-live',
    url: process.env.WVB_REAL_YOUTUBE_LIVE_URL || 'https://www.youtube.com/@ntv_news/live'
  },
  {
    id: 'bilibili-video',
    url: process.env.WVB_REAL_BILIBILI_VIDEO_URL || 'https://www.bilibili.com/video/BV15z4y1U7HS'
  },
  {
    id: 'bilibili-live',
    url: process.env.WVB_REAL_BILIBILI_LIVE_URL || 'https://live.bilibili.com/21654762'
  },
  {
    id: 'douyin-short',
    url: process.env.WVB_REAL_DOUYIN_SHORT_URL || 'https://www.douyin.com/video/7594382801768850091'
  },
  {
    id: 'douyin-live',
    url: process.env.WVB_REAL_DOUYIN_LIVE_URL || 'https://live.douyin.com/208823316033'
  }
];

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

const requested = argValue('scenario');
const selected = requested ? scenarios.filter((scenario) => scenario.id === requested) : scenarios;
const verbose = process.env.WVB_REAL_VERBOSE === '1';
const holdMs = Math.max(0, Number(argValue('hold-ms') || process.env.WVB_E2E_HOLD_MS || 0));
const aggregatePath = path.join(tmpDir, requested
  ? `latest-real-site-${holdMs > 0 ? 'endurance' : 'run'}-${requested}.json`
  : 'latest-real-site-matrix-e2e.json');
if (!selected.length) {
  console.error(`[real-site] unknown scenario: ${requested}`);
  process.exit(2);
}

fs.mkdirSync(tmpDir, { recursive: true });
const results = [];
for (const scenario of selected) {
  const reportPath = path.join(tmpDir, `latest-real-site-${scenario.id}.json`);
  fs.rmSync(reportPath, { force: true });
  console.log(`[real-site] start ${scenario.id} ${scenario.url}`);
  const run = spawnSync(process.execPath, [runner], {
    cwd: root,
    stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: verbose ? undefined : 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: Number(process.env.WVB_REAL_SCENARIO_TIMEOUT_MS || 180000),
    env: {
      ...process.env,
      WVB_E2E_URL: scenario.url,
      WVB_E2E_REPORT_ID: scenario.id,
      WVB_E2E_EXPECT: 'observe',
      WVB_E2E_MIN_SIGNAL_TICKS: process.env.WVB_E2E_MIN_SIGNAL_TICKS || '20',
      WVB_E2E_REQUIRE_POPUP_AUTOCAPTURE: '1',
      WVB_E2E_SILENT_SINK: '1',
      WVB_E2E_HEADLESS: process.env.WVB_E2E_HEADLESS || '1',
      WVB_E2E_SITE_SETTLE_MS: process.env.WVB_E2E_SITE_SETTLE_MS || '8000',
      WVB_E2E_HOLD_MS: String(holdMs),
      WVB_E2E_HOLD_SAMPLE_MS: process.env.WVB_E2E_HOLD_SAMPLE_MS || '5000'
    }
  });
  const report = readJson(reportPath);
  const passed = run.status === 0
    && report?.passed === true
    && report?.requestedUrl === scenario.url
    && report?.tab?.silentSink === true
    && report?.nativeAudioOutputOpened === false
    && (holdMs <= 0 || (report?.hold?.passed === true && Number(report.hold.durationMs) >= holdMs));
  results.push({
    id: scenario.id,
    url: scenario.url,
    passed,
    exitCode: run.status,
    report
  });
  if (!passed && !verbose) {
    const tail = `${run.stdout || ''}\n${run.stderr || ''}`
      .trim()
      .split(/\r?\n/)
      .slice(-24)
      .join('\n');
    if (tail) console.log(tail);
  }
  console.log(`[real-site] ${passed ? 'PASS' : 'FAIL'} ${scenario.id}`);
}

const aggregate = {
  version: readJson(path.join(root, 'manifest.json'))?.version || 'unknown',
  generatedAt: new Date().toISOString(),
  isolatedProfile: true,
  silentAudio: true,
  requestedHoldMs: holdMs,
  results
};
fs.writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);
if (holdMs > 0) {
  fs.writeFileSync(
    path.join(tmpDir, 'latest-real-site-endurance-e2e.json'),
    `${JSON.stringify(aggregate, null, 2)}\n`
  );
}

const failed = results.filter((result) => !result.passed);
console.log(`[real-site] completed=${results.length - failed.length}/${results.length} report=${aggregatePath}`);
process.exit(failed.length ? 1 : 0);
