// @vitest-environment node

/* The release gate and these contracts run the same scanner, imported here as
 * the module the gate imports, so the two cannot drift into disagreeing about
 * what may be written.
 *
 * This file is itself allowlisted, because a scanner for a character cannot be
 * tested without writing that character down. */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  MACHINE_PUNCTUATION,
  scanRepository,
  scanText,
  scannable,
  summarise,
  unexplainedAllowlistEntries,
} from './writingStyle.mjs';

const run = promisify(execFile);

describe('punctuation that reads as machine-written', () => {
  it('finds every character it names, wherever it sits', () => {
    for (const entry of MACHINE_PUNCTUATION) {
      const found = scanText('docs/example.md', `before${entry.character}after`);
      expect(found, entry.name).toHaveLength(1);
      expect(found[0]).toMatchObject({ line: 1, name: entry.name, escaped: false });
    }
  });

  it('finds one written as an escape, because that is what the reader sees', () => {
    const found = scanText('src/example.ts', "const label = 'the machine\\u2019s own clock';");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'closing single quote', escaped: true });
  });

  it('reports where it is, so it can be found and rewritten', () => {
    const found = scanText('docs/example.md', 'first line\nsecond line has a — dash');
    expect(found[0]).toMatchObject({ path: 'docs/example.md', line: 2 });
    expect(summarise(found)[0]).toContain('docs/example.md:2:');
    expect(summarise(found)[0]).toContain('em dash');
  });

  it('says what to write instead rather than only refusing', () => {
    for (const line of summarise(scanText('docs/example.md', 'a — b … c – d'))) {
      expect(line).toMatch(/write .+/);
    }
  });

  it('passes ordinary ASCII prose, including a hyphen and three full stops', () => {
    expect(scanText('docs/example.md', "A 1-4,096 byte range, an aside (like this one), and 'quoted' text...")).toEqual([]);
  });

  it('applies to text and not to what it cannot read', () => {
    expect(scannable('docs/todo.md')).toBe(true);
    expect(scannable('src/App.tsx')).toBe(true);
    expect(scannable('scripts/ci.mjs')).toBe(true);
    expect(scannable('public/help/appearance.png')).toBe(false);
    expect(scannable('local-roms/os12.rom')).toBe(false);
  });

  it('exempts only the files whose subject is the character itself', () => {
    expect(scannable('src/editor/sourceTextFormat.ts')).toBe(false);
    expect(scannable('src/emulator/keyboardInputModel.test.ts')).toBe(false);
    expect(scannable('src/emulator/keyboardInputModel.ts')).toBe(true);
  });

  it('gives every exemption a reason', () => {
    expect(unexplainedAllowlistEntries()).toEqual([]);
    expect(ALLOWLIST.length).toBeGreaterThan(0);
  });
});

describe('the repository as it stands', () => {
  it('carries none of it, in any tracked text file', async () => {
    /* The tracked files plus the untracked ones git is not ignoring, which is
     * what a release would carry. Scanning nothing must never read as a pass,
     * so the count is asserted too. */
    const listed = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024 });
    const vendored = /^(?:node_modules|backend\/vendor|\.toolchains|dist|coverage)\//;
    const paths = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean).filter((path) => !vendored.test(path));
    expect(paths.length, 'files were listed to scan').toBeGreaterThan(100);

    const read = async (path: string) => {
      try { return await readFile(path, 'utf8'); } catch { return null; }
    };
    const { findings, scanned } = await scanRepository(paths, read);
    expect(scanned, 'text files were actually read').toBeGreaterThan(100);
    expect(summarise(findings)).toEqual([]);
  }, 60_000);
});
