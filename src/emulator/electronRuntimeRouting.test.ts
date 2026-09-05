import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { electronRuntimeRoute, isElectronEngine } from './electronRuntimeRouting';
import { ROM_SETS } from '../rom/romProfiles';

describe('routing an Electron ROM set to its core', () => {
  it('sends each engine to its own page and channel', () => {
    expect(electronRuntimeRoute('elkjs')).toEqual({ page: '/electron.html', channel: '8bit-net-electron', label: 'ElkJS' });
    expect(electronRuntimeRoute('elkulator')).toEqual({ page: '/elkulator.html', channel: '8bit-net-elkulator', label: 'Elkulator' });
  });

  it('refuses an engine this build cannot start rather than defaulting to one', () => {
    /* Answering with one core's page for another core's identifier is how a
     * machine comes to be started that nobody asked for. */
    for (const engine of ['jsbeeb', 'arculator', undefined, '', 'elkjs2']) {
      expect(electronRuntimeRoute(engine as string | undefined), String(engine)).toBeNull();
      expect(isElectronEngine(engine as string | undefined), String(engine)).toBe(false);
    }
  });

  it('routes every Electron ROM set this build registers', () => {
    /* A set whose engine had no route would frame the wrong document, and the
     * only symptom would be a machine that never answered. */
    const electronSets = ROM_SETS.filter((set) => set.machineIds.includes('electron'));
    expect(electronSets.length).toBeGreaterThan(1);
    for (const set of electronSets) {
      const route = electronRuntimeRoute(set.engine.id);
      expect(route, `${set.id} on ${set.engine.id}`).not.toBeNull();
    }
  });

  it('names the page and channel the runtime file itself implements', () => {
    /* Both halves are checked against the file that implements them. A page
     * that exists with a channel that does not match is the silent failure this
     * module exists to prevent: the runtime ignores anything not addressed to
     * it, so nothing anywhere would say why the machine never answered. */
    const root = process.cwd();
    for (const engine of ['elkjs', 'elkulator'] as const) {
      const route = electronRuntimeRoute(engine)!;
      const page = readFileSync(resolve(root, 'public', route.page.slice(1)), 'utf8');
      const script = /<script defer src="\/([a-z-]+\.js)"><\/script>\s*<\/head>/.exec(page)?.[1]
        ?? [...page.matchAll(/src="\/([a-z-]+-runtime\.js)"/g)].at(-1)?.[1];
      expect(script, `${route.page} loads a runtime script`).toBeTruthy();
      const source = readFileSync(resolve(root, 'public', script!), 'utf8');
      expect(source, `${script} declares ${route.channel}`).toContain(`const CHANNEL = '${route.channel}'`);
    }
  });
});
