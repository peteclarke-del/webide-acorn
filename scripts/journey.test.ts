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

  it('walks every one of them, because every one of them now runs', () => {
    /* The B+ was the exception, walked only to check it refused honestly. It
     * runs now, on a machine this build adds to the engine, so it is walked the
     * same way as the rest — and if that ever regresses, this is what says so
     * rather than the journey quietly expecting a refusal again. */
    expect(JOURNEYS.every((journey) => journey.runnable)).toBe(true);
    for (const journey of JOURNEYS) {
      const machine = machineProfiles.find((candidate) => candidate.id === journey.machineId)!;
      expect(machine.roms.length, `${journey.machineId} offers firmware`).toBeGreaterThan(0);
      const resolvable = machine.roms.filter((rom) => romSetFor(machine.id, rom.id));
      expect(resolvable.length, `${journey.machineId} has a firmware set that resolves`).toBeGreaterThan(0);
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
    /* And in an empty workbench: the product remembers a project between
     * visits, which is what somebody wants and is not where a journey starts. */
    expect(source).toContain("Storage.clearDataForOrigin");
  });

  it('walks the whole authoring line and not only the parts that are easy to drive', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/journey.mjs'), 'utf8');
    /* Every element of the workflow the journey is supposed to cover. Naming
     * them here is what stops one being quietly dropped when a selector breaks
     * and the walk still reports success. */
    for (const element of ['Sprites', 'Sound', 'Build targets', 'Media']) {
      expect(source, `${element} is visited`).toContain(`clickText('${element}')`);
    }
    /* The editors keep their actions in menus now, so the walk names the item
     * it chooses out of one rather than the whole label of a button. */
    expect(source, 'the drawing reaches the project').toContain('/^Add EQUB source/');
    expect(source, 'a project is started from the menu bar').toContain('/^Start from a sample/');
    expect(source, 'the song reaches the project').toContain("'Add generated source'");
    /* And the step that decides whether the editors are part of the workflow or
     * beside it: the generated units have to reach the binary. */
    expect(source).toContain('build-check-list');
    expect(source).toContain('did not change the program');
  });

  it('answers the question the workbench asks before discarding work', () => {
    /* The product asks before it throws away unsaved edits, with the browser's
     * own dialog — which blocks the page until something answers. A walk that
     * ignored one would not fail, it would hang. */
    const source = readFileSync(resolve(process.cwd(), 'scripts/journey.mjs'), 'utf8');
    expect(source).toContain('Page.javascriptDialogOpening');
    expect(source).toContain('Page.handleJavaScriptDialog');
  });

  it('gives every request a deadline, so a frozen page fails rather than hangs', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/journey.mjs'), 'utf8');
    expect(source).toContain('did not answer within');
  });
});
