import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROM_SETS, romStorageKey } from './romProfiles';

/*
 * The key a ROM is stored under, and the key the service worker looks for.
 *
 * These are written in two different files in two different languages and
 * nothing joined them up. The worker removed a `roms/` segment from every
 * request, because jsbeeb asks its base URL for `roms/<path>` while jsbeeb
 * profiles store `<set>/<path>` without it. The Elkulator profiles put `roms/`
 * in the manifest path itself, so their vault keys really do contain it, and
 * every ROM of the expanded Electron set was therefore stored under a key the
 * worker would never ask for. Supplied, present in the vault, and answered with
 * 404 the moment the core wanted it.
 *
 * This holds the two ends together by running the worker's own rule over every
 * key the profiles can produce.
 */
const WORKER = readFileSync(resolve(process.cwd(), 'public/rom-service-worker.js'), 'utf8');

/** The worker's own two candidates, taken from its source rather than restated. */
function candidates(pathname: string): string[] {
  const asked = decodeURIComponent(pathname.slice('/user-roms/'.length));
  const shortened = asked.replace(/^([^/]+)\/roms\//, '$1/');
  return shortened === asked ? [asked] : [asked, shortened];
}

describe('the keys a ROM is stored and fetched under', () => {
  it('still tries the stored key before the shortened one', () => {
    /* If this rule leaves the worker, the test above stops describing it. */
    expect(WORKER).toContain("const asked = decodeURIComponent(url.pathname.slice('/user-roms/'.length));");
    expect(WORKER).toContain("const shortened = asked.replace(/^([^/]+)\\/roms\\//, '$1/');");
    expect(WORKER, 'the stored key is tried first').toMatch(/readRom\(asked\)[\s\S]{0,120}readRom\(shortened\)/);
  });

  it('can find every ROM of every profile the product ships', () => {
    const unreachable: string[] = [];
    for (const profile of ROM_SETS) {
      for (const requirement of profile.requirements) {
        const key = romStorageKey(profile.id, requirement);
        /* The URL the workbench builds for this ROM, from App's own rule. */
        const url = `/user-roms/${key.split('/').map(encodeURIComponent).join('/')}`;
        if (!candidates(url).includes(key)) unreachable.push(`${profile.id} · ${requirement.id} stored as ${key}`);
      }
    }
    expect(unreachable, 'every stored ROM is reachable by the worker').toEqual([]);
  });

  it('reaches an Elkulator key, which is the one that was unreachable', () => {
    const electron = ROM_SETS.find((profile) => profile.id === 'electron-expanded');
    expect(electron, 'the expanded Electron set is still shipped').toBeTruthy();
    const os = electron!.requirements.find((requirement) => requirement.id === 'os')!;
    const key = romStorageKey(electron!.id, os);
    expect(key).toBe('electron-expanded/roms/os');
    expect(candidates(`/user-roms/${key}`)).toContain(key);
  });

  it('still reaches a jsbeeb key, which relies on the shortening', () => {
    /* The rule that was there first has to keep working: those profiles store a
     * path with no `roms/` in it and the core asks for one with. */
    expect(candidates('/user-roms/bbc-b/roms/os.rom')).toContain('bbc-b/os.rom');
  });
});
