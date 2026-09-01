import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JOURNEYS } from './journey.mjs';
import { machineProfiles } from '../src/data/machines';
import { TEMPLATE_CATALOGUE } from '../src/project/templateCatalogue';
import { romSetFor } from '../src/rom/romProfiles';

describe('the authoring journey', () => {
  /*
   * The journey itself runs in the gate, against a real browser. What is
   * checked here is the thing a browser cannot check: that the list of machines
   * being walked is still the list the goal names. A journey stage that quietly
   * stopped covering a machine would go on passing.
   */
  it('walks every machine the goal names', () => {
    expect(JOURNEYS.map((journey) => journey.machineId)).toEqual(['atom', 'electron', 'bbc-b', 'bbc-bplus', 'master']);
  });

  it('names machines this build actually has', () => {
    for (const journey of JOURNEYS) {
      expect(machineProfiles.some((machine) => machine.id === journey.machineId), `${journey.machineId} is a machine`).toBe(true);
    }
  });

  it('gives every runnable machine a template that exists and a medium to leave on', () => {
    for (const journey of JOURNEYS.filter((entry) => entry.runnable)) {
      expect(TEMPLATE_CATALOGUE.some((template) => template.id === journey.template), `${journey.machineId} has ${journey.template}`).toBe(true);
      expect(journey.packages, `${journey.machineId} packages to something`).toBe('cassette');
      const machine = machineProfiles.find((candidate) => candidate.id === journey.machineId)!;
      const cassette = machine.capabilities.find((capability) => capability.id === 'cassette');
      expect(cassette?.state, `${journey.machineId} has a cassette interface to enable`).toBe('supported');
    }
  });

  it('expects the machine with no engine to refuse, and to be walked anyway', () => {
    const refusing = JOURNEYS.filter((journey) => !journey.runnable);
    expect(refusing.map((journey) => journey.machineId)).toEqual(['bbc-bplus']);
    for (const journey of refusing) {
      expect(journey.template, `${journey.machineId} offers no template`).toBeNull();
      /* Every firmware it lists must carry the reason the walk asserts. */
      const machine = machineProfiles.find((candidate) => candidate.id === journey.machineId)!;
      for (const rom of machine.roms) {
        expect(romSetFor(machine.id, rom.id), `${rom.id} does not resolve`).toBeUndefined();
        expect(rom.unavailableReason, `${rom.id} says why`).toBeTruthy();
      }
    }
  });

  it('fails the walk on a console error, an exception or a blocked resource', () => {
    /* All three are collected in the same place, and a journey is only reported
     * as walked when none of them arrived. A stage that watched for exceptions
     * alone would pass a workbench whose content policy broke it. */
    const source = readFileSync(resolve(process.cwd(), 'scripts/journey.mjs'), 'utf8');
    expect(source).toContain('Runtime.exceptionThrown');
    expect(source).toContain("message.params?.type === 'error'");
    expect(source).toContain("message.params?.entry?.source === 'security'");
    expect(source).toContain('ok: complaints.length === 0');
  });

  it('starts each machine in a fresh page rather than where the last one finished', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/journey.mjs'), 'utf8');
    expect(source).toContain("await call('Page.navigate'");
    expect(source).toContain('complaints = [];');
  });
});
