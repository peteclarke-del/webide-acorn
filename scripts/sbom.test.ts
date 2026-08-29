// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyLicence, licencesNeedingReview, readLockfile, renderSbom, sbomSummary } from './sbom.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let lockfile: { packages?: Record<string, Record<string, unknown>> } = {};

beforeAll(async () => { lockfile = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')); });

describe('classifying a licence expression', () => {
  it('recognises the permissive licences a bundle can carry without conditions', () => {
    for (const licence of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'Zlib']) {
      expect(classifyLicence(licence), licence).toBe('permissive');
    }
  });

  it('recognises copyleft, including the -only and -or-later spellings', () => {
    /* Missing a spelling means missing an obligation, and `LGPL-3.0-or-later`
     * is the spelling npm actually publishes. */
    for (const licence of ['GPL-2.0', 'GPL-3.0-or-later', 'LGPL-3.0-or-later', 'AGPL-3.0-only', 'MPL-2.0']) {
      expect(classifyLicence(licence), licence).toBe('copyleft');
    }
  });

  it('reads OR as satisfied by its most permissive arm', () => {
    expect(classifyLicence('(MIT OR GPL-3.0)')).toBe('permissive');
    expect(classifyLicence('GPL-2.0 OR LGPL-3.0')).toBe('copyleft');
  });

  it('reads AND as binding every arm at once', () => {
    /* This is the one that matters: an AND expression is copyleft the moment
     * one arm is, and treating it as permissive because another arm is MIT
     * would drop a real obligation. */
    expect(classifyLicence('(MIT AND Zlib)')).toBe('permissive');
    expect(classifyLicence('Apache-2.0 AND LGPL-3.0-or-later AND MIT')).toBe('copyleft');
  });

  it('says undetermined when nothing was recorded, which is not the same as none', () => {
    expect(classifyLicence(null)).toBe('undetermined');
    expect(classifyLicence('  ')).toBe('undetermined');
  });

  it('refuses to assume an expression it does not recognise is safe', () => {
    expect(classifyLicence('SEE LICENSE IN LICENCE.txt')).toBe('other');
    expect(classifyLicence('Custom-Commercial-1.0')).toBe('other');
  });
});

describe('deciding what is actually distributed', () => {
  const lock = {
    packages: {
      '': { name: 'root' },
      'node_modules/shipped': { version: '1.0.0', license: 'MIT' },
      'node_modules/tooling': { version: '1.0.0', license: 'MIT', dev: true },
      'node_modules/native': { version: '1.0.0', license: 'LGPL-3.0-or-later', hasInstallScript: true },
      'node_modules/@img/platform': { version: '1.0.0', license: 'LGPL-3.0-or-later', optional: true, os: ['linux'], cpu: ['x64'] },
      'node_modules/optional-extra': { version: '1.0.0', license: 'GPL-3.0-or-later', optional: true },
    },
  };

  it('excludes a native module and a per-platform binary that the build does not contain', () => {
    /* The lockfile's development flag was not enough on its own: a native
     * image library arrives as a runtime dependency and brings copyleft
     * platform binaries that no browser bundle can contain. */
    const entries = readLockfile(lock, new Set());
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    expect(byName.get('native')!.shipped).toBe(false);
    expect(byName.get('native')!.excludedBecause).toMatch(/native module/i);
    expect(byName.get('@img/platform')!.shipped).toBe(false);
    expect(byName.get('@img/platform')!.excludedBecause).toMatch(/per-platform binary/i);
    expect(byName.get('optional-extra')!.excludedBecause).toMatch(/optional dependency/i);
  });

  it('keeps a package distributed when it is present in the built output', () => {
    /* Evidence of presence beats the reason it might have been excluded. */
    const entries = readLockfile(lock, new Set(['native']));
    expect(entries.find((entry) => entry.name === 'native')!.shipped).toBe(true);
  });

  it('treats an ordinary package as distributed, so an unproven case over-reports', () => {
    const entries = readLockfile(lock, new Set());
    expect(entries.find((entry) => entry.name === 'shipped')!.shipped).toBe(true);
    expect(entries.find((entry) => entry.name === 'tooling')!.shipped).toBe(false);
    expect(entries.find((entry) => entry.name === 'tooling')!.development).toBe(true);
  });

  it('never counts the project itself as a dependency of itself', () => {
    expect(readLockfile(lock, new Set()).some((entry) => entry.name === 'root')).toBe(false);
  });
});

describe('the report on this project', () => {
  it('adds up', () => {
    const entries = readLockfile(lockfile, new Set());
    const summary = sbomSummary(entries);
    expect(summary.total).toBe(entries.length);
    expect(summary.shipped + summary.development + summary.installedNotDistributed).toBe(summary.total);
    expect(summary.shippedPermissive + summary.shippedCopyleft + summary.shippedUndetermined + summary.shippedOther).toBe(summary.shipped);
  });

  it('records an integrity hash for everything installed from a registry', () => {
    /* Without one, a package cannot be verified as being what it was when the
     * lockfile was written. */
    expect(sbomSummary(readLockfile(lockfile, new Set())).withoutIntegrity).toBe(0);
  });

  it('names every shipped copyleft dependency rather than counting it', () => {
    const entries = readLockfile(lockfile, new Set(['jsbeeb']));
    const review = licencesNeedingReview(entries);
    const report = renderSbom(entries, null);
    for (const entry of review) expect(report, entry.name).toContain(entry.name);
    /* The emulator core is GPL-3.0-or-later and is in the built output, which
     * is a real obligation on distributing the workbench and is recorded
     * rather than discovered later. */
    expect(review.map((entry) => entry.name)).toContain('jsbeeb');
  });

  it('says what it does not cover, so the vendored cores are not assumed absent', () => {
    const report = renderSbom(readLockfile(lockfile, new Set()), null);
    expect(report).toContain('third-party-components.md');
    expect(report).toMatch(/GPL-2\.0/);
  });

  it('produces the same bytes every time', () => {
    const entries = readLockfile(lockfile, new Set());
    expect(renderSbom(entries, null)).toBe(renderSbom(entries, null));
  });
});
