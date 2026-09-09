/*
 * BeebSCSI LUN images, as files rather than as a running drive.
 *
 * A LUN is a pair of files on the board's micro SD card: `scsiN.dat` holds the
 * sectors and `scsiN.dsc` holds the descriptor that says what shape the drive
 * is. Both are documented in the BeebSCSI Technical Guide, which also says the
 * descriptor is byte-for-byte the one BeebEm uses, so a pair prepared for
 * either will work with the other.
 *
 * Everything geometric here follows from two numbers the Acorn world fixed long
 * ago: a sector is 256 bytes, and a track is 33 of them. That is the ACB-4000
 * card Acorn shipped, and Acorn's own formatters still expect it.
 */
import {
  SCSI_DESCRIPTOR_SIZE,
  SCSI_MAX_LUN_SECTORS,
  SCSI_SECTORS_PER_TRACK,
  SCSI_SECTOR_SIZE,
  lunDescriptorFor,
  lunSectorsFromDescriptor,
} from '../emulator/beebScsi';

export { SCSI_DESCRIPTOR_SIZE, SCSI_SECTORS_PER_TRACK, SCSI_SECTOR_SIZE };

/** Bytes in one ACB-4000 track, which is the unit a LUN image is a whole number of. */
export const LUN_TRACK_BYTES = SCSI_SECTORS_PER_TRACK * SCSI_SECTOR_SIZE;

export interface LunGeometry {
  cylinders: number;
  heads: number;
  sectorsPerTrack: number;
  sectorBytes: number;
  sectors: number;
  bytes: number;
}

/** What a descriptor says the drive is. */
export function lunGeometry(descriptor: Uint8Array): LunGeometry {
  const cylinders = ((descriptor[13] ?? 0) << 8) | (descriptor[14] ?? 0);
  const heads = descriptor[15] ?? 0;
  const sectors = lunSectorsFromDescriptor(descriptor);
  return { cylinders, heads, sectorsPerTrack: SCSI_SECTORS_PER_TRACK, sectorBytes: SCSI_SECTOR_SIZE, sectors, bytes: sectors * SCSI_SECTOR_SIZE };
}

/** How big a LUN of this many tracks is, said the way the guide says it. */
export function lunSizeLabel(tracks: number): string {
  const mib = (tracks * LUN_TRACK_BYTES) / (1024 * 1024);
  return `${mib >= 100 ? mib.toFixed(1) : mib.toFixed(2)} MB`;
}

/*
 * The sizes worth offering.
 *
 * A track is 8,448 bytes, which divides no round power of two, so none of these
 * is an exact number of megabytes and the labels say what each one really is.
 * The largest is the Technical Guide's own worked example: 63,536 tracks is
 * 2,096,688 sectors, which is as close to the 21 bit ADFS sector ceiling as a
 * whole number of cylinders gets.
 */
export const LUN_SIZE_CHOICES: Array<{ id: string; tracks: number }> = [
  { id: '8m', tracks: 992 },
  { id: '16m', tracks: 1984 },
  { id: '32m', tracks: 3968 },
  { id: '64m', tracks: 7936 },
  { id: '128m', tracks: 15872 },
  { id: '256m', tracks: 31744 },
  { id: '512m', tracks: 63536 },
];

export interface BlankLunImage {
  descriptor: Uint8Array;
  geometry: LunGeometry;
  /*
   * No sectors, on purpose. The board's own file system creates a LUN as an
   * empty file and lets it grow as the host writes, rather than laying down
   * half a gigabyte of fill nobody reads, and a browser has even better reasons
   * to do the same. A read of a sector that was never written is a read of
   * unwritten space, not an error.
   */
  data: Uint8Array;
}

/** A LUN of a given number of tracks, with the descriptor an ACB-4000 would carry. */
export function createBlankLunImage(tracks: number): BlankLunImage {
  if (!Number.isInteger(tracks) || tracks < 1) throw new Error('A LUN image is a whole number of tracks, and at least one');
  const sectors = tracks * SCSI_SECTORS_PER_TRACK;
  if (sectors > SCSI_MAX_LUN_SECTORS) throw new Error(`ADFS carries a 21 bit sector number, so a LUN holds at most ${SCSI_MAX_LUN_SECTORS.toLocaleString()} sectors`);
  const descriptor = lunDescriptorFor(tracks * LUN_TRACK_BYTES);
  return { descriptor, geometry: lunGeometry(descriptor), data: new Uint8Array(0) };
}

export interface LunImageReport {
  bytes: number;
  descriptor: Uint8Array;
  geometry: LunGeometry;
  /** Reasons the image is not the shape the board expects. Empty means it is. */
  warnings: string[];
}

/**
 * Read a `.dat` and, when there is one, its `.dsc`.
 *
 * An image with no descriptor gets the one the board would build for it, which
 * is the same rule the firmware applies when a `.dat` is copied to the card on
 * its own.
 */
export function describeLunImage(data: Uint8Array, descriptor?: Uint8Array): LunImageReport {
  const warnings: string[] = [];
  if (descriptor && descriptor.length !== SCSI_DESCRIPTOR_SIZE) {
    warnings.push(`A LUN descriptor is ${SCSI_DESCRIPTOR_SIZE} bytes; this one is ${descriptor.length}`);
  }
  const resolved = descriptor && descriptor.length === SCSI_DESCRIPTOR_SIZE ? descriptor : lunDescriptorFor(data.length);
  const geometry = lunGeometry(resolved);

  if (data.length % LUN_TRACK_BYTES !== 0) {
    warnings.push(`An ACB-4000 track is ${LUN_TRACK_BYTES} bytes and this image is not a whole number of them, so its last track is short`);
  }
  if (data.length > geometry.bytes) {
    warnings.push(`The image holds ${data.length.toLocaleString()} bytes and the descriptor claims ${geometry.bytes.toLocaleString()}, so the end of the image is out of reach`);
  }
  if (geometry.sectors > SCSI_MAX_LUN_SECTORS) {
    warnings.push('The descriptor claims more sectors than the 21 bit ADFS sector number can address');
  }
  if (geometry.heads === 0 || geometry.cylinders === 0) {
    warnings.push('The descriptor gives no geometry, so no sector on this LUN can be addressed');
  }
  return { bytes: data.length, descriptor: resolved, geometry, warnings };
}

/** Which LUN a filename names, from the `scsiN.dat` convention the card uses. */
export function lunNumberFromFilename(name: string): number | null {
  const match = /(?:^|[^0-9a-z])scsi([0-7])\.(?:dat|dsc)$/i.exec(name);
  return match ? Number(match[1]) : null;
}
