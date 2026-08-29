import { createDfsImageFromFiles, openDfsImageProject, type CreatedDfsImage, type DfsImageProject } from './dfsImage';

const SECTOR_SIZE = 256;
const SECTORS_PER_TRACK = 10;
const TRACKS_PER_SIDE = 80;
const TRACK_SIZE = SECTOR_SIZE * SECTORS_PER_TRACK;
export const DFS_DSD_IMAGE_SIZE = TRACKS_PER_SIDE * TRACK_SIZE * 2;

export interface DfsDsdProject {
  sides: [DfsImageProject, DfsImageProject];
}

export interface CreatedDfsDsdImage {
  image: Uint8Array;
  sides: [CreatedDfsImage, CreatedDfsImage];
}

/** Splits the conventional track-interleaved 80-track DSD representation into
 * two ordinary 200 KiB logical DFS sides. */
export function splitDfsDsdImage(image: Uint8Array): [Uint8Array, Uint8Array] {
  if (image.length !== DFS_DSD_IMAGE_SIZE) throw new Error('A DFS DSD image must be exactly 400 KiB (80 tracks, 10 sectors, 2 sides)');
  const sides: [Uint8Array, Uint8Array] = [new Uint8Array(DFS_DSD_IMAGE_SIZE / 2), new Uint8Array(DFS_DSD_IMAGE_SIZE / 2)];
  for (let track = 0; track < TRACKS_PER_SIDE; track++) {
    for (let side = 0; side < 2; side++) {
      const source = (track * 2 + side) * TRACK_SIZE;
      sides[side]!.set(image.subarray(source, source + TRACK_SIZE), track * TRACK_SIZE);
    }
  }
  return sides;
}

export function openDfsDsdProject(image: Uint8Array): DfsDsdProject {
  const [side0, side1] = splitDfsDsdImage(image);
  return { sides: [openDfsImageProject(side0), openDfsImageProject(side1)] };
}

/** Writes and validates each logical side independently, interleaves physical
 * tracks, then splits and byte-compares the final DSD as a second boundary. */
export function createDfsDsdImage(project: DfsDsdProject): CreatedDfsDsdImage {
  const sides: [CreatedDfsImage, CreatedDfsImage] = [createDfsImageFromFiles(project.sides[0]), createDfsImageFromFiles(project.sides[1])];
  const image = new Uint8Array(DFS_DSD_IMAGE_SIZE);
  for (let track = 0; track < TRACKS_PER_SIDE; track++) {
    for (let side = 0; side < 2; side++) {
      const source = track * TRACK_SIZE;
      image.set(sides[side]!.image.subarray(source, source + TRACK_SIZE), (track * 2 + side) * TRACK_SIZE);
    }
  }
  const split = splitDfsDsdImage(image);
  if (!split.every((bytes, side) => bytes.every((byte, index) => byte === sides[side]!.image[index]))) throw new Error('Generated DFS DSD failed independent side deinterleave validation');
  openDfsDsdProject(image);
  return { image, sides };
}
