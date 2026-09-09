import { describe, expect, it } from 'vitest';
import {
  LUN_SIZE_CHOICES,
  LUN_TRACK_BYTES,
  createBlankLunImage,
  describeLunImage,
  lunGeometry,
  lunNumberFromFilename,
  lunSizeLabel,
} from './beebScsiLun';

describe('LUN image geometry', () => {
  it('is built on the ACB-4000 track the Acorn world settled on', () => {
    expect(LUN_TRACK_BYTES).toBe(33 * 256);
  });

  it('offers only sizes that are a whole number of cylinders', () => {
    for (const choice of LUN_SIZE_CHOICES) {
      const blank = createBlankLunImage(choice.tracks);
      expect(blank.geometry.cylinders * blank.geometry.heads, `${choice.id} divides into cylinders`).toBe(choice.tracks);
      expect(blank.geometry.sectors).toBe(choice.tracks * 33);
    }
  });

  it('stays inside the sector number ADFS can carry', () => {
    /* Twenty-one bits, so 2,097,151 sectors. The largest offered is the worked
     * example from the Technical Guide, which stops just under it. */
    const largest = LUN_SIZE_CHOICES.at(-1)!;
    expect(createBlankLunImage(largest.tracks).geometry.sectors).toBe(2_096_688);
    expect(() => createBlankLunImage(70_000)).toThrow(/21 bit/);
  });

  it('says what each size really holds rather than rounding it to a power of two', () => {
    expect(lunSizeLabel(992)).toBe('7.99 MB');
    expect(lunSizeLabel(63_536)).toBe('511.9 MB');
  });

  it('creates a blank LUN with no sectors, because none have been written', () => {
    const blank = createBlankLunImage(32);
    expect(blank.data).toHaveLength(0);
    expect(blank.descriptor).toHaveLength(22);
    expect(blank.geometry.heads).toBe(16);
    expect(blank.geometry.sectors).toBe(32 * 33);
  });

  it('refuses a size that is not a whole number of tracks', () => {
    expect(() => createBlankLunImage(0)).toThrow(/at least one/);
    expect(() => createBlankLunImage(1.5)).toThrow(/whole number of tracks/);
  });
});

describe('reading a LUN image someone brought with them', () => {
  it('builds the descriptor the board would build when there is no .dsc', () => {
    const report = describeLunImage(new Uint8Array(64 * LUN_TRACK_BYTES));
    expect(report.warnings).toEqual([]);
    expect(report.geometry.heads).toBe(16);
    expect(report.geometry.cylinders).toBe(4);
    expect(report.geometry.bytes).toBe(64 * LUN_TRACK_BYTES);
  });

  it('uses the .dsc when there is one, even where it disagrees with the file size', () => {
    /* This is the interesting case rather than an edge one: a LUN image is
     * sparse, so a descriptor claiming more than the file holds is normal and
     * is not a warning. The other way round is. */
    const descriptor = createBlankLunImage(64).descriptor;
    const small = describeLunImage(new Uint8Array(8 * LUN_TRACK_BYTES), descriptor);
    expect(small.geometry.sectors).toBe(64 * 33);
    expect(small.warnings).toEqual([]);

    const large = describeLunImage(new Uint8Array(128 * LUN_TRACK_BYTES), descriptor);
    expect(large.warnings.join(' ')).toMatch(/out of reach/);
  });

  it('says when an image is not a whole number of tracks', () => {
    const report = describeLunImage(new Uint8Array(LUN_TRACK_BYTES + 256));
    expect(report.warnings.join(' ')).toMatch(/whole number of them/);
  });

  it('says when a descriptor is the wrong length rather than reading past it', () => {
    const report = describeLunImage(new Uint8Array(LUN_TRACK_BYTES), new Uint8Array(16));
    expect(report.warnings[0]).toMatch(/22 bytes; this one is 16/);
    /* And it falls back to the descriptor the size implies, so the image is
     * still usable. */
    expect(report.geometry.sectors).toBe(33);
  });

  it('says when a descriptor gives no geometry at all', () => {
    const report = describeLunImage(new Uint8Array(0), new Uint8Array(22));
    expect(report.warnings.join(' ')).toMatch(/no geometry/);
  });

  it('reads the geometry a descriptor states', () => {
    const descriptor = new Uint8Array(22);
    descriptor[13] = 0x01; descriptor[14] = 0x2c; descriptor[15] = 4;
    expect(lunGeometry(descriptor)).toMatchObject({ cylinders: 300, heads: 4, sectors: 300 * 4 * 33 });
  });
});

describe('naming a LUN from its filename', () => {
  it('takes the number out of the card convention', () => {
    expect(lunNumberFromFilename('scsi0.dat')).toBe(0);
    expect(lunNumberFromFilename('BeebSCSI0/scsi3.dat')).toBe(3);
    expect(lunNumberFromFilename('SCSI2.DSC')).toBe(2);
  });

  it('gives nothing for a name that does not follow it, rather than guessing', () => {
    expect(lunNumberFromFilename('mygame.dat')).toBeNull();
    expect(lunNumberFromFilename('scsi8.dat')).toBeNull();
    expect(lunNumberFromFilename('discscsi1.dat')).toBeNull();
  });
});
