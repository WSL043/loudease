const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { candidateSource } = require('./true_peak_candidate');
const { samplePeak, estimatedTruePeak, measurePeaks } = require('./true_peak_audit');
const { findChrome, waitForDevToolsPort, waitForCdp, CdpSocket, connectTarget,
  evaluateValue, sleep, assertInside } = require('./offline_audio_graph_tests');
const root = path.resolve(__dirname, '..');
const tmp = path.join(root, 'tmp');

function scheduledSource(source) {
  // Test-only sample-aligned control messages; production configuration remains
  // untouched. No eval, prototype patching, or test switches in either package.
  return `${source}\nclass ScheduledAuditProcessor extends WebVolumeBalancerLevelerProcessor {
    constructor(options) { super(); this.auditEvents = options.processorOptions.events;
      this.auditEventIndex = 0; this.auditFrame = 0; }
    process(inputs, outputs) {
      while (this.auditEventIndex < this.auditEvents.length && this.auditEvents[this.auditEventIndex].frame <= this.auditFrame) {
        this.configure(this.auditEvents[this.auditEventIndex++].data);
      }
      const alive = super.process(inputs, outputs);
      this.auditFrame += outputs[0][0].length;
      return alive;
    }
  }
  registerProcessor('wvb-audit-processor', ScheduledAuditProcessor);`;
}

async function main() {
  fs.mkdirSync(tmp, { recursive: true });
  const production = fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'), 'utf8');
  const candidate = candidateSource(production);
  const reference = candidateSource(production, { fused: false });
  const routes = {
    '/': ['text/html', '<!doctype html><title>LoudEase isolated audit</title><script src="/measure.js"></script><script src="/harness.js"></script>'],
    '/policy.js': ['text/javascript', fs.readFileSync(path.join(root, 'shared/programme-leveler-policy.js'), 'utf8')],
    '/production.js': ['text/javascript', scheduledSource(production)],
    '/candidate.js': ['text/javascript', scheduledSource(candidate)],
    '/reference.js': ['text/javascript', scheduledSource(reference)],
    '/measure.js': ['text/javascript', `const TRUE_PEAK_LIMIT = 1;\n${samplePeak}\n${estimatedTruePeak}\n${measurePeaks}`],
    '/harness.js': ['text/javascript', fs.readFileSync(path.join(root, 'test-pages/candidate-browser-audit.js'), 'utf8')]
  };
  const server = http.createServer((request, response) => {
    const route = routes[new URL(request.url, 'http://127.0.0.1').pathname];
    response.writeHead(route ? 200 : 404, { 'content-type': route?.[0] || 'text/plain' });
    response.end(route?.[1] || 'not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(tmp, 'candidate-browser-profile-'));
  assertInside(tmp, profile);
  const child = spawn(findChrome(), [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  const sockets = [];
  const report = { date: new Date().toISOString(), productionSha256: crypto.createHash('sha256').update(production).digest('hex'),
    candidateSha256: crypto.createHash('sha256').update(candidate).digest('hex'),
    referenceSha256: crypto.createHash('sha256').update(reference).digest('hex'),
    hardwareOutputUsed: false, cases: [], benchmarks: [], realtime: [] };
  try {
    const port = await waitForDevToolsPort(profile, child, () => stderr);
    const version = await waitForCdp(port);
    report.browser = version.Browser;
    const browser = new CdpSocket(version.webSocketDebuggerUrl);
    await browser.connect(); sockets.push(browser);
    await browser.command('Target.createTarget', { url: origin });
    const { cdp } = await connectTarget(port, (target) => target.type === 'page' && target.url === origin);
    sockets.push(cdp);
    await cdp.command('Runtime.enable');
    for (let i = 0; i < 100; i += 1) {
      if (await evaluateValue(cdp, "typeof window.renderCandidateCase === 'function'")) break;
      await sleep(100);
    }
    const failures = [];
    for (const rate of [44100, 48000, 96000]) {
      for (const scenario of ['stress', 'volume', 'volume-lag', 'system-volume', 'reference', 'boundary', 'tone',
        'crest-volume', 'crest-reference', 'edge-volume', 'edge-reference']) {
        for (const variant of ['production', 'candidate']) {
          const options = { rate, scenario, variant, kind: scenario.startsWith('crest-') ? 'crest' : scenario === 'stress' ? 'alternating' : scenario === 'tone' ? 'sine' : 'ordinary', seconds: ['volume', 'volume-lag', 'system-volume', 'reference'].includes(scenario) ? 10 : 4 };
          const result = await evaluateValue(cdp, `window.renderCandidateCase(${JSON.stringify(options)})`);
          report.cases.push(result);
          assert(result.stereoError < 1e-6 && result.peak <= 10 ** (-3 / 20) + 1e-6);
          if (variant === 'candidate' && result.peaks?.fullScaleExceeded) failures.push(`${rate}: candidate stress overshoot`);
          if (scenario === 'volume') assert.equal(result.rmsSegments[7], 0, 'hard mute');
          if (scenario === 'boundary') assert.equal(result.oldProgrammeLeak, 0, 'old programme buffer cleared');
          if (scenario === 'tone') assert(result.toneResidualDb < -50, 'steady ordinary-tone residual below -50 dB');
          console.log(JSON.stringify({ rate, scenario, variant, peaks: result.peaks, oldProgrammeLeak: result.oldProgrammeLeak, renderMs: result.renderMs }));
          if (variant === 'candidate') {
            const prior = await evaluateValue(cdp, `window.renderCandidateCase(${JSON.stringify({ ...options, variant: 'reference' })})`);
            assert.deepEqual(result.pcmHashes, prior.pcmHashes, 'fused/reference stereo PCM must be byte-identical');
            result.referencePcmMatch = true;
          }
        }
      }
      for (const variant of ['production', 'candidate']) {
        const get = (scenario) => report.cases.find((row) => row.rate === rate && row.variant === variant && row.scenario === scenario);
        const edge = get('edge-volume');
        edge.pendingAudioErrorDb = 20 * Math.log10(edge.edgeRms / get('edge-reference').edgeRms);
        assert(Math.abs(edge.pendingAudioErrorDb) < 0.25, 'first 4 ms after late downward metadata');
        const crest = get('crest-volume'), crestReference = get('crest-reference');
        const start = 3 * Math.ceil(rate / 128) * 128;
        const errors = crest.windowRms.flatMap((value, i) => i * 960 >= start + rate * 0.01 && (i + 1) * 960 <= start + rate * 0.1
          ? [Math.abs(20 * Math.log10(value / (0.5 * crestReference.windowRms[i])))] : []);
        assert(errors.length > 0);
        crest.highCrestVolumeErrorDb = Math.max(...errors);
        assert(crest.highCrestVolumeErrorDb < 0.25, 'high-crest manual-volume transient');
        const reference = report.cases.find((row) => row.rate === rate && row.variant === variant && row.scenario === 'reference');
        for (const scenario of ['volume', 'volume-lag', 'system-volume']) {
          const actual = report.cases.find((row) => row.rate === rate && row.variant === variant && row.scenario === scenario);
          const second = Math.ceil(rate / 128) * 128;
          const differences = [];
          for (let i = 0; i < reference.windowRms.length; i += 1) {
            const start = i * 960, end = start + 960;
            const guard = Math.ceil(rate * (scenario === 'volume-lag' ? 0.5 : 0.01));
            const cap = start >= 3 * second + guard && end <= 5 * second ? 0.25 : start >= 5 * second + guard && end <= 7 * second ? 1 : null;
            if (cap !== null) differences.push(Math.abs(20 * Math.log10(actual.windowRms[i] / (reference.windowRms[i] * cap))));
          }
          actual.worstVolumeIntentErrorDb = Math.max(...differences);
          assert(actual.worstVolumeIntentErrorDb < (scenario === 'volume-lag' ? 0.5 : 0.25), `${variant} ${scenario}: volume intent`);
        }
      }
      for (const kind of ['ordinary', 'alternating']) {
        const times = { production: [], candidate: [], reference: [] };
        const hashes = {};
        for (let trial = -1; trial < 5; trial += 1) for (const variant of trial % 2 ? ['candidate', 'reference', 'production'] : ['production', 'reference', 'candidate']) {
          const options = { rate, kind, variant, seconds: 4, scenario: kind === 'alternating' ? 'benchmark-stress' : 'steady' };
          const result = await evaluateValue(cdp, `window.renderCandidateCase(${JSON.stringify(options)})`);
          hashes[variant] = result.pcmHashes;
          if (hashes.candidate && hashes.reference) assert.deepEqual(hashes.candidate, hashes.reference,
            'benchmark fused/reference PCM must be byte-identical');
          if (trial >= 0) times[variant].push(result.renderMs);
        }
        const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const result = { rate, kind, audioSeconds: 4, channels: 2, trialsMs: times,
          medianOverheadPercent: (median(times.candidate) / median(times.production) - 1) * 100,
          improvementVsReferencePercent: (1 - median(times.candidate) / median(times.reference)) * 100 };
        report.benchmarks.push(result);
        console.log(JSON.stringify(result));
      }
    }
    for (const variant of ['production', 'candidate']) {
      const sessions = await evaluateValue(cdp, `window.runCandidateRealtime('${variant}')`);
      report.realtime.push({ variant, sessions });
      for (const session of sessions) {
        assert.equal(session.sinkType, 'none');
        assert.equal(session.errors, 0);
        assert.equal(session.state, 'running');
        assert(session.currentTime >= 14 && session.messages >= 100, 'continuous real-time rendering');
      }
      console.log(`OK ${variant}: four concurrent silent real-time contexts`);
    }
    report.failures = failures;
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    report.error = { message: error.message, stack: error.stack };
    console.error(error);
    process.exitCode = 1;
  } finally {
    const target = path.join(tmp, 'browser-candidate-audit.json');
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${target}`);
    for (const socket of sockets) socket.close();
    child.kill(); server.close();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(2000)]);
    assertInside(tmp, profile);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may retain files briefly. */ }
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
