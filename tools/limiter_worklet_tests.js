const path = require('path');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const LOOKAHEAD_MS = 5;
const LOOKAHEAD_SAMPLES = Math.round(SAMPLE_RATE * LOOKAHEAD_MS / 1000);
const CEILING = 10 ** (-3 / 20);

let ProcessorClass = null;

global.sampleRate = SAMPLE_RATE;
global.AudioWorkletProcessor = class AudioWorkletProcessor {
  constructor() {
    this.messages = [];
    this.port = {
      onmessage: null,
      postMessage: (message) => this.messages.push(message)
    };
  }
};
global.registerProcessor = (name, implementation) => {
  if (name === 'wvb-limiter-processor') {
    ProcessorClass = implementation;
  }
};

require(path.resolve(__dirname, '..', 'offscreen', 'limiter-worklet.js'));

function assert(name, condition, details = '') {
  if (!condition) {
    console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${name}`);
}

const processor = new ProcessorClass();
processor.port.onmessage({
  data: {
    type: 'configure',
    enabled: true,
    ceilingDb: -3,
    releaseSeconds: 0.08,
    lookaheadMs: LOOKAHEAD_MS
  }
});

const inputLength = BLOCK_SIZE * 24;
const impulseIndex = 320;
const leftInput = new Float32Array(inputLength);
const rightInput = new Float32Array(inputLength);
leftInput[impulseIndex] = 1;
rightInput[impulseIndex] = 0.5;
const leftOutput = new Float32Array(inputLength);
const rightOutput = new Float32Array(inputLength);

for (let offset = 0; offset < inputLength; offset += BLOCK_SIZE) {
  const leftBlock = leftInput.slice(offset, offset + BLOCK_SIZE);
  const rightBlock = rightInput.slice(offset, offset + BLOCK_SIZE);
  const outputLeft = new Float32Array(BLOCK_SIZE);
  const outputRight = new Float32Array(BLOCK_SIZE);
  processor.process([[leftBlock, rightBlock]], [[outputLeft, outputRight]]);
  leftOutput.set(outputLeft, offset);
  rightOutput.set(outputRight, offset);
}

let outputPeak = 0;
let outputPeakIndex = -1;
for (let i = 0; i < leftOutput.length; i += 1) {
  if (Math.abs(leftOutput[i]) > outputPeak) {
    outputPeak = Math.abs(leftOutput[i]);
    outputPeakIndex = i;
  }
}

assert('worklet processor registers', typeof ProcessorClass === 'function');
assert('lookahead delays the impulse by the configured duration', outputPeakIndex === impulseIndex + LOOKAHEAD_SAMPLES, String(outputPeakIndex));
assert('lookahead envelope reaches the sample ceiling', outputPeak <= CEILING + 1e-6 && outputPeak >= CEILING - 1e-4, String(outputPeak));
assert('lookahead envelope avoids emergency hard clipping', processor.hardClippedSamples === 0, String(processor.hardClippedSamples));
assert(
  'linked stereo channels preserve their level ratio',
  Math.abs(rightOutput[outputPeakIndex] - (leftOutput[outputPeakIndex] * 0.5)) < 1e-6,
  `${leftOutput[outputPeakIndex]},${rightOutput[outputPeakIndex]}`
);

const clusteredProcessor = new ProcessorClass();
clusteredProcessor.port.onmessage({
  data: {
    type: 'configure',
    enabled: true,
    ceilingDb: -3,
    releaseSeconds: 0.08,
    lookaheadMs: LOOKAHEAD_MS
  }
});
const clusteredInput = new Float32Array(2048);
clusteredInput[500] = 0.9;
clusteredInput[665] = 1;
for (let offset = 0; offset < clusteredInput.length; offset += BLOCK_SIZE) {
  clusteredProcessor.process(
    [[clusteredInput.slice(offset, offset + BLOCK_SIZE)]],
    [[new Float32Array(BLOCK_SIZE)]]
  );
}
const clusteredHardClips = clusteredProcessor.messages
  .reduce((sum, message) => sum + Number(message.hardClippedSamples || 0), 0)
  + clusteredProcessor.hardClippedSamples;
const clusteredMaxOvershoot = Math.max(
  clusteredProcessor.maxHardClipOvershoot,
  ...clusteredProcessor.messages.map((message) => Number(message.maxHardClipOvershoot || 0))
);
assert(
  'clustered future peaks do not hide an earlier over-ceiling peak',
  clusteredHardClips === 0 && clusteredMaxOvershoot === 0,
  JSON.stringify({ clusteredHardClips, clusteredMaxOvershoot })
);

const dynamicMessageStart = processor.messages.length;
processor.port.onmessage({
  data: { type: 'configure', enabled: true, ceilingDb: 0, releaseSeconds: 0.08, lookaheadMs: LOOKAHEAD_MS }
});
for (let block = 0; block < 120; block += 1) {
  if (block === 20 || block === 85) {
    processor.port.onmessage({
      data: { type: 'configure', enabled: true, ceilingDb: -3, releaseSeconds: 0.08, lookaheadMs: LOOKAHEAD_MS }
    });
  } else if (block === 70) {
    processor.port.onmessage({
      data: { type: 'configure', enabled: true, ceilingDb: 0, releaseSeconds: 0.08, lookaheadMs: LOOKAHEAD_MS }
    });
  }
  const input = new Float32Array(BLOCK_SIZE);
  const output = new Float32Array(BLOCK_SIZE);
  for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
    const sampleIndex = (block * BLOCK_SIZE) + frame;
    input[frame] = sampleIndex % 997 === 0
      ? 1
      : 0.92 * Math.sin(2 * Math.PI * 997 * sampleIndex / SAMPLE_RATE);
  }
  processor.process([[input]], [[output]]);
}
const dynamicHardClips = processor.messages
  .slice(dynamicMessageStart)
  .reduce((sum, message) => sum + Number(message.hardClippedSamples || 0), 0)
  + processor.hardClippedSamples;
const dynamicMaxOvershoot = Math.max(
  processor.maxHardClipOvershoot,
  ...processor.messages.slice(dynamicMessageStart).map((message) => Number(message.maxHardClipOvershoot || 0))
);
assert(
  'runtime ceiling changes do not fall through to hard clipping',
  dynamicHardClips === 0,
  JSON.stringify({ dynamicHardClips, dynamicMaxOvershoot })
);
assert('runtime ceiling changes report no overshoot', dynamicMaxOvershoot === 0, String(dynamicMaxOvershoot));

if (process.exitCode) {
  process.exit(process.exitCode);
}
