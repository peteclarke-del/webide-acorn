// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BBC_GRAPHICS_HEIGHT,
  BBC_GRAPHICS_WIDTH,
  BBC_SCREEN_MODES,
  BBC_SCREEN_TOP,
  NULA_PALETTE_DEPTH,
  bitsPerPixel,
  bytesForProgram,
  bytesPerPixelRow,
  nulaPaletteGain,
  renderScreenModeMatrix,
} from './bbcScreenModes';
import { PALETTE_MODES } from '../assets/paletteDocument';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPath = join(root, 'docs', 'bbc-screen-modes.md');

describe('the screen modes a Model B was measured having', () => {
  it('matches the document that is checked in', async () => {
    /* A table a game is designed against must not be able to drift from the
     * measurements it was made of, so it is generated and the gate compares it. */
    const expected = renderScreenModeMatrix();
    let actual: string;
    try { actual = await readFile(documentPath, 'utf8'); }
    catch {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/bbc-screen-modes.md did not exist and has been written. Commit it.');
    }
    if (actual !== expected) {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/bbc-screen-modes.md was out of date with the catalogue and has been regenerated. Review and commit it.');
    }
    expect(actual).toBe(expected);
  });

  it('covers all eight modes the machine offers', () => {
    expect(BBC_SCREEN_MODES.map((mode) => mode.mode)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps screen memory and HIMEM consistent, because one was derived from the other', () => {
    for (const mode of BBC_SCREEN_MODES) {
      expect(BBC_SCREEN_TOP - mode.himem, `mode ${mode.mode}`).toBe(mode.screenBytes);
    }
  });

  it('gives every graphics mode a whole number of bits per pixel', () => {
    /* A fractional answer would mean one of the two measurements was wrong,
     * which is the whole reason to derive this rather than state it. */
    for (const mode of BBC_SCREEN_MODES.filter((entry) => entry.kind === 'graphics')) {
      const bits = bitsPerPixel(mode)!;
      expect([1, 2, 4], `mode ${mode.mode}`).toContain(bits);
      expect(mode.logicalColours, `mode ${mode.mode}`).toBe(2 ** bits);
    }
  });

  it('lays every graphics mode out as eighty or forty bytes to a pixel row', () => {
    /* The 6845 shows eighty character cells in the twenty-kilobyte modes and
     * forty in the ten-kilobyte ones, whatever the pixel width. */
    for (const mode of BBC_SCREEN_MODES.filter((entry) => entry.kind === 'graphics')) {
      expect([40, 80], `mode ${mode.mode}`).toContain(bytesPerPixelRow(mode)!);
    }
  });

  it('says nothing about pixels or colours for a mode that has none', () => {
    for (const mode of BBC_SCREEN_MODES.filter((entry) => entry.kind !== 'graphics')) {
      expect(mode.pixelsAcross, `mode ${mode.mode}`).toBeNull();
      expect(mode.logicalColours, `mode ${mode.mode}`).toBeNull();
      expect(bitsPerPixel(mode), `mode ${mode.mode}`).toBeNull();
      expect(nulaPaletteGain(mode), `mode ${mode.mode}`).toBeNull();
    }
  });

  it('divides the graphics space exactly, which is what the probe relied on', () => {
    for (const mode of BBC_SCREEN_MODES.filter((entry) => entry.kind === 'graphics')) {
      expect(BBC_GRAPHICS_WIDTH % mode.pixelsAcross!, `mode ${mode.mode}`).toBe(0);
      expect(BBC_GRAPHICS_HEIGHT % mode.pixelsDown!, `mode ${mode.mode}`).toBe(0);
    }
  });

  it('leaves less room for a program the more the screen costs', () => {
    const graphics = BBC_SCREEN_MODES.filter((entry) => entry.kind === 'graphics');
    for (const mode of graphics) {
      expect(bytesForProgram(mode) + mode.screenBytes, `mode ${mode.mode}`).toBe(BBC_SCREEN_TOP - 0x1900);
    }
  });

  it('agrees with the palette editor about every mode that editor offers', () => {
    /* Two statements about the same machine, so they are checked against each
     * other rather than each being trusted on its own. */
    for (const profile of PALETTE_MODES) {
      const measured = BBC_SCREEN_MODES.find((mode) => mode.mode === profile.mode)!;
      expect(measured.logicalColours, `mode ${profile.mode} colours`).toBe(profile.logicalColours);
      expect(bitsPerPixel(measured), `mode ${profile.mode} depth`).toBe(profile.bitsPerPixel);
    }
  });

  it('says a NuLA widens the palette without adding logical colours', () => {
    for (const mode of BBC_SCREEN_MODES.filter((entry) => entry.kind === 'graphics')) {
      const gain = nulaPaletteGain(mode)!;
      expect(gain.logicalColours).toBe(mode.logicalColours);
      expect(gain.withNula).toBe(NULA_PALETTE_DEPTH);
      expect(gain.withNula).toBeGreaterThan(gain.withoutNula);
    }
  });

  it('produces the same bytes every time, so the check is on content and not on ordering', () => {
    expect(renderScreenModeMatrix()).toBe(renderScreenModeMatrix());
  });
});
