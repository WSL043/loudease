const fs = require('fs');
const http = require('http');
const path = require('path');

const { buildReport } = require('./site_matrix_audit.js');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'tmp');
const diagnosticsPath = path.join(outDir, 'latest-diagnostics.json');
const matrixPath = path.join(outDir, 'latest-site-matrix.json');
const port = 18765;
const requiredScenarios = ['youtube-video', 'youtube-live', 'bilibili-video', 'bilibili-live', 'douyin-short', 'douyin-live'];

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function matrixSummary(report) {
  return report.matrix
    .filter((item) => requiredScenarios.includes(item.id))
    .map((item) => {
      const tab = item.tab;
      const gain = tab?.currentGainDb == null ? '--' : Number(tab.currentGainDb).toFixed(2);
      const input = tab?.inputDb == null ? '--' : Number(tab.inputDb).toFixed(1);
      const output = tab?.outputDb == null ? '--' : Number(tab.outputDb).toFixed(1);
      const effect = tab?.effect || item.evidence?.effect || 'missing';
      return `${item.id}:${item.status} effect=${effect} gain=${gain} input=${input} output=${output}`;
    })
    .join(' | ');
}

function completedScenarios(report) {
  return report.matrix
    .filter((item) => requiredScenarios.includes(item.id) && item.status === 'processing')
    .map((item) => item.id);
}

function printReport(report, source) {
  const completed = completedScenarios(report);
  const missing = requiredScenarios.filter((id) => !completed.includes(id));
  console.log(`[matrix] ${new Date().toISOString()} source=${source} version=${report.version || 'unknown'} fresh=${report.diagnosticsFresh} active=${report.activeCaptureTabs?.length || 0}`);
  console.log(`[matrix] ${matrixSummary(report)}`);
  console.log(`[matrix] completed=${completed.join(',') || '-'} missing=${missing.join(',') || '-'}`);
}

function reportFromDiagnostics(diagnostics, source) {
  const report = buildReport(diagnostics || {});
  writeJson(matrixPath, report);
  printReport(report, source);
  return report;
}

function handlePayload(payload) {
  payload._receivedAt = Date.now();
  writeJson(diagnosticsPath, payload);
  return reportFromDiagnostics(payload, 'post');
}

function makeServer(onReport) {
  return http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type'
      });
      response.end();
      return;
    }

    if (request.method !== 'POST' || request.url !== '/loudease') {
      response.writeHead(404);
      response.end();
      return;
    }

    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        const report = handlePayload(JSON.parse(body || '{}'));
        onReport(report);
        response.writeHead(204, { 'access-control-allow-origin': '*' });
        response.end();
      } catch (error) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(String(error?.message || error));
      }
    });
  });
}

function selfTest() {
  const report = buildReport({
    version: 'self-test',
    now: Date.now(),
    statusTtlMs: 8000,
    tabs: requiredScenarios.map((id, index) => ({
      tabId: index + 1,
      url: id === 'youtube-video'
        ? 'https://www.youtube.com/watch?v=example'
        : id === 'youtube-live'
          ? 'https://www.youtube.com/live/example'
          : id === 'bilibili-video'
            ? 'https://www.bilibili.com/video/BV1xx411c7mD/'
            : id === 'bilibili-live'
              ? 'https://live.bilibili.com/123'
              : id === 'douyin-short'
                ? 'https://www.douyin.com/?recommend=1'
                : 'https://live.douyin.com/123',
      mediaCount: 1,
      audibleCount: 1,
      activeProcessorCount: 1,
      captureActive: true,
      captureState: 'processing',
      capturePipelineMode: 'leveler-v3',
      meterMode: 'worklet',
      meterFrameAgeMs: 5,
      captureContextState: 'running',
      captureAudioTrackCount: 1,
      currentGainDb: index % 2 === 0 ? -3 : 4,
      averageInputDb: -30,
      averageOutputDb: -32,
      frames: []
    }))
  });
  const completed = completedScenarios(report);
  if (completed.length !== requiredScenarios.length) {
    throw new Error(`expected all scenarios complete, got ${completed.join(',')}`);
  }
  console.log('OK   live matrix watch self-test passed');
}

async function main() {
  if (hasArg('--self-test')) {
    selfTest();
    return;
  }

  const once = hasArg('--once');
  const noFail = hasArg('--no-fail');
  const timeoutMs = Number(argValue('--timeout-ms', once ? '0' : '300000'));
  const startedAt = Date.now();
  let latestReport = null;
  let exitTimer = null;

  function maybeFinish(report) {
    latestReport = report;
    const completed = completedScenarios(report);
    if (completed.length === requiredScenarios.length) {
      console.log('[matrix] all required real-site scenarios are processing');
      process.exit(0);
    }
    if (once) {
      process.exit(noFail ? 0 : 2);
    }
  }

  const existing = readJson(diagnosticsPath);
  if (existing) {
    maybeFinish(reportFromDiagnostics(existing, 'file'));
  } else if (once) {
    console.error(`[matrix] missing diagnostics file: ${diagnosticsPath}`);
    process.exit(noFail ? 0 : 2);
  }

  if (timeoutMs > 0) {
    exitTimer = setTimeout(() => {
      const completed = latestReport ? completedScenarios(latestReport) : [];
      const missing = requiredScenarios.filter((id) => !completed.includes(id));
      console.error(`[matrix] timeout after ${Date.now() - startedAt}ms; missing=${missing.join(',') || '-'}`);
      process.exit(noFail ? 0 : 2);
    }, timeoutMs);
  }

  const server = makeServer(maybeFinish);
  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.log(`[matrix] 127.0.0.1:${port} already has a diagnostics receiver; watching ${diagnosticsPath}`);
      fs.watchFile(diagnosticsPath, { interval: 1000 }, () => {
        const payload = readJson(diagnosticsPath);
        if (payload) {
          maybeFinish(reportFromDiagnostics(payload, 'file'));
        }
      });
      return;
    }
    throw error;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[matrix] listening on http://127.0.0.1:${port}/loudease`);
  });

  process.on('SIGINT', () => {
    if (exitTimer) {
      clearTimeout(exitTimer);
    }
    server.close(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
