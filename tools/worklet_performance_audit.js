const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
// Last published, unoptimized runtime; pin the comparison rather than silently
// comparing the new code with itself after its commit lands.
const baseline = 'afcfff1cfd2456048c1b80de43286076beb9e6fa';
// Freeze this historical coefficient-only equivalence experiment. Later volume
// intent / source-boundary fixes deliberately change PCM and cannot be compared
// byte-for-byte with the old functional baseline.
const optimized = '7769fad5c3d0aaa5cbe73d6872fbaea9d12f2b84';
const policy = execFileSync('git', ['show', `${optimized}:shared/programme-leveler-policy.js`], { cwd: root, encoding: 'utf8' });
const sources = {
  baseline: execFileSync('git', ['show', `${baseline}:offscreen/leveler-worklet.js`], { cwd: root, encoding: 'utf8' }),
  current: execFileSync('git', ['show', `${optimized}:offscreen/leveler-worklet.js`], { cwd: root, encoding: 'utf8' })
};
assert.equal(policy.replace(/\r\n/g, '\n'), execFileSync('git', ['show', `${baseline}:shared/programme-leveler-policy.js`], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n'), 'This benchmark requires an unchanged control policy');

function load(source, sampleRate) {
  let Processor;
  const context = vm.createContext({
    sampleRate,
    AudioWorkletProcessor: class {
      constructor() { this.messages = []; this.port = { postMessage: (message) => this.messages.push(message) }; }
    },
    registerProcessor(name, implementation) { if (name === 'wvb-leveler-processor') Processor = implementation; }
  });
  vm.runInContext(policy, context);
  vm.runInContext(source, context);
  return Processor;
}

function config(block, blocksPerSecond) {
  const second = Math.floor(block / blocksPerSecond);
  return { type: 'configure', configSequence: second + 1,
    settings: { enabled: second !== 8, respectPlayerVolume: true, cutStrength: second === 7 ? 0 : 100, liftStrength: second === 6 ? 0 : 100, targetLoudnessDb: second >= 9 ? -16 : -19 },
    playerVolumeCap: second === 5 ? 0.25 : 1,
    playerVolumeReliable: true,
    playerMuted: second === 4,
    programmeKey: second >= 9 ? 'next-programme' : 'first-programme' };
}

function run(Processor, sampleRate, blocks) {
  const processor = new Processor();
  const out = [new Float32Array(128), new Float32Array(128)];
  const output = [new Float32Array(blocks.length * 128), new Float32Array(blocks.length * 128)];
  const blocksPerSecond = Math.ceil(sampleRate / 128);
  const start = performance.now();
  for (let block = 0; block < blocks.length; block += 1) {
    if (block % blocksPerSecond === 0) processor.port.onmessage({ data: config(block, blocksPerSecond) });
    processor.process([blocks[block]], [out]);
    output[0].set(out[0], block * 128);
    output[1].set(out[1], block * 128);
  }
  return { elapsedMs: performance.now() - start, output, messages: JSON.stringify(processor.messages) };
}

function median(values) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
const results = [];
for (const sampleRate of [44100, 48000, 96000]) {
  const blocksPerSecond = Math.ceil(sampleRate / 128);
  const blocks = Array.from({ length: blocksPerSecond * 12 }, (_, block) => {
    const second = Math.floor(block / blocksPerSecond);
    const amplitude = [0.02, 0.02, 0.35, 0, 0.2, 0.02, 0.12, 0.35, 0.05, 0.008, 0.008, 0.35][second];
    const left = Float32Array.from({ length: 128 }, (_, i) => amplitude * Math.sin(2 * Math.PI * 997 * (block * 128 + i) / sampleRate));
    return [left, Float32Array.from(left, (value) => -0.5 * value)];
  });
  const classes = { baseline: load(sources.baseline, sampleRate), current: load(sources.current, sampleRate) };
  for (const Processor of Object.values(classes)) run(Processor, sampleRate, blocks.slice(0, blocksPerSecond));
  const times = { baseline: [], current: [] };
  for (let trial = 0; trial < 3; trial += 1) {
    const rendered = {};
    for (const name of trial % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      rendered[name] = run(classes[name], sampleRate, blocks);
      times[name].push(rendered[name].elapsedMs);
    }
    for (let channel = 0; channel < 2; channel += 1) {
      assert(Buffer.from(rendered.current.output[channel].buffer).equals(Buffer.from(rendered.baseline.output[channel].buffer)), `${sampleRate} Hz channel ${channel}: PCM changed`);
    }
    assert.equal(rendered.current.messages, rendered.baseline.messages, `${sampleRate} Hz diagnostic/control state changed`);
  }
  const baselineMs = median(times.baseline);
  const currentMs = median(times.current);
  results.push({ sampleRate, audioSeconds: blocks.length * 128 / sampleRate, channels: 2, exactPcmAndStateMatch: true, trials: times, baselineMedianMs: baselineMs, currentMedianMs: currentMs, elapsedReductionPercent: (1 - currentMs / baselineMs) * 100 });
}
const report = { baseline, optimized, historicalExperiment: true, environment: `Node ${process.version} VM on ${process.platform}; not current runtime or browser CPU`, results };
const reportPath = path.join(root, 'tmp', 'worklet-performance-audit.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
