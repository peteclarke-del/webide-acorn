/*
 * What each BBC Model B screen mode is, asked of a Model B.
 *
 * A table of BBC screen modes is the easiest thing in the world to write from
 * memory and get slightly wrong, and a game is designed against it. So every
 * number below was answered by a machine running a real OS 1.20 and BASIC II,
 * and `scripts/measureBbcScreenModes.mjs` reproduces all of it:
 *
 *   - `screenBytes` is &8000 minus HIMEM after the mode change, which is what
 *     the screen costs.
 *   - `pixelsAcross` and `pixelsDown` come from plotting one point at the
 *     origin and walking away from it until POINT stops seeing it. Graphics
 *     coordinates are always 1280 by 1024 whatever the mode, so the step is the
 *     resolution.
 *   - `logicalColours` comes from GCOL masking its argument to the mode's
 *     range: the first colour that behaves like colour zero is the count.
 *   - A mode with no graphics says so because a point plotted at its origin was
 *     not there afterwards, not because somebody knew.
 *
 * PAGE was &1900 for all of them, which is a machine with a DFS in it. A
 * cassette machine has &0E00 and 2,816 more bytes for the program.
 */

/** The BBC's graphics coordinate space, which does not change with the mode. */
export const BBC_GRAPHICS_WIDTH = 1280;
export const BBC_GRAPHICS_HEIGHT = 1024;

/** Screen memory ends here on a Model B, whatever the mode. */
export const BBC_SCREEN_TOP = 0x8000;

/** What was measured, and on what. */
export const BBC_SCREEN_MODE_SOURCE =
  'Measured on a BBC Model B with OS 1.20, BASIC II and a DFS, by asking BASIC for PAGE and HIMEM in each mode and probing the screen with PLOT and POINT.';

export type BbcModeKind = 'graphics' | 'text' | 'teletext';

export interface BbcScreenMode {
  mode: number;
  kind: BbcModeKind;
  /** HIMEM after the mode change, which is the bottom of screen memory. */
  himem: number;
  /** &8000 minus HIMEM. */
  screenBytes: number;
  /** Null for a mode with no pixels to measure. */
  pixelsAcross: number | null;
  pixelsDown: number | null;
  /** Null where PLOT and POINT do nothing, so no count could be taken. */
  logicalColours: number | null;
}

export const BBC_SCREEN_MODES: readonly BbcScreenMode[] = Object.freeze([
  { mode: 0, kind: 'graphics', himem: 0x3000, screenBytes: 20480, pixelsAcross: 640, pixelsDown: 256, logicalColours: 2 },
  { mode: 1, kind: 'graphics', himem: 0x3000, screenBytes: 20480, pixelsAcross: 320, pixelsDown: 256, logicalColours: 4 },
  { mode: 2, kind: 'graphics', himem: 0x3000, screenBytes: 20480, pixelsAcross: 160, pixelsDown: 256, logicalColours: 16 },
  { mode: 3, kind: 'text', himem: 0x4000, screenBytes: 16384, pixelsAcross: null, pixelsDown: null, logicalColours: null },
  { mode: 4, kind: 'graphics', himem: 0x5800, screenBytes: 10240, pixelsAcross: 320, pixelsDown: 256, logicalColours: 2 },
  { mode: 5, kind: 'graphics', himem: 0x5800, screenBytes: 10240, pixelsAcross: 160, pixelsDown: 256, logicalColours: 4 },
  { mode: 6, kind: 'text', himem: 0x6000, screenBytes: 8192, pixelsAcross: null, pixelsDown: null, logicalColours: null },
  { mode: 7, kind: 'teletext', himem: 0x7c00, screenBytes: 1024, pixelsAcross: null, pixelsDown: null, logicalColours: null },
]);

/** Bits of screen memory per pixel, which follows from the two measurements. */
export function bitsPerPixel(mode: BbcScreenMode): number | null {
  if (mode.pixelsAcross === null || mode.pixelsDown === null) return null;
  return (mode.screenBytes * 8) / (mode.pixelsAcross * mode.pixelsDown);
}

/**
 * How many bytes one pixel row of a mode occupies.
 *
 * A BBC screen is stored as character cells of eight consecutive bytes, so a
 * row of pixels is not contiguous. This is the number that matters when
 * working out how far a scroll moves, not a stride to add to a pointer.
 */
export function bytesPerPixelRow(mode: BbcScreenMode): number | null {
  const bits = bitsPerPixel(mode);
  if (bits === null || mode.pixelsAcross === null) return null;
  return (mode.pixelsAcross * bits) / 8;
}

/** What is left below the screen when the program starts at this address. */
export function bytesForProgram(mode: BbcScreenMode, page = 0x1900): number {
  return mode.himem - page;
}

/*
 * What a VideoNuLA changes, and what it does not.
 *
 * The NuLA replaces the video ULA. It does not change how much memory a mode
 * costs, how many pixels it has, or how its bytes are laid out: the 6845 and
 * the screen RAM belong to the machine, not to the ULA. So every measurement
 * above still stands with one fitted.
 *
 * What it changes is what a logical colour may be. The machine gives each
 * logical colour one of sixteen physical colours, eight steady and eight
 * flashing pairs. The NuLA gives it a twelve-bit value, four bits each of red,
 * green and blue, written as a pair of bytes to &FE23. The count of logical
 * colours in a mode is unchanged; the choice for each one is not.
 *
 * That is the whole of what is claimed here, and it is the part this build has
 * exercised. The NuLA's other features reached through &FE22, the attribute
 * modes and the horizontal scroll and left blanking, are documented in its own
 * user guide and implemented by the pinned core, and they are described in
 * `src/language/acornTargetReference.ts` against that citation. No resolution
 * or colour count for them is stated here, because none has been measured.
 */

/** Colours a NuLA logical colour may be set to: four bits each of red, green and blue. */
export const NULA_PALETTE_DEPTH = 4096;

/** Colours the machine's own video ULA may set a logical colour to. */
export const BBC_PALETTE_DEPTH = 16;

export interface NulaPaletteGain {
  mode: number;
  /** Unchanged by the NuLA: the mode still has this many logical colours. */
  logicalColours: number;
  /** What each of them may be set to, without a NuLA and with one. */
  withoutNula: number;
  withNula: number;
}

/** The palette gain for a mode, which is arithmetic on the measured colour count. */
export function nulaPaletteGain(mode: BbcScreenMode): NulaPaletteGain | null {
  if (mode.logicalColours === null) return null;
  return {
    mode: mode.mode,
    logicalColours: mode.logicalColours,
    withoutNula: BBC_PALETTE_DEPTH,
    withNula: NULA_PALETTE_DEPTH,
  };
}

/*
 * The matrix, rendered.
 *
 * Generated rather than written, the way the compatibility matrix is: a table
 * a game is designed against must not be able to drift from the measurements
 * it was made of. A contract test compares the checked-in document against
 * what this produces.
 */
const hex = (value: number) => `&${value.toString(16).toUpperCase().padStart(4, '0')}`;

function row(mode: BbcScreenMode): string {
  const pixels = mode.pixelsAcross === null ? 'no graphics' : `${mode.pixelsAcross} x ${mode.pixelsDown}`;
  const colours = mode.logicalColours === null ? 'n/a' : String(mode.logicalColours);
  const bits = bitsPerPixel(mode);
  const perRow = bytesPerPixelRow(mode);
  const kind = mode.kind === 'graphics' ? 'graphics' : mode.kind === 'text' ? 'text only' : 'teletext';
  return `| ${mode.mode} | ${kind} | ${pixels} | ${colours} | ${bits === null ? 'n/a' : bits} | ${perRow === null ? 'n/a' : perRow} | ${mode.screenBytes.toLocaleString()} | ${hex(mode.himem)} | ${bytesForProgram(mode).toLocaleString()} |`;
}

export function renderScreenModeMatrix(): string {
  const lines: string[] = [];
  lines.push('# BBC Model B screen modes');
  lines.push('');
  lines.push('<!-- Generated from src/data/bbcScreenModes.ts. Edit the catalogue, not this file. -->');
  lines.push('');
  lines.push(BBC_SCREEN_MODE_SOURCE);
  lines.push('');
  lines.push('Every figure below was answered by the machine. Screen memory is &8000 minus HIMEM after the mode change. The resolution comes from plotting one point at the origin and walking away from it until POINT stops seeing it, against a graphics space that is always 1280 by 1024. The colour count comes from GCOL masking its argument to the mode\'s range. A mode listed as text only is listed that way because a point plotted at its origin was not there afterwards.');
  lines.push('');
  lines.push('Bits per pixel and bytes per pixel row follow from those two measurements. Program space is HIMEM minus PAGE, with PAGE at &1900, which is a machine with a DFS in it. A cassette machine has PAGE at &0E00 and 2,816 bytes more.');
  lines.push('');
  lines.push('| Mode | Kind | Pixels | Logical colours | Bits per pixel | Bytes per pixel row | Screen bytes | HIMEM | Program space |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const mode of BBC_SCREEN_MODES) lines.push(row(mode));
  lines.push('');
  lines.push('## Choosing one for a game');
  lines.push('');
  lines.push('The trade is between colours, resolution and what is left for the program. Modes 0, 1 and 2 take twenty kilobytes and leave 5,888 bytes below the screen; modes 4 and 5 take ten and leave 16,384.');
  lines.push('');
  lines.push('Sideways RAM does not change any of those numbers. It adds sixteen kilobytes at &8000, above the screen, so it holds code and data that can be paged in rather than lowering what the screen costs. A tube second processor does change them: the program runs in the parasite and the whole of the host\'s memory below &8000 is the screen and the host\'s own workspace, so the mode is chosen for what it looks like rather than for what it leaves.');
  lines.push('');
  lines.push('## With a VideoNuLA fitted');
  lines.push('');
  lines.push(`A VideoNuLA replaces the video ULA and changes none of the figures above: the 6845 and the screen RAM belong to the machine. What it changes is what a logical colour may be set to, from the machine's ${BBC_PALETTE_DEPTH} physical colours to ${NULA_PALETTE_DEPTH.toLocaleString()}, four bits each of red, green and blue, written as a pair of bytes to &FE23.`);
  lines.push('');
  lines.push('| Mode | Logical colours | Each chosen from, without a NuLA | With one |');
  lines.push('| --- | --- | --- | --- |');
  for (const mode of BBC_SCREEN_MODES) {
    const gain = nulaPaletteGain(mode);
    if (gain) lines.push(`| ${gain.mode} | ${gain.logicalColours} | ${gain.withoutNula} | ${gain.withNula.toLocaleString()} |`);
  }
  lines.push('');
  lines.push('The NuLA\'s other features reached through &FE22, the attribute modes and the horizontal scroll and left blanking, are implemented by the pinned core and documented in the VideoNuLA user guide, which the target reference cites. No resolution or colour count for them is given here, because none has been measured.');
  lines.push('');
  return `${lines.join('\n')}`;
}
