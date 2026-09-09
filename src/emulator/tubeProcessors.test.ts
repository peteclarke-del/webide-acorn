// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PITUBE_DIRECT_CITATION,
  TUBE_PROCESSORS,
  TUBE_SELECT_OSBYTE,
  plannedTubeProcessors,
  renderTubeProcessorMatrix,
  runnableTubeProcessors,
} from './tubeProcessors';
import { TUBE_PARASITES } from './tubeParasite';
import { TUBE_PARASITE_BOOTS } from './tubeParasiteMeasurements';
import { machineProfiles } from '../data/machines';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPath = join(root, 'docs', 'tube-processors.md');

describe('the second processors a Tube can carry', () => {
  it('matches the document that is checked in', async () => {
    const expected = renderTubeProcessorMatrix();
    let actual: string;
    try { actual = await readFile(documentPath, 'utf8'); }
    catch {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/tube-processors.md did not exist and has been written. Commit it.');
    }
    if (actual !== expected) {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/tube-processors.md was out of date with the catalogue and has been regenerated. Review and commit it.');
    }
    expect(actual).toBe(expected);
  });

  it('covers Acorn\'s own four processors and the two 6502 emulations this build runs', () => {
    const cpus = TUBE_PROCESSORS.map((entry) => entry.cpu);
    expect(cpus.some((cpu) => cpu.includes('65C02'))).toBe(true);
    expect(cpus.some((cpu) => cpu.includes('65C102'))).toBe(true);
    expect(cpus).toContain('Z80');
    expect(cpus).toContain('ARM2');
    expect(cpus).toContain('National Semiconductor 32016');
    expect(cpus).toContain('Intel 80286');
  });

  it('keeps PiTube Direct\'s own selection numbers rather than renumbering them', () => {
    /* A program that switches processors on real hardware is written against
     * these, so a private numbering would be worse than useless. */
    expect(TUBE_SELECT_OSBYTE).toBe('*FX 151,230,n');
    expect(TUBE_PROCESSORS.map((entry) => entry.select)).toEqual([1, 3, 5, 8, 12, 13]);
    /* Sparse on purpose: the gaps are the emulations left out. */
    expect(new Set(TUBE_PROCESSORS.map((entry) => entry.select)).size).toBe(TUBE_PROCESSORS.length);
  });

  it('cites where the list came from', () => {
    expect(PITUBE_DIRECT_CITATION.url).toContain('PiTubeDirect');
    expect(renderTubeProcessorMatrix()).toContain(PITUBE_DIRECT_CITATION.url);
  });

  it('says exactly two run, and they are the two that were measured', () => {
    const runnable = runnableTubeProcessors();
    expect(runnable).toHaveLength(2);
    const measured = new Set(TUBE_PARASITE_BOOTS.map((boot) => boot.parasite));
    expect(measured).toEqual(new Set(['Tube65C02', 'Tube65C102']));
    expect(runnable.map((entry) => entry.romPath)).toEqual([
      TUBE_PARASITES['6502'].romPath,
      TUBE_PARASITES['65c102'].romPath,
    ]);
  });

  it('is offered as a capability on every machine that has a Tube', () => {
    /* The table and the machine profiles are two statements about the same
     * hardware, so they are checked against each other rather than each being
     * trusted on its own. A processor in the table that no machine offers is a
     * processor nobody can ask for. */
    for (const machineId of ['bbc-b', 'bbc-bplus', 'master']) {
      const machine = machineProfiles.find((profile) => profile.id === machineId)!;
      const offered = new Set(machine.capabilities.map((item) => item.id));
      expect(offered.has('tube'), machineId).toBe(true);
      for (const entry of plannedTubeProcessors()) {
        expect(offered.has(entry.capabilityId), `${machineId} offers ${entry.label} as ${entry.capabilityId}`).toBe(true);
      }
    }
  });

  it('offers the 65C102 as its own capability only where the plain Tube is not already one', () => {
    /* A Master was sold with the Turbo board, so its Tube capability is a
     * 65C102 and a second capability saying so would be the same thing twice.
     * A Model B and a B+ were sold with the 6502 board, so on those the 65C102
     * is a choice. */
    const turbo = TUBE_PROCESSORS.find((entry) => entry.cpu.startsWith('65C102'))!;
    const has = (machineId: string, id: string) =>
      machineProfiles.find((profile) => profile.id === machineId)!.capabilities.some((item) => item.id === id);
    expect(has('bbc-b', turbo.capabilityId)).toBe(true);
    expect(has('bbc-bplus', turbo.capabilityId)).toBe(true);
    expect(has('master', turbo.capabilityId)).toBe(false);
    expect(machineProfiles.find((profile) => profile.id === 'master')!.capabilities
      .find((item) => item.id === 'tube')!.description).toContain('65C102');
  });

  it('gives every processor that does not run a reason, and never implies otherwise', () => {
    for (const entry of plannedTubeProcessors()) {
      expect(entry.note, entry.label).not.toBe('');
      expect(entry.note.length, entry.label).toBeGreaterThan(40);
    }
    expect(plannedTubeProcessors()).toHaveLength(TUBE_PROCESSORS.length - 2);
  });

  it('separates having a parasite ROM from being able to run it', () => {
    /* Two of the absent processors have their ROM in the vault already. A ROM
     * is not a processor, and the table has to be readable as saying so. */
    const withRom = plannedTubeProcessors().filter((entry) => entry.romPath);
    expect(withRom.map((entry) => entry.cpu)).toEqual(['Z80', 'ARM2']);
    const rendered = renderTubeProcessorMatrix();
    expect(rendered).toContain('Having the ROM is not having the processor');
  });

  it('names no processor as running that the engine has no model for', () => {
    /* The failure this table exists to prevent: a list of what the hardware
     * offers, read as a list of what this build does. */
    for (const entry of runnableTubeProcessors()) {
      /* The pinned engine's two parasite models are both 6502 family and it
       * publishes no others, so anything else marked as running would be a
       * claim with nothing behind it. */
      expect(entry.cpu, entry.label).toMatch(/^65C(02|102) at \d MHz$/);
    }
  });

  it('produces the same bytes every time, so the check is on content and not on ordering', () => {
    expect(renderTubeProcessorMatrix()).toBe(renderTubeProcessorMatrix());
  });
});
