// Test-only, served by a loopback-only harness; not part of either extension build.
function auditConfiguration(cap = 1, extra = {}) {
  return { type: 'configure', settings: { enabled: true, respectPlayerVolume: true,
    cutStrength: 100, liftStrength: 100, targetLoudnessDb: -19 },
  playerVolumeCap: cap, playerVolumeReliable: true, playerMuted: cap === 0,
  programmeKey: 'browser-fixture', ...extra };
}

function auditSignal(index, rate, kind) {
  if (kind === 'sine') return 0.08 * Math.sin(2 * Math.PI * 997 * index / rate);
  if (kind === 'alternating') return index % 2 ? -1.2 : 1.2;
  if (kind === 'quarter-rate') return 0.95 * Math.sin(Math.PI * index / 2 + Math.PI / 4);
  return 0.12 * (0.7 * Math.sin(2 * Math.PI * 997 * index / rate)
    + 0.3 * Math.sin(2 * Math.PI * 217 * index / rate));
}

window.renderCandidateCase = async function ({ variant, rate, kind, seconds = 4, scenario = 'steady' }) {
  const length = Math.ceil(rate * seconds / 128) * 128;
  const second = Math.ceil(rate / 128) * 128;
  const context = new OfflineAudioContext(2, length, rate);
  await context.audioWorklet.addModule('/policy.js');
  await context.audioWorklet.addModule(`/${variant}.js`);
  const events = [{ frame: 0, data: auditConfiguration() }];
  if (scenario === 'volume' || scenario === 'volume-lag') {
    const lag = scenario === 'volume-lag' ? Math.ceil(rate * 0.1 / 128) * 128 : 0;
    events.push({ frame: 3 * second + lag, data: auditConfiguration(0.25) },
      { frame: 5 * second + lag, data: auditConfiguration(1) },
      { frame: 7 * second, data: auditConfiguration(0) },
      { frame: 8 * second, data: auditConfiguration(1) });
  }
  if (scenario === 'boundary') events.push({ frame: 3 * second,
    data: auditConfiguration(1, { programmeKey: 'next-silent-programme' }) });
  if (scenario === 'stress') events[0].data.settings.cutStrength = 0;
  if (scenario === 'benchmark-stress') {
    events[0].data.settings.cutStrength = 0;
    events[0].data.settings.liftStrength = 0;
  }
  const worklet = new AudioWorkletNode(context, 'wvb-audit-processor', {
    outputChannelCount: [2], processorOptions: { events }
  });
  let error = null;
  let lastState = null;
  worklet.onprocessorerror = () => { error = 'processorerror'; };
  worklet.port.onmessage = ({ data }) => { if (data.type === 'state') lastState = data; };
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      let value = auditSignal(i, rate, kind);
      if (scenario === 'stress' && i < 3 * second) value = 0.02 * Math.sin(2 * Math.PI * 997 * i / rate);
      if (scenario === 'volume' || scenario === 'volume-lag') {
        if (i >= 3 * second && i < 5 * second) value *= 0.25;
        if (i >= 7 * second && i < 8 * second) value = 0;
      }
      if (scenario === 'boundary' && i >= 3 * second) value = 0;
      samples[i] = value * (channel ? -0.5 : 1);
    }
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const outputGain = context.createGain();
  if (scenario === 'system-volume') {
    outputGain.gain.setValueAtTime(0.25, 3 * second / rate);
    outputGain.gain.setValueAtTime(1, 5 * second / rate);
    outputGain.gain.setValueAtTime(0, 7 * second / rate);
    outputGain.gain.setValueAtTime(1, 8 * second / rate);
  }
  source.connect(worklet).connect(outputGain).connect(context.destination);
  source.start();
  const start = performance.now();
  const rendered = await context.startRendering();
  const renderMs = performance.now() - start;
  if (error) throw new Error(error);
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  let stereoError = 0;
  let peak = 0;
  const rmsSegments = [];
  for (let offset = 0; offset < left.length; offset += second) {
    const end = Math.min(left.length, offset + second);
    let energy = 0;
    for (let i = offset; i < end; i += 1) {
      if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('Non-finite output');
      stereoError = Math.max(stereoError, Math.abs(left[i] * 0.5 + right[i]));
      energy += left[i] * left[i];
      peak = Math.max(peak, Math.abs(left[i]));
    }
    rmsSegments.push(Math.sqrt(energy / (end - offset)));
  }
  let peaks = null;
  if (scenario === 'stress') peaks = measurePeaks(left.subarray(3 * second, 3 * second + 8192));
  const oldProgrammeLeak = scenario === 'boundary' ? samplePeak(left.subarray(3 * second, 3 * second + 1024)) : null;
  const windowRms = [];
  for (let start = 0; start + 960 <= left.length; start += 960) {
    let energy = 0;
    for (let i = start; i < start + 960; i += 1) energy += left[i] * left[i];
    windowRms.push(Math.sqrt(energy / 960));
  }
  let toneResidualDb = null;
  if (kind === 'sine') {
    // Least-squares fundamental removal. Includes noise, harmonics and gain
    // modulation; it is a signal diagnostic, not a perceptual quality score.
    const start = 3 * second;
    let ss = 0, cc = 0, sc = 0, xs = 0, xc = 0, energy = 0;
    for (let i = start; i < length; i += 1) {
      const s = Math.sin(2 * Math.PI * 997 * i / rate), c = Math.cos(2 * Math.PI * 997 * i / rate);
      ss += s * s; cc += c * c; sc += s * c; xs += left[i] * s; xc += left[i] * c; energy += left[i] ** 2;
    }
    const det = ss * cc - sc * sc;
    const a = (xs * cc - xc * sc) / det, b = (xc * ss - xs * sc) / det;
    let residual = 0;
    for (let i = start; i < length; i += 1) residual += (left[i]
      - a * Math.sin(2 * Math.PI * 997 * i / rate) - b * Math.cos(2 * Math.PI * 997 * i / rate)) ** 2;
    toneResidualDb = 10 * Math.log10(Math.max(1e-24, residual / energy));
  }
  worklet.port.close();
  return { variant, rate, kind, scenario, frames: length, renderMs, peak, stereoError,
    rmsSegments, windowRms, peaks, oldProgrammeLeak, toneResidualDb, lastState };
};

window.runCandidateRealtime = async function (variant, count = 4, durationMs = 15000) {
  const sessions = [];
  try {
    for (let i = 0; i < count; i += 1) {
      const context = new AudioContext({ sampleRate: 48000, sinkId: { type: 'none' } });
      const session = { context, messages: 0, first: null, last: null, errors: 0 };
      sessions.push(session);
      if (context.sinkId?.type !== 'none') throw new Error('Refusing a hardware output sink');
      await context.audioWorklet.addModule('/policy.js');
      await context.audioWorklet.addModule(`/${variant}.js`);
      const node = new AudioWorkletNode(context, 'wvb-audit-processor', {
        outputChannelCount: [2], processorOptions: { events: [{ frame: 0, data: auditConfiguration() }] }
      });
      session.node = node;
      node.onprocessorerror = () => { session.errors += 1; };
      node.port.onmessage = ({ data }) => {
        if (data.type === 'state') {
          session.messages += 1;
          session.first ||= data;
          session.last = data;
        }
      };
      const buffer = context.createBuffer(2, 48000, 48000);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let n = 0; n < data.length; n += 1) data[n] = auditSignal(n, 48000, i % 2 ? 'alternating' : 'ordinary') * (channel ? -0.5 : 1);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(node).connect(context.destination);
      source.start();
      await context.resume();
    }
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return sessions.map(({ context, messages, first, last, errors }) => ({
      currentTime: context.currentTime, sampleRate: context.sampleRate, state: context.state,
      sinkType: context.sinkId.type, messages, first, last, errors
    }));
  } finally {
    for (const session of sessions) {
      session.node?.port.close();
      await session.context.close();
    }
  }
};
