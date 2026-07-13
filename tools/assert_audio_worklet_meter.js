const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const meter = fs.readFileSync(path.join(root, 'offscreen', 'meter-worklet.js'), 'utf8');

const checks = [
  ['meter worklet file exists', fs.existsSync(path.join(root, 'offscreen', 'meter-worklet.js'))],
  ['offscreen loads the meter worklet', /audioWorklet\.addModule\(chrome\.runtime\.getURL\('offscreen\/meter-worklet\.js'\)\)/.test(offscreen)],
  ['offscreen uses four meter inputs for raw and weighted input/output audio', /numberOfInputs: 4/.test(offscreen) && /this\.source\.connect\(this\.meter, 0, 0\)/.test(offscreen) && /this\.kHighpass\.connect\(this\.meter, 0, 1\)/.test(offscreen) && /this\.playerGain\.connect\(this\.meter, 0, 2\)/.test(offscreen) && /this\.outputKHighpass\.connect\(this\.meter, 0, 3\)/.test(offscreen)],
  ['meter consumes continuous render frames', /for \(let frame = 0; frame < frameCount; frame \+= 1\)/.test(meter) && /this\.samplesInFrame >= this\.frameSamples/.test(meter)],
  ['meter computes per-channel energy without phase cancellation', /for \(const channel of weightedInput\)/.test(meter) && /this\.weightedSquareSum \+= sample \* sample/.test(meter)],
  ['meter computes post-DSP weighted energy and linked peak', /outputWeightedInput/.test(meter) && /outputWeightedSquareSum/.test(meter) && /outputRawPeak/.test(meter)],
  ['worklet frame drives production input and output measurement', /handleMeterMessage\(message\)/.test(offscreen) && /this\.processMeasurement\(energy, peak, \{ energy: outputEnergy, peak: outputPeak \}\)/.test(offscreen)],
  ['analyser polling is fallback only', /this\.meterMode = 'analyser-fallback'/.test(offscreen) && /if \(this\.meterMode !== 'worklet'\) \{[\s\S]*?this\.measure\(\)/.test(offscreen)],
  ['meter diagnostics expose mode and frame age', /meterMode: this\.meterMode/.test(offscreen) && /meterFrameAgeMs/.test(offscreen)]
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
