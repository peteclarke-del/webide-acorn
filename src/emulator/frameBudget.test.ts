// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BYTE_MOVEMENT,
  CYCLES_PER_FRAME,
  FRAME_BUDGET_FINDINGS,
  MODE_SCREEN_BYTES,
  NULA_PALETTE_RELOAD_CYCLES,
  SCROLL_CYCLES,
  SPECTRUM_SCREEN_BYTES,
  bytesPerFrame,
  paletteReloadsPerFrame,
  renderFrameBudget,
  screenFractionPerUpdate,
} from './frameBudgetMeasurements';
import { BBC_SCREEN_MODES } from '../data/bbcScreenModes';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPath = join(root, 'docs', 'frame-budget.md');
const cost = (id: string) => BYTE_MOVEMENT.find((entry) => entry.id === id)!.cyclesPerByte;

describe('what fits in a frame', () => {
  it('matches the document that is checked in', async () => {
    const expected = renderFrameBudget();
    let actual: string;
    try { actual = await readFile(documentPath, 'utf8'); }
    catch {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/frame-budget.md did not exist and has been written. Commit it.');
    }
    if (actual !== expected) {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/frame-budget.md was out of date with the catalogue and has been regenerated. Review and commit it.');
    }
    expect(actual).toBe(expected);
  });

  it('is measured against the frame a 2 MHz machine at 50 Hz actually has', () => {
    expect(CYCLES_PER_FRAME).toBe(40_000);
  });

  it('agrees with the screen modes the machine reported', () => {
    /* Two statements about the same machine, checked against each other. */
    for (const [mode, bytes] of Object.entries(MODE_SCREEN_BYTES)) {
      const measured = BBC_SCREEN_MODES.find((entry) => `MODE ${entry.mode}` === mode)!;
      expect(measured.screenBytes, mode).toBe(bytes);
    }
  });

  it('finds the Tube no dearer than the host\'s own memory', () => {
    /* The finding the architecture rests on. If this ever reverses, composing
     * on the parasite stops being free and the design has to move. */
    expect(cost('tube')).toBeLessThan(cost('copy'));
    expect(cost('fill')).toBeLessThan(cost('tube'));
  });

  it('cannot redraw any mode in a single frame, even as a flat fill', () => {
    for (const mode of Object.keys(MODE_SCREEN_BYTES)) {
      expect(screenFractionPerUpdate(mode, cost('fill')), mode).toBeLessThan(1);
      expect(screenFractionPerUpdate(mode, cost('tube')), mode).toBeLessThan(0.5);
    }
  });

  it('puts a ten-kilobyte mode within reach at half rate and a twenty-kilobyte one out of it', () => {
    /* This is the mode decision, in one assertion. */
    expect(screenFractionPerUpdate('MODE 5', cost('tube'), 2)).toBeGreaterThan(0.8);
    expect(screenFractionPerUpdate('MODE 2', cost('tube'), 2)).toBeLessThan(0.5);
  });

  it('makes the hardware scroll and the NuLA palette effectively free', () => {
    expect(SCROLL_CYCLES / CYCLES_PER_FRAME).toBeLessThan(0.001);
    /* More reloads than a screen has scanlines, so a four-colour mode can carry
     * a different four on every band. */
    expect(paletteReloadsPerFrame()).toBeGreaterThan(256 / 2);
    expect(NULA_PALETTE_RELOAD_CYCLES).toBeLessThan(CYCLES_PER_FRAME / 100);
  });

  it('keeps a Spectrum screen as the yardstick, and says what it costs here', () => {
    expect(SPECTRUM_SCREEN_BYTES).toBe(6912);
    const frames = SPECTRUM_SCREEN_BYTES / bytesPerFrame(cost('tube'));
    expect(frames).toBeGreaterThan(1);
    expect(frames).toBeLessThan(2);
  });

  it('states its findings rather than leaving them to be rederived', () => {
    expect(FRAME_BUDGET_FINDINGS.length).toBeGreaterThanOrEqual(5);
    for (const finding of FRAME_BUDGET_FINDINGS) expect(finding.length).toBeGreaterThan(60);
    expect(FRAME_BUDGET_FINDINGS.join(' ')).toContain('not a bottleneck for pixels');
  });

  it('produces the same bytes every time, so the check is on content and not on ordering', () => {
    expect(renderFrameBudget()).toBe(renderFrameBudget());
  });
});
