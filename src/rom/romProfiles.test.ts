import { describe, expect, it } from 'vitest';
import { requiredRomRequirements, ROM_SETS, romSetFor, runtimeSidewaysRomPaths, validateRom } from './romProfiles';

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
