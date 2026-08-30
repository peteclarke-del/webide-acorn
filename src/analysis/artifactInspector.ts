export type ArtifactSearchMode = 'hex' | 'text';

export interface ArtifactSearchResult {
  pattern: Uint8Array;
  offsets: number[];
  total: number;
  truncated: boolean;
}

export interface ArtifactDifference {
  offset: number;
  left?: number;
  right?: number;
}

export interface ArtifactDiffResult {
  equal: boolean;
  changed: number;
  added: number;
  removed: number;
  differences: ArtifactDifference[];
  truncated: boolean;
}

const MAX_SEARCH_RESULTS = 10_000;
const MAX_DIFF_ROWS = 512;

export function parseArtifactSearch(query: string, mode: ArtifactSearchMode): Uint8Array {
  if (mode === 'text') {
    if (!query.length) return new Uint8Array();
    const bytes = new TextEncoder().encode(query);
    if (bytes.length > 256) throw new Error('Text search is limited to 256 UTF-8 bytes');
    return bytes;
  }
  const compact = query.trim().replaceAll(/(?:0x|&|\$)/gi, '').replaceAll(/[\s,]+/g, '');
  if (!compact) return new Uint8Array();
  if (compact.length > 512) throw new Error('Hex search is limited to 256 bytes');
  if (compact.length % 2 || !/^[0-9a-f]+$/i.test(compact)) throw new Error('Hex search must contain complete byte pairs, for example A9 41 or &A9,&41');
  return Uint8Array.from(compact.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
}

export function searchArtifact(bytes: Uint8Array, query: string, mode: ArtifactSearchMode, maximum = MAX_SEARCH_RESULTS): ArtifactSearchResult {
  const pattern = parseArtifactSearch(query, mode);
  if (!pattern.length || pattern.length > bytes.length) return { pattern, offsets: [], total: 0, truncated: false };
  const offsets: number[] = [];
  let total = 0;
  outer: for (let offset = 0; offset <= bytes.length - pattern.length; offset += 1) {
    for (let index = 0; index < pattern.length; index += 1) if (bytes[offset + index] !== pattern[index]) continue outer;
    total += 1;
    if (offsets.length < maximum) offsets.push(offset);
  }
  return { pattern, offsets, total, truncated: total > offsets.length };
}

export function compareArtifacts(left: Uint8Array, right: Uint8Array, maximum = MAX_DIFF_ROWS): ArtifactDiffResult {
  const differences: ArtifactDifference[] = [];
  let changed = 0; let added = 0; let removed = 0;
  const length = Math.max(left.length, right.length);
  for (let offset = 0; offset < length; offset += 1) {
    const leftByte = left[offset]; const rightByte = right[offset];
    if (leftByte === rightByte) continue;
    if (leftByte === undefined) added += 1;
    else if (rightByte === undefined) removed += 1;
    else changed += 1;
    if (differences.length < maximum) differences.push({ offset, left: leftByte, right: rightByte });
  }
  const total = changed + added + removed;
  return { equal: total === 0, changed, added, removed, differences, truncated: total > differences.length };
}

export function crc32Hex(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function artifactWindowStart(requested: number, length: number, windowBytes = 256): number {
  if (!Number.isFinite(requested) || length <= windowBytes) return 0;
  return Math.min(Math.max(0, Math.floor(requested / 16) * 16), Math.max(0, Math.ceil((length - windowBytes) / 16) * 16));
}
