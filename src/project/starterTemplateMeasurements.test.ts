import { describe, expect, it } from 'vitest';
import {
  STARTER_TEMPLATE_RUNS, STARTER_TEMPLATE_MEASUREMENT_SOURCE, ELECTRON_LAUNCH_MEASUREMENT,
} from './starterTemplateMeasurements';
import { TEMPLATE_CATALOGUE } from './templateCatalogue';

describe('the starters, as the machines ran them', () => {
  it('covers every 6502 starter the catalogue ships', () => {
    const assembly = TEMPLATE_CATALOGUE.filter((template) => template.language === '6502').map((template) => template.id).sort();
    expect(STARTER_TEMPLATE_RUNS.map((run) => run.templateId).sort()).toEqual(assembly);
  });

  it('shows the banner on every machine', () => {
    for (const run of STARTER_TEMPLATE_RUNS.filter((entry) => entry.model !== 'Elkulator Electron')) {
      expect(run.shown, `${run.templateId} printed its banner`).toContain('8BIT-NET DEV');
    }
  });

  it('leaves the machine usable, which is what returning cleanly means', () => {
    for (const run of STARTER_TEMPLATE_RUNS) {
      expect(run.basicAnsweredAfterwards, `${run.templateId} came back`).toBe(true);
    }
    for (const run of STARTER_TEMPLATE_RUNS.filter((entry) => entry.model !== 'Elkulator Electron')) {
      expect(run.shown, `${run.templateId} left BASIC working`).toContain('42');
    }
  });

  it('calls each machine in its own language', () => {
    const atom = STARTER_TEMPLATE_RUNS.find((run) => run.model === 'Atom-Tape')!;
    expect(atom.call).toContain('LINK');
    for (const run of STARTER_TEMPLATE_RUNS.filter((entry) => entry.model !== 'Atom-Tape')) {
      expect(run.call).toContain('CALL');
    }
  });

  it('reports the Electron by what was measured rather than by inventing its text', () => {
    const electron = STARTER_TEMPLATE_RUNS.find((run) => run.model === 'Elkulator Electron')!;
    expect(electron.shown).toContain('screen memory lit');
    expect(electron.shown).not.toContain('8BIT-NET DEV');
  });

  it('keeps why a program has to be called rather than jumped into', () => {
    expect(ELECTRON_LAUNCH_MEASUREMENT.settingTheProgramCounter).toContain('printed nothing');
    expect(ELECTRON_LAUNCH_MEASUREMENT.callingFromBasic).toContain('left BASIC working');
  });

  it('says how the measurement was taken', () => {
    expect(STARTER_TEMPLATE_MEASUREMENT_SOURCE).toContain('6*7');
  });
});
