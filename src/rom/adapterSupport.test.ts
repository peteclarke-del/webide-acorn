import { describe, expect, it } from 'vitest';
import { allModels } from 'jsbeeb/src/models.js';
import { ADAPTER_SUPPORT, adapterSupportFor, adapterSupportSummary } from './adapterSupport';
import { machineProfiles } from '../data/machines';
import { ROM_SETS } from './romProfiles';

/** Every selectable synonym the pinned engine actually publishes. */
const engineSynonyms = new Set<string>(allModels.flatMap((model) => model.synonyms));

describe('adapter support matrix', () => {
  it('covers every machine profile the product offers', () => {
    for (const profile of machineProfiles) {
      expect(adapterSupportFor(profile.id).machineId, profile.id).toBe(profile.id);
    }
  });

  it('names only models the pinned engine really publishes', () => {
    for (const support of ADAPTER_SUPPORT) {
      if (support.engine?.id !== 'jsbeeb') continue;
      for (const model of support.engineModels) {
        expect(engineSynonyms.has(model), `${support.machineId} claims model ${model}`).toBe(true);
      }
    }
  });

  it('claims no model for a machine no engine in this build implements', () => {
    /* jsbeeb 1.19.1 publishes no B+ model. If a future engine adds one this
     * test fails, which is the point: the claim must follow the code. */
    const support = adapterSupportFor('bbc-bplus');
    expect(support.state).toBe('no-engine-model');
    expect(support.engineModels).toEqual([]);
    expect(support.engine).toBeNull();
    expect(support.limitation).toMatch(/no .* model/i);
    expect(support.limitation).toMatch(/would not change that/);
    expect([...engineSynonyms].some((name) => /b\+|bplus/i.test(name))).toBe(false);
  });

  it('runs the Electron on its own core, and says what that core does not have', () => {
    const support = adapterSupportFor('electron');
    expect(support.state).toBe('runnable');
    expect(support.engine).toEqual({ id: 'elkjs', version: 'ff123355' });
    expect(support.romSetIds).toEqual(['electron-os']);
    /* jsbeeb still has no Electron model; the Electron is served by ElkJS. */
    expect(engineSynonyms.has('Electron')).toBe(false);
    /* The limitation must name the expansions the core does not model, so a
     * user is not left to infer them from silence. */
    for (const missing of ['Plus 1', 'Plus 3', 'AP5', 'ADFS', 'per-instruction hook']) {
      expect(support.limitation, missing).toContain(missing);
    }
  });

  it('marks a machine runnable only when a model and a ROM manifest both exist', () => {
    for (const support of ADAPTER_SUPPORT) {
      if (support.state === 'runnable') {
        expect(support.engine, support.machineId).not.toBeNull();
        if (support.engine!.id === 'jsbeeb') expect(support.romSetIds.length, support.machineId).toBeGreaterThan(0);
      }
      if (support.state === 'no-rom-manifest') {
        expect(support.engineModels.length, support.machineId).toBeGreaterThan(0);
        expect(support.romSetIds, support.machineId).toEqual([]);
      }
      if (support.state === 'no-engine-model') expect(support.engineModels, support.machineId).toEqual([]);
    }
  });

  it('reports the machines this build can actually run', () => {
    const runnable = ADAPTER_SUPPORT.filter((entry) => entry.state === 'runnable').map((entry) => entry.machineId).sort();
    expect(runnable).toEqual(['archimedes-a300', 'atom', 'bbc-b', 'electron', 'master']);
  });

  it('advertises a ROM manifest only when its engine can be started', () => {
    /*
     * A manifest may be registered ahead of the engine that will run it — the
     * Elkulator set is written down and its firmware checkable long before the
     * core can boot — and advertising one would offer a machine configuration
     * nobody can select. So each manifest falls into exactly one of two cases,
     * and both are asserted rather than one being assumed.
     */
    const runnableEngines = new Set(['jsbeeb', 'elkjs']);
    let advertised = 0;
    let awaitingEngine = 0;
    for (const set of ROM_SETS) {
      for (const machineId of set.machineIds) {
        const support = adapterSupportFor(machineId);
        if (runnableEngines.has(set.engine.id)) {
          expect(support.romSetIds, `${set.id} on ${machineId}`).toContain(set.id);
          expect(support.state, `${set.id} on ${machineId}`).toBe('runnable');
          expect(support.engineModels, `${set.id} on ${machineId}`).toContain(set.adapterModel);
          advertised += 1;
        } else {
          expect(support.romSetIds, `${set.id} on ${machineId}`).not.toContain(set.id);
          awaitingEngine += 1;
        }
      }
    }
    expect(advertised).toBeGreaterThan(0);
    /* One today: the Elkulator set. Counted so that a second one added without
     * its engine becoming runnable is a deliberate act rather than a drift. */
    expect(awaitingEngine).toBe(1);
  });

  it('summarises each state in words that match what supplying firmware would do', () => {
    expect(adapterSupportSummary(adapterSupportFor('bbc-b'))).toBe('Runs on jsbeeb 1.19.1.');
    expect(adapterSupportSummary(adapterSupportFor('electron'))).toBe('Runs on elkjs ff123355.');
    expect(adapterSupportSummary(adapterSupportFor('bbc-bplus'))).toBe('No emulator in this build can run this machine.');
    expect(adapterSupportSummary(adapterSupportFor('bbc-a'))).toMatch(/registers no ROM manifest for it yet/);
  });

  it('does not claim a qualified ARM adapter beyond the A310 class', () => {
    expect(adapterSupportFor('archimedes-a300').state).toBe('runnable');
    for (const machineId of ['archimedes-a400', 'a3000', 'a5000', 'riscpc']) {
      expect(adapterSupportFor(machineId).state, machineId).toBe('no-engine-model');
      expect(adapterSupportFor(machineId).limitation, machineId).toMatch(/no other machine is substituted/);
    }
  });

  it('answers for a machine it has never heard of without inventing support', () => {
    const unknown = adapterSupportFor('acorn-nonesuch');
    expect(unknown.state).toBe('no-engine-model');
    expect(unknown.limitation).toMatch(/does not substitute another/);
  });
});
