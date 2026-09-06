import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROM_SETS } from './romProfiles';

/*
 * The names the Elkulator core opens, and the names the profile supplies.
 *
 * The core is a C program compiled to WebAssembly. It opens its firmware by
 * filename from its own working directory — `os`, `basic.rom`, `plus1.rom` —
 * and a name it cannot find is an expansion that is not fitted rather than a
 * machine that will not start. That is the right behaviour and it is also
 * silent: a profile that supplies `acorn-adfs.rom` when the core opens
 * `adfs.rom` produces a machine that boots perfectly and simply has no disc
 * interface, and nothing anywhere says why.
 *
 * That is what had happened. The first end-to-end run with the expanded set in
 * the vault booted the Electron, fitted the Plus 1 and the DFS, and reported
 * "No ROM file 'adfs.rom'; that expansion is not fitted" — with a supplied,
 * verified ADFS sitting in the vault under a name nothing would ever ask for.
 *
 * So the names are read from the core's own build script rather than restated
 * here, and every Elkulator requirement has to be one of them.
 */
const PREPARE = readFileSync(resolve(process.cwd(), 'docker/elkulator/prepare-elkulator.py'), 'utf8');

/** Every filename the prepared core opens, from the calls it is patched to make. */
function namesTheCoreOpens(): string[] {
  const calls = [...PREPARE.matchAll(/loadrom(?:_optional)?\((?:\w+),\s*"([^"]+)"\)/g)].map((match) => match[1]!);
  return [...new Set(calls)];
}

describe('the firmware an Elkulator machine is given', () => {
  it('reads the names out of the core rather than restating them', () => {
    const names = namesTheCoreOpens();
    expect(names, 'the core still opens its ROMs by name').toContain('basic.rom');
    expect(names).toContain('plus1.rom');
    expect(names.length).toBeGreaterThan(4);
  });

  /*
   * Which requirements the core can actually take, and which it cannot.
   *
   * The core opens five files by name and puts them in dedicated slots. Every
   * other expansion this profile offers is a sideways ROM, and this build does
   * not drive sideways banks on the Electron — the workbench says so in its own
   * words, and each is marked planned for that reason. That boundary is real
   * and is pinned here, so a new expansion added on the strength of having a
   * ROM is caught rather than sitting in the vault doing nothing.
   */
  const SIDEWAYS_NOT_DRIVEN = ['emmfs', 'eswmmfs', 'zemmfs', 'afm', 'rhplus1', 'elkwifi', 'tube6502'];

  it('supplies every ROM the core loads under the name it opens', () => {
    const names = new Set(namesTheCoreOpens());
    const wrong: string[] = [];
    for (const set of ROM_SETS) {
      if (set.engine.id !== 'elkulator') continue;
      for (const requirement of set.requirements) {
        if (SIDEWAYS_NOT_DRIVEN.includes(requirement.id)) continue;
        /* The core opens relative to its own directory, which is what the
         * `roms/` prefix in these paths is. */
        const filename = requirement.emulatorPath.replace(/^roms\//, '');
        if (!names.has(filename)) wrong.push(`${set.id} · ${requirement.id} supplies ${filename}`);
      }
    }
    expect(wrong, 'a name the core never opens is firmware that silently does nothing').toEqual([]);
  });

  it('knows exactly which expansions this build cannot yet fit', () => {
    const names = new Set(namesTheCoreOpens());
    const undrivable = ROM_SETS
      .filter((set) => set.engine.id === 'elkulator')
      .flatMap((set) => set.requirements
        .filter((requirement) => !names.has(requirement.emulatorPath.replace(/^roms\//, '')))
        .map((requirement) => requirement.id));
    expect(undrivable.sort(), 'a new sideways expansion has appeared, and this build has no way to fit it')
      .toEqual([...SIDEWAYS_NOT_DRIVEN].sort());
  });

  it('names the ADFS the way the core asks for it', () => {
    /* The one that was wrong, kept as its own case so the regression has a name. */
    const electron = ROM_SETS.find((set) => set.id === 'electron-expanded')!;
    const adfs = electron.requirements.find((requirement) => requirement.id === 'adfs')!;
    expect(adfs.emulatorPath).toBe('roms/adfs.rom');
    expect(namesTheCoreOpens()).toContain('adfs.rom');
  });
});
