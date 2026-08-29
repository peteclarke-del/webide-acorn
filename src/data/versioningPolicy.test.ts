// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderVersioningPolicy, versionedSurfaces } from './versioningPolicy';
import { PROJECT_FORMAT_VERSION } from '../project/project';
import { PROJECT_BUNDLE_VERSION } from '../project/projectBundle';
import { BUILD_TARGET_SCHEMA, TOOLCHAIN_REGISTRY_VERSION } from '../build/buildTarget';
import { EMULATOR_ADAPTER_API_VERSION } from '../emulator/adapterContract';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPath = join(root, 'docs', 'versioning-policy.md');

describe('the versioning policy', () => {
  it('matches the document that is checked in', async () => {
    /* A policy that names version numbers goes stale the first time one of
     * them changes, and a stale policy is a commitment the product no longer
     * keeps, in writing. */
    const expected = renderVersioningPolicy();
    let actual: string | null = null;
    try { actual = await readFile(documentPath, 'utf8'); } catch { actual = null; }
    if (actual !== expected) {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error(`docs/versioning-policy.md ${actual === null ? 'did not exist' : 'was out of date'} and has been written. Review and commit it.`);
    }
    expect(actual).toBe(expected);
  });

  it('takes every version it states from the module that defines it', async () => {
    /* The whole point: these are read from the code, not transcribed. */
    const byName = new Map(versionedSurfaces().map((surface) => [surface.name, surface.version]));
    expect(byName.get('Project document')).toBe(String(PROJECT_FORMAT_VERSION));
    expect(byName.get('Portable project bundle')).toBe(String(PROJECT_BUNDLE_VERSION));
    expect(byName.get('Build target')).toBe(String(BUILD_TARGET_SCHEMA));
    expect(byName.get('Toolchain registry')).toBe(TOOLCHAIN_REGISTRY_VERSION);
    expect(byName.get('Emulator adapter API')).toBe(String(EMULATOR_ADAPTER_API_VERSION));
  });

  it('states what is promised for every surface it lists, with nothing left blank', () => {
    for (const surface of versionedSurfaces()) {
      expect(surface.identifier.trim(), surface.name).not.toBe('');
      expect(surface.version.trim(), surface.name).not.toBe('');
      expect(surface.compatibility.trim().length, surface.name).toBeGreaterThan(40);
    }
  });

  it('says a newer document is refused as newer rather than as broken', () => {
    const text = renderVersioningPolicy();
    expect(text).toContain('A newer document is not a corrupt');
    expect(text).toContain('update the workbench');
  });

  it('says a planned capability is not a deprecation', () => {
    /* Otherwise "planned" could be read as something once offered and
     * withdrawn, which would be a support claim in reverse. */
    expect(renderVersioningPolicy()).toContain('declared `planned` has never been fitted and is not a');
  });

  it('produces the same bytes every time', () => {
    expect(renderVersioningPolicy()).toBe(renderVersioningPolicy());
  });
});
