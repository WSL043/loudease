// Local-only research; no audio is played or sent outside the loopback harness.
window.renderCorpusCase = async function ({ file, variant, level }) {
  const rate = 48000, lead = 12000, tail = 12000, delay = 240;
  const decoder = new OfflineAudioContext(2, 1, rate);
  const response = await fetch(`/corpus/${file}`);
  if (!response.ok) throw new Error('Missing verified corpus file');
  const decoded = await decoder.decodeAudioData(await response.arrayBuffer());
  const count = Math.min(decoded.length, rate * 8);
  const context = new OfflineAudioContext(2, lead + count + tail, rate);
  await context.audioWorklet.addModule('/policy.js');
  await context.audioWorklet.addModule(`/${variant}.js`);
  let originalPeak = 0;
  for (let c = 0; c < decoded.numberOfChannels; c += 1) {
    originalPeak = Math.max(originalPeak, samplePeak(decoded.getChannelData(c).subarray(0, count)));
  }
  if (!(originalPeak > 0)) throw new Error('Silent corpus input');
  const buffer = context.createBuffer(2, context.length, rate);
  for (let c = 0; c < 2; c += 1) {
    const input = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
    const samples = buffer.getChannelData(c);
    for (let i = 0; i < count; i += 1) samples[lead + i] = input[i] * level / originalPeak;
  }
  const worklet = new AudioWorkletNode(context, 'wvb-audit-processor', {
    outputChannelCount: [2], processorOptions: { events: [{ frame: 0, data: auditConfiguration() }] }
  });
  let error = null;
  worklet.onprocessorerror = () => { error = 'processorerror'; };
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(worklet).connect(context.destination);
  source.start();
  const output = await context.startRendering();
  worklet.port.close();
  if (error) throw new Error(error);
  const pcm = [output.getChannelData(0), output.getChannelData(1)];
  const hashes = await Promise.all(pcm.map(async (samples) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', samples)),
      (value) => value.toString(16).padStart(2, '0')).join('')));
  if (variant === 'reference') return { file, variant, level, hashes };
  const peaks = pcm.map((samples) => measurePeaks(samples, 'zero'));
  const windows = [];
  for (let start = lead; start + 960 <= lead + count; start += 960) {
    let inputEnergy = 0, outputEnergy = 0;
    for (let c = 0; c < 2; c += 1) for (let i = start; i < start + 960; i += 1) {
      inputEnergy += buffer.getChannelData(c)[i] ** 2;
      outputEnergy += pcm[c][i + delay] ** 2;
    }
    const inputDb = 10 * Math.log10(Math.max(1e-24, inputEnergy / 1920));
    const outputDb = 10 * Math.log10(Math.max(1e-24, outputEnergy / 1920));
    windows.push({ seconds: (start - lead) / rate, inputDb, outputDb, gainDb: outputDb - inputDb });
  }
  return { file, variant, level, hashes, rate, decodedChannels: decoded.numberOfChannels,
    sourceSeconds: decoded.duration, excerptSeconds: count / rate, originalPeak, peaks, windows,
    tailDrained: pcm.every((samples) => samples.subarray(-512).every((value) => value === 0)) };
};
