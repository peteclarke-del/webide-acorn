import { describe, expect, it } from 'vitest';
import { machineProfiles } from './machines';

/*
 * Which machines have somewhere to put a disc, and how the workbench knows.
 *
 * It knew by looking for capabilities called `dfs` or `adfs`. That is true of
 * the BBC family and false of the Electron, whose disc interface is the Plus 3,
 * so an Electron with a Plus 3 fitted and ADFS in it had a working drive and no
 * way to mount anything, because the control that mounts a disc never appeared.
 *
 * Each capability says it for itself now. These cases are the machines whose
 * answer was wrong, and the ones whose answer must not change.
 */
const machine = (id: string) => machineProfiles.find((profile) => profile.id === id)!;
const discBearing = (id: string) => machine(id).capabilities.filter((item) => item.providesDiscStorage).map((item) => item.id);

describe('a machine that can take a disc', () => {
  it('knows the Electron takes one through its Plus 3', () => {
    expect(discBearing('electron')).toEqual(['plus3']);
  });

  it('still knows the BBC family takes one through its filing systems', () => {
    expect(discBearing('bbc-b')).toContain('dfs');
    expect(discBearing('bbc-bplus')).toContain('dfs');
    expect(discBearing('bbc-bplus')).toContain('adfs');
  });

  it('knows the Atom takes one through AtomDOS', () => {
    expect(discBearing('atom')).toContain('atomdos');
  });

  it('does not claim a drive for a capability that is not one', () => {
    /* Sideways RAM, a Tube processor and a speech chip are not disc drives. */
    for (const profile of machineProfiles) {
      for (const item of profile.capabilities.filter((entry) => entry.providesDiscStorage)) {
        expect(['dfs', 'adfs', 'atomdos', 'plus3', 'harddisc', 'ide'], `${profile.id}/${item.id}`).toContain(item.id);
      }
    }
  });

  it('gives every machine that ships a filing-system capability a way to mount one', () => {
    /* If a machine offers a disc filing system at all, something on it has to
     * declare the drive, or its Media workspace will offer no mount control. */
    for (const profile of machineProfiles) {
      const filingSystems = profile.capabilities.filter((item) => ['dfs', 'adfs', 'atomdos', 'plus3'].includes(item.id));
      if (!filingSystems.length) continue;
      expect(filingSystems.some((item) => item.providesDiscStorage), `${profile.id} offers a filing system with no drive`).toBe(true);
    }
  });
});
