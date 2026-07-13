class WebVolumeBalancerLimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ceiling = Math.pow(10, -3 / 20);
    this.enabled = true;
    this.releaseSeconds = 0.08;
    this.lookaheadMs = 5;
    this.lookaheadSamples = 0;
    this.delayLength = 0;
    this.delayBuffers = [];
    this.delayIndex = 0;
    this.sampleIndex = 0;
    this.peakQueueValues = null;
    this.peakQueueIndices = null;
    this.peakQueueHead = 0;
    this.peakQueueTail = 0;
    this.gain = 1;
    this.inputPeak = 0;
    this.outputPeak = 0;
    this.minGain = 1;
    this.limitedSamples = 0;
    this.hardClippedSamples = 0;
    this.maxHardClipOvershoot = 0;
    this.framesSinceReport = 0;
    this.reportFrames = Math.max(128, Math.round(sampleRate * 0.1));
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type !== 'configure') {
        return;
      }
      const ceilingDb = Number.isFinite(Number(message.ceilingDb)) ? Number(message.ceilingDb) : -3;
      const releaseSeconds = Number.isFinite(Number(message.releaseSeconds)) ? Number(message.releaseSeconds) : this.releaseSeconds;
      const lookaheadMs = Number.isFinite(Number(message.lookaheadMs)) ? Number(message.lookaheadMs) : this.lookaheadMs;
      const previousCeiling = this.ceiling;
      this.ceiling = Math.max(0.0001, Math.min(1, Math.pow(10, ceilingDb / 20)));
      this.enabled = message.enabled !== false;
      this.releaseSeconds = Math.max(0.005, Math.min(1, releaseSeconds));
      this.lookaheadMs = Math.max(0, Math.min(20, lookaheadMs));
      this.configureLookahead();
      if (!this.enabled) {
        this.gain = 1;
      } else if (this.ceiling < previousCeiling && this.peakQueueTail > this.peakQueueHead) {
        const headIndex = this.peakQueueHead % this.peakQueueValues.length;
        const bufferedPeak = this.peakQueueValues[headIndex] || 0;
        const gainCeiling = Math.max(0.0001, this.ceiling - 0.000001);
        if (bufferedPeak > gainCeiling) {
          this.gain = Math.min(this.gain, gainCeiling / bufferedPeak);
        }
      }
    };
    this.configureLookahead();
  }

  configureLookahead() {
    const nextLookaheadSamples = Math.max(0, Math.round(sampleRate * this.lookaheadMs / 1000));
    if (nextLookaheadSamples === this.lookaheadSamples && this.delayLength > 0) {
      return;
    }
    this.lookaheadSamples = nextLookaheadSamples;
    this.delayLength = this.lookaheadSamples + 1;
    this.delayBuffers = [];
    this.delayIndex = 0;
    this.sampleIndex = 0;
    const queueCapacity = this.lookaheadSamples + 2;
    this.peakQueueValues = new Float32Array(queueCapacity);
    this.peakQueueIndices = new Float64Array(queueCapacity);
    this.peakQueueHead = 0;
    this.peakQueueTail = 0;
  }

  ensureDelayBuffers(channelCount) {
    if (this.delayBuffers.length === channelCount) {
      return;
    }
    this.delayBuffers = Array.from({ length: channelCount }, () => new Float32Array(this.delayLength));
    this.delayIndex = 0;
    this.sampleIndex = 0;
    this.peakQueueHead = 0;
    this.peakQueueTail = 0;
  }

  pushPeak(value) {
    const capacity = this.peakQueueValues.length;
    while (this.peakQueueTail > this.peakQueueHead) {
      const tailIndex = (this.peakQueueTail - 1) % capacity;
      if (this.peakQueueValues[tailIndex] > value) {
        break;
      }
      this.peakQueueTail -= 1;
    }
    const insertIndex = this.peakQueueTail % capacity;
    this.peakQueueValues[insertIndex] = value;
    this.peakQueueIndices[insertIndex] = this.sampleIndex;
    this.peakQueueTail += 1;

    const oldestAllowed = this.sampleIndex - this.lookaheadSamples;
    while (this.peakQueueTail > this.peakQueueHead) {
      const headIndex = this.peakQueueHead % capacity;
      if (this.peakQueueIndices[headIndex] >= oldestAllowed) {
        break;
      }
      this.peakQueueHead += 1;
    }
    const headIndex = this.peakQueueHead % capacity;
    return {
      value: this.peakQueueValues[headIndex] || 0,
      sampleIndex: this.peakQueueIndices[headIndex]
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const channelCount = output.length;
    if (channelCount === 0) {
      return true;
    }
    const frameCount = output[0]?.length || 0;
    if (input.length === 0 || frameCount === 0) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        output[channel].fill(0);
      }
      return true;
    }

    this.ensureDelayBuffers(channelCount);
    const releaseStep = 1 - Math.exp(-1 / (sampleRate * this.releaseSeconds));
    for (let frame = 0; frame < frameCount; frame += 1) {
      let framePeak = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        const source = input[channel] || input[0];
        const sample = source[frame] || 0;
        this.delayBuffers[channel][this.delayIndex] = sample;
        framePeak = Math.max(framePeak, Math.abs(sample));
      }

      this.inputPeak = Math.max(this.inputPeak, framePeak);
      const lookaheadPeak = this.pushPeak(framePeak);
      const gainCeiling = Math.max(0.0001, this.ceiling - 0.000001);
      const requiredGain = this.enabled && lookaheadPeak.value > gainCeiling
        ? Math.max(0, gainCeiling / Math.max(lookaheadPeak.value, 1e-12))
        : 1;
      if (!this.enabled) {
        this.gain = 1;
      } else if (requiredGain < this.gain) {
        const delayedSampleIndex = this.sampleIndex - this.lookaheadSamples;
        const samplesUntilPeak = Math.max(1, lookaheadPeak.sampleIndex - delayedSampleIndex);
        this.gain += (requiredGain - this.gain) / samplesUntilPeak;
        this.limitedSamples += 1;
      } else {
        this.gain += (requiredGain - this.gain) * releaseStep;
        if (this.gain > 1) {
          this.gain = 1;
        }
      }
      const readIndex = (this.delayIndex + 1) % this.delayLength;
      let delayedFramePeak = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        delayedFramePeak = Math.max(delayedFramePeak, Math.abs(this.delayBuffers[channel][readIndex]));
      }
      if (this.enabled && delayedFramePeak * this.gain > gainCeiling) {
        this.gain = Math.min(this.gain, gainCeiling / Math.max(delayedFramePeak, 1e-12));
        this.limitedSamples += 1;
      }
      this.minGain = Math.min(this.minGain, this.gain);

      for (let channel = 0; channel < channelCount; channel += 1) {
        let sample = this.delayBuffers[channel][readIndex] * this.gain;
        if (sample > this.ceiling) {
          this.maxHardClipOvershoot = Math.max(this.maxHardClipOvershoot, sample - this.ceiling);
          sample = this.ceiling;
          this.limitedSamples += 1;
          this.hardClippedSamples += 1;
        } else if (sample < -this.ceiling) {
          this.maxHardClipOvershoot = Math.max(this.maxHardClipOvershoot, (-sample) - this.ceiling);
          sample = -this.ceiling;
          this.limitedSamples += 1;
          this.hardClippedSamples += 1;
        }
        output[channel][frame] = sample;
        this.outputPeak = Math.max(this.outputPeak, Math.abs(sample));
      }
      this.delayIndex = readIndex;
      this.sampleIndex += 1;
    }

    this.framesSinceReport += frameCount;
    if (this.framesSinceReport >= this.reportFrames) {
      const reductionDb = Math.max(0, -20 * Math.log10(Math.max(0.000001, this.minGain)));
      this.port.postMessage({
        type: 'meter',
        reductionDb,
        inputPeak: this.inputPeak,
        outputPeak: this.outputPeak,
        limitedSamples: this.limitedSamples,
        hardClippedSamples: this.hardClippedSamples,
        maxHardClipOvershoot: this.maxHardClipOvershoot,
        lookaheadMs: this.lookaheadMs
      });
      this.inputPeak = 0;
      this.outputPeak = 0;
      this.minGain = this.gain;
      this.limitedSamples = 0;
      this.hardClippedSamples = 0;
      this.maxHardClipOvershoot = 0;
      this.framesSinceReport = 0;
    }
    return true;
  }
}

registerProcessor('wvb-limiter-processor', WebVolumeBalancerLimiterProcessor);
