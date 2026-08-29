/* A disk set: which build artifacts and project files go on which image.
 *
 * Producing a disc by hand each time a build changes is where the real errors
 * live — a stale artifact copied onto a disc, a boot option that names a file
 * nobody put on it, a set that no longer fits. A disk set records the intent
 * instead: the discs, what belongs on each, in what order, and how the machine
 * should start. From that the product can say what needs building, whether it
 * will fit before anything is written, and produce every image in one step.
 *
 * Two rules shape this module.
 *
 * Nothing here invents bytes. A disc is only produced from artifacts and files
 * the caller supplies; a missing or unbuilt source is reported as missing, and
 * the set is refused rather than written with a placeholder.
 *
 * The capacity answer is arithmetic on the real DFS geometry, not an estimate.
 * A DFS side holds 800 sectors of 256 bytes with two reserved for the
 * catalogue, and at most 31 entries. Both limits are checked before writing,
 * and the shortfall is quantified so a user can see how much has to go.
 */
import { createDfsDsdImage, DFS_DSD_IMAGE_SIZE } from './dfsDsdImage';
import { createDfsImageFromFiles, type DfsImageProject, type DfsLogicalFile } from './dfsImage';

export const DISK_SET_SCHEMA = '8bit-net.disk-set';
export const DISK_SET_VERSION = 1;

export const DFS_SECTOR_SIZE = 256;
export const DFS_SECTORS_PER_SIDE = 800;
export const DFS_RESERVED_SECTORS = 2;
export const DFS_MAX_CATALOGUE_ENTRIES = 31;
export const MAX_DISCS_PER_SET = 8;

/** Where a disc entry's bytes come from. Nothing else is accepted. */
export type DiskSetSource =
  | { kind: 'build-target'; targetId: string }
  | { kind: 'project-file'; fileId: string }
  | { kind: 'generated-boot' };

export interface DiskSetEntry {
  id: string;
  /** DFS filename, at most seven printable characters. */
  name: string;
  /** DFS directory character; `$` when not given. */
  directory?: string;
  source: DiskSetSource;
  /** Overrides the artifact's own load and execution addresses when supplied. */
  loadAddress?: number;
  executionAddress?: number;
  locked?: boolean;
}

/** DFS boot options, as the filing system defines them. */
export type DiskSetBootAction = 'none' | 'load' | 'run' | 'exec';

export interface DiskSetBoot {
  action: DiskSetBootAction;
  /** The entry the boot acts on. Required for anything but `none`. */
  entryId?: string;
}

export interface DiskSetSide {
  title: string;
  entries: DiskSetEntry[];
  boot: DiskSetBoot;
}

export interface DiskSetDisc {
  id: string;
  label: string;
  format: 'dfs-ssd' | 'dfs-dsd';
  /** One side for an SSD, two for a DSD. */
  sides: DiskSetSide[];
}

export interface DiskSet {
  readonly schema: typeof DISK_SET_SCHEMA;
  readonly version: typeof DISK_SET_VERSION;
  readonly id: string;
  readonly name: string;
  readonly discs: readonly DiskSetDisc[];
}

const BOOT_OPTION: Record<DiskSetBootAction, number> = { none: 0, load: 1, run: 2, exec: 3 };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function printable(value: string, maximum: number, field: string): string {
  const trimmed = value.trim();
  assert(trimmed.length >= 1 && trimmed.length <= maximum && /^[\x20-\x7e]+$/.test(trimmed), `${field} must be 1 to ${maximum} printable ASCII characters`);
  return trimmed;
}

/** Accept a candidate disk set or say exactly why it is not one. */
export function validateDiskSet(value: unknown): DiskSet {
  assert(value && typeof value === 'object', 'A disk set must be an object');
  const candidate = value as Record<string, unknown>;
  assert(candidate.schema === DISK_SET_SCHEMA, `A disk set must declare schema ${DISK_SET_SCHEMA}`);
  assert(candidate.version === DISK_SET_VERSION, `Disk set version ${DISK_SET_VERSION} is required`);
  assert(typeof candidate.id === 'string' && candidate.id.trim(), 'A disk set needs an identifier');
  const name = printable(String(candidate.name ?? ''), 48, 'Disk set name');
  assert(Array.isArray(candidate.discs) && candidate.discs.length >= 1, 'A disk set must contain at least one disc');
  assert(candidate.discs.length <= MAX_DISCS_PER_SET, `A disk set holds at most ${MAX_DISCS_PER_SET} discs`);

  const discIds = new Set<string>();
  const discs = (candidate.discs as unknown[]).map((raw, discIndex) => {
    assert(raw && typeof raw === 'object', 'Every disc must be an object');
    const disc = raw as Record<string, unknown>;
    assert(typeof disc.id === 'string' && disc.id.trim(), `Disc ${discIndex + 1} needs an identifier`);
    assert(!discIds.has(disc.id), `Two discs share the identifier ${disc.id}`);
    discIds.add(disc.id);
    const label = printable(String(disc.label ?? ''), 48, `Disc ${discIndex + 1} label`);
    assert(disc.format === 'dfs-ssd' || disc.format === 'dfs-dsd', `Disc ${label} must be a single- or double-sided DFS image`);
    const expectedSides = disc.format === 'dfs-dsd' ? 2 : 1;
    assert(Array.isArray(disc.sides) && disc.sides.length === expectedSides, `${label} must declare exactly ${expectedSides} side${expectedSides === 1 ? '' : 's'}`);
    const sides = (disc.sides as unknown[]).map((rawSide, sideIndex) => validateSide(rawSide, `${label} side ${sideIndex}`));
    return { id: disc.id, label, format: disc.format as DiskSetDisc['format'], sides };
  });

  return Object.freeze({
    schema: DISK_SET_SCHEMA, version: DISK_SET_VERSION,
    id: (candidate.id as string).trim(), name,
    discs: Object.freeze(discs.map((disc) => Object.freeze({ ...disc, sides: Object.freeze(disc.sides.map((side) => Object.freeze({ ...side, entries: Object.freeze(side.entries.map((entry) => Object.freeze({ ...entry }))) }))) }))),
  }) as DiskSet;
}

function validateSide(value: unknown, where: string): DiskSetSide {
  assert(value && typeof value === 'object', `${where} must be an object`);
  const side = value as Record<string, unknown>;
  const title = printable(String(side.title ?? ''), 12, `${where} title`);
  assert(Array.isArray(side.entries), `${where} must list its entries`);
  assert((side.entries as unknown[]).length <= DFS_MAX_CATALOGUE_ENTRIES, `${where} lists more than the ${DFS_MAX_CATALOGUE_ENTRIES} entries a DFS catalogue holds`);
  const entryIds = new Set<string>();
  const identities = new Set<string>();
  const entries = (side.entries as unknown[]).map((raw, index) => {
    assert(raw && typeof raw === 'object', `${where} entry ${index + 1} must be an object`);
    const entry = raw as Record<string, unknown>;
    assert(typeof entry.id === 'string' && entry.id.trim(), `${where} entry ${index + 1} needs an identifier`);
    assert(!entryIds.has(entry.id), `${where} uses the entry identifier ${entry.id} twice`);
    entryIds.add(entry.id);
    const name = printable(String(entry.name ?? ''), 7, `${where} entry ${index + 1} name`);
    assert(!/[.\/\\ ]/.test(name), `${name} is not a DFS filename; it must not contain a space, dot or slash`);
    const directory = printable(String(entry.directory ?? '$'), 1, `${where} entry ${name} directory`);
    const identity = `${directory}.${name}`.toUpperCase();
    assert(!identities.has(identity), `${where} would write ${directory}.${name} twice`);
    identities.add(identity);
    const source = entry.source as Record<string, unknown> | undefined;
    assert(source && typeof source === 'object', `${where} entry ${name} must name where its bytes come from`);
    let validated: DiskSetSource;
    if (source.kind === 'build-target') {
      assert(typeof source.targetId === 'string' && source.targetId.trim(), `${where} entry ${name} must name a build target`);
      validated = { kind: 'build-target', targetId: source.targetId };
    } else if (source.kind === 'project-file') {
      assert(typeof source.fileId === 'string' && source.fileId.trim(), `${where} entry ${name} must name a project file`);
      validated = { kind: 'project-file', fileId: source.fileId };
    } else if (source.kind === 'generated-boot') {
      validated = { kind: 'generated-boot' };
    } else {
      throw new Error(`${where} entry ${name} names an unknown source; a disc entry comes from a build target, a project file, or a generated boot file`);
    }
    for (const field of ['loadAddress', 'executionAddress'] as const) {
      if (entry[field] === undefined) continue;
      assert(Number.isInteger(entry[field]) && (entry[field] as number) >= 0 && (entry[field] as number) <= 0x3ffff, `${where} entry ${name} ${field} must be an 18-bit DFS address`);
    }
    return {
      id: entry.id, name, directory, source: validated,
      ...(entry.loadAddress === undefined ? {} : { loadAddress: entry.loadAddress as number }),
      ...(entry.executionAddress === undefined ? {} : { executionAddress: entry.executionAddress as number }),
      ...(entry.locked === undefined ? {} : { locked: Boolean(entry.locked) }),
    };
  });

  const rawBoot = (side.boot ?? { action: 'none' }) as Record<string, unknown>;
  const action = rawBoot.action as DiskSetBootAction;
  assert(action in BOOT_OPTION, `${where} boot action must be none, load, run or exec`);
  const boot: DiskSetBoot = { action, ...(rawBoot.entryId === undefined ? {} : { entryId: String(rawBoot.entryId) }) };
  if (action !== 'none') {
    assert(boot.entryId, `${where} boots with *${action.toUpperCase()} but names no file to act on`);
    assert(entryIds.has(boot.entryId), `${where} boots from ${boot.entryId}, which is not on that side`);
  }
  return { title, entries, boot };
}

/* ---- what has to be built, and whether it fits ---------------------------- */

/**
 * The build targets this set depends on, in the order they are first needed.
 * Deduplicated, so a target used on three discs is built once.
 */
export function diskSetBuildPlan(set: DiskSet): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const disc of set.discs) {
    for (const side of disc.sides) {
      for (const entry of side.entries) {
        if (entry.source.kind !== 'build-target' || seen.has(entry.source.targetId)) continue;
        seen.add(entry.source.targetId);
        ordered.push(entry.source.targetId);
      }
    }
  }
  return ordered;
}

export interface DiskSetSideQuota {
  title: string;
  entries: number;
  entryCapacity: number;
  usedSectors: number;
  sectorCapacity: number;
  usedBytes: number;
  /** Bytes that will not fit; zero when the side fits. */
  overflowBytes: number;
  fits: boolean;
  reasons: string[];
}

/**
 * Whether each side fits, from the real geometry rather than a byte total.
 * DFS allocates whole sectors, so a 1-byte file costs 256 bytes of the disc.
 */
export function diskSetSideQuota(side: DiskSetSide, sizes: ReadonlyMap<string, number>): DiskSetSideQuota {
  const reasons: string[] = [];
  let usedSectors = 0;
  let usedBytes = 0;
  let missing = 0;
  for (const entry of side.entries) {
    const size = sizes.get(entry.id);
    if (size === undefined) { missing += 1; continue; }
    if (size < 1) { reasons.push(`${entry.directory ?? '$'}.${entry.name} has no bytes; DFS cannot hold an empty file`); continue; }
    usedBytes += size;
    usedSectors += Math.ceil(size / DFS_SECTOR_SIZE);
  }
  if (missing) reasons.push(`${missing} entr${missing === 1 ? 'y has' : 'ies have'} no bytes yet, so this side cannot be sized until they are built`);
  const sectorCapacity = DFS_SECTORS_PER_SIDE - DFS_RESERVED_SECTORS;
  if (usedSectors > sectorCapacity) {
    reasons.push(`${usedSectors - sectorCapacity} sector${usedSectors - sectorCapacity === 1 ? '' : 's'} more than the ${sectorCapacity} a DFS side holds after its catalogue`);
  }
  if (side.entries.length > DFS_MAX_CATALOGUE_ENTRIES) {
    reasons.push(`${side.entries.length} files, ${side.entries.length - DFS_MAX_CATALOGUE_ENTRIES} more than a DFS catalogue can name`);
  }
  return {
    title: side.title,
    entries: side.entries.length,
    entryCapacity: DFS_MAX_CATALOGUE_ENTRIES,
    usedSectors,
    sectorCapacity,
    usedBytes,
    overflowBytes: Math.max(0, (usedSectors - sectorCapacity) * DFS_SECTOR_SIZE),
    fits: !missing && !reasons.length,
    reasons,
  };
}

/* ---- producing the images ------------------------------------------------- */

export interface DiskSetResolvedEntry {
  bytes: Uint8Array;
  loadAddress: number;
  executionAddress: number;
}

export interface BuiltDiskSetDisc {
  discId: string;
  label: string;
  format: DiskSetDisc['format'];
  filename: string;
  image: Uint8Array;
  sides: Array<{ title: string; files: number; usedSectors: number }>;
}

export interface BuiltDiskSet {
  set: DiskSet;
  discs: BuiltDiskSetDisc[];
  /** Total bytes across every produced image. */
  totalBytes: number;
}

/**
 * The text of a generated `!BOOT` file: one `*RUN` per named entry, in order.
 * It is plain text with carriage returns, which is what `*EXEC` reads.
 */
export function generatedBootText(side: DiskSetSide): string {
  const commands = side.entries
    .filter((entry) => entry.source.kind !== 'generated-boot')
    .map((entry) => `*RUN ${entry.directory === '$' || !entry.directory ? '' : `${entry.directory}.`}${entry.name}`);
  return commands.length ? `${commands.join('\r')}\r` : '*ECHO No files on this side\r';
}

/**
 * Write every disc in the set. `resolved` supplies the bytes for each entry
 * identifier; an entry with no bytes is refused by name rather than skipped,
 * because a disc missing a file it declares is worse than no disc.
 */
export function buildDiskSet(set: DiskSet, resolved: ReadonlyMap<string, DiskSetResolvedEntry>): BuiltDiskSet {
  const discs: BuiltDiskSetDisc[] = [];
  for (const disc of set.discs) {
    const projects = disc.sides.map((side) => sideProject(disc, side, resolved));
    if (disc.format === 'dfs-dsd') {
      const created = createDfsDsdImage({ sides: [projects[0]!, projects[1]!] });
      discs.push({
        discId: disc.id, label: disc.label, format: disc.format,
        filename: `${safeName(disc.label)}.dsd`, image: created.image,
        sides: created.sides.map((created_, index) => ({ title: disc.sides[index]!.title, files: created_.catalogue.files.length, usedSectors: usedSectors(projects[index]!) })),
      });
      /* The DSD writer already reparses each side; this is the size boundary. */
      if (created.image.length !== DFS_DSD_IMAGE_SIZE) throw new Error(`${disc.label} did not produce a 400 KiB double-sided image`);
      continue;
    }
    const created = createDfsImageFromFiles(projects[0]!);
    discs.push({
      discId: disc.id, label: disc.label, format: disc.format,
      filename: `${safeName(disc.label)}.ssd`, image: created.image,
      sides: [{ title: disc.sides[0]!.title, files: created.catalogue.files.length, usedSectors: usedSectors(projects[0]!) }],
    });
  }
  return { set, discs, totalBytes: discs.reduce((sum, disc) => sum + disc.image.length, 0) };
}

function sideProject(disc: DiskSetDisc, side: DiskSetSide, resolved: ReadonlyMap<string, DiskSetResolvedEntry>): DfsImageProject {
  const files: DfsLogicalFile[] = side.entries.map((entry) => {
    const supplied = resolved.get(entry.id);
    if (!supplied) throw new Error(`${disc.label} declares ${entry.directory ?? '$'}.${entry.name} but no bytes were supplied for it`);
    return {
      name: entry.name,
      directory: entry.directory ?? '$',
      locked: entry.locked ?? false,
      loadAddress: entry.loadAddress ?? supplied.loadAddress,
      executionAddress: entry.executionAddress ?? supplied.executionAddress,
      bytes: supplied.bytes,
    };
  });
  return { title: side.title, bootOption: BOOT_OPTION[side.boot.action], files };
}

function usedSectors(project: DfsImageProject): number {
  return project.files.reduce((sum, file) => sum + Math.ceil(file.bytes.length / DFS_SECTOR_SIZE), 0);
}

function safeName(label: string): string {
  return label.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'disk-set';
}

/** One line describing the set, for the interface and for a build log. */
export function diskSetSummary(set: DiskSet): string {
  const sides = set.discs.reduce((sum, disc) => sum + disc.sides.length, 0);
  const entries = set.discs.reduce((sum, disc) => sum + disc.sides.reduce((count, side) => count + side.entries.length, 0), 0);
  const targets = diskSetBuildPlan(set).length;
  return `${set.discs.length} disc${set.discs.length === 1 ? '' : 's'} · ${sides} side${sides === 1 ? '' : 's'} · ${entries} file${entries === 1 ? '' : 's'} · ${targets} build target${targets === 1 ? '' : 's'}`;
}
