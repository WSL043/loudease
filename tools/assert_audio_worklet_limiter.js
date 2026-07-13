const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const workletPath = path.join(root, 'offscreen', 'limiter-worklet.js');
const worklet = fs.readFileSync(workletPath, 'utf8');
const graphPage = fs.readFileSync(path.join(root, 'test-pages', 'offline-audio-graph.html'), 'utf8');

const checks = [
  ['limiter worklet file exists', fs.existsSync(workletPath)],
  ['offscreen loads limiter AudioWorklet module', /audioWorklet\.addModule\(chrome\.runtime\.getURL\('offscreen\/limiter-worklet\.js'\)\)/.test(offscreen)],
  ['offscreen uses AudioWorkletNode as primary limiter', /new AudioWorkletNode\(this\.context, 'wvb-limiter-processor'/.test(offscreen) && /this\.limiterMode = 'worklet'/.test(offscreen)],
  ['offscreen keeps compressor fallback only after worklet failure', /catch \(error\) \{[\s\S]*?this\.limiterMode = 'compressor';[\s\S]*?createDynamicsCompressor\(\)/.test(offscreen)],
  ['worklet clamps output at configured ceiling', /this\.ceiling = Math\.max/.test(worklet) && /sample > this\.ceiling/.test(worklet) && /sample < -this\.ceiling/.test(worklet)],
  ['worklet delays audio for sample-peak lookahead', /this\.lookaheadMs = 5/.test(worklet) && /this\.delayBuffers/.test(worklet) && /const readIndex = \(this\.delayIndex \+ 1\) % this\.delayLength/.test(worklet)],
  ['worklet uses a rolling future peak window', /pushPeak\(value\)/.test(worklet) && /const lookaheadPeak = this\.pushPeak\(framePeak\)/.test(worklet) && /samplesUntilPeak/.test(worklet)],
  ['worklet reaches required gain over the available lookahead', /\(requiredGain - this\.gain\) \/ samplesUntilPeak/.test(worklet) && !/attackStep/.test(worklet)],
  ['worklet protects buffered samples when the ceiling tightens', /this\.ceiling < previousCeiling/.test(worklet) && /bufferedPeak/.test(worklet) && /gainCeiling \/ bufferedPeak/.test(worklet)],
  ['worklet reports limiter meter diagnostics', /type: 'meter'/.test(worklet) && /reductionDb/.test(worklet) && /limitedSamples/.test(worklet) && /hardClippedSamples/.test(worklet) && /maxHardClipOvershoot/.test(worklet)],
  ['offscreen exposes worklet limiter diagnostics', /limiterMode: this\.limiterMode/.test(offscreen) && /workletLimitedSamples: this\.workletLimitedSamples/.test(offscreen) && /workletHardClippedSamples: this\.workletHardClippedSamples/.test(offscreen)],
  ['offline graph test uses the worklet limiter path', /audioWorklet\.addModule\('\/offscreen\/limiter-worklet\.js'\)/.test(graphPage) && /new AudioWorkletNode\(context, 'wvb-limiter-processor'/.test(graphPage)]
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
