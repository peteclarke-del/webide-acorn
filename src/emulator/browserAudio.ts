import { AtomSoundChip, SoundChip } from 'jsbeeb/src/soundchip.js';
import rendererUrl from 'jsbeeb/src/web/audio-renderer.js?url';

export interface BrowserAudioStatus {
  available: boolean;
  enabled: boolean;
  contextState: string;
  error?: string;
  buffers: number;
  peak: number;
  latencyMs: number;
  underruns: number;
  lastBufferGapMs: number;
  backgroundSuspended: boolean;
  volume: number;
}

export class BrowserAudio {
  readonly soundChip: SoundChip;
  readonly context: AudioContext | null;
  readonly ready: Promise<void>;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private enabled = false;
  private error?: string;
  private buffers = 0;
  private peak = 0;
  private underruns = 0;
  private lastBufferAt = 0;
  private lastBufferGapMs = 0;
  private backgroundSuspended = false;
  private volume = 100;
  private testCapture = false;
  private testWriteDigest = 0x811c9dc5;
  private testWrites = 0;
  /* The Atom drives a one-bit speaker from a PPIA port rather than a sound
   * chip, so the faithful observation there is a transition count, not a
   * command digest. The emulated PPIA raises this only when the line actually
   * changes level, so every call is one transition; the level between them says
   * nothing about what was heard. */
  private readonly hasSpeaker: boolean;
  private testSpeakerTransitions = 0;
  private captureBuffers: Float32Array[] | null = null;
  private captureSamples = 0;
  private captureLimit = 0;

  constructor(isAtom: boolean, cpuSpeed: number) {
    this.context = typeof AudioContext === 'undefined' ? null : new AudioContext();
    this.soundChip = isAtom
      ? new AtomSoundChip((buffer) => this.onBuffer(buffer), { cpuSpeed })
      : new SoundChip((buffer) => this.onBuffer(buffer));
    const writableSoundChip = this.soundChip as SoundChip & { poke(value: number): void };
    const originalPoke = writableSoundChip.poke.bind(writableSoundChip);
    writableSoundChip.poke = (value: number) => {
      if (this.testCapture) {
        this.testWriteDigest ^= value & 0xff;
        this.testWriteDigest = Math.imul(this.testWriteDigest, 0x01000193) >>> 0;
        this.testWrites += 1;
      }
      originalPoke(value);
    };
    const speaker = (this.soundChip as SoundChip & { speakerGenerator?: { pushBit(bit: number, cycles: number, seconds: number): void } }).speakerGenerator;
    this.hasSpeaker = !!speaker;
    if (speaker) {
      const originalPushBit = speaker.pushBit.bind(speaker);
      speaker.pushBit = (bit: number, cycles: number, seconds: number) => {
        if (this.testCapture) this.testSpeakerTransitions += 1;
        originalPushBit(bit, cycles, seconds);
      };
    }
    this.soundChip.mute();
    this.ready = this.setup();
  }

  /** Whether this machine has a one-bit speaker to count transitions on. */
  get speakerAvailable() { return this.hasSpeaker; }

  private async setup() {
    if (!this.context?.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      this.error = 'This browser context does not provide AudioWorklet';
      return;
    }
    try {
      await this.context.audioWorklet.addModule(rendererUrl);
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.context.destination);
      this.node = new AudioWorkletNode(this.context, 'sound-chip-processor');
      this.node.connect(this.gain);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private onBuffer(buffer: Float32Array) {
    const now = performance.now();
    if (this.lastBufferAt && this.enabled && !this.backgroundSuspended && this.context?.state === 'running') {
      this.lastBufferGapMs = now - this.lastBufferAt;
      const expectedMs = buffer.length / (this.context.sampleRate || 44_100) * 1000;
      if (this.lastBufferGapMs > Math.max(30, expectedMs * 1.75)) this.underruns += 1;
    }
    this.lastBufferAt = now;
    this.buffers += 1;
    for (let index = 0; index < buffer.length; index += 1) this.peak = Math.max(this.peak, Math.abs(buffer[index]!));
    this.node?.port.postMessage({ time: Date.now(), buffer });
    if (this.captureBuffers && this.captureSamples < this.captureLimit) {
      const retained = buffer.slice(0, Math.min(buffer.length, this.captureLimit - this.captureSamples));
      this.captureBuffers.push(retained); this.captureSamples += retained.length;
    }
  }

  async setEnabled(enabled: boolean) {
    await this.ready;
    if (!this.available) return;
    this.enabled = enabled;
    this.backgroundSuspended = false;
    this.lastBufferAt = 0;
    if (enabled) {
      this.soundChip.unmute();
      if (this.gain) this.gain.gain.value = this.volume / 100;
      await this.context?.resume();
    } else {
      this.soundChip.mute();
      if (this.gain) this.gain.gain.value = 0;
      await this.context?.suspend();
    }
  }

  setVolume(volume: number) {
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error('Machine volume must be a whole percentage from 0 to 100');
    this.volume = volume;
    if (this.gain) this.gain.gain.value = this.enabled ? volume / 100 : 0;
  }

  beginCapture(seconds: number) {
    if (!this.available || !this.enabled || !this.context) throw new Error('Enable live machine audio before starting WAV capture');
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw new Error('Audio capture duration must be 1 to 30 seconds');
    this.captureBuffers = []; this.captureSamples = 0; this.captureLimit = this.context.sampleRate * seconds;
    return { sampleRate: this.context.sampleRate, limitSamples: this.captureLimit };
  }

  endCapture() {
    if (!this.captureBuffers || !this.context) throw new Error('No machine audio capture is active');
    const output = new Float32Array(this.captureSamples); let offset = 0;
    this.captureBuffers.forEach((buffer) => { output.set(buffer, offset); offset += buffer.length; });
    this.captureBuffers = null; this.captureSamples = 0; this.captureLimit = 0;
    return { samples: output, sampleRate: this.context.sampleRate };
  }

  get captureActive() { return this.captureBuffers !== null; }

  get available() { return !!this.context && !!this.node && !this.error; }

  beginTestCapture() {
    this.testWriteDigest = 0x811c9dc5;
    this.testWrites = 0;
    this.testSpeakerTransitions = 0;
    this.testCapture = true;
    this.soundChip.unmute();
  }

  endTestCapture() {
    this.testCapture = false;
    if (!this.enabled) this.soundChip.mute();
    return {
      digest: this.testWriteDigest.toString(16).toUpperCase().padStart(8, '0'),
      writes: this.testWrites,
      speakerTransitions: this.testSpeakerTransitions,
      speakerAvailable: this.hasSpeaker,
    };
  }

  async setBackgroundSuspended(suspended: boolean) {
    await this.ready;
    if (!this.available || !this.enabled || this.backgroundSuspended === suspended) return;
    this.backgroundSuspended = suspended;
    this.lastBufferAt = 0;
    if (suspended) await this.context?.suspend();
    else await this.context?.resume();
  }

  status(resetPeak = true): BrowserAudioStatus {
    const contextWithOutput = this.context as (AudioContext & { outputLatency?: number }) | null;
    const latencyMs = ((this.context?.baseLatency ?? 0) + (contextWithOutput?.outputLatency ?? 0)) * 1000;
    const status = { available: this.available, enabled: this.enabled, contextState: this.context?.state ?? 'unavailable', error: this.error, buffers: this.buffers, peak: this.peak, latencyMs, underruns: this.underruns, lastBufferGapMs: this.lastBufferGapMs, backgroundSuspended: this.backgroundSuspended, volume: this.volume };
    if (resetPeak) this.peak = 0;
    return status;
  }

  async close() {
    this.enabled = false;
    this.backgroundSuspended = false;
    this.soundChip.mute();
    this.captureBuffers = null; this.captureSamples = 0; this.captureLimit = 0;
    this.node?.disconnect();
    this.gain?.disconnect();
    await this.context?.close();
  }
}
