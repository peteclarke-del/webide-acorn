import { describe, expect, it } from 'vitest';
import { extractDfsFile } from './dfsCatalogue';
import { createDfsDsdImage, DFS_DSD_IMAGE_SIZE, openDfsDsdProject, splitDfsDsdImage } from './dfsDsdImage';

describe('track-interleaved DFS DSD images', () => {
  it('writes, splits and reopens two independently catalogued sides byte-exactly', () => {
    const side0Bytes = Uint8Array.from({ length: 300 }, (_, index) => index & 0xff);
    const side1Bytes = Uint8Array.from({ length: 521 }, (_, index) => (index * 13) & 0xff);
    const created = createDfsDsdImage({ sides: [
      { title: 'SIDE ZERO', cycle: 7, bootOption: 2, files: [{ name: 'GAME', loadAddress: 0x1900, executionAddress: 0x1900, bytes: side0Bytes }] },
      { title: 'SIDE ONE', cycle: 9, bootOption: 3, files: [{ name: '!BOOT', locked: true, loadAddress: 0xffff, executionAddress: 0xffff, bytes: side1Bytes }] },
    ] });
    expect(created.image).toHaveLength(DFS_DSD_IMAGE_SIZE);
    const opened = openDfsDsdProject(created.image);
    expect(opened.sides[0]).toMatchObject({ title: 'SIDE ZERO', cycle: 7, bootOption: 2, files: [{ name: 'GAME' }] });
    expect(opened.sides[1]).toMatchObject({ title: 'SIDE ONE', cycle: 9, bootOption: 3, files: [{ name: '!BOOT', locked: true }] });
    const split = splitDfsDsdImage(created.image);
    expect(extractDfsFile(split[0], created.sides[0].catalogue.files[0]!)).toEqual(side0Bytes);
    expect(extractDfsFile(split[1], created.sides[1].catalogue.files[0]!)).toEqual(side1Bytes);
  });

  it('supports a valid empty side and rejects ambiguous geometry', () => {
    const created = createDfsDsdImage({ sides: [
      { title: 'USED', files: [{ name: 'ONE', loadAddress: 0, executionAddress: 0, bytes: Uint8Array.of(1) }] },
      { title: 'EMPTY', files: [] },
    ] });
    expect(openDfsDsdProject(created.image).sides[1].files).toEqual([]);
    expect(() => splitDfsDsdImage(created.image.subarray(0, created.image.length - 1))).toThrow('exactly 400 KiB');
  });
});
