import { describe, expect, it } from 'vitest';
import { describeMountedMedia, mediaLocation, type MachineMedia } from './machineMedia';

/*
 * Where the workbench says a piece of media is.
 *
 * This existed as a two-way test in two places, `disc or else cassette`, and
 * the moment there was a third kind it told somebody that a BeebSCSI LUN image
 * was mounted in the cassette input. The wording is one function now, and these
 * are the three answers.
 */

const disc: MachineMedia = { kind: 'disc', name: 'game.ssd', size: 204_800, drive: 1 };
const tape: MachineMedia = { kind: 'tape', name: 'game.uef', size: 40_960, format: 'UEF' };
const lun: MachineMedia = { kind: 'scsi-lun', name: 'scsi0.dat', size: 0, lun: 0 };

describe('saying where mounted media is', () => {
  it('puts a disc in a drive, by its number', () => {
    expect(mediaLocation(disc)).toBe('drive 1');
    expect(describeMountedMedia(disc)).toBe('game.ssd is mounted in the live drive 1; the emulator acknowledged 204,800 bytes.');
  });

  it('puts a cassette in the cassette input', () => {
    expect(mediaLocation(tape)).toBe('cassette');
    expect(describeMountedMedia(tape)).toBe('game.uef is mounted in the live cassette input; the emulator acknowledged 40,960 bytes.');
  });

  it('puts a LUN image on the card, and does not call it a cassette', () => {
    expect(mediaLocation(lun)).toBe('LUN 0');
    const said = describeMountedMedia(lun);
    expect(said).toContain('BeebSCSI card');
    expect(said).toContain('LUN 0');
    expect(said).not.toContain('cassette');
    expect(said).not.toContain('drive');
  });

  it('says a blank LUN holds nothing yet rather than that nothing was accepted', () => {
    /* A LUN image is sparse, so zero bytes is the normal state of a new one.
     * "acknowledged 0 bytes" would read as a failure. */
    expect(describeMountedMedia(lun)).toContain('holds 0 bytes and grows as the machine writes to it');
    expect(describeMountedMedia(lun)).not.toContain('acknowledged');
  });

  it('reports what a written LUN now holds', () => {
    expect(describeMountedMedia({ ...lun, size: 270_336, revision: 3 })).toContain('holds 270,336 bytes');
  });

  it('gives every kind a location and a sentence, so none can fall through', () => {
    for (const item of [disc, tape, lun]) {
      expect(mediaLocation(item), item.kind).not.toBe('');
      expect(describeMountedMedia(item), item.kind).toContain(item.name);
    }
  });
});
