// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderFirmwareMatrix } from './firmwareMatrix';
import { ROM_SETS, romStorageKey } from './romProfiles';
import { ARCHIMEDES_ROM_PROFILES } from './archimedesRom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPath = join(root, 'docs', 'firmware.md');

describe('the firmware matrix', () => {
  it('matches the document that is checked in', async () => {
    /* A hand-maintained firmware table is a promise made once and left behind
     * by the manifests. This one is generated, and the gate fails the moment it
     * stops describing what the product asks for. */
    const expected = renderFirmwareMatrix();
    let actual: string;
    try { actual = await readFile(documentPath, 'utf8'); }
    catch {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/firmware.md did not exist and has been written. Commit it.');
    }
    if (actual !== expected) {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error('docs/firmware.md was out of date with the manifests and has been regenerated. Review and commit it.');
    }
    expect(actual).toBe(expected);
  });

  it('names every ROM of every set, and the key each is stored under', () => {
    const document = renderFirmwareMatrix();
    for (const set of ROM_SETS) {
      expect(document, set.id).toContain(set.label);
      for (const requirement of set.requirements) {
        expect(document, `${set.id}/${requirement.id}`).toContain(requirement.label);
        expect(document, `${set.id}/${requirement.id}`).toContain(romStorageKey(set.id, requirement));
      }
    }
  });

  it('says of every optional ROM which capability needs it', () => {
    /* An optional ROM with nothing beside it reads as one nobody needs, which
     * is the opposite of true: it is needed exactly when its capability is on. */
    for (const set of ROM_SETS) {
      for (const requirement of set.requirements) {
        if (requirement.required) continue;
        expect(requirement.requiredByCapability, `${set.id}/${requirement.id}`).toBeTruthy();
      }
    }
    expect(renderFirmwareMatrix()).toContain('needed for');
  });

  it('names every Archimedes profile with its four lanes and its CMOS', () => {
    const document = renderFirmwareMatrix();
    for (const profile of ARCHIMEDES_ROM_PROFILES) {
      expect(document, profile.id).toContain(profile.label);
      expect(profile.laneFilenames, profile.id).toHaveLength(4);
      for (const lane of profile.laneFilenames) expect(document, profile.id).toContain(lane);
      expect(document, profile.id).toContain(profile.cmosFilename);
    }
  });

  it('states the position on redistribution, ownership and hashing rather than implying it', () => {
    const document = renderFirmwareMatrix();
    expect(document).toContain('It never ships any');
    expect(document).toContain('Ownership does not change');
    expect(document).toContain('origin-private');
    /* And it says what it does not check, which is the part a reader would
     * otherwise assume: a manifest that checks length is not checking content. */
    expect(document).toContain('It is not a hash');
    expect(document).toContain('Accepted digests');
  });

  it('says a run without firmware is a run that did not happen', () => {
    /* The alternative — a substitute image, or a quiet ROM-less mode — would
     * make a pipeline report a pass for a machine it never started. */
    expect(renderFirmwareMatrix()).toContain('a run without firmware is reported as a run');
  });
});
