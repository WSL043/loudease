const path = require('path');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
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
  if (name === 'wvb-meter-processor') {
    ProcessorClass = implementation;
  }
};

require(path.resolve(__dirname, '..', 'offscreen', 'meter-worklet.js'));

function assert(name, condition, details = '') {
  if (!condition) {
    console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${name}`);
}

const processor = new ProcessorClass();
processor.port.onmessage({ data: { type: 'configure', frameMs: 20 } });

for (let block = 0; block < 8; block += 1) {
  const rawLeft = new Float32Array(BLOCK_SIZE).fill(0.1);
  const rawRight = new Float32Array(BLOCK_SIZE).fill(-0.1);
    const weightedLeft = new Float32Array(BLOCK_SIZE).fill(0.1);
    const weightedRight = new Float32Array(BLOCK_SIZE).fill(-0.1);
    const outputRawLeft = new Float32Array(BLOCK_SIZE).fill(0.05);
    const outputRawRight = new Float32Array(BLOCK_SIZE).fill(-0.05);
    const outputWeightedLeft = new Float32Array(BLOCK_SIZE).fill(0.2);
    const outputWeightedRight = new Float32Array(BLOCK_SIZE).fill(-0.2);
  const output = new Float32Array(BLOCK_SIZE);
  processor.process(
    [
      [rawLeft, rawRight],
      [weightedLeft, weightedRight],
      [outputRawLeft, outputRawRight],
      [outputWeightedLeft, outputWeightedRight]
    ],
    [[output]]
  );
}

const frame = processor.messages.find((message) => message.type === 'frame');
assert('meter worklet processor registers', typeof ProcessorClass === 'function');
assert('meter emits an exact 20ms frame', frame?.sampleCount === 960, JSON.stringify(frame || {}));
assert('meter preserves anti-phase channel energy', Math.abs(Number(frame?.energy) - 0.01) < 1e-6, String(frame?.energy));
assert('meter reports the linked raw peak', Math.abs(Number(frame?.peak) - 0.1) < 1e-6, String(frame?.peak));
assert('meter preserves weighted output energy', Math.abs(Number(frame?.outputEnergy) - 0.04) < 1e-6, String(frame?.outputEnergy));
assert('meter reports the linked output peak', Math.abs(Number(frame?.outputPeak) - 0.05) < 1e-6, String(frame?.outputPeak));
assert('meter advances a monotonic frame sequence', frame?.sequence === 0, String(frame?.sequence));

if (process.exitCode) {
  process.exit(process.exitCode);
}
