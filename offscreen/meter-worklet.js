class WebVolumeBalancerMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameMs = 20;
    this.frameSamples = Math.max(1, Math.round(sampleRate * this.frameMs / 1000));
    this.samplesInFrame = 0;
    this.weightedSquareSum = 0;
    this.weightedSampleCount = 0;
    this.rawPeak = 0;
    this.outputWeightedSquareSum = 0;
    this.outputWeightedSampleCount = 0;
    this.outputRawPeak = 0;
    this.sequence = 0;
    this.totalSamples = 0;
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type !== 'configure') {
        return;
      }
      const frameMs = Number(message.frameMs);
      if (Number.isFinite(frameMs)) {
        this.frameMs = Math.max(5, Math.min(100, frameMs));
        this.frameSamples = Math.max(1, Math.round(sampleRate * this.frameMs / 1000));
      }
    };
  }

  emitFrame() {
    this.port.postMessage({
      type: 'frame',
      sequence: this.sequence,
      energy: this.weightedSampleCount > 0
        ? this.weightedSquareSum / this.weightedSampleCount
        : 0,
      peak: this.rawPeak,
      outputEnergy: this.outputWeightedSampleCount > 0
        ? this.outputWeightedSquareSum / this.outputWeightedSampleCount
        : 0,
      outputPeak: this.outputRawPeak,
      sampleCount: this.samplesInFrame,
      audioTimeSeconds: this.totalSamples / sampleRate
    });
    this.sequence += 1;
    this.samplesInFrame = 0;
    this.weightedSquareSum = 0;
    this.weightedSampleCount = 0;
    this.rawPeak = 0;
    this.outputWeightedSquareSum = 0;
    this.outputWeightedSampleCount = 0;
    this.outputRawPeak = 0;
  }

  process(inputs, outputs) {
    const rawInput = inputs[0] || [];
    const weightedInput = inputs[1] && inputs[1].length ? inputs[1] : rawInput;
    const outputRawInput = inputs[2] || [];
    const outputWeightedInput = inputs[3] && inputs[3].length ? inputs[3] : outputRawInput;
    const output = outputs[0] || [];
    for (const channel of output) {
      channel.fill(0);
    }

    const frameCount = rawInput[0]?.length
      || weightedInput[0]?.length
      || outputRawInput[0]?.length
      || outputWeightedInput[0]?.length
      || output[0]?.length
      || 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (const channel of rawInput) {
        this.rawPeak = Math.max(this.rawPeak, Math.abs(channel[frame] || 0));
      }
      for (const channel of weightedInput) {
        const sample = channel[frame] || 0;
        this.weightedSquareSum += sample * sample;
        this.weightedSampleCount += 1;
      }
      for (const channel of outputRawInput) {
        this.outputRawPeak = Math.max(this.outputRawPeak, Math.abs(channel[frame] || 0));
      }
      for (const channel of outputWeightedInput) {
        const sample = channel[frame] || 0;
        this.outputWeightedSquareSum += sample * sample;
        this.outputWeightedSampleCount += 1;
      }
      this.samplesInFrame += 1;
      this.totalSamples += 1;
      if (this.samplesInFrame >= this.frameSamples) {
        this.emitFrame();
      }
    }
    return true;
  }
}

registerProcessor('wvb-meter-processor', WebVolumeBalancerMeterProcessor);
