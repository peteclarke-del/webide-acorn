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

  it('finds the blind Tube read no dearer than host memory, and the kept-in-step transfer dearer', () => {
    /* The finding the architecture rests on. The blind figure is the ceiling;
     * the kept-in-step one is what a game pays, and it is the one that puts
     * the ground on the host and the sprites on the Tube. If the handshaken
     * cost ever drops below the local copy, that division has to be looked
     * at again. */
    expect(cost('tube')).toBeLessThan(cost('copy'));
    expect(cost('fill')).toBeLessThan(cost('tube'));
    expect(cost('tube-handshake')).toBeGreaterThan(cost('copy'));
    expect(cost('tube-handshake')).toBeLessThan(2 * cost('copy'));
  });

  it('cannot redraw any mode in a single frame, even as a flat fill', () => {
    for (const mode of Object.keys(MODE_SCREEN_BYTES)) {
      expect(screenFractionPerUpdate(mode, cost('fill')), mode).toBeLessThan(1);
      expect(screenFractionPerUpdate(mode, cost('tube-handshake')), mode).toBeLessThan(0.3);
    }
  });

  it('puts half a ten-kilobyte mode within reach of the Tube at half rate and a quarter of a twenty-kilobyte one', () => {
    /* This is the mode decision, in one assertion. */
    expect(screenFractionPerUpdate('MODE 5', cost('tube-handshake'), 2)).toBeGreaterThan(0.45);
    expect(screenFractionPerUpdate('MODE 2', cost('tube-handshake'), 2)).toBeLessThan(0.3);
    /* And what the host can fill itself, which is where the ground goes. */
    expect(screenFractionPerUpdate('MODE 5', cost('fill'))).toBeGreaterThan(0.65);
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
    const frames = SPECTRUM_SCREEN_BYTES / bytesPerFrame(cost('tube-handshake'));
    expect(frames).toBeGreaterThan(2);
    expect(frames).toBeLessThan(3);
  });

  it('states its findings rather than leaving them to be rederived', () => {
    expect(FRAME_BUDGET_FINDINGS.length).toBeGreaterThanOrEqual(5);
    for (const finding of FRAME_BUDGET_FINDINGS) expect(finding.length).toBeGreaterThan(60);
    expect(FRAME_BUDGET_FINDINGS.join(' ')).toContain('a bottleneck for pixels after all');
    expect(FRAME_BUDGET_FINDINGS.join(' ')).toContain('16.14');
  });

  it('produces the same bytes every time, so the check is on content and not on ordering', () => {
    expect(renderFrameBudget()).toBe(renderFrameBudget());
  });
});
