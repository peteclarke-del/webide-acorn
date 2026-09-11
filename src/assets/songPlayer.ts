/*
 * The browser's speaker for a song: one oscillator and one gain a channel,
 * set row by row from what songPlayback says a row sounds like. The
 * context is handed in, so the workspace can run without one (a browser with
 * no audio, or a test) and say so, and so a test can hand in a fake and see
 * what was asked of it.
 */
import type { PreviewRow, PreviewVoice } from './songPlayback';

export interface PlayerAudioParam { value: number; setValueAtTime(value: number, time: number): unknown; linearRampToValueAtTime(value: number, time: number): unknown; cancelScheduledValues(time: number): unknown }
export interface PlayerNode { connect(target: unknown): unknown; disconnect(): unknown }
export interface PlayerOscillator extends PlayerNode { type: string; frequency: PlayerAudioParam; start(): unknown; stop(): unknown }
export interface PlayerGain extends PlayerNode { gain: PlayerAudioParam }
export interface PlayerBufferSource extends PlayerNode { buffer: unknown; loop: boolean; start(): unknown; stop(): unknown }
export interface PlayerContext {
  currentTime: number;
  sampleRate: number;
  destination: unknown;
  state?: string;
  resume?(): Promise<unknown>;
  createOscillator(): PlayerOscillator;
  createGain(): PlayerGain;
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(channel: number): Float32Array };
  createBufferSource(): PlayerBufferSource;
  close?(): Promise<unknown>;
}

const MASTER_LEVEL = 0.18;

export class SongPlayer {
  private readonly channels: Array<{ oscillator: PlayerOscillator; noise: PlayerBufferSource; gain: PlayerGain; usingNoise: boolean }> = [];
  private readonly master: PlayerGain;

  constructor(private readonly context: PlayerContext, channelCount: number) {
    this.master = context.createGain();
    this.master.gain.value = MASTER_LEVEL;
    this.master.connect(context.destination);
    const noiseBuffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate)), context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    /* A fixed pseudo-random sequence, so two runs sound the same. */
    let seed = 0x2545f491;
    for (let index = 0; index < samples.length; index += 1) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; samples[index] = (seed / 0xffffffff) * 2 - 1; }
    for (let channel = 0; channel < channelCount; channel += 1) {
      const gain = context.createGain(); gain.gain.value = 0; gain.connect(this.master);
      const oscillator = context.createOscillator(); oscillator.type = 'square'; oscillator.frequency.value = 440; oscillator.connect(gain); oscillator.start();
      const noise = context.createBufferSource(); noise.buffer = noiseBuffer; noise.loop = true; noise.start();
      this.channels.push({ oscillator, noise, gain, usingNoise: false });
    }
  }

  /** Sound one row from now: each channel's wave, pitch and level, the SID's envelope as ramps. */
  playRow(row: PreviewRow) {
    const now = this.context.currentTime;
    for (const channel of this.channels) channel.gain.gain.cancelScheduledValues(now);
    row.voices.forEach((voice, index) => this.setVoice(index, voice, now, row.duration));
  }

  /**
   * Sound a run of rows on the audio clock, from `startTime`, each at its
   * offset from the first: scheduled ahead, the tempo holds whatever the
   * page's timers do, which in a window that is not in front is little.
   * A channel that changes between tone and noise is switched at the first
   * such row, since the browser cannot schedule a rewiring.
   */
  scheduleRows(rows: readonly PreviewRow[], startTime: number) {
    if (!rows.length) return;
    const first = rows[0]!.start;
    for (const channel of this.channels) channel.gain.gain.cancelScheduledValues(startTime);
    for (const row of rows) {
      const at = startTime + (row.start - first);
      row.voices.forEach((voice, index) => this.setVoice(index, voice, at, row.duration));
    }
  }

  private setVoice(index: number, voice: PreviewVoice, now: number, duration: number) {
    const channel = this.channels[index];
    if (!channel) return;
    const wantNoise = voice.wave === 'noise';
    if (wantNoise !== channel.usingNoise) {
      if (channel.usingNoise) { channel.noise.disconnect(); channel.oscillator.connect(channel.gain); }
      else { channel.oscillator.disconnect(); channel.noise.connect(channel.gain); }
      channel.usingNoise = wantNoise;
    }
    if (voice.wave === 'silence' || voice.level <= 0) {
      /* A chip that switches goes quiet at once; the SID lets the note release. */
      if (voice.release > 0) channel.gain.gain.linearRampToValueAtTime(0, now + Math.min(voice.release, duration));
      else channel.gain.gain.setValueAtTime(0, now);
      return;
    }
    if (!wantNoise) {
      channel.oscillator.type = voice.wave;
      channel.oscillator.frequency.setValueAtTime(Math.max(1, voice.frequency), now);
    }
    if (voice.attack > 0 || voice.decay > 0) {
      channel.gain.gain.setValueAtTime(0, now);
      channel.gain.gain.linearRampToValueAtTime(1, now + voice.attack);
      channel.gain.gain.linearRampToValueAtTime(voice.level, now + voice.attack + voice.decay);
    } else channel.gain.gain.setValueAtTime(voice.level, now);
  }

  silence() {
    const now = this.context.currentTime;
    for (const channel of this.channels) { channel.gain.gain.cancelScheduledValues(now); channel.gain.gain.setValueAtTime(0, now); }
  }

  dispose() {
    this.silence();
    for (const channel of this.channels) { try { channel.oscillator.stop(); channel.noise.stop(); } catch { /* already stopped */ } }
    this.master.disconnect();
    void this.context.close?.();
  }
}

/** The browser's audio context, when the browser has one. */
export function browserAudioContext(): PlayerContext | null {
  const Constructor = (globalThis as { AudioContext?: new () => PlayerContext; webkitAudioContext?: new () => PlayerContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: new () => PlayerContext }).webkitAudioContext;
  if (!Constructor) return null;
  try { return new Constructor(); } catch { return null; }
}
