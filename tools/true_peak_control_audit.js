// Finite synthetic control records, including real rendered delay tails.
// This is candidate qualification, not a listening or certified-meter test.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadProcessor, measurePeaks } = require('./true_peak_audit');
const { loadCandidate, candidateSource } = require('./true_peak_candidate');

const root = path.resolve(__dirname, '..');
const scenarios = ['volume-down', 'volume-up', 'volume-lag', 'volume-rapid',
  'mute-unmute', 'zero-unmute', 'source-reset', 'target-change', 'strength-change', 'mono-stereo'];

function run(sampleRate, loader, scenario) {
  const processor = new (loader(sampleRate))();
  const result = [new Float32Array(8192), new Float32Array(8192)];
  let cap = scenario === 'volume-up' ? 0.25 : 1;
  let pcmCap = cap;
  let muted = false;
  let key = 'first';
  let target = -19;
  let cut = scenario === 'target-change' ? 100 : 0;
  let muteLeak = 0;
  let minimumLimiterGain = 1;
  let limiterGainBeforeEvent = 1;
  const configure = () => processor.port.onmessage({ data: { type: 'configure',
    settings: { enabled: true, respectPlayerVolume: true, cutStrength: cut,
      liftStrength: 100, targetLoudnessDb: target },
    playerVolumeCap: cap, playerVolumeReliable: true, playerMuted: muted, programmeKey: key } });
  configure();
  for (let offset = 0; offset < result[0].length; offset += 128) {
    if (offset === 2048) {
      limiterGainBeforeEvent = processor.limiterGain;
      if (scenario === 'volume-down') pcmCap = cap = 0.25;
      if (scenario === 'volume-up') pcmCap = cap = 1;
      if (scenario === 'volume-lag') pcmCap = 0.25;
      if (scenario === 'volume-rapid') pcmCap = cap = 0.25;
      if (scenario === 'mute-unmute') muted = true;
      if (scenario === 'zero-unmute') cap = 0;
      if (scenario === 'source-reset') key = 'second';
      if (scenario === 'target-change') target = -22;
      if (scenario === 'strength-change') cut = 100;
      configure();
    }
    if (offset === 2176 && scenario === 'volume-rapid') { pcmCap = cap = 1; configure(); }
    if (offset === 2304 && scenario === 'volume-rapid') { pcmCap = cap = 0.1; configure(); }
    if (offset === 3072 && scenario === 'volume-lag') { cap = pcmCap; configure(); }
    if (offset === 4096) { muted = false; if (scenario === 'zero-unmute') cap = 1; configure(); }
    // A near-full-scale Fs/4 burst forces active limiting before every event.
    // Keep nonzero PCM while muted to test the enforcement boundary itself.
    const left = Float32Array.from({ length: 128 }, (_, i) => offset + i < 6144
      ? pcmCap * 1.2 * Math.sin(Math.PI * (offset + i) / 2 + Math.PI / 4) : 0);
    const right = Float32Array.from(left, (value) => -0.5 * value);
    const input = scenario === 'mono-stereo' && offset < 2048 ? [left] : [left, right];
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process([input], [output]);
    minimumLimiterGain = Math.min(minimumLimiterGain, processor.limiterGain);
    for (let channel = 0; channel < 2; channel += 1) {
      result[channel].set(output[channel], offset);
      if (muted || cap === 0) for (const value of output[channel]) muteLeak = Math.max(muteLeak, Math.abs(value));
    }
  }
  const channels = result.map((pcm) => measurePeaks(pcm, 'zero'));
  const tailDrained = result.every((pcm) => pcm.subarray(-512).every((value) => value === 0));
  return { sampleRate, scenario, channels, muteLeak, minimumLimiterGain, limiterGainBeforeEvent, tailDrained,
    failed: channels.some((v) => v.fullScaleExceeded || v.measuredSamplePeak > 10 ** (-3 / 20) + 1e-6)
      || muteLeak !== 0 || !tailDrained || limiterGainBeforeEvent >= 1 };
}

function main() {
  const report = { schemaVersion: 1, boundary: 'finite record with rendered tail and zero extension',
    candidateSha256: crypto.createHash('sha256').update(candidateSource()).digest('hex'),
    productionSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'))).digest('hex'),
    results: [] };
  try {
    for (const sampleRate of [44100, 48000, 96000]) for (const scenario of scenarios) {
      const production = run(sampleRate, loadProcessor, scenario);
      const candidate = run(sampleRate, loadCandidate, scenario);
      report.results.push({ production, candidate });
      console.log(JSON.stringify({ sampleRate, scenario, productionFailed: production.failed,
        candidateFailed: candidate.failed, candidatePeak: Math.max(...candidate.channels.map((v) => v.referencePeak)) }));
    }
  } catch (error) { report.error = error.stack; console.error(error); }
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp/true-peak-control-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.error || report.results.length !== 3 * scenarios.length
    || report.results.some((v) => v.candidate.failed)) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { run };
