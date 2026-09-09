import { describe, expect, it } from 'vitest';
import { BBC_TUBE_BOOTS, BBC_TUBE_HOST_ROM, TUBE_CONTROL_WRITES } from './bbcTubeMeasurements';
import { machineProfiles } from '../data/machines';
import { romSetFor, runtimeSidewaysRomPaths } from '../rom/romProfiles';

/*
 * The Tube, held to what each machine actually printed.
 *
 * The product used to say the Tube did not boot on a BBC-family host. It does,
 * and the difference between the machines is which of them carries the host
 * code. These check that the catalogues say what the machines demonstrated,
 * because the catalogue is what a user reads before switching the Tube on.
 */

const machine = (id: string) => machineProfiles.find((profile) => profile.id === id)!;
const tubeCapability = (id: string) => machine(id).capabilities.find((item) => item.id === 'tube')!;
const boot = (name: string, banks: string) => BBC_TUBE_BOOTS.find((item) => item.machine === name && item.banks === banks)!;

describe('the Tube on a BBC-family host', () => {
  it('was measured on all three machines, including the one that was said not to work', () => {
    expect(BBC_TUBE_BOOTS.map((item) => `${item.machine} · ${item.banks}`)).toEqual([
      'Acorn BBC Model B · nothing extra',
      'Acorn BBC Model B · DNFS 1.20 in a sideways bank',
      'Acorn BBC B+ · nothing extra',
      'BBC Master Series · nothing extra',
    ]);
  });

  it('shows a Model B stopping after the operating system has found the Tube', () => {
    const bare = boot('Acorn BBC Model B', 'nothing extra');
    expect(bare.printed).toBe('BBC Computer 32K');
    /* Two accesses, both from the operating system ROM at &DBxx: set the flag,
     * read it back. Nothing else in OS 1.20 touches the Tube. */
    expect(bare.ulaAccesses).toHaveLength(2);
    expect(bare.ulaAccesses.every((access) => access.endsWith('at &DB3D') || access.endsWith('at &DB40'))).toBe(true);
  });

  it('shows the same Model B introducing itself as a Tube once a bank carries the host code', () => {
    const fitted = boot('Acorn BBC Model B', 'DNFS 1.20 in a sideways bank');
    expect(fitted.printed).toBe('Acorn TUBE 6502 64K');
    /* The operating system's two accesses are unchanged; what follows comes
     * from &815D, which is a sideways bank and not the operating system. */
    expect(fitted.ulaAccesses.slice(0, 2)).toEqual(boot('Acorn BBC Model B', 'nothing extra').ulaAccesses);
    expect(fitted.ulaAccesses[2]).toContain('at &815D');
  });

  it('shows the B+ and the Master needing nothing in a bank, because their own firmware carries it', () => {
    for (const [name, banner, hostAddress] of [
      ['Acorn BBC B+', 'Acorn TUBE 6502 64K', '&AEFB'],
      ['BBC Master Series', 'Acorn TUBE 65C102 Co-Processor', '&9DA5'],
    ] as const) {
      const measured = boot(name, 'nothing extra');
      expect(measured.printed).toBe(banner);
      expect(measured.ulaAccesses.some((access) => access.includes(`&8E at ${hostAddress}`)), name).toBe(true);
    }
  });

  it('names every control-register write the trace contains', () => {
    const written = new Set(BBC_TUBE_BOOTS.flatMap((item) => item.ulaAccesses)
      .flatMap((access) => /^write &FEE0 = (&[0-9A-F]+)/.exec(access)?.[1] ?? []));
    expect([...written].sort()).toEqual(Object.keys(TUBE_CONTROL_WRITES).sort());
  });
});

describe('what the product says about the Tube', () => {
  it('offers it on every BBC-family machine that booted one', () => {
    for (const id of ['bbc-b', 'bbc-bplus', 'master']) {
      expect(tubeCapability(id).state, id).toBe('supported');
    }
  });

  it('asks a Model B for the host ROM the moment the Tube is switched on', () => {
    /* The parasite's own ROM goes in the parasite. This one goes in a bank, and
     * without it the machine boots to its own banner with the parasite sitting
     * in its ROM, which looks like a broken Tube rather than a missing ROM. */
    for (const romSetId of ['os12-basic2-dfs', 'os12-basic2-adfs', 'os12-basic1']) {
      const definition = romSetFor('bbc-b', romSetId)!;
      expect(runtimeSidewaysRomPaths(definition, ['tube']), romSetId).toEqual([BBC_TUBE_HOST_ROM]);
      const host = definition.requirements.find((item) => item.id === 'tube-host')!;
      expect(host.requiredByCapability).toBe('tube');
      expect(host.runtimeMount).toBe('sideways');
    }
  });

  it('asks the B+ and the Master for no host ROM, because they need none', () => {
    for (const [machineId, romSetId] of [['bbc-bplus', 'bplus-os'], ['bbc-bplus', 'bplus-adfs'], ['master', 'mos320']] as const) {
      const definition = romSetFor(machineId, romSetId)!;
      expect(runtimeSidewaysRomPaths(definition, ['tube']), `${machineId}/${romSetId}`).toEqual([]);
    }
  });

  it('still gives every machine that offers a Tube a parasite ROM to run', () => {
    for (const [machineId, romSetId] of [
      ['bbc-b', 'os12-basic2-dfs'], ['bbc-b', 'os12-basic2-adfs'], ['bbc-b', 'os12-basic1'],
      ['bbc-bplus', 'bplus-os'], ['bbc-bplus', 'bplus-adfs'], ['master', 'mos320'],
    ] as const) {
      const definition = romSetFor(machineId, romSetId)!;
      const parasite = definition.requirements.filter((item) => item.requiredByCapability === 'tube' && item.purpose === 'extension' && item.acceptedSizes.includes(2048));
      expect(parasite, `${machineId}/${romSetId}`).toHaveLength(1);
    }
  });
});
