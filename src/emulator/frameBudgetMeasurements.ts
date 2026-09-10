/*
 * What a BBC Model B can put on screen in one frame.
 *
 * A game design starts with this number and everything else follows from it, so
 * it was measured on the machine rather than reasoned about. The routines ran
 * on a real Model B under the pinned core and the emulator counted their cycles;
 * `scripts/measureFrameBudget.mjs` reproduces all five.
 *
 * The result that matters most is the pair of Tube figures. Read blind, with
 * nothing keeping the two sides in step, a byte from the second processor
 * costs the host slightly less than one from its own memory, because a read
 * from a fixed address avoids the indexed penalty. No program can run at that
 * figure: the first one written to it painted its rows wherever stale reads
 * sent them. Kept in step, with the host waiting on register 3's flag before
 * every byte and a 65C102 sending as fast as its own flag allows, a byte
 * costs 16.14 cycles, and the ULA's two-byte mode makes no difference to
 * that. That is the figure a game pays, and it is two thirds as much again as
 * a local copy. So the Tube carries what is expensive to compute and cheap to
 * move, and what the host can fill from a table stays on the host.
 */

/** A Model B runs at 2 MHz and its display is 50 frames a second. */
export const HOST_CLOCK_HZ = 2_000_000;
export const FRAMES_PER_SECOND = 50;
export const CYCLES_PER_FRAME = HOST_CLOCK_HZ / FRAMES_PER_SECOND;

export const FRAME_BUDGET_MEASUREMENT_SOURCE =
  'Measured on a BBC Model B with OS 1.20 and BASIC II by running each routine from its own entry and counting the cycles it took to reach its exit.';

export interface ByteMovementMeasurement {
  id: 'fill' | 'copy' | 'tube' | 'tube-handshake';
  label: string;
  /** Cycles for one byte, from 4,096 bytes moved. */
  cyclesPerByte: number;
  what: string;
}

export const BYTE_MOVEMENT: readonly ByteMovementMeasurement[] = Object.freeze([
  {
    id: 'fill',
    label: 'Store a byte to the screen',
    cyclesPerByte: 5.59,
    what: 'An unrolled absolute indexed store and nothing else. This is the floor: nothing that draws anything can beat it, and it is what clearing or flat-filling costs.',
  },
  {
    id: 'copy',
    label: 'Copy a byte from host memory to the screen',
    cyclesPerByte: 9.70,
    what: 'What showing an already-composed frame costs when the bytes are in the host\'s own memory.',
  },
  {
    id: 'tube',
    label: 'Pull a byte across the Tube to the screen, blind',
    cyclesPerByte: 9.31,
    what: 'The same, reading register 3 at &FEE5 with nothing on the other end and nothing keeping the two sides in step. Cheaper than the local copy, because a read from a fixed address needs no index. This is a ceiling, not a rate a program can run at: a byte read before the second processor has written it is a stale one.',
  },
  {
    id: 'tube-handshake',
    label: 'Pull a byte across the Tube to the screen, kept in step',
    cyclesPerByte: 16.14,
    what: 'A 65C102 at 4 MHz sends a byte whenever register 3 has room; the host waits on the data-available flag before every byte. Every byte received is checked against the one sent. This is what a game pays for a byte the second processor composed. The ULA\'s two-byte mode measures the same: it raises the host\'s flag once two bytes are in, which invites reading two for one check, and that is a race the check before every byte is there to avoid.',
  },
]);

/** Two 6845 register writes, which is the whole of a hardware scroll. */
export const SCROLL_CYCLES = 35;

/** All sixteen NuLA colours reloaded, as two writes each to &FE23. */
export const NULA_PALETTE_RELOAD_CYCLES = 208;

/** The modes worth considering, with the screen sizes the machine reported. */
export const MODE_SCREEN_BYTES: Readonly<Record<string, number>> = Object.freeze({
  'MODE 2': 20480,
  'MODE 1': 20480,
  'MODE 5': 10240,
  'MODE 4': 10240,
});

/** How many bytes fit in one frame at a given cost. */
export function bytesPerFrame(cyclesPerByte: number, framesPerUpdate = 1): number {
  return Math.floor((CYCLES_PER_FRAME * framesPerUpdate) / cyclesPerByte);
}

/** How much of a mode's screen can be redrawn per update, as a fraction. */
export function screenFractionPerUpdate(mode: string, cyclesPerByte: number, framesPerUpdate = 1): number {
  const bytes = MODE_SCREEN_BYTES[mode];
  if (bytes === undefined) return 0;
  return bytesPerFrame(cyclesPerByte, framesPerUpdate) / bytes;
}

/** How many full NuLA palette reloads fit in one frame. */
export function paletteReloadsPerFrame(): number {
  return Math.floor(CYCLES_PER_FRAME / NULA_PALETTE_RELOAD_CYCLES);
}

/*
 * A Spectrum screen, for scale.
 *
 * The Spectrum ran well-regarded conversions of arcade games with far more
 * hardware than it had, so its screen is the honest yardstick for whether a
 * plan for this machine is ambitious or fantasy.
 * It is 6,912 bytes: 6,144 of bitmap and 768 of attributes.
 */
export const SPECTRUM_SCREEN_BYTES = 6912;

/*
 * The finding, in one place so it can be quoted rather than rederived.
 */
export const FRAME_BUDGET_FINDINGS: readonly string[] = Object.freeze([
  'A byte from the second processor costs the host 16.14 cycles when the two sides are kept in step, against 9.70 for one already in its own memory. The 9.31 of a blind read is a ceiling no program can run at. So the Tube is a bottleneck for pixels after all: 2,477 bytes a frame, a quarter of a MODE 5 screen, half of it at 25 Hz.',
  'What crosses the Tube is therefore what is expensive to compute and cheap to move: composed sprites, and descriptors for what the host can fill from a table. The host draws the ground from a per-row descriptor at the fill cost, not the Tube cost.',
  'No mode can be fully redrawn in one frame. The best case is a flat fill, and even that covers only 70 per cent of a ten-kilobyte screen.',
  'The loops on both sides of the Tube matter as much as the link. The 16.14 is a five-instruction sender and a receiver unrolled sixteen stores deep; a receiver that counts and branches for every byte measured 24 cycles a byte on the same machine, and a transfer that runs past the end of a frame costs a whole second frame waiting for the next vertical sync.',
  'The hardware scroll is free. Two 6845 register writes cost 35 cycles, which is under a tenth of a per cent of a frame.',
  'Reloading the whole NuLA palette costs 208 cycles, and 192 reloads fit in a frame. That is more reloads than there are scanlines, so a four-colour mode can carry a different four colours on every band of the screen.',
  'That last point is what decides the mode. MODE 5 has the same 160 pixel width as MODE 2 for half the bytes, and per-band palettes turn its four-colour limit into a per-band limit rather than a screen limit.',
]);

/*
 * The table, rendered.
 *
 * Generated rather than written, so the numbers a game is designed against
 * cannot drift from the measurements they were taken from.
 */
export function renderFrameBudget(): string {
  const lines: string[] = [];
  lines.push('# What fits in a frame on a BBC Model B');
  lines.push('');
  lines.push('<!-- Generated from src/emulator/frameBudgetMeasurements.ts. Edit the catalogue, not this file. -->');
  lines.push('');
  lines.push(FRAME_BUDGET_MEASUREMENT_SOURCE);
  lines.push('');
  lines.push(`A Model B runs at ${(HOST_CLOCK_HZ / 1_000_000).toFixed(0)} MHz and its display is ${FRAMES_PER_SECOND} frames a second, so one frame is ${CYCLES_PER_FRAME.toLocaleString()} cycles. Everything below is measured against that.`);
  lines.push('');
  lines.push('## Moving bytes');
  lines.push('');
  lines.push('| What | Cycles a byte | Bytes in one frame |');
  lines.push('| --- | --- | --- |');
  for (const entry of BYTE_MOVEMENT) {
    lines.push(`| ${entry.label} | ${entry.cyclesPerByte.toFixed(2)} | ${bytesPerFrame(entry.cyclesPerByte).toLocaleString()} |`);
  }
  lines.push('');
  for (const entry of BYTE_MOVEMENT) lines.push(`- **${entry.label}**: ${entry.what}`);
  lines.push('');
  lines.push('## How much of a screen that is');
  lines.push('');
  lines.push('Taking the kept-in-step Tube figure, which is the one a game built around a second processor pays. The blind figure is a ceiling.');
  lines.push('');
  lines.push('| Mode | Screen bytes | At 50 Hz | At 25 Hz | Frames for a full redraw |');
  lines.push('| --- | --- | --- | --- | --- |');
  const tube = BYTE_MOVEMENT.find((entry) => entry.id === 'tube-handshake')!;
  for (const [mode, bytes] of Object.entries(MODE_SCREEN_BYTES)) {
    const at50 = screenFractionPerUpdate(mode, tube.cyclesPerByte);
    const at25 = screenFractionPerUpdate(mode, tube.cyclesPerByte, 2);
    lines.push(`| ${mode} | ${bytes.toLocaleString()} | ${(at50 * 100).toFixed(0)}% | ${(at25 * 100).toFixed(0)}% | ${(1 / at50).toFixed(1)} |`);
  }
  lines.push('');
  lines.push(`For scale, a ZX Spectrum screen is ${SPECTRUM_SCREEN_BYTES.toLocaleString()} bytes, which is ${(SPECTRUM_SCREEN_BYTES / bytesPerFrame(tube.cyclesPerByte)).toFixed(1)} frames at the same rate. A machine that ran well-regarded arcade conversions had two thirds of a MODE 5 screen to move, and did not move all of it every frame either.`);
  lines.push('');
  lines.push(`The kept-in-step figure was measured with a 65C102 at 4 MHz sending through a loop of five instructions and the host storing through sixteen unrolled absolute indexed stores, and every byte received was checked against the one sent. A sender that does more per byte, or a receiver that counts and branches for every byte, is slower than this: the first game program to stream rows this way measured 24 cycles a byte. The link is the floor; the loops on both sides are what a program pays on top, and a transfer that runs past the end of a frame waits a whole frame for the next vertical sync.`);
  lines.push('');
  lines.push('## The two things that are free');
  lines.push('');
  lines.push(`- **The hardware scroll**: ${SCROLL_CYCLES} cycles for the two 6845 start-address registers, which is ${((SCROLL_CYCLES / CYCLES_PER_FRAME) * 100).toFixed(3)} per cent of a frame.`);
  lines.push(`- **The NuLA palette**: ${NULA_PALETTE_RELOAD_CYCLES} cycles to reload all sixteen colours, so ${paletteReloadsPerFrame()} full reloads fit in one frame. That is more than there are scanlines.`);
  lines.push('');
  lines.push('## What follows');
  lines.push('');
  for (const finding of FRAME_BUDGET_FINDINGS) lines.push(`- ${finding}`);
  lines.push('');
  return lines.join('\n');
}
