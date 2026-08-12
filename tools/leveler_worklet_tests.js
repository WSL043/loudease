const path = require('path');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
let ProcessorClass;
global.sampleRate = SAMPLE_RATE;
global.AudioWorkletProcessor = class {
  constructor() {
    this.messages = [];
    this.port = { onmessage: null, postMessage: (message) => this.messages.push(message) };
  }
};
global.registerProcessor = (name, implementation) => {
  if (name === 'wvb-leveler-processor') ProcessorClass = implementation;
};
require(path.resolve(__dirname, '..', 'shared', 'programme-leveler-policy.js'));
require(path.resolve(__dirname, '..', 'offscreen', 'leveler-worklet.js'));

function assert(name, condition, details = '') {
  if (condition) console.log(`OK   ${name}`);
  else {
    console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
    process.exitCode = 1;
  }
}

function configure(processor, overrides = {}, media = {}) {
  processor.port.onmessage({ data: {
    type: 'configure',
    configSequence: media.configSequence ?? 1,
    settings: {
      enabled: true,
      respectPlayerVolume: true,
      cutStrength: 100,
      liftStrength: 100,
      ...overrides
    },
    playerVolumeCap: media.playerVolumeCap ?? 1,
    playerVolumeReliable: media.playerVolumeReliable ?? true,
    playerMuted: media.playerMuted ?? false,
    allowUnknownVolumeLift: media.allowUnknownVolumeLift ?? false,
    programmeKey: media.programmeKey ?? 'programme-a'
  } });
}

function sine(amplitude, frequency = 997) {
  return (sampleIndex) => amplitude * Math.sin(2 * Math.PI * frequency * sampleIndex / SAMPLE_RATE);
}

function renderGenerated(processor, seconds, generator, startSample = 0, collect = false) {
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  const outputSamples = collect ? [] : null;
  let peak = 0;
  let energy = 0;
  let samples = 0;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const output = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      input[index] = generator(startSample + (block * BLOCK_SIZE) + index);
    }
    processor.process([[input]], [[output]]);
    for (const value of output) {
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
      samples += 1;
      if (outputSamples) outputSamples.push(value);
    }
  }
  return {
    peak,
    rms: Math.sqrt(energy / Math.max(1, samples)),
    sampleCount: blocks * BLOCK_SIZE,
    outputSamples
  };
}

function render(processor, seconds, amplitude, startSample = 0, collect = false) {
  return renderGenerated(processor, seconds, sine(amplitude), startSample, collect);
}

function states(processor) {
  return processor.messages.filter((message) => message.type === 'state');
}

function latest(processor) {
  return states(processor).at(-1) || {};
}

function steady(processor, fraction = 0.35) {
  const all = states(processor);
  const selected = all.slice(Math.floor(all.length * (1 - fraction)));
  const average = (field) => selected.reduce((sum, state) => sum + Number(state[field] || 0), 0)
    / Math.max(1, selected.length);
  return {
    inputDb: average('momentaryInputDb'),
    outputDb: average('outputMomentaryDb'),
    gainDb: average('currentGainDb'),
    limiterReductionDb: average('currentLimiterReductionDb'),
    hardClippedSamples: all.reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0)
  };
}

function renderSteady(amplitude, media = {}) {
  const processor = new ProcessorClass();
  configure(processor, {}, media);
  render(processor, 7, amplitude);
  return { processor, summary: steady(processor) };
}

function windowMetrics(samples, seconds) {
  const length = Math.min(samples.length, Math.round(SAMPLE_RATE * seconds));
  let energy = 0;
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[index];
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return {
    rmsDb: 20 * Math.log10(Math.max(1e-12, Math.sqrt(energy / Math.max(1, length)))),
    peakDb: 20 * Math.log10(Math.max(1e-12, peak))
  };
}

function onsetAfter(leadAmplitude, onsetAmplitude = 0.35) {
  const processor = new ProcessorClass();
  configure(processor);
  const lead = render(processor, 1.5, leadAmplitude);
  const onset = render(processor, 0.08, onsetAmplitude, lead.sampleCount, true);
  return {
    processor,
    first20Ms: windowMetrics(onset.outputSamples, 0.02),
    first40Ms: windowMetrics(onset.outputSamples, 0.04)
  };
}

const unconfigured = new ProcessorClass();
const unconfiguredOut = render(unconfigured, 0.05, 0.2);
assert('unconfigured worklet is fail-closed', unconfiguredOut.rms < 1e-6, String(unconfiguredOut.rms));
configure(unconfigured);
assert(
  'worklet acknowledges applied configuration',
  unconfigured.messages.some((message) => message.type === 'configured' && message.configSequence === 1),
  JSON.stringify(unconfigured.messages)
);
const configuredOut = render(unconfigured, 0.1, 0.2, unconfiguredOut.sampleCount);
assert(
  'configured worklet opens through the adaptive startup ceiling',
  configuredOut.rms > 0.01 && configuredOut.peak <= 10 ** (-12.9 / 20),
  JSON.stringify(configuredOut)
);
assert(
  'diagnostic messages remain near 10 Hz while control runs at audio rate',
  states(unconfigured).length >= 1 && states(unconfigured).length <= 2,
  String(states(unconfigured).length)
);

const zero = new ProcessorClass();
configure(zero, { cutStrength: 0, liftStrength: 0 });
const zeroOut = render(zero, 0.8, 0.2);
assert('zero strength remains unity', Math.abs(zeroOut.rms - 0.2 / Math.SQRT2) < 0.003, String(zeroOut.rms));

const loud = renderSteady(0.35);
const typical = renderSteady(0.12);
const quiet = renderSteady(0.02);
const veryQuiet = renderSteady(0.008);
const outputs = [loud, typical, quiet, veryQuiet].map((item) => item.summary.outputDb);
assert(
  'typical programme keeps nearly the same enabled and bypass average',
  Math.abs(typical.summary.outputDb - typical.summary.inputDb) < 2,
  JSON.stringify(typical.summary)
);
assert(
  'loud programme receives bounded downward normalization around the new centre',
  loud.summary.gainDb < -4.5 && loud.summary.outputDb > -19.5 && loud.summary.outputDb < -17.5,
  JSON.stringify(loud.summary)
);
assert(
  'quiet programme receives strong upward normalization around the new centre',
  quiet.summary.gainDb > 16 && quiet.summary.outputDb > -21.5 && quiet.summary.outputDb < -19,
  JSON.stringify(quiet.summary)
);
assert(
  'very quiet programme stays inside the explicit 25 dB lift bound',
  veryQuiet.summary.gainDb <= 25.01 && veryQuiet.summary.gainDb > 24,
  JSON.stringify(veryQuiet.summary)
);
assert(
  'loud and quiet programme centres converge without forcing exact identity',
  Math.max(...outputs) - Math.min(...outputs) < 4,
  JSON.stringify(outputs)
);

const coldQuiet = new ProcessorClass();
configure(coldQuiet);
render(coldQuiet, 0.3, 0.02);
assert(
  'upward gain waits for a measured programme instead of guessing from the first samples',
  Math.abs(latest(coldQuiet).currentGainDb || 0) < 0.25,
  JSON.stringify(latest(coldQuiet))
);
render(coldQuiet, 1.7, 0.02, Math.round(0.3 * SAMPLE_RATE));
assert(
  'a quiet opening cannot establish full programme lift in two seconds',
  latest(coldQuiet).programmeConfidence < 0.5 && latest(coldQuiet).currentGainDb < 9,
  JSON.stringify(latest(coldQuiet))
);
render(coldQuiet, 3.5, 0.02, Math.round(2 * SAMPLE_RATE));
assert(
  'a sustained quiet programme still reaches useful lift after representative evidence',
  latest(coldQuiet).programmeConfidence >= 0.99 && latest(coldQuiet).currentGainDb > 16,
  JSON.stringify(latest(coldQuiet))
);

const quietOnset = onsetAfter(0.008);
assert(
  'adaptive lookahead catches a loud onset without the legacy -24 dBFS deep duck',
  quietOnset.first20Ms.peakDb <= -12.9
    && quietOnset.first20Ms.rmsDb > -23
    && quietOnset.first20Ms.rmsDb < -17,
  JSON.stringify(quietOnset)
);
const silenceOnset = onsetAfter(0, 0.8);
assert(
  'cold loud onset is caught before the first audible block',
  silenceOnset.first20Ms.peakDb <= -12.9,
  JSON.stringify(silenceOnset)
);
const normalOnset = onsetAfter(0.12);
assert(
  'active-programme jump is bounded by the fixed programme safety crest',
  normalOnset.first20Ms.peakDb <= -12.9,
  JSON.stringify(normalOnset)
);

const fullVolumeQuiet = renderSteady(0.02).summary;
const quarterVolumeQuiet = renderSteady(0.005, { playerVolumeCap: 0.25, playerVolumeReliable: true }).summary;
assert(
  'player-volume compensation preserves the source decision without undoing user volume',
  Math.abs(fullVolumeQuiet.gainDb - quarterVolumeQuiet.gainDb) < 0.5
    && Math.abs((fullVolumeQuiet.outputDb - quarterVolumeQuiet.outputDb) - 12.041) < 0.75,
  JSON.stringify({ fullVolumeQuiet, quarterVolumeQuiet })
);
const unknownVolume = renderSteady(0.02, { playerVolumeReliable: false }).summary;
assert('unknown player volume blocks automatic upward gain', unknownVolume.gainDb <= 0.1, JSON.stringify(unknownVolume));

const highCrest = new ProcessorClass();
configure(highCrest);
const highCrestOut = renderGenerated(highCrest, 6, (sampleIndex) => {
  const bed = 0.006 * Math.sin(2 * Math.PI * 997 * sampleIndex / SAMPLE_RATE);
  return sampleIndex % Math.round(SAMPLE_RATE * 0.25) === 4000 ? 0.55 : bed;
});
const highCrestStates = states(highCrest);
const highCrestHardClips = highCrestStates.reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0);
assert('high-crest material receives useful but bounded lift', steady(highCrest).gainDb > 15, JSON.stringify(steady(highCrest)));
assert('lookahead limiter keeps high-crest output sample-safe', highCrestOut.peak <= 10 ** (-3 / 20) + 1e-6 && highCrestHardClips === 0, JSON.stringify({ highCrestOut, highCrestHardClips }));

const liveProgramme = new ProcessorClass();
configure(liveProgramme);
let liveCursor = render(liveProgramme, 6, 0.2).sampleCount;
const liveQuietStart = states(liveProgramme).length;
liveCursor += render(liveProgramme, 3, 0.0015, liveCursor).sampleCount;
const liveQuietStates = states(liveProgramme).slice(liveQuietStart);
const liveQuietMaxGainDb = Math.max(...liveQuietStates.map((state) => Number(state.currentGainDb || 0)));
const liveReturnStart = states(liveProgramme).length;
render(liveProgramme, 1, 0.2, liveCursor);
const liveReturnStates = states(liveProgramme).slice(liveReturnStart);
assert(
  'live quiet beds cannot drive a programme-scale upward gain wave',
  liveQuietMaxGainDb <= 3.5,
  JSON.stringify({ liveQuietMaxGainDb, lastQuiet: liveQuietStates.at(-1) })
);
assert(
  'gain leaves a quiet bed before the loud programme resumes',
  Number(liveReturnStates.at(0)?.currentGainDb || 0) <= 3.5
    && Number(liveReturnStates.at(-1)?.currentGainDb || 0) < 0,
  JSON.stringify(liveReturnStates.slice(0, 4))
);

const liveDetail = new ProcessorClass();
configure(liveDetail);
const liveDetailLead = render(liveDetail, 7, 0.2);
const liveDetailStart = states(liveDetail).length;
render(liveDetail, 2, 0.02, liveDetailLead.sampleCount);
const liveDetailTail = states(liveDetail).slice(liveDetailStart).slice(-5);
const liveDetailOutputDb = liveDetailTail.reduce(
  (sum, state) => sum + Number(state.outputMomentaryDb || -120),
  0
) / Math.max(1, liveDetailTail.length);
assert(
  'audible quiet detail inside a loud programme is brought into a comfortable range',
  liveDetailOutputDb > -29 && Number(liveDetailTail.at(-1)?.currentGainDb || 0) > 8,
  JSON.stringify({ liveDetailOutputDb, liveDetailTail })
);

const boundary = new ProcessorClass();
configure(boundary, {}, { programmeKey: 'programme-a' });
const boundaryLead = render(boundary, 5, 0.2);
configure(boundary, {}, { programmeKey: 'programme-b', configSequence: 2 });
render(boundary, 7, 0.02, boundaryLead.sampleCount);
assert(
  'explicit programme key change resets cumulative measurement',
  latest(boundary).loudnessResetCount === 1
    && latest(boundary).programmeInputDb < -35
    && steady(boundary).outputDb > -23,
  JSON.stringify(latest(boundary))
);

const limited = new ProcessorClass();
configure(limited);
const limitedOut = render(limited, 0.8, 1);
const hardClips = states(limited).reduce((sum, state) => sum + Number(state.hardClippedSamples || 0), 0);
assert('lookahead limiter respects the -3 dBFS ceiling', limitedOut.peak <= 10 ** (-3 / 20) + 1e-6, String(limitedOut.peak));
assert('lookahead limiter avoids hard clipping', hardClips === 0, String(hardClips));

const runtime = new ProcessorClass();
configure(runtime, { cutStrength: 0, liftStrength: 0 });
render(runtime, 0.5, 0.35);
configure(runtime, { cutStrength: 100, liftStrength: 100 }, { configSequence: 2 });
render(runtime, 2, 0.35, Math.round(0.5 * SAMPLE_RATE));
assert('runtime setting updates change processing', latest(runtime).currentGainDb < -3, JSON.stringify(latest(runtime)));

const muted = new ProcessorClass();
configure(muted, {}, { playerMuted: true });
const mutedOut = render(muted, 0.5, 0.2);
assert('hard player mute is preserved', mutedOut.rms < 0.001, String(mutedOut.rms));

if (process.exitCode) process.exit(process.exitCode);
