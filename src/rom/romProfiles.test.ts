import { describe, expect, it } from 'vitest';
import { requiredRomRequirements, ROM_SETS, romSetFor, romStorageKey, runtimeSidewaysRomPaths, validateRom } from './romProfiles';
import { machineProfiles } from '../data/machines';
import { archimedesRomProfile } from './archimedesRom';

describe('ROM profile registry', () => {
  it('resolves exact machine and firmware combinations', () => {
    expect(romSetFor('bbc-b', 'os12-basic2-dfs')?.adapterModel).toBe('B-DFS0.9');
    expect(romSetFor('bbc-b', 'os12-basic2-dfs')?.engine).toEqual({ id: 'jsbeeb', version: '1.19.1' });
    expect(romSetFor('bbc-a', 'os12-basic2-dfs')).toBeUndefined();
    /* The Electron now has a manifest, served by the vendored ElkJS core. */
    expect(romSetFor('electron', 'electron-os')).toMatchObject({ adapterModel: 'Electron', engine: { id: 'elkjs' } });
    expect(romSetFor('electron', 'electron-plus3')).toBeUndefined();
  });
  it('rejects incorrect and blank ROM images', () => {
    const requirement = romSetFor('bbc-b', 'os12-basic2-dfs')!.requirements[0]!;
    expect(validateRom(requirement, new Uint8Array(8192)).valid).toBe(false);
    expect(validateRom(requirement, new Uint8Array(16384).fill(0xff)).errors).toContain('The file contains only blank ROM values.');
  });
  it('accepts a nonblank correctly-sized image without claiming its provenance', () => {
    const requirement = romSetFor('atom', 'atom-mos')!.requirements[0]!;
    const bytes = new Uint8Array(4096); bytes[0] = 1; bytes[4092] = 0x00; bytes[4093] = 0xf0;
    expect(validateRom(requirement, bytes).valid).toBe(true);
  });
  it('reports BBC sideways header and combined-bank anomalies separately from size validity', () => {
    const basic = romSetFor('bbc-b', 'os12-basic2-dfs')!.requirements.find((item) => item.id === 'basic')!;
    const malformed = new Uint8Array(16384); malformed[100] = 1;
    expect(validateRom(basic, malformed)).toMatchObject({ valid: true, warnings: expect.arrayContaining([expect.stringContaining('sideways-ROM header'), expect.stringContaining('type byte'), expect.stringContaining('copyright offset')]) });
    const validHeader = new Uint8Array(16384); validHeader.set([0x4c, 0, 0x80, 0x4c, 3, 0x80, 0xc0, 8, 0]);
    expect(validateRom(basic, validHeader).warnings).toEqual([]);
    const master = romSetFor('master', 'mos320')!.requirements[0]!; const combined = new Uint8Array(131072);
    combined.fill(1); combined.fill(0xff, 3 * 16384, 4 * 16384);
    expect(validateRom(master, combined)).toMatchObject({ valid: false, errors: [expect.stringContaining('blank 16 KiB bank')] });
  });
  it('makes expansion firmware mandatory only when its capability is enabled', () => {
    const bbc = romSetFor('bbc-b', 'os12-basic2-dfs')!;
    expect(requiredRomRequirements(bbc).map((item) => item.id)).not.toContain('tube6502');
    expect(requiredRomRequirements(bbc, ['tube']).map((item) => item.id)).toContain('tube6502');
    const master = romSetFor('master', 'mos320')!;
    expect(requiredRomRequirements(master, ['tube']).map((item) => item.id)).toContain('tube65c102');
  });
  it('mounts only enabled requirements explicitly declared as sideways ROMs', () => {
    const bbc = romSetFor('bbc-b', 'os12-basic2-dfs')!;
    expect(runtimeSidewaysRomPaths(bbc)).toEqual([]);
    expect(runtimeSidewaysRomPaths(bbc, ['tube'])).toEqual([]);
    expect(runtimeSidewaysRomPaths(bbc, ['1mhzpi'])).toEqual(['development/BBCWiFi-development.rom']);
    expect(requiredRomRequirements(bbc, ['1mhzpi']).map((item) => item.id)).toContain('1mhzpi-wifi');
  });
  it('shares the development BBC WiFi manifest across supported BBC and Master adapters', () => {
    for (const definition of [romSetFor('bbc-b', 'os12-basic2-dfs'), romSetFor('bbc-b', 'os12-basic2-adfs'), romSetFor('master', 'mos320')]) {
      expect(definition).toBeDefined();
      expect(runtimeSidewaysRomPaths(definition!, ['1mhzpi'])).toEqual(['development/BBCWiFi-development.rom']);
    }
  });
});

describe('the Electron expansion combinations', () => {
  const set = ROM_SETS.find((candidate) => candidate.id === 'electron-expanded')!;

  it('names the core that runs it, pinned to the revision that was built', () => {
    /* This set was declared ahead of its core on purpose, so that firmware
     * somebody already owned could be registered and checked before anything
     * could boot it. The core runs now, and the pin is what ties the manifest
     * to the exact build the artefact came from. */
    expect(set.engine).toEqual({ id: 'elkulator', version: 'allegro5-6785521' });
  });

  it('requires only the machine itself, and gates every expansion on a capability', () => {
    /* An Electron with no Plus 1 is a real Electron. Making an expansion ROM
     * required would refuse a configuration the hardware supports. */
    const required = set.requirements.filter((item) => item.required).map((item) => item.id);
    expect(required).toEqual(['os', 'basic']);
    for (const item of set.requirements.filter((entry) => !entry.required)) {
      expect(item.requiredByCapability, item.id).toBeTruthy();
      expect(item.provenanceNote, item.id).toBeTruthy();
    }
  });

  it('accepts the sizes these ROMs actually are', () => {
    /* Taken from the 1MHzPi project's own Elkulator ROM directory, where these
     * combinations are exercised on hardware. A file of the wrong size is
     * refused before it can produce a machine that half works. */
    const sized = Object.fromEntries(set.requirements.map((item) => [item.id, item.acceptedSizes]));
    expect(sized.plus1).toEqual([4096]);
    expect(sized.tube6502).toEqual([4096]);
    expect(sized.adfs).toEqual([16384]);
    /* ElkWiFi is built rather than obtained and is not a round 16 KB. */
    expect(sized.elkwifi).toEqual([16384, 16406]);
  });

  it('covers the boards the 1MHzPi work actually uses', () => {
    const ids = set.requirements.map((item) => item.id).sort();
    expect(ids).toEqual(['adfs', 'afm', 'basic', 'dfs', 'elkwifi', 'emmfs', 'eswmmfs', 'os', 'plus1', 'rhplus1', 'tube6502', 'zemmfs']);
  });

  it('mounts sideways ROMs sideways and the Tube client as a parasite image', () => {
    /* The Tube client runs in the second processor rather than in a sideways
     * bank, so mounting it sideways would put it where nothing reads it. */
    expect(set.requirements.find((item) => item.id === 'tube6502')?.runtimeMount).toBeUndefined();
    expect(set.requirements.find((item) => item.id === 'adfs')?.runtimeMount).toBe('sideways');
  });
});

describe('every firmware a machine offers', () => {
  /*
   * A machine's firmware list describes the machine, so a version it really
   * shipped with belongs there whether or not this build can run it. What is
   * not acceptable is an entry that quietly resolves to nothing: the run path
   * then reports it as firmware the person has not supplied, and sends them
   * looking for a file that would not have helped.
   */
  it('either resolves to a ROM set or says why it cannot', () => {
    /* The ARM machines carry their firmware in the Archimedes inventory rather
     * than this registry, so they are asked there. Which of them this build can
     * actually run is a separate question, and adapterSupport answers it per
     * machine. */
    const unresolved = machineProfiles.flatMap((machine) => machine.roms
      .filter((entry) => !romSetFor(machine.id, entry.id)
        && !archimedesRomProfile(machine.id, entry.id)
        && !entry.unavailableReason)
      .map((entry) => `${machine.id}/${entry.id}`));
    expect(unresolved).toEqual([]);
  });

  it('gives a reason that names the obstacle rather than blaming a missing file', () => {
    const excused = machineProfiles.flatMap((machine) => machine.roms
      .filter((entry) => entry.unavailableReason)
      .map((entry) => ({ machine: machine.id, id: entry.id, reason: entry.unavailableReason! })));
    expect(excused.length).toBeGreaterThan(0);
    for (const entry of excused) {
      expect(romSetFor(entry.machine, entry.id), `${entry.machine}/${entry.id} is excused but does resolve`).toBeUndefined();
      expect(entry.reason.length).toBeGreaterThan(80);
      /* The obstacle is the emulator, and the reason has to name it, because
       * the alternative reading — that a file is missing — is the one that
       * sends somebody looking for firmware that would not help. */
      expect(entry.reason).toMatch(/jsbeeb|arculator|elkulator|emulat|model/i);
    }
  });

  it('registers the two Master firmwares that share the engine model, and not the machine that does not', () => {
    expect(romSetFor('master', 'mos320')?.adapterModel).toBe('Master');
    expect(romSetFor('master', 'mos350')?.adapterModel).toBe('Master');
    expect(romSetFor('master', 'compact510')).toBeUndefined();
    /* Both Master sets read their operating system through the socket the
     * engine names, from their own directory in the vault. */
    const keys = ['mos320', 'mos350'].map((id) => romStorageKey(id, romSetFor('master', id)!.requirements[0]!));
    expect(keys).toEqual(['mos320/master/mos3.20', 'mos350/master/mos3.20']);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('the two Electron cores', () => {
  /*
   * The Electron's firmware list is how a person chooses between them, because
   * the ROM set carries the engine. It named a set that did not exist, so the
   * Elkulator core — the one with the instruction hook, the media path and the
   * expansions — could not be reached from the workbench at all, while every
   * test that asked the registry directly still passed. This is the test that
   * would have caught it.
   */
  it('are both reachable from the machine\'s own firmware list', () => {
    const electron = machineProfiles.find((machine) => machine.id === 'electron')!;
    const engines = electron.roms
      .map((entry) => romSetFor('electron', entry.id)?.engine.id)
      .filter((id) => !!id);
    expect(new Set(engines)).toEqual(new Set(['elkjs', 'elkulator']));
  });

  it('offer the base machine on ElkJS and the expanded one on Elkulator', () => {
    expect(romSetFor('electron', 'electron-os')?.engine.id).toBe('elkjs');
    expect(romSetFor('electron', 'electron-expanded')?.engine.id).toBe('elkulator');
  });
});
