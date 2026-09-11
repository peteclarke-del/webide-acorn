/*
 * The project's own description, kept in the folder beside its files.
 *
 * A project written back to a folder was only ever its source files. Which
 * machine it is for, which capabilities are fitted, what its build targets are
 * and what its settings say lived in browser storage and nowhere else, so a
 * folder opened on another day, or on another machine, had its machine guessed
 * from the source and its build targets proposed afresh. A game for a Model B
 * with a second processor, a NuLA and a BeebSID fitted came back as a Model B
 * with a DFS, because nothing in an assembler file says otherwise.
 *
 * So the folder now carries `acorn-project.json`. It holds everything about the
 * project that is not a file, and it refers to files by name because names are
 * what a folder has: the identifiers a project gives its files are assigned
 * when it is opened and mean nothing on disk.
 *
 * It is deliberately not the whole project document. That format carries file
 * contents inline and is what a bundle is for. A manifest beside loose files is
 * for a folder somebody edits with the workbench and with anything else they
 * like, and the files stay files.
 */
import { BUILD_TARGET_SCHEMA, toolchainFor, type BuildTarget } from '../build/buildTarget';
import { validateDiskSet, type DiskSet } from '../media/diskSet';
import { PROJECT_FORMAT, type LocalProject, type ProjectTarget } from './project';

/** The one name the manifest is written under, at the root of the folder. */
export const PROJECT_MANIFEST_FILENAME = 'acorn-project.json';

/**
 * A build target as it is written to the folder: the fields an author would
 * set, with the entry file by name. Anything `migrateBuildTarget` accepts may
 * appear, and anything it does not know is ignored rather than refused, so a
 * manifest written by a later workbench still opens in an earlier one.
 */
export interface ManifestBuildTarget {
  id: string;
  name: string;
  entryFile: string;
  toolchainId: string;
  outputName: string;
  processor?: 'host' | 'parasite';
  buildPolicy?: BuildTarget['buildPolicy'];
  entryPoint?: BuildTarget['entryPoint'];
  memoryLayout?: BuildTarget['memoryLayout'];
  profile?: BuildTarget['profile'];
  sourceFiles?: string[];
  defines?: string[];
  includePaths?: string[];
}

export interface ProjectManifest {
  format: string;
  name: string;
  target: ProjectTarget;
  buildTargets: ManifestBuildTarget[];
  activeBuildTargetId: string | null;
  /** Disk sets as the project holds them, except that a project-file source's
   * `fileId` is the file's name, because a folder has names and not ids. */
  diskSets: DiskSet[];
  settings: Record<string, unknown>;
}

/** A disk set with every project-file source renamed through `rename`. */
function renameDiskSetFiles(set: DiskSet, rename: (fileId: string) => string | undefined): DiskSet | null {
  const raw = JSON.parse(JSON.stringify(set)) as { discs: Array<{ sides: Array<{ entries: Array<{ name: string; source: { kind: string; fileId?: string } }>; boot: { entryId?: string; action: string } }> }> };
  for (const disc of raw.discs) {
    for (const side of disc.sides) {
      side.entries = side.entries.filter((entry) => {
        if (entry.source.kind !== 'project-file') return true;
        const renamed = rename(entry.source.fileId ?? '');
        if (renamed === undefined) return false;
        entry.source.fileId = renamed;
        return true;
      });
    }
  }
  try { return validateDiskSet(raw); } catch { return null; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stringOr = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

/**
 * Read a manifest, refusing what is not one and repairing what is nearly one.
 *
 * A file that is not a project manifest at all is refused with a reason, so an
 * unrelated `acorn-project.json` somebody happened to have does not quietly
 * become the project's machine. A manifest with a field missing gets the
 * default a fresh project would have, because a folder is more useful open
 * with a note than closed with an error.
 */
export function parseProjectManifest(text: string): ProjectManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`${PROJECT_MANIFEST_FILENAME} is not valid JSON`); }
  if (!isRecord(parsed)) throw new Error(`${PROJECT_MANIFEST_FILENAME} is not a JSON object`);
  if (typeof parsed.format !== 'string' || !parsed.format.startsWith('8bit-net-dev-project-')) {
    throw new Error(`${PROJECT_MANIFEST_FILENAME} does not declare an 8bit-net project format`);
  }

  const candidate = isRecord(parsed.target) ? parsed.target : {};
  const platformClass = candidate.platformClass === '32-bit' ? '32-bit' : '8-16-bit';
  const target: ProjectTarget = {
    platformClass,
    machineId: stringOr(candidate.machineId, 'bbc-b'),
    variant: stringOr(candidate.variant, ''),
    romId: stringOr(candidate.romId, ''),
    enabledCapabilities: Array.isArray(candidate.enabledCapabilities)
      ? Array.from(new Set(candidate.enabledCapabilities.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())))
      : [],
  };

  const buildTargets: ManifestBuildTarget[] = (Array.isArray(parsed.buildTargets) ? parsed.buildTargets : []).flatMap((item): ManifestBuildTarget[] => {
    if (!isRecord(item)) return [];
    if (typeof item.entryFile !== 'string' || !item.entryFile.trim()) return [];
    if (typeof item.toolchainId !== 'string' || !toolchainFor(item.toolchainId)) return [];
    const entryFile = item.entryFile.trim().replace(/\\/g, '/');
    const toolchain = toolchainFor(item.toolchainId)!;
    const stem = (entryFile.split('/').pop() ?? entryFile).replace(/\.[^.]+$/, '') || 'program';
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined);
    return [{
      id: stringOr(item.id, entryFile),
      name: stringOr(item.name, `${stem} build`),
      entryFile,
      toolchainId: item.toolchainId,
      outputName: stringOr(item.outputName, `${stem}.${toolchain.language === 'bbc-basic' ? 'bbc' : 'bin'}`),
      ...(item.processor === 'parasite' ? { processor: 'parasite' as const } : {}),
      ...(item.buildPolicy === 'on-save' || item.buildPolicy === 'live' || item.buildPolicy === 'manual' ? { buildPolicy: item.buildPolicy } : {}),
      ...(isRecord(item.entryPoint) && typeof item.entryPoint.value === 'string' && (item.entryPoint.mode === 'source' || item.entryPoint.mode === 'symbol' || item.entryPoint.mode === 'address')
        ? { entryPoint: { mode: item.entryPoint.mode, value: item.entryPoint.value } } : {}),
      ...(isRecord(item.memoryLayout) && typeof item.memoryLayout.defaultOrigin === 'string' && typeof item.memoryLayout.maximumAddress === 'string'
        ? { memoryLayout: { defaultOrigin: item.memoryLayout.defaultOrigin, maximumAddress: item.memoryLayout.maximumAddress } } : {}),
      ...(item.profile === 'debug' || item.profile === 'size' || item.profile === 'speed' || item.profile === 'custom' ? { profile: item.profile } : {}),
      ...(strings(item.sourceFiles) ? { sourceFiles: strings(item.sourceFiles) } : {}),
      ...(strings(item.defines) ? { defines: strings(item.defines) } : {}),
      ...(strings(item.includePaths) ? { includePaths: strings(item.includePaths) } : {}),
    }];
  });

  /* Two targets with one identifier cannot both be active, and the second would
   * silently replace the first. The later one is renamed rather than dropped. */
  const seen = new Set<string>();
  for (const target of buildTargets) {
    let id = target.id;
    let counter = 2;
    while (seen.has(id)) { id = `${target.id}-${counter}`; counter += 1; }
    target.id = id;
    seen.add(id);
  }

  /* A disk set that is not one is dropped whole, as the project parser drops
   * it, rather than partly repaired into a disc that is not what was meant. */
  const diskSets: DiskSet[] = (Array.isArray(parsed.diskSets) ? parsed.diskSets : []).slice(0, 16).flatMap((candidate): DiskSet[] => {
    try { return [validateDiskSet(candidate)]; } catch { return []; }
  });

  return {
    format: parsed.format,
    name: stringOr(parsed.name, ''),
    target,
    buildTargets,
    activeBuildTargetId: typeof parsed.activeBuildTargetId === 'string' && seen.has(parsed.activeBuildTargetId) ? parsed.activeBuildTargetId : null,
    diskSets,
    settings: isRecord(parsed.settings) ? parsed.settings : {},
  };
}

/**
 * The project's disk sets from a manifest, with each project-file source
 * pointed at the file's id. An entry naming a file that is not in the folder
 * is left out and named, since a disc missing a file it declares is worse
 * than a disc without the entry.
 */
export function diskSetsFromManifest(manifest: ProjectManifest, idFor: ReadonlyMap<string, string>): { diskSets: DiskSet[]; dropped: string[] } {
  const dropped: string[] = [];
  const diskSets = (manifest.diskSets ?? []).flatMap((set) => {
    const renamed = renameDiskSetFiles(set, (name) => {
      const id = idFor.get(name) ?? idFor.get(name.toLowerCase());
      if (!id) dropped.push(`${set.name}: ${name} is not in the folder`);
      return id;
    });
    return renamed ? [renamed] : [];
  });
  return { diskSets, dropped };
}

/** The manifest a project would write for itself. */
export function manifestFromProject(project: LocalProject): ProjectManifest {
  const nameOf = new Map(project.files.map((file) => [file.id, file.name]));
  const buildTargets: ManifestBuildTarget[] = project.buildTargets.flatMap((target) => {
    const entryFile = nameOf.get(target.entryFileId);
    if (!entryFile) return [];
    return [{
      id: target.id,
      name: target.name,
      entryFile,
      toolchainId: target.toolchainId,
      outputName: target.outputName,
      ...((target as Partial<BuildTarget> & { processor?: string }).processor === 'parasite' ? { processor: 'parasite' as const } : {}),
      buildPolicy: target.buildPolicy,
      entryPoint: target.entryPoint,
      memoryLayout: target.memoryLayout,
      profile: target.profile,
      sourceFiles: target.sourceFileIds.map((id) => nameOf.get(id)).filter((name): name is string => !!name),
      ...(target.defines.length ? { defines: target.defines } : {}),
      ...(target.includePaths.length && !(target.includePaths.length === 1 && target.includePaths[0] === '.') ? { includePaths: target.includePaths } : {}),
    }];
  });
  const diskSets = project.diskSets.flatMap((set) => {
    const renamed = renameDiskSetFiles(set, (id) => nameOf.get(id));
    return renamed ? [renamed] : [];
  });
  return {
    format: PROJECT_FORMAT,
    name: project.name,
    target: { ...project.target, enabledCapabilities: [...project.target.enabledCapabilities] },
    buildTargets,
    activeBuildTargetId: buildTargets.some((target) => target.id === project.activeBuildTargetId) ? project.activeBuildTargetId : null,
    diskSets,
    settings: { ...project.settings },
  };
}

/** Written with stable key order and a trailing newline, so it diffs like a source file. */
export function serializeProjectManifest(manifest: ProjectManifest): string {
  return `${JSON.stringify({
    format: manifest.format,
    name: manifest.name,
    target: manifest.target,
    buildTargets: manifest.buildTargets,
    activeBuildTargetId: manifest.activeBuildTargetId,
    ...(manifest.diskSets?.length ? { diskSets: manifest.diskSets } : {}),
    settings: manifest.settings,
  }, null, 2)}\n`;
}

/**
 * Turn the manifest's build targets into the author form the project parser
 * migrates, once the folder's files have been given identifiers. A target whose
 * entry file is not in the folder is dropped and named, because a build target
 * for a file that is not there would fail on its first build for a reason that
 * looks like the assembler's.
 */
export function buildTargetsFromManifest(manifest: ProjectManifest, idFor: ReadonlyMap<string, string>): { targets: Array<Record<string, unknown>>; dropped: string[] } {
  const targets: Array<Record<string, unknown>> = [];
  const dropped: string[] = [];
  for (const target of manifest.buildTargets) {
    const entryFileId = idFor.get(target.entryFile) ?? idFor.get(target.entryFile.toLowerCase());
    if (!entryFileId) { dropped.push(`${target.name} (${target.entryFile})`); continue; }
    const sourceFileIds = (target.sourceFiles ?? [target.entryFile]).map((name) => idFor.get(name) ?? idFor.get(name.toLowerCase())).filter((id): id is string => !!id);
    targets.push({
      schemaVersion: BUILD_TARGET_SCHEMA,
      id: target.id,
      name: target.name,
      entryFileId,
      sourceFileIds: Array.from(new Set([...sourceFileIds, entryFileId])),
      toolchainId: target.toolchainId,
      outputName: target.outputName,
      ...(target.processor ? { processor: target.processor } : {}),
      ...(target.buildPolicy ? { buildPolicy: target.buildPolicy } : {}),
      ...(target.entryPoint ? { entryPoint: target.entryPoint } : {}),
      ...(target.memoryLayout ? { memoryLayout: target.memoryLayout } : {}),
      ...(target.profile ? { profile: target.profile } : {}),
      ...(target.defines ? { defines: target.defines } : {}),
      ...(target.includePaths ? { includePaths: target.includePaths } : {}),
    });
  }
  return { targets, dropped };
}
