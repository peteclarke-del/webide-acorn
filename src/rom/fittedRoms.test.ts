import { describe, expect, it } from 'vitest';
import { ROM_SETS, fittedRomRequirements, requiredRomRequirements, romRequirementsMet, romStorageKey } from './romProfiles';

/*
 * What an expansion is, and what it carries.
 *
 * These were the same thing, and it made the expanded Electron set impossible
 * to use. Every cartridge and sideways ROM offered for the Plus 1 was tagged as
 * required by the Plus 1, so switching the Plus 1 on demanded four more ROMs,
 * MMFS, another MMFS, the Advanced File Manager, the Retro Hardware support ROM
 *, and the machine went unready the moment somebody tried to fit the very
 * thing the set exists for.
 *
 * A Plus 1 with no Plus 1 support ROM is not a Plus 1, so that one is required.
 * A Plus 1 with no MMFS is a Plus 1 with an empty cartridge slot, so that one is
 * offered. The runtime is given everything fitted; readiness asks only for what
 * is required.
 */
const ELECTRON = ROM_SETS.find((set) => set.id === 'electron-expanded')!;

describe('fitting an expansion and filling it', () => {
  it('asks only for the ROM the expansion actually is', () => {
    const required = requiredRomRequirements(ELECTRON, ['plus1']).map((item) => item.id);
    expect(required, 'the operating system and BASIC are always required').toContain('os');
    expect(required, 'a Plus 1 needs its own support ROM').toContain('plus1');
    for (const carried of ['emmfs', 'eswmmfs', 'zemmfs', 'afm', 'rhplus1']) {
      expect(required, `${carried} is something a Plus 1 may carry, not something it needs`).not.toContain(carried);
    }
  });

  it('gives the machine what is carried as well as what is needed', () => {
    const fitted = fittedRomRequirements(ELECTRON, ['plus1']).map((item) => item.id);
    expect(fitted).toContain('plus1');
    expect(fitted, 'a ROM supplied for a fitted expansion was put there on purpose').toContain('emmfs');
    /* And nothing that belongs to an expansion which is not fitted. */
    expect(fitted).not.toContain('adfs');
  });

  it('fits nothing extra when no expansion is switched on', () => {
    const fitted = fittedRomRequirements(ELECTRON, []).map((item) => item.id);
    expect(fitted.sort()).toEqual(['basic', 'os']);
  });

  it('never asks for more than it would fit', () => {
    /* Required is a subset of fitted for every set and every combination that
     * matters, or readiness could demand a ROM the machine would then ignore. */
    for (const set of ROM_SETS) {
      const capabilities = [...new Set(set.requirements.flatMap((item) =>
        [item.requiredByCapability, item.offeredByCapability].filter((value): value is string => !!value)))];
      const required = requiredRomRequirements(set, capabilities).map((item) => item.id);
      const fitted = new Set(fittedRomRequirements(set, capabilities).map((item) => item.id));
      const missing = required.filter((id) => !fitted.has(id));
      expect(missing, `${set.id} would require a ROM it never fits`).toEqual([]);
    }
  });

  describe('an expansion that takes either of two ROMs', () => {
    const key = (id: string) => romStorageKey(ELECTRON.id, ELECTRON.requirements.find((item) => item.id === id)!);
    const machine = [key('os'), key('basic')];

    it('is satisfied by one filing system, because the interface takes one', () => {
      /* Both ADFS and the Electron DFS were marked required by the Plus 3, so
       * fitting one asked for both, a machine nobody owns. */
      expect(romRequirementsMet(ELECTRON, ['plus3'], new Set([...machine, key('adfs')])), 'ADFS alone').toBe(true);
      expect(romRequirementsMet(ELECTRON, ['plus3'], new Set([...machine, key('dfs')])), 'the DFS alone').toBe(true);
      expect(romRequirementsMet(ELECTRON, ['plus3'], new Set([...machine, key('adfs'), key('dfs')])), 'both').toBe(true);
    });

    it('is not satisfied by neither', () => {
      expect(romRequirementsMet(ELECTRON, ['plus3'], new Set(machine))).toBe(false);
    });

    it('still asks for everything outside a group', () => {
      /* The Plus 1's own ROM is not an alternative to anything. */
      expect(romRequirementsMet(ELECTRON, ['plus1'], new Set(machine))).toBe(false);
      expect(romRequirementsMet(ELECTRON, ['plus1'], new Set([...machine, key('plus1')]))).toBe(true);
    });

    it('offers both to the machine even though it needs one', () => {
      const fitted = fittedRomRequirements(ELECTRON, ['plus3']).map((item) => item.id);
      expect(fitted).toContain('adfs');
      expect(fitted).toContain('dfs');
    });
  });
});
