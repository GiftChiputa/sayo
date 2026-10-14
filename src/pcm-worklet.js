// Buffer 250 ms of mono PCM at 16 kHz, then transfer it to the trusted process.
// AudioWorklet keeps capture off the UI thread and works without remote scripts.
class PCMWriter extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Int16Array(4000); this.used = 0;
    this.sum = 0; this.count = 0; this.phase = 0; this.done = false;
    this.meterSum = 0; this.meterCount = 0;
    this.port.onmessage = () => { this.flush(); this.done = true; this.port.postMessage({ done: true }); };
  }
  flush() {
    if (this.used) {
      const output = this.samples.slice(0, this.used);
      this.port.postMessage({ pcm: output.buffer }, [output.buffer]); this.used = 0;
    }
  }
  process(inputs, outputs) {
    if (this.done) return false;
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.meterSum += sample * sample; this.meterCount++;
      if (this.meterCount >= sampleRate * 0.04) {
        this.port.postMessage({ level: Math.min(1, Math.sqrt(this.meterSum / this.meterCount) * 5) });
        this.meterSum = 0; this.meterCount = 0;
      }
      this.sum += sample; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples[this.used++] = Math.round(value * (value < 0 ? 32768 : 32767));
        this.sum = 0; this.count = 0;
        if (this.used === this.samples.length) this.flush();
      }
    }
    // Zero output: the microphone must never echo through the speakers.
    return true;
  }
}
registerProcessor('pcm-writer', PCMWriter);
