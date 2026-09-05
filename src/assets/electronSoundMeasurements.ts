/*
 * What an Acorn Electron actually does when it is asked to make a sound.
 *
 * The Electron is not a BBC with fewer channels. It has one tone generator in
 * its ULA and nothing else, and the two registers that drive it — the divider
 * that fixes the pitch, and the two bits that turn the tone on — are write-only
 * to the processor. So a program cannot read back what it asked for, and
 * neither could a debugger by reading memory. They are published by the bridge
 * in `docker/elkulator/webide_bridge.c` for exactly this reason.
 *
 * Everything below was measured by booting an Electron on the Elkulator core in
 * a headless browser, typing SOUND statements at its keyboard, and watching the
 * ULA while each note played. It is here because composing for the wrong chip
 * produces music that does not play, and three of these findings would have
 * been wrong if they had been assumed:
 *
 *  - Notes on different channels do not share the machine. A note sent to a
 *    second channel replaces the one playing rather than queueing behind it,
 *    and the first is lost without a word. Notes on the *same* channel do
 *    queue. That is why the editor gives this machine one channel.
 *  - There is no volume. Amplitude 0 is silence, and -1, -7 and -15 all
 *    produce exactly the same divider and the same tone.
 *  - Channel 0 does make a noise, by modulating the one tone generator through
 *    a scatter of dividers rather than by having a noise source. It cannot be
 *    combined with a tone, for the reason above.
 */

/** How the measurement was taken, for anyone reading a failure. */
export const ELECTRON_SOUND_MEASUREMENT_SOURCE =
  'Measured on an Acorn Electron booted under the Elkulator WebAssembly core in headless Chromium: SOUND statements ' +
  'were typed at the machine and the ULA tone divider and enable bit were read through the bridge while each note played.';

export interface ElectronPitchMeasurement {
  /** The pitch as OSWORD 7 and the SOUND statement take it. */
  pitch: number;
  /** The divider the ULA was given while that note sounded. */
  divider: number;
}

/**
 * Pitch to ULA divider, as the Electron's own operating system set it.
 *
 * The machine's scale is the BBC's: forty-eight pitch units to an octave. The
 * measurements bear that out — pitch 53 gives divider 116 and pitch 101 gives
 * 57, and 1 MHz / (16 × (n + 1)) makes those 534 Hz and 1,077 Hz, which is an
 * octave to within the divider's own resolution.
 */
export const ELECTRON_PITCH_DIVIDERS: readonly ElectronPitchMeasurement[] = Object.freeze([
  { pitch: 0, divider: 252 },
  { pitch: 4, divider: 236 },
  { pitch: 32, divider: 157 },
  { pitch: 53, divider: 116 },
  { pitch: 89, divider: 68 },
  { pitch: 101, divider: 57 },
  { pitch: 149, divider: 28 },
  { pitch: 197, divider: 13 },
  { pitch: 231, divider: 7 },
  { pitch: 255, divider: 5 },
]);

/** The frequency a divider produces, from the ULA's own 1 MHz clock. */
export function electronToneFrequency(divider: number): number {
  if (!Number.isInteger(divider) || divider < 0 || divider > 0xff) {
    throw new Error(`An Electron ULA sound divider is 0 to 255 and ${divider} is not one`);
  }
  return 1_000_000 / (16 * (divider + 1));
}

export interface ElectronSoundObservation {
  /** What was typed at the machine. */
  statement: string;
  /** Whether the tone was ever enabled while it ran. */
  played: boolean;
  /** Every distinct divider seen while it sounded. */
  dividers: readonly number[];
  /** What the observation establishes. */
  finding: string;
}

export const ELECTRON_SOUND_OBSERVATIONS: readonly ElectronSoundObservation[] = Object.freeze([
  {
    statement: 'SOUND 1,0,101,10', played: false, dividers: [],
    finding: 'Amplitude zero is silence: the tone is never enabled.',
  },
  {
    statement: 'SOUND 1,-1,101,10', played: true, dividers: [57],
    finding: 'The quietest amplitude sounds, and sounds at the same divider as the loudest.',
  },
  {
    statement: 'SOUND 1,-7,101,10', played: true, dividers: [57],
    finding: 'So does the middle one. There is no volume control on this machine.',
  },
  {
    statement: 'SOUND 1,-15,101,10', played: true, dividers: [57],
    finding: 'And the loudest is no different, which is what having no volume means.',
  },
  {
    statement: 'SOUND 0,-15,101,10', played: true,
    dividers: [128, 249, 235, 168, 152, 133, 187, 243, 218],
    finding: 'Channel 0 makes noise by modulating the one tone generator, not by having a noise source.',
  },
  {
    statement: 'SOUND 2,-15,101,10', played: true, dividers: [57],
    finding: 'Channels 1, 2 and 3 all drive the same generator identically; there is no second voice.',
  },
  {
    statement: 'SOUND 1,-15,53,10:SOUND 2,-15,197,10', played: true, dividers: [13],
    finding: 'Two notes on different channels do not both play: the second replaces the first, and the first is lost.',
  },
  {
    statement: 'SOUND 0,-15,5,10:SOUND 1,-15,101,10', played: true, dividers: [57],
    finding: 'Noise and tone cannot be mixed either, for the same reason.',
  },
  {
    statement: 'SOUND 1,-15,53,10:SOUND 1,-15,197,10', played: true, dividers: [116, 13],
    finding: 'Two notes on the same channel do queue, and both play, in order.',
  },
]);
