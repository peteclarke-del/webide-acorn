import { describe, expect, it } from 'vitest';
import { modeFromFilename, screenDumpCandidate } from './screenDump';
import { screenGeometry } from './screenDocument';

const MODE_2 = screenGeometry('bbc-mode-2').byteLength;
const MODE_5 = screenGeometry('bbc-mode-5').byteLength;

describe('a screen saved straight out of the machine', () => {
  it('offers every mode the length allows, because the bytes do not say', () => {
    const candidate = screenDumpCandidate('LOADPIC', new Uint8Array(MODE_2))!;
    expect(candidate.byteLength).toBe(20_480);
    /* Twenty kilobytes is modes 0, 1 and 2 alike. */
    expect(candidate.modes).toEqual(['bbc-mode-0', 'bbc-mode-1', 'bbc-mode-2']);
    expect(candidate.namedByFilename).toBe(false);
  });

  it('puts the mode the filename names first, and says that is why', () => {
    const candidate = screenDumpCandidate('assets/loading/generated/loading_acorn_mode2_selected.scr', new Uint8Array(MODE_2))!;
    expect(candidate.modes[0]).toBe('bbc-mode-2');
    expect(candidate.namedByFilename).toBe(true);
    expect(candidate.sourceLabel).toBe('loading_acorn_mode2_selected');
  });

  it('reads the ten-kilobyte modes as the two they are', () => {
    const candidate = screenDumpCandidate('title.scr', new Uint8Array(MODE_5))!;
    expect(candidate.byteLength).toBe(10_240);
    expect(candidate.modes).toEqual(['bbc-mode-4', 'bbc-mode-5']);
  });

  it('ignores a filename naming a mode whose buffer is a different length', () => {
    /* A ten-kilobyte file called mode1 cannot be a mode 1 screen, so the name
     * is wrong and the length is believed. */
    const candidate = screenDumpCandidate('mode1_thing.bin', new Uint8Array(MODE_5))!;
    expect(candidate.namedByFilename).toBe(false);
    expect(candidate.modes).toEqual(['bbc-mode-4', 'bbc-mode-5']);
  });

  it('says nothing about a file that is no screen size at all', () => {
    expect(screenDumpCandidate('grave.bin', new Uint8Array(5284))).toBeNull();
    expect(screenDumpCandidate('empty', new Uint8Array(0))).toBeNull();
  });

  it('keeps the bytes, so the screen that is recovered is the one that was saved', () => {
    const bytes = new Uint8Array(MODE_5);
    bytes[0] = 0xff;
    bytes[MODE_5 - 1] = 0x0f;
    const candidate = screenDumpCandidate('pic.scr', bytes)!;
    expect(candidate.bytes[0]).toBe(0xff);
    expect(candidate.bytes[MODE_5 - 1]).toBe(0x0f);
  });

  describe('reading a mode out of a filename', () => {
    it.each([
      ['loading_acorn_mode2_selected.scr', 'bbc-mode-2'],
      ['TITLE-MODE 1.scr', 'bbc-mode-1'],
      ['pic_m5.bin', 'bbc-mode-5'],
      ['screen-mode-0', 'bbc-mode-0'],
    ])('reads %s as %s', (name, mode) => expect(modeFromFilename(name)).toBe(mode));

    it.each(['loading.scr', 'mode9.scr', 'random123.bin', 'atom.scr'])('finds no mode in %s', (name) => {
      expect(modeFromFilename(name)).toBeNull();
    });
  });
});
