import { describe, expect, it } from 'vitest';
import {
  BPLUS_ANDY_PAGES, BPLUS_SHADOW_PAGES, BPLUS_CONTROL, BPLUS_ROMSEL_ANDY,
  BPLUS_64K_SWRAM, BPLUS_128_SWRAM, BPLUS_MODELS, bplusModelDefinition,
  bplusModelFrom, resolveMachineModel,
} from './bbcBPlus';
import {
  BBC_BPLUS_BANNER, BBC_BPLUS_SCREEN_MODES, BBC_BPLUS_PAGED_RAM,
  BBC_BPLUS_SIDEWAYS_RAM_BANNERS, BBC_BPLUS_MEASUREMENT_SOURCE,
} from './bbcBPlusMeasurements';
import { allModels, findModel } from 'jsbeeb/src/models.js';

describe('the B+ this build adds', () => {
  it('exists because the engine has none, and is built on the machine it is closest to', () => {
    const synonyms = new Set(allModels.flatMap((model) => model.synonyms));
    expect([...synonyms].some((name) => /b\+|bplus/i.test(name))).toBe(false);
    for (const model of BPLUS_MODELS) expect(synonyms.has(model.derivedFrom), model.derivedFrom).toBe(true);
  });

  it('pages twelve kilobytes at &8000, not the Master\'s four', () => {
    /* Memory pages are 256 bytes, so &8000-&AFFF is pages 128 to 175. The
     * Master pages 128 to 143. Getting this wrong leaves ROM under the top
     * eight kilobytes and a program that writes there loses what it wrote. */
    expect(BPLUS_ANDY_PAGES.first * 256).toBe(0x8000);
    expect(BPLUS_ANDY_PAGES.last * 256).toBe(0xb000);
    expect((BPLUS_ANDY_PAGES.last - BPLUS_ANDY_PAGES.first) * 256).toBe(12 * 1024);
  });

  it('shadows the twenty kilobytes the screen can live in', () => {
    expect(BPLUS_SHADOW_PAGES.first * 256).toBe(0x3000);
    expect(BPLUS_SHADOW_PAGES.last * 256).toBe(0x8000);
    expect((BPLUS_SHADOW_PAGES.last - BPLUS_SHADOW_PAGES.first) * 256).toBe(20 * 1024);
  });

  it('names the bits it acts on', () => {
    expect(BPLUS_ROMSEL_ANDY).toBe(0x80);
    expect(BPLUS_CONTROL.shadow).toBe(0x80);
    expect(BPLUS_CONTROL.allAccesses).toBe(0x40);
  });

  it('fits a B+ 64K with no sideways RAM, because that is what one has', () => {
    expect(BPLUS_64K_SWRAM.some(Boolean)).toBe(false);
    expect(BPLUS_128_SWRAM.filter(Boolean)).toHaveLength(4);
    for (const model of BPLUS_MODELS) expect(model.swram).toBe(BPLUS_64K_SWRAM);
  });

  it('derives a machine without touching the one it derived from', () => {
    const base = findModel('B1770')!;
    const before = { name: base.name, os: [...(base as unknown as { os: string[] }).os] };
    const model = bplusModelFrom(base, { os: ['bplus/os2.rom'], name: 'test B+' });
    expect(model.name).toBe('test B+');
    expect((model as unknown as { os: string[] }).os).toEqual(['bplus/os2.rom']);
    /* The engine shares its models across every machine in the process. */
    expect(base.name).toBe(before.name);
    expect((base as unknown as { os: string[] }).os).toEqual(before.os);
    /* And the derived one still answers as a machine: the clock and processor
     * come from the Model B it was made from rather than being restated. */
    expect(model.cyclesPerSecond).toBe(base.cyclesPerSecond);
    expect(model.nmos).toBe(base.nmos);
  });

  it('resolves a B+ by name and everything else through the engine', () => {
    const bplus = resolveMachineModel('BPlus', findModel);
    expect(bplus?.bplus?.label).toBe('BBC Model B+ 64K');
    const beeb = resolveMachineModel('B1770', findModel);
    expect(beeb?.bplus).toBeNull();
    expect(beeb?.model).toBe(findModel('B1770'));
    expect(resolveMachineModel('no-such-machine', findModel)).toBeNull();
    expect(bplusModelDefinition('bplusadfs')?.synonym).toBe('BPlusADFS');
  });

  it('refuses to build a B+ on a machine the engine does not have', () => {
    expect(() => resolveMachineModel('BPlus', () => null)).toThrow(/does not publish/);
  });
});

describe('what the B+ answered when it was asked', () => {
  it('introduces itself as a B+ and not as a Model B', () => {
    expect(BBC_BPLUS_BANNER).toContain('Acorn OS 64K');
    expect(BBC_BPLUS_BANNER).not.toContain('BBC Computer');
    expect(BBC_BPLUS_BANNER).toContain('1770 DFS');
  });

  it('gives a shadow mode away for nothing, which is the point of the machine', () => {
    const ordinary = BBC_BPLUS_SCREEN_MODES.find((mode) => mode.typed.includes('MODE 7:'))!;
    const shadow = BBC_BPLUS_SCREEN_MODES.filter((mode) => /MODE 1(28|35)/.test(mode.typed));
    expect(ordinary.himem).toBe('7C00');
    expect(shadow).toHaveLength(2);
    for (const mode of shadow) {
      expect(mode.himem, mode.typed).toBe('8000');
      /* And the program still starts where it did: shadow moves the screen, not
       * the program. */
      expect(mode.page, mode.typed).toBe(ordinary.page);
    }
    /* The twenty-kilobyte screen is the one a Model B could not give away. */
    const twentyK = BBC_BPLUS_SCREEN_MODES.find((mode) => mode.typed.includes('MODE 128'))!;
    expect(Number.parseInt(twentyK.himem, 16)).toBeGreaterThan(0x3000);
  });

  it('holds twelve kilobytes at &8000 and gives the ROM back afterwards', () => {
    expect(BBC_BPLUS_PAGED_RAM.readBackAt8000).toBe(BBC_BPLUS_PAGED_RAM.wroteAt8000);
    expect(BBC_BPLUS_PAGED_RAM.readBackAtAFFF).toBe(BBC_BPLUS_PAGED_RAM.wroteAtAFFF);
    expect(BBC_BPLUS_PAGED_RAM.romByteAt8000AfterRestoring).not.toBe(BBC_BPLUS_PAGED_RAM.wroteAt8000);
  });

  it('explains, in the machine\'s own answers, why the 128 is not offered', () => {
    const byBanks = new Map(BBC_BPLUS_SIDEWAYS_RAM_BANNERS.map((entry) => [entry.banks.join(','), entry.banner]));
    expect(byBanks.get('')).toBe('Acorn OS 64K');
    /* Whatever is fitted, the answer never becomes a B+ 128's. */
    const withRam = BBC_BPLUS_SIDEWAYS_RAM_BANNERS.filter((entry) => entry.banks.length);
    expect(withRam.every((entry) => entry.banner !== 'Acorn OS 128K')).toBe(true);
    expect(byBanks.get('0,1')).toBe(byBanks.get('0,1,2,3'));
  });

  it('says where the answers came from', () => {
    expect(BBC_BPLUS_MEASUREMENT_SOURCE).toContain('own keyboard');
    expect(BBC_BPLUS_MEASUREMENT_SOURCE).toContain('OS 2.00');
  });
});
