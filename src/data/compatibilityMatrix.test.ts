// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { machineRows, renderCompatibilityMatrix } from './compatibilityMatrix';
import { machineProfiles } from './machines';
import { ADAPTER_SUPPORT } from '../rom/adapterSupport';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPath = join(root, 'docs', 'compatibility.md');

describe('the compatibility matrix', () => {
  it('matches the document that is checked in', async () => {
    /* A hand-maintained support table is a promise made once and then left
     * behind by the code. This one is generated, and the release gate fails
     * the moment it stops describing what the product does. */
    const expected = renderCompatibilityMatrix();
    let actual: string;
    try { actual = await readFile(documentPath, 'utf8'); }
    catch {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/compatibility.md did not exist and has been written. Commit it.');
    }
    if (actual !== expected) {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/compatibility.md was out of date with the catalogues and has been regenerated. Review and commit it.');
    }
    expect(actual).toBe(expected);
  });

  it('lists every registered machine, and never claims one is runnable that has no engine', () => {
    const rows = machineRows();
    expect(rows).toHaveLength(machineProfiles.length);
    for (const row of rows) {
      if (row.tier === 'runnable') expect(row.engine, row.label).not.toBe('none in this build');
      else expect(row.limitation.trim(), row.label).not.toBe('');
    }
  });

  it('agrees with the adapter support map about what runs', () => {
    /* Two statements about the same thing, so they are checked against each
     * other rather than each being trusted on its own. */
    const runnable = new Set(ADAPTER_SUPPORT.filter((entry) => entry.state === 'runnable').map((entry) => entry.machineId));
    for (const row of machineRows()) {
      expect(row.tier === 'runnable', row.label).toBe(runnable.has(row.id));
    }
  });

  it('separates a planned capability from a fitted one for every machine', () => {
    /* Planned means not fitted. A document that blurred the two would be the
     * false support claim the release gate exists to prevent. */
    for (const row of machineRows()) {
      const machine = machineProfiles.find((candidate) => candidate.id === row.id)!;
      for (const capability of machine.capabilities) {
        const where = capability.state === 'supported' ? row.fitted : capability.state === 'preview' ? row.preview : row.planned;
        expect(where, `${row.label} ${capability.label}`).toContain(capability.label);
      }
      expect([...row.fitted, ...row.preview, ...row.planned]).toHaveLength(machine.capabilities.length);
    }
  });

  it('says plainly that no firmware is distributed', () => {
    expect(renderCompatibilityMatrix()).toContain('No firmware is distributed with this product');
  });

  it('produces the same bytes every time, so the check is on content and not on ordering', () => {
    expect(renderCompatibilityMatrix()).toBe(renderCompatibilityMatrix());
  });
});
