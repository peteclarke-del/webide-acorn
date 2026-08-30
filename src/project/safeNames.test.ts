// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { MAX_FILENAME_LENGTH, RESERVED_DEVICE_NAMES, normalizeProjectFilename, unsafeWritePath } from './safeNames';

describe('the name a project will actually use', () => {
  it('leaves an ordinary filename exactly as it was, and says nothing changed', () => {
    for (const name of ['main.asm', 'hero.asset.json', 'level-1.bas', 'READ ME.txt', 'sprite_08.arm']) {
      expect(normalizeProjectFilename(name)).toEqual({ name, reason: null });
    }
  });

  it('folds path separators into the name rather than creating a directory', () => {
    const result = normalizeProjectFilename('src/main.asm');
    expect(result.name).toBe('src-main.asm');
    expect(result.reason).toContain('path separators');
    expect(normalizeProjectFilename('src\\main.asm').name).toBe('src-main.asm');
  });

  it('removes the characters a filesystem refuses, naming that as the reason', () => {
    const result = normalizeProjectFilename('re:port<1>?.txt');
    expect(result.name).toBe('report1.txt');
    expect(result.reason).toContain('will not accept');
    /* A control character in a name is not visible; removing it silently would
     * leave two names that look identical and are not. */
    expect(normalizeProjectFilename('main\u0000.asm').name).toBe('main.asm');
    expect(normalizeProjectFilename('main\u007f.asm').name).toBe('main.asm');
  });

  it('refuses the two names that mean a directory', () => {
    expect(normalizeProjectFilename('.').name).toBe('untitled.txt');
    expect(normalizeProjectFilename('.').reason).toContain('names a directory');
    expect(normalizeProjectFilename('..').name).toBe('untitled.txt');
    /* A leading dot is a hidden file, not a directory reference, and is kept. */
    expect(normalizeProjectFilename('.gitignore')).toEqual({ name: '.gitignore', reason: null });
  });

  it('drops a trailing dot or space, because the filesystem would drop it anyway', () => {
    expect(normalizeProjectFilename('report.').name).toBe('report');
    expect(normalizeProjectFilename('report ').name).toBe('report');
    expect(normalizeProjectFilename('report. . ').name).toBe('report');
    expect(normalizeProjectFilename('report.').reason).toContain('would be discarded');
  });

  it('renames every Windows device name, with or without an extension', () => {
    for (const device of RESERVED_DEVICE_NAMES) {
      expect(normalizeProjectFilename(device).name).toBe(`_${device}`);
      expect(normalizeProjectFilename(`${device.toUpperCase()}.asm`).name).toBe(`_${device.toUpperCase()}.asm`);
      expect(normalizeProjectFilename(device).reason).toContain('reserved device name');
    }
    expect(RESERVED_DEVICE_NAMES.size).toBe(22);
    /* A name that merely starts with one is a perfectly good file. */
    expect(normalizeProjectFilename('console.asm')).toEqual({ name: 'console.asm', reason: null });
    expect(normalizeProjectFilename('com10.asm')).toEqual({ name: 'com10.asm', reason: null });
  });

  it('shortens an over-long name but keeps its extension, so the language is still known', () => {
    const long = `${'a'.repeat(400)}.asm`;
    const result = normalizeProjectFilename(long);
    expect(result.name.length).toBe(MAX_FILENAME_LENGTH);
    expect(result.name.endsWith('.asm')).toBe(true);
    expect(result.reason).toContain(`${MAX_FILENAME_LENGTH} characters`);
  });

  it('always returns a usable name, whatever it was given', () => {
    for (const input of ['', '   ', '///', '<<<>>>', '..', '.', '\u0000\u0001']) {
      const result = normalizeProjectFilename(input);
      expect(result.name.length).toBeGreaterThan(0);
      expect(unsafeWritePath(result.name)).toBeNull();
      expect(result.reason).not.toBeNull();
    }
  });

  it('is settled after one pass, so a name it produced is never changed again', () => {
    for (const input of ['CON', 'report.', 'a/b', 're:port', `${'x'.repeat(300)}.asm`, '..', '']) {
      const once = normalizeProjectFilename(input).name;
      expect(normalizeProjectFilename(once)).toEqual({ name: once, reason: null });
    }
  });
});

describe('what may be written into a folder on disk', () => {
  it('accepts an ordinary path with directories in it', () => {
    expect(unsafeWritePath('main.asm')).toBeNull();
    expect(unsafeWritePath('src/assets/sprite.asm')).toBeNull();
  });

  it('refuses a path that names no file', () => {
    expect(unsafeWritePath('')).toBe('has no filename');
    expect(unsafeWritePath('src/')).toBe('has no filename');
  });

  it('refuses anything that would climb out of the chosen folder', () => {
    expect(unsafeWritePath('../escaped.asm')).toBe('leaves the chosen folder');
    expect(unsafeWritePath('src/../../escaped.asm')).toBe('leaves the chosen folder');
    expect(unsafeWritePath('./main.asm')).toBe('leaves the chosen folder');
    expect(unsafeWritePath('/main.asm')).toBe('leaves the chosen folder');
    expect(unsafeWritePath('src//main.asm')).toBe('leaves the chosen folder');
  });

  it('refuses a segment the filesystem itself would refuse, naming the segment', () => {
    expect(unsafeWritePath('src/CON/main.asm')).toContain('"CON"');
    expect(unsafeWritePath('src/re:port.asm')).toContain('"re:port.asm"');
    expect(unsafeWritePath('src/trailing. /main.asm')).toContain('"trailing. "');
  });
});
