import { describe, expect, it } from 'vitest';
import { ADFS_EXTENSIONS, ADFS_GEOMETRIES, adfsGeometryFor, adfsMountRefusal } from './adfsGeometry';
import { parseAdfsCatalogue } from './adfsCatalogue';

describe('the geometries', () => {
  it('are each a whole number of tracks, as the core computes them', () => {
    /* Taken from the pinned core's own loader table, so the arithmetic has to
     * come out — a geometry whose parts do not multiply to its length would be
     * a transcription error, and the machine would read a different disc from
     * the one this build thinks it mounted. */
    for (const geometry of ADFS_GEOMETRIES) {
      expect(geometry.sectorsPerTrack * geometry.sectorBytes * geometry.sides * geometry.tracks, geometry.id).toBe(geometry.bytes);
    }
  });

  it('has a unique identity and length for each disc', () => {
    expect(new Set(ADFS_GEOMETRIES.map((geometry) => geometry.id)).size).toBe(ADFS_GEOMETRIES.length);
    expect(new Set(ADFS_GEOMETRIES.map((geometry) => geometry.bytes)).size).toBe(ADFS_GEOMETRIES.length);
  });

  it('gives a reason wherever it says a catalogue cannot be listed', () => {
    /* An unreadable catalogue with nothing beside it reads as a broken disc. */
    for (const geometry of ADFS_GEOMETRIES) {
      if (geometry.catalogue.readable) continue;
      expect(geometry.catalogue.reason.length, geometry.id).toBeGreaterThan(80);
      expect(geometry.catalogue.reason, geometry.id).toMatch(/this build|reader/i);
    }
    /* Four of the five are listable today, which is the honest count: S, M and
     * L on the old map and directory, and D or E on the new directory. F is
     * not, and says why. */
    expect(ADFS_GEOMETRIES.filter((geometry) => geometry.catalogue.readable).map((geometry) => geometry.id))
      .toEqual(['adfs-s', 'adfs-m', 'adfs-l', 'adfs-de']);
    /* A geometry that can be listed but carries a caveat says it as a note,
     * never as a reason: a reason is why a disc cannot be read. */
    for (const geometry of ADFS_GEOMETRIES) {
      if (!geometry.catalogue.readable) continue;
      if (geometry.catalogue.note) expect(geometry.catalogue.note.length, geometry.id).toBeGreaterThan(80);
    }
  });
});

describe('identifying an image', () => {
  it('decides by length and narrows by extension, because a name is typed and a length is true', () => {
    expect(adfsGeometryFor('game.adf', 800 * 1024)?.id).toBe('adfs-de');
    expect(adfsGeometryFor('game.adf', 320 * 1024)?.id).toBe('adfs-m');
    expect(adfsGeometryFor('game.adl', 640 * 1024)?.id).toBe('adfs-l');
    expect(adfsGeometryFor('game.adf', 160 * 1024)?.id).toBe('adfs-s');
    expect(adfsGeometryFor('game.adf', 1600 * 1024)?.id).toBe('adfs-f');
  });

  it('refuses a length that is no ADFS disc, naming the lengths that are', () => {
    const refusal = adfsMountRefusal('half.adf', 400 * 1024);
    expect(refusal).toMatch(/409,600 bytes, which is not a whole ADFS disc/);
    expect(refusal).toContain('ADFS D or E · 800 KiB');
    expect(refusal).toContain('ADFS M · 320 KiB');
  });

  it('refuses an extension the core does not read as ADFS at all', () => {
    expect(adfsMountRefusal('picture.png', 800 * 1024)).toMatch(/is not a disc image this build mounts/);
    /* A .adl of a length no .adl ever has is a refusal about that extension. */
    expect(adfsMountRefusal('odd.adl', 800 * 1024)).toMatch(/ADFS L · 640 KiB/);
  });

  it('lets every declared geometry through the mount guard', () => {
    for (const geometry of ADFS_GEOMETRIES) {
      const name = `disc.${geometry.extensions[0]}`;
      expect(adfsMountRefusal(name, geometry.bytes), geometry.id).toBeNull();
    }
    expect(ADFS_EXTENSIONS).toContain('adf');
    expect(ADFS_EXTENSIONS).toContain('adl');
  });
});

describe('what the catalogue reader says about a disc it cannot list', () => {
  it('says an L-sized image is damaged rather than that it cannot read L discs', () => {
    /* An L disc is read now, so an all-zero image of that length is not an
     * unsupported format — it is a disc whose free-space map does not check.
     * Saying the first would send somebody looking for a feature that is there. */
    /* An all-zero image passes the map checksum, because zero is what a sum of
     * zeroes comes to, and is caught by the map disagreeing with the file about
     * how big the disc is. Both halves are checked; this is the one that speaks
     * first for an empty file. */
    expect(() => parseAdfsCatalogue(new Uint8Array(640 * 1024)))
      .toThrow(/ADFS L says it holds 0 bytes and this image is 655,360/);
    const damaged = new Uint8Array(640 * 1024);
    damaged[0xfc] = 0x00; damaged[0xfd] = 0x0a; damaged[0xff] = 0x11;
    expect(() => parseAdfsCatalogue(damaged)).toThrow(/ADFS L free-space map checksum is invalid/);
  });

  it('says an F disc has more than one zone rather than pretending it read one', () => {
    expect(() => parseAdfsCatalogue(new Uint8Array(1600 * 1024)))
      .toThrow(/more than one allocation zone/);
  });

  it('still answers by size when the length is no disc at all', () => {
    expect(() => parseAdfsCatalogue(new Uint8Array(1234)))
      .toThrow(/exactly 800 KiB image, and this is 1,234 bytes/);
  });
});
