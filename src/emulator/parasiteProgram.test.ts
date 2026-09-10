import { describe, expect, it } from 'vitest';
import {
  MEASURED_PROGRAM_ORIGIN,
  PARASITE_PROGRAM_RUNS,
  PARASITE_PROOF_ADDRESS,
  PARASITE_PROOF_NOTE,
} from './parasiteProgramMeasurements';
import { BUILD_TARGET_SCHEMA, createBuildTarget, migrateBuildTarget, validateBuildTarget } from '../build/buildTarget';
import type { ProjectFile } from '../project/project';

/*
 * Running a program on the second processor.
 *
 * The measurements say it happened. These say the product still describes a
 * target the same way, so a build meant for the parasite cannot silently be
 * loaded into the host, and one that could never run there is refused with a
 * reason rather than accepted and left to fail.
 */

const source: ProjectFile = { id: 'main', name: 'main.asm', language: '6502', content: 'ORG &2000\nRTS', modified: false };
const basic: ProjectFile = { id: 'prog', name: 'prog.bas', language: 'bbc-basic', content: '10 END', modified: false };
const bbc = { cpu: 'MOS 6502A @ 2 MHz', id: 'bbc-b' };

const parasiteTarget = () => {
  const target = createBuildTarget(source);
  return { ...target, processor: 'parasite' as const, memoryLayout: { ...target.memoryLayout, defaultOrigin: '&2000' } };
};

describe('a program measured running on the second processor', () => {
  it('ran on every host and parasite pairing this build offers', () => {
    expect(PARASITE_PROGRAM_RUNS.map((run) => `${run.host} ${run.parasite}`)).toEqual([
      'B Tube65C02', 'B Tube65C102', 'Master Tube65C102',
    ]);
  });

  it('computed its answer rather than being handed one', () => {
    /* &10 plus &32 is &42, and &42 is nowhere in the program. A run that had
     * not executed could not leave it behind. */
    for (const run of PARASITE_PROGRAM_RUNS) {
      expect(run.computed, `${run.host} ${run.parasite}`).toBe(0x10 + 0x32);
      expect(run.x, `${run.host} ${run.parasite}`).toBe(run.computed);
      expect(run.marker, `${run.host} ${run.parasite}`).toBe(0x5a);
    }
  });

  it('proved it at the one address where the two processors differ', () => {
    expect(PARASITE_PROOF_ADDRESS).toBe(0x8000);
    expect(PARASITE_PROOF_NOTE).toContain('sideways ROM slot');
    /* Everything else the program does would be equally true on the host. */
    expect(PARASITE_PROOF_NOTE).toContain('only the second processor could have produced');
  });

  it('loaded where the runtime allows a parasite program to go', () => {
    expect(MEASURED_PROGRAM_ORIGIN).toBeGreaterThanOrEqual(0x0200);
    expect(MEASURED_PROGRAM_ORIGIN).toBeLessThan(0xf000);
  });
});

describe('a build target that runs on the second processor', () => {
  it('runs on the host unless it says otherwise', () => {
    expect(createBuildTarget(source).processor).toBe('host');
    expect(createBuildTarget(basic).processor).toBe('host');
  });

  it('carries the choice through a migration, and defaults an older target to the host', () => {
    const fallback = { id: 'old', name: 'Old', entryFileId: source.id, toolchainId: '8bit-net.asm.6502' as const, outputName: 'old.bin' };
    expect(migrateBuildTarget({} as never, fallback).processor).toBe('host');
    expect(migrateBuildTarget({ processor: 'parasite' } as never, fallback).processor).toBe('parasite');
    expect(migrateBuildTarget({ processor: 'nonsense' } as never, fallback).processor).toBe('host');
    expect(migrateBuildTarget({} as never, fallback).schemaVersion).toBe(BUILD_TARGET_SCHEMA);
  });

  it('accepts 6502 machine code for a machine that has a Tube', () => {
    expect(validateBuildTarget(parasiteTarget(), [source], bbc)).toEqual([]);
    for (const machineId of ['bbc-bplus', 'master']) {
      expect(validateBuildTarget(parasiteTarget(), [source], { ...bbc, id: machineId }), machineId).toEqual([]);
    }
  });

  it('refuses a machine with no Tube rather than building something that cannot run', () => {
    expect(validateBuildTarget(parasiteTarget(), [source], { ...bbc, id: 'atom' }))
      .toContain('A second processor is fitted to a BBC B, B+ or Master; no other machine here has a Tube');
  });

  it('refuses anything that is not 6502 machine code', () => {
    const target = { ...createBuildTarget(basic), processor: 'parasite' as const };
    expect(validateBuildTarget(target, [basic], bbc).join(' ')).toContain('a second processor runs 6502 machine code');
  });

  it('refuses an origin the parasite cannot hold a program at', () => {
    /* Below &0200 is its zero page and stack; from &F000 the boot ROM overlays
     * the address space while it is paged in. */
    const low = { ...parasiteTarget(), memoryLayout: { defaultOrigin: '&0100', maximumAddress: '&FFFF' } };
    const high = { ...parasiteTarget(), memoryLayout: { defaultOrigin: '&F800', maximumAddress: '&FFFF' } };
    for (const target of [low, high]) {
      expect(validateBuildTarget(target, [source], bbc).join(' ')).toContain('between &0200 and &EFFF');
    }
  });

  it('leaves a host target alone, whatever its origin', () => {
    const target = { ...createBuildTarget(source), memoryLayout: { defaultOrigin: '&0100', maximumAddress: '&FFFF' } };
    expect(validateBuildTarget(target, [source], bbc).join(' ')).not.toContain('&0200');
  });
});
