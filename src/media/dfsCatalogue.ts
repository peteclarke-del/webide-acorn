export interface DfsFileEntry {
  name: string;
  directory: string;
  locked: boolean;
  loadAddress: number;
  executionAddress: number;
  length: number;
  startSector: number;
}

export interface DfsCatalogue {
  title: string;
  cycle: number;
  bootOption: number;
  declaredSectors: number;
  imageSectors: number;
  files: DfsFileEntry[];
  warnings: string[];
}

const SECTOR_SIZE = 256;
const CATALOGUE_SIZE = SECTOR_SIZE * 2;

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes).replace(/[\0-\x1f\x7f-\xff]/g, ' ').trimEnd();
}

export function parseDfsCatalogue(image: Uint8Array): DfsCatalogue {
  if (image.length < CATALOGUE_SIZE) throw new Error('A DFS SSD image must contain at least two 256-byte catalogue sectors');
  if (image.length % SECTOR_SIZE !== 0) throw new Error('DFS SSD image length must be a whole number of 256-byte sectors');
  const sector0 = image.subarray(0, SECTOR_SIZE);
  const sector1 = image.subarray(SECTOR_SIZE, CATALOGUE_SIZE);
  const entryBytes = sector1[5]!;
  if (entryBytes % 8 !== 0 || entryBytes > 31 * 8) throw new Error('DFS catalogue file-count byte is invalid');
  const fileCount = entryBytes / 8;
  const declaredSectors = ((sector1[6]! & 0x03) << 8) | sector1[7]!;
  const imageSectors = image.length / SECTOR_SIZE;
  const warnings: string[] = [];
  if (!declaredSectors) warnings.push('Catalogue declares zero sectors');
  else if (declaredSectors !== imageSectors) warnings.push(`Catalogue declares ${declaredSectors} sectors but the image contains ${imageSectors}`);

  const files: DfsFileEntry[] = [];
  const identities = new Set<string>();
  const extents: Array<{ identity: string; start: number; end: number }> = [];
  for (let index = 0; index < fileCount; index++) {
    const nameOffset = 8 + index * 8;
    const metadataOffset = 8 + index * 8;
    const directoryByte = sector0[nameOffset + 7]!;
    const extra = sector1[metadataOffset + 6]!;
    const name = ascii(sector0.subarray(nameOffset, nameOffset + 7));
    const directory = String.fromCharCode(directoryByte & 0x7f) || '$';
    const loadAddress = sector1[metadataOffset]! | (sector1[metadataOffset + 1]! << 8) | ((extra & 0x0c) << 14);
    const executionAddress = sector1[metadataOffset + 2]! | (sector1[metadataOffset + 3]! << 8) | ((extra & 0xc0) << 10);
    const length = sector1[metadataOffset + 4]! | (sector1[metadataOffset + 5]! << 8) | ((extra & 0x30) << 12);
    const startSector = sector1[metadataOffset + 7]! | ((extra & 0x03) << 8);
    const identity = `${directory}.${name}`.toUpperCase();
    if (identities.has(identity)) warnings.push(`Duplicate catalogue name ${directory}.${name}`);
    identities.add(identity);
    const extentSectors = Math.ceil(length / SECTOR_SIZE);
    if (extentSectors && startSector < 2) warnings.push(`${directory}.${name} overlaps the DFS catalogue sectors`);
    const endSector = startSector + extentSectors;
    for (const extent of extents) if (extentSectors && startSector < extent.end && endSector > extent.start) warnings.push(`${directory}.${name} overlaps ${extent.identity}`);
    if (extentSectors) extents.push({ identity: `${directory}.${name}`, start: startSector, end: endSector });
    if (declaredSectors && startSector + Math.ceil(length / SECTOR_SIZE) > declaredSectors) warnings.push(`${directory}.${name} extends beyond the declared disk geometry`);
    files.push({ name, directory, locked: (directoryByte & 0x80) !== 0, loadAddress, executionAddress, length, startSector });
  }
  return {
    title: `${ascii(sector0.subarray(0, 8)).padEnd(8, ' ')}${ascii(sector1.subarray(0, 4))}`.trimEnd(),
    cycle: sector1[4]!,
    bootOption: (sector1[6]! >>> 4) & 0x03,
    declaredSectors,
    imageSectors,
    files,
    warnings,
  };
}

export function extractDfsFile(image: Uint8Array, entry: DfsFileEntry): Uint8Array {
  const catalogue = parseDfsCatalogue(image);
  if (!catalogue.files.some((item) => item.name === entry.name && item.directory === entry.directory && item.startSector === entry.startSector && item.length === entry.length)) throw new Error('The selected file entry does not belong to this validated DFS image');
  const start = entry.startSector * SECTOR_SIZE; const end = start + entry.length;
  if (start < CATALOGUE_SIZE || end > image.length) throw new Error(`${entry.directory}.${entry.name} extent is outside the DFS image`);
  return image.slice(start, end);
}
