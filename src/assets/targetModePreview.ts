/* What a sprite will actually look like on the machine.
 *
 * A pixel editor shows square pixels because that is what a grid of cells is.
 * A BBC Micro does not. Every graphics mode fills the same screen with the same
 * 256 lines, so a MODE 5 pixel is four times as wide as a MODE 0 one, and a
 * sprite drawn as a neat circle in the editor is an oval on the machine. That
 * is not a rendering detail; it is the difference between artwork that looks
 * right and artwork that has to be redrawn once somebody sees it running.
 *
 * The aspect ratio is derived from the mode widths the screen model already
 * carries rather than stated again here, because two declarations of one fact
 * are a defect and this is exactly the fact that would drift.
 *
 * The other half of the preview is what the mode cannot show. A sprite drawn
 * with sixteen colours has to lose twelve of them in MODE 5, and the useful
 * thing to say is which twelve and how many pixels use them — not to clamp them
 * quietly to something that fits, which produces a preview that looks fine and
 * a build that does not.
 */
import { paletteModeProfile, type PaletteModeId, type ProjectPalette } from './paletteDocument';
import { screenGeometry, SCREEN_HEIGHT } from './screenDocument';

/** The widest mode, against which every other mode's pixel is measured. */
const WIDEST_MODE: PaletteModeId = 'bbc-mode-0';

export interface UnrepresentableColour {
  /** The logical colour the artwork uses. */
  colour: number;
  /** How many pixels use it. */
  pixels: number;
}

export interface TargetModePreview {
  mode: PaletteModeId;
  modeLabel: string;
  /**
   * How many times wider a pixel of this mode is than a pixel of the narrowest
   * one. A MODE 5 pixel is four of MODE 0's.
   */
  pixelAspect: number;
  logicalColours: number;
  bitsPerPixel: number;
  /** The sprite's size in this mode's pixels. */
  size: { width: number; height: number };
  /** What fraction of the visible screen it covers, as a percentage. */
  screenCoverage: { horizontal: number; vertical: number };
  /** Colours the artwork uses that this mode cannot show. */
  unrepresentable: UnrepresentableColour[];
  /** Bytes one frame costs in this mode, before any mask. */
  frameBytes: number;
  /** Said plainly, for an interface that has to explain the preview. */
  notes: string[];
}

/**
 * How much wider this mode's pixel is than the narrowest mode's.
 *
 * Derived, because every BBC graphics mode paints the same width of screen: the
 * ratio of the pixel counts is the ratio of the pixel widths.
 */
export function pixelAspectOf(mode: PaletteModeId): number {
  return screenGeometry(WIDEST_MODE).width / screenGeometry(mode).width;
}

/**
 * Work out how a piece of artwork stands against a display mode.
 *
 * Takes the pixels rather than a document, so a single frame of an animation
 * can be previewed as readily as a whole sprite.
 */
export function previewInMode(
  pixels: readonly number[],
  size: { width: number; height: number },
  mode: PaletteModeId,
): TargetModePreview {
  const profile = paletteModeProfile(mode);
  const geometry = screenGeometry(mode);
  const pixelAspect = pixelAspectOf(mode);

  const counts = new Map<number, number>();
  for (const pixel of pixels) {
    if (pixel >= profile.logicalColours) counts.set(pixel, (counts.get(pixel) ?? 0) + 1);
  }
  const unrepresentable = [...counts.entries()]
    .map(([colour, count]) => ({ colour, pixels: count }))
    .sort((left, right) => left.colour - right.colour);

  const notes: string[] = [];
  if (pixelAspect !== 1) {
    notes.push(`A ${profile.label} pixel is ${pixelAspect} times as wide as it is in ${paletteModeProfile(WIDEST_MODE).label}, so this artwork is ${pixelAspect} times wider on the machine than the editor grid suggests.`);
  }
  if (unrepresentable.length) {
    const total = unrepresentable.reduce((sum, entry) => sum + entry.pixels, 0);
    notes.push(`${profile.label} has ${profile.logicalColours} logical colours and this artwork uses ${unrepresentable.map((entry) => entry.colour).join(', ')} as well. ${total.toLocaleString()} pixel${total === 1 ? '' : 's'} would have no colour to be drawn in; nothing is clamped for you, because a preview that looked right and a build that did not would be worse than being told.`);
  }
  if (size.width > geometry.width) {
    notes.push(`This artwork is ${size.width} pixels wide and ${profile.label} is ${geometry.width}, so it cannot fit across the screen.`);
  }
  if (size.height > SCREEN_HEIGHT) {
    notes.push(`This artwork is ${size.height} pixels tall and the screen is ${SCREEN_HEIGHT}.`);
  }

  return {
    mode,
    modeLabel: profile.label,
    pixelAspect,
    logicalColours: profile.logicalColours,
    bitsPerPixel: profile.bitsPerPixel,
    size: { width: size.width, height: size.height },
    screenCoverage: {
      horizontal: Math.round((size.width / geometry.width) * 1000) / 10,
      vertical: Math.round((size.height / SCREEN_HEIGHT) * 1000) / 10,
    },
    unrepresentable,
    /* Rounded up per row, because a row cannot occupy part of a byte. */
    frameBytes: Math.ceil((size.width * profile.bitsPerPixel) / 8) * size.height,
    notes,
  };
}

/**
 * Every mode, so somebody can see at a glance which ones their artwork suits.
 *
 * Ordered by how many colours the mode offers, because that is the constraint
 * artwork is usually up against.
 */
export function previewInEveryMode(
  pixels: readonly number[],
  size: { width: number; height: number },
): TargetModePreview[] {
  const modes: PaletteModeId[] = ['bbc-mode-0', 'bbc-mode-1', 'bbc-mode-2', 'bbc-mode-4', 'bbc-mode-5'];
  return modes
    .map((mode) => previewInMode(pixels, size, mode))
    .sort((left, right) => left.unrepresentable.length - right.unrepresentable.length || right.logicalColours - left.logicalColours);
}

/**
 * The colours to paint each pixel with, at the mode's own aspect ratio.
 *
 * A pixel the mode cannot show is returned as `null` rather than as a colour,
 * so a preview draws the hole rather than inventing something to fill it.
 */
export function previewCells(
  pixels: readonly number[],
  size: { width: number; height: number },
  mode: PaletteModeId,
  palette: ProjectPalette,
): Array<{ colour: string | null; logical: number }> {
  const profile = paletteModeProfile(mode);
  void size;
  return pixels.map((logical) => ({
    logical,
    colour: logical >= profile.logicalColours ? null : palette.colours[logical] ?? palette.colours[0] ?? null,
  }));
}
