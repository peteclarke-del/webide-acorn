/* Build a viable browser-local project from an existing folder of source.
 *
 * The plan is produced first and shown to the user: every file that will be
 * imported, everything that will be left out and why, every filename that had
 * to change, the entry files and build targets that were inferred, and the
 * editable pixel assets that could be recovered from existing assembler data.
 * Nothing is inferred silently, and nothing that cannot be reproduced byte for
 * byte is offered. */
import { MAX_PROJECT_SOURCE_BYTES, MAX_SOURCE_FILE_BYTES, sourceUtf8ByteLength } from '../editor/sourceTextFormat';
import { DEFAULT_TARGET, languageForFilename, parseProject, PROJECT_FORMAT, type LocalProject, type ProjectFile, type ProjectTarget, type SourceLanguage } from './project';
import { PROJECT_MANIFEST_FILENAME, buildTargetsFromManifest, parseProjectManifest, type ProjectManifest } from './projectManifest';
import { BUILD_TARGET_SCHEMA, defaultToolchainId, toolchainFor, type ToolchainId } from '../build/buildTarget';
import { asciiMapGrid } from '../assets/asciiTileMap';
import { detectPlatform, type DetectedPlatform } from './platformDetection';
import { machineProfiles } from '../data/machines';
import { screenDocumentFromBytes, serializeScreenDocument } from '../assets/screenDocument';
import { screenDumpCandidate, type ScreenDumpCandidate } from '../assets/screenDump';
import type { PaletteModeId } from '../assets/paletteDocument';
import { assemblyByteRuns, pixelAssetCandidates, tileMapCandidates, tileMapFromCandidate, type DerivedPixelAsset, type TileMapCandidate } from '../assets/assemblyPixelData';
import { serializeTileMapDocument } from '../assets/tileMapDocument';
import { normalizeProjectPath } from './safeNames';
import { basenameOf, directoryOf } from './includeResolution';

export const MAX_IMPORT_FILES = 512;

/* Directories that do not contain Acorn project source worth importing. */
const IGNORED_SEGMENTS = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'target', '.vscode', '.idea', '.cache', '__pycache__', 'vendor']);

/* Only text this workbench can genuinely edit is imported. Everything else is
 * reported rather than dropped in silence. */
const TEXT_EXTENSIONS = new Set([
  /* Source the workbench can compile or assemble. */
  'asm', 's', 'a65', '6502', 'inc', 'arm', 'sarm', 'c', 'h', 'bas', 'basic',
  /* Things a project carries alongside its source: metadata, notes, output the
   * toolchain wrote, and the linker and configuration files a build needs. */
  'txt', 'md', 'json', 'inf', 'cfg', 'lst', 'def', 'ld', 'cmd', 'map', 'sym',
  /* How the codebase was built before it arrived here. A project that loses its
   * build script loses the record of how its author built it, which is the one
   * thing nobody can reconstruct from the source. */
  'mk', 'mak', 'make', 'am', 'ac', 'sh', 'bat', 'ps1', 'py', 'pl', 'awk',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'cmake',
]);

/* Files whose whole name is their type. A makefile is the obvious one, and the
 * reason this set exists: an imported codebase arrived without its Makefile
 * because the importer asked for an extension and a makefile has none. */
const EXTENSIONLESS_NAMES = new Set([
  'makefile', 'gnumakefile', 'rakefile', 'justfile', 'dockerfile', 'containerfile',
  'readme', 'license', 'licence', 'copying', 'copyright', 'notice', 'authors',
  'contributors', 'changelog', 'changes', 'news', 'install', 'todo', 'version',
]);

/* A NUL or C0 control run means the file did not decode as text, whatever its
 * extension claims. Tab, newline and carriage return are of course allowed. */
const BINARY_MARKERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export type ImportExclusionReason =
  | 'ignored-directory' | 'unsupported-file-type' | 'not-text' | 'file-too-large'
  | 'project-size-limit' | 'file-count-limit' | 'empty-name' | 'project-manifest';

export interface CodebaseFileInput {
  /** Path relative to the chosen folder, using forward slashes. */
  path: string;
  content: string;
  /**
   * The raw bytes, where the caller kept them. Only a file that is exactly the
   * length of a display mode's frame buffer arrives with these, and it is
   * offered as a screen rather than imported as a source file.
   */
  bytes?: Uint8Array;
}

export interface PlannedImportFile {
  path: string;
  name: string;
  language: SourceLanguage;
  bytes: number;
  /** Present when the flat project name differs from the folder basename. */
  renamedFrom?: string;
  role: 'source' | 'asset' | 'text';
}

export interface ImportExclusion { path: string; reason: ImportExclusionReason; detail: string }

export interface ProposedBuildTarget {
  id: string;
  name: string;
  entryName: string;
  toolchainId: ToolchainId;
  outputName: string;
  language: SourceLanguage;
  /** Why this file was chosen, shown before anything is created. */
  reason: string;
  /** Every file that could have been this target's entry point, best first,
   * each with what was found in it. The inference is a guess made from what a
   * file looks like; the person importing knows which file is the program, so
   * the alternatives are offered rather than the guess being final. */
  candidates: EntryCandidate[];
}

export interface EntryCandidate {
  name: string;
  /** What was found in the file, in the same words the proposal reason uses. */
  reason: string;
}

export interface CodebaseImportPlan {
  name: string;
  files: PlannedImportFile[];
  exclusions: ImportExclusion[];
  targets: ProposedBuildTarget[];
  derivedAssets: DerivedPixelAsset[];
  /** Files that are exactly a frame buffer, offered as screens to recover. */
  screenCandidates: ScreenDumpCandidate[];
  /**
   * Which Acorn this codebase is for, and what it needs fitted, read from the
   * codebase itself. Always present: where nothing names a machine it holds the
   * lowest configuration and says it is a default rather than a finding.
   */
  platform: DetectedPlatform;
  mapCandidates: TileMapCandidate[];
  totalBytes: number;
  warnings: string[];
  /**
   * The project's own description, when the folder carries one. It names the
   * machine, the capabilities, the build targets and the settings, and it is
   * honoured over anything guessed from the source. Null when the folder has
   * none, which is every folder that did not come from this workbench.
   */
  manifest: ProjectManifest | null;
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function isProbablyText(content: string): boolean {
  return !BINARY_MARKERS.test(content.slice(0, 4096));
}

function roleFor(name: string, language: SourceLanguage): PlannedImportFile['role'] {
  if (/\.asset\.json$/i.test(name)) return 'asset';
  return language === 'text' ? 'text' : 'source';
}

/** Names reached by an `INCLUDE` or `INCLUDEASSET` directive, lower-cased. */
function includedNames(files: PlannedImportFile[], contents: Map<string, string>): Set<string> {
  const included = new Set<string>();
  for (const file of files) {
    if (file.language !== '6502' && file.language !== 'arm') continue;
    for (const line of (contents.get(file.name) ?? '').split('\n')) {
      const match = /^\s*INCLUDE(?:ASSET)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i.exec(line);
      if (match) included.add((match[1] ?? match[2] ?? match[3])!.trim().toLowerCase());
    }
  }
  return included;
}

interface EntryScore { file: PlannedImportFile; score: number; reasons: string[] }

function scoreEntry(file: PlannedImportFile, content: string, included: Set<string>): EntryScore {
  const reasons: string[] = [];
  let score = 0;
  if (/^\s*(?:ORG\b|\*\s*=)/im.test(content)) { score += 40; reasons.push('sets an origin'); }
  if (/^\s*(?:int|void)\s+main\s*\(/im.test(content)) { score += 40; reasons.push('defines main()'); }
  if (/^main\.[^.]+$/i.test(basenameOf(file.name))) { score += 30; reasons.push('is named main'); }
  if (/^\s*INCLUDE(?:ASSET)?\s/im.test(content)) { score += 15; reasons.push('includes other files'); }
  if (/^\s*\.(?:start|main|init|entry)\b/im.test(content)) { score += 10; reasons.push('declares a start label'); }
  if (!included.has(file.name.toLowerCase()) && !included.has(basenameOf(file.name).toLowerCase())) { score += 25; reasons.push('is not included by another file'); }
  return { file, score, reasons };
}

function proposeTargets(files: PlannedImportFile[], contents: Map<string, string>): { targets: ProposedBuildTarget[]; warnings: string[] } {
  const warnings: string[] = [];
  const included = includedNames(files, contents);
  const targets: ProposedBuildTarget[] = [];

  for (const language of ['6502', 'arm', 'c'] as const) {
    const candidates = files.filter((file) => file.language === language);
    if (!candidates.length) continue;
    const scored = candidates
      .map((file) => scoreEntry(file, contents.get(file.name) ?? '', included))
      .sort((left, right) => right.score - left.score || left.file.name.localeCompare(right.file.name));
    const best = scored[0]!;
    if (best.score <= 0) { warnings.push(`No ${language} file looked like a build entry, so no ${language} target was proposed.`); continue; }
    const tied = scored.filter((entry) => entry.score === best.score);
    if (tied.length > 1) warnings.push(`${tied.map((entry) => entry.file.name).join(' and ')} scored equally as the ${language} entry file. ${best.file.name} was proposed and can be changed before the project is created.`);
    const stem = basenameOf(best.file.name).replace(/\.[^.]+$/, '') || 'program';
    targets.push({
      id: `import-${language}`,
      name: `${stem} build`,
      entryName: best.file.name,
      toolchainId: defaultToolchainId(language),
      outputName: `${stem}.bin`,
      language,
      reason: best.reasons.length ? `Proposed because it ${best.reasons.join(', ')}.` : 'Proposed as the only candidate.',
      candidates: scored.map((entry) => ({ name: entry.file.name, reason: entry.reasons.length ? `Contains: ${entry.reasons.join(', ')}.` : 'Nothing in it suggests an entry point.' })),
    });
  }

  const basic = files.filter((file) => file.language === 'bbc-basic');
  if (basic.length) {
    const numbered = basic
      .map((file) => ({ file, lines: (contents.get(file.name) ?? '').split('\n').filter((line) => /^\s*\d{1,5}(?:\s|$)/.test(line)).length }))
      .sort((left, right) => right.lines - left.lines || left.file.name.localeCompare(right.file.name));
    const preferred = numbered.find((entry) => /^main\./i.test(basenameOf(entry.file.name))) ?? numbered[0]!;
    if (preferred.lines === 0) warnings.push(`${preferred.file.name} has no numbered BASIC lines, so building it will report line-number diagnostics.`);
    const stem = basenameOf(preferred.file.name).replace(/\.[^.]+$/, '') || 'program';
    targets.push({
      id: 'import-bbc-basic',
      name: `${stem} build`,
      entryName: preferred.file.name,
      toolchainId: '8bit-net.basic.bbc2',
      outputName: `${stem}.bbc`,
      language: 'bbc-basic',
      reason: /^main\./i.test(basenameOf(preferred.file.name)) ? 'Proposed because it is named main.' : `Proposed because it carries the most numbered lines (${preferred.lines}).`,
      candidates: numbered.map((entry) => ({ name: entry.file.name, reason: entry.lines ? `Carries ${entry.lines} numbered line${entry.lines === 1 ? '' : 's'}.` : 'Has no numbered BASIC lines.' })),
    });
  }
  return { targets, warnings };
}

export interface CodebaseImportOptions {
  /**
   * Whether the paths carry the name of the folder that was chosen as their
   * first segment.
   *
   * The two folder routes disagree about this, which is why it is stated rather
   * than guessed. A directory input reports `MyGame/src/main.asm`; the File
   * System Access API reports `src/main.asm` for the same folder, because it
   * walks from the handle. Working it out from the paths alone cannot tell a
   * chosen folder from a project whose files all happen to live under one
   * directory, and getting that wrong throws away a real directory, which is
   * exactly what it did to a project whose sources were all under `src`.
   *
   * Left undefined for an archive, where it genuinely varies: a zip may hold a
   * top-level folder or may not, and the only evidence is the paths.
   */
  pathsIncludeChosenFolder?: boolean;
}

export function planCodebaseImport(inputs: readonly CodebaseFileInput[], folderName = 'Imported project', options: CodebaseImportOptions = {}): CodebaseImportPlan {
  const exclusions: ImportExclusion[] = [];
  const files: PlannedImportFile[] = [];
  const contents = new Map<string, string>();
  const usedNames = new Set<string>();
  const warnings: string[] = [];
  const pathWarnings: string[] = [];
  let totalBytes = 0;

  const ordered = [...inputs].sort((left, right) => left.path.localeCompare(right.path));
  /* Where the paths carry the chosen folder's own name, dropping it keeps the
   * project's top level looking like the folder somebody opened rather than a
   * single directory holding everything. Whether they do is the caller's to
   * say; only an archive is left to the evidence in the paths. */
  const normalizedPaths = ordered.map((input) => input.path.replace(/\\/g, '/').replace(/^\.\//, ''));
  const firstSegments = new Set(normalizedPaths.filter((path) => path.includes('/')).map((path) => path.split('/')[0]!));
  const sharesOneFirstSegment = firstSegments.size === 1 && normalizedPaths.every((path) => path.includes('/'));
  const stripFirstSegment = options.pathsIncludeChosenFolder ?? sharesOneFirstSegment;
  const sharedRoot = stripFirstSegment && sharesOneFirstSegment ? `${[...firstSegments][0]!}/` : '';
  /* The screen the game opens on, which is not text and never was. It is
   * offered rather than imported: nothing in a frame buffer says which display
   * mode it is for, so this only gets as far as saying what it could be. */
  const screenCandidates = ordered
    .flatMap((input) => input.bytes ? [screenDumpCandidate(input.path.replace(/\\/g, '/').replace(/^\.\//, ''), input.bytes) ?? []] : [])
    .flat();

  let manifest: ProjectManifest | null = null;
  for (const input of ordered) {
    const path = input.path.replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = path.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
    const base = segments[segments.length - 1] ?? '';
    if (!base) { exclusions.push({ path, reason: 'empty-name', detail: 'The entry has no filename.' }); continue; }
    /* The folder's own description of the project. It is read, not imported
     * as a source file, and it has to be at the root: a manifest in a
     * subfolder belongs to whatever that subfolder is. */
    const relativeForManifest = sharedRoot && path.startsWith(sharedRoot) ? path.slice(sharedRoot.length) : path;
    if (relativeForManifest === PROJECT_MANIFEST_FILENAME) {
      try {
        manifest = parseProjectManifest(input.content);
        exclusions.push({ path, reason: 'project-manifest', detail: 'Read as the project\'s own description rather than imported as a file.' });
      } catch (error) {
        warnings.push(`${path} was not read as a project manifest: ${error instanceof Error ? error.message : String(error)}`);
        exclusions.push({ path, reason: 'project-manifest', detail: 'Not a manifest this workbench can read, so it was left alone.' });
      }
      continue;
    }
    const ignored = segments.slice(0, -1).find((segment) => IGNORED_SEGMENTS.has(segment) || segment.startsWith('.'));
    if (ignored) { exclusions.push({ path, reason: 'ignored-directory', detail: `Inside ${ignored}.` }); continue; }
    if (base.startsWith('.')) { exclusions.push({ path, reason: 'unsupported-file-type', detail: 'Dot files are not imported.' }); continue; }
    const extension = extensionOf(base);
    const offeredAsScreen = screenCandidates.some((candidate) => candidate.sourceFile === path);
    if (!TEXT_EXTENSIONS.has(extension) && !EXTENSIONLESS_NAMES.has(base.toLowerCase())) { exclusions.push({ path, reason: 'unsupported-file-type', detail: offeredAsScreen ? 'Offered above as a screen to recover, rather than imported as a source file.' : extension ? `.${extension} is not an editable source type.` : 'The file has no extension and is not a name this product recognises, such as Makefile.' }); continue; }
    if (!isProbablyText(input.content)) { exclusions.push({ path, reason: 'not-text', detail: offeredAsScreen ? 'Offered above as a screen to recover, rather than imported as a source file.' : 'The contents did not decode as text.' }); continue; }
    const content = input.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const bytes = sourceUtf8ByteLength(content);
    if (bytes > MAX_SOURCE_FILE_BYTES) { exclusions.push({ path, reason: 'file-too-large', detail: `${bytes.toLocaleString()} bytes exceeds the 1 MiB per-file limit.` }); continue; }
    if (files.length >= MAX_IMPORT_FILES) { exclusions.push({ path, reason: 'file-count-limit', detail: `More than ${MAX_IMPORT_FILES} importable files were offered.` }); continue; }
    if (totalBytes + bytes > MAX_PROJECT_SOURCE_BYTES) { exclusions.push({ path, reason: 'project-size-limit', detail: 'Adding this file would exceed the 8 MiB project total.' }); continue; }

    /* The project keeps the folders the codebase arrived in, because that is
     * what its INCLUDE directives, its build scripts and its author assume.
     * Only the folder that was opened is dropped, and a path the filesystem
     * rule had to change is reported rather than silently altered. */
    const relative = sharedRoot && path.startsWith(sharedRoot) ? path.slice(sharedRoot.length) : path;
    const normalized = normalizeProjectPath(relative);
    let name = normalized.name;
    if (normalized.reason) pathWarnings.push(`${path}: ${normalized.reason}.`);
    let renamed = basenameOf(name) !== base;
    if (usedNames.has(name.toLowerCase())) {
      /* Two files at the same path can only come from an archive, since a
       * filesystem cannot hold them, but the project cannot hold them either. */
      const folder = directoryOf(name);
      let counter = 2;
      do { name = `${folder}${counter}-${basenameOf(normalized.name)}`; counter += 1; } while (usedNames.has(name.toLowerCase()));
      renamed = true;
    }
    usedNames.add(name.toLowerCase());
    const language = languageForFilename(name);
    files.push({ path, name, language, bytes, role: roleFor(name, language), ...(renamed ? { renamedFrom: base } : {}) });
    contents.set(name, content);
    totalBytes += bytes;
  }

  const renamed = files.filter((file) => file.renamedFrom);
  if (renamed.length) warnings.push(`${renamed.length} file${renamed.length === 1 ? '' : 's'} shared a name with another file and ${renamed.length === 1 ? 'was' : 'were'} renamed. Any INCLUDE directive that named ${renamed.length === 1 ? 'it' : 'them'} needs updating.`);
  warnings.push(...pathWarnings);

  /* Targets are proposed from the source only for a folder that does not
   * describe its own. A manifest with build targets is the description, and
   * a warning that two files tied for the entry would be a warning about a
   * guess nobody is going to use. */
  const proposed = proposeTargets(files, contents);
  const targets = proposed.targets;
  const targetWarnings = manifest?.buildTargets.length ? [] : proposed.warnings;
  const runs = files
    .filter((file) => file.language === '6502')
    .flatMap((file) => assemblyByteRuns(file.name, contents.get(file.name) ?? ''));
  const derivedAssets = pixelAssetCandidates(runs, new Set(files.map((file) => file.name.toLowerCase())));
  /* And the maps somebody drew as characters instead of assembling. The path
   * above only ever sees a map once it has been packed into a byte run, so a
   * project that keeps its rooms as text files (which is how most people
   * write one, and how the generator that produced the binary read them) had
   * no maps recovered at all. Only plain text is read this way: an assembler
   * include of EQUB lines is also a rectangle of equal-length lines, and the
   * run above already reads that properly as artwork. */

  /* And not JSON. A serialised document, this product's own sprite or map or
   * anybody else's data, is lines of equal length as often as not, and its
   * pixels array reads as a tall thin room. A drawn map is plain text. */
  const asciiMaps: TileMapCandidate[] = files
    .filter((file) => file.language === 'text' && !/\.json$/i.test(file.name))
    .flatMap((file) => {
      const grid = asciiMapGrid(contents.get(file.name) ?? '');
      if (!grid) return [];
      return [{
        id: `${file.name}:drawn`,
        sourceFile: file.name,
        sourceLabel: (file.name.split('/').pop() ?? file.name).replace(/\.[^.]+$/, ''),
        sourceLine: grid.line,
        byteLength: grid.values.length,
        distinctValues: grid.legend.length,
        values: grid.values,
        /* One shape, because the text says how wide the map is rather than
         * leaving it to be guessed from a byte count. */
        shapes: [{ width: grid.width, height: grid.height }],
        legend: grid.legend,
      }];
    });
  const mapCandidates = [...tileMapCandidates(runs), ...asciiMaps];

  if (!files.length) warnings.push('No editable source file was found in that folder.');
  const platform = detectPlatform(files.map((file) => ({ name: file.name, content: contents.get(file.name) ?? '' })));

  if (manifest) {
    const missing = manifest.buildTargets.filter((target) => !files.some((file) => file.name === target.entryFile || file.name.toLowerCase() === target.entryFile.toLowerCase()));
    for (const target of missing) warnings.push(`${PROJECT_MANIFEST_FILENAME} names a build target, ${target.name}, whose entry file ${target.entryFile} is not in the folder, so it is left out.`);
  }
  return { name: manifest?.name || folderName.trim() || 'Imported project', files, exclusions, targets, derivedAssets, screenCandidates, mapCandidates, platform, totalBytes, warnings: [...warnings, ...targetWarnings], manifest };
}

/**
 * Choose a different entry file for one proposed build target.
 *
 * The plan is returned as a new value rather than mutated, so a dialog can hold
 * the override in state alongside the original and show what changed. The
 * target's name and output are re-derived from the new entry, because a build
 * called `helper build` that assembles `main.asm` names the wrong thing.
 *
 * A file that is not a candidate for this target is refused. Substituting one
 * silently. A file of the wrong language, or one excluded from the import,
 * would produce a project whose build target names a file that is not there.
 */
export function overrideTargetEntry(plan: CodebaseImportPlan, targetId: string, entryName: string): CodebaseImportPlan {
  const target = plan.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`${targetId} is not a proposed build target.`);
  const chosen = target.candidates.find((candidate) => candidate.name === entryName);
  if (!chosen) throw new Error(`${entryName} is not a ${target.language} file in this import, so it cannot be its entry point.`);
  if (target.entryName === entryName) return plan;
  const stem = entryName.replace(/\.[^.]+$/, '') || 'program';
  const extension = target.outputName.replace(/^.*\./, '');
  return {
    ...plan,
    targets: plan.targets.map((candidate) => candidate.id !== targetId ? candidate : {
      ...candidate,
      entryName,
      name: `${stem} build`,
      outputName: `${stem}.${extension}`,
      reason: `Chosen during the import. ${chosen.reason}`,
    }),
  };
}

export interface CodebaseImportSelection {
  /** Identifiers from plan.derivedAssets to create as editable documents. */
  derivedAssetIds?: readonly string[];
  /** Map candidates to promote, each with a grid shape its length allows. */
  derivedMaps?: ReadonlyArray<{ id: string; width: number; height: number }>;
  /** Screens to recover, each with the display mode to read the bytes as. */
  derivedScreens?: ReadonlyArray<{ id: string; mode: PaletteModeId }>;
  projectName?: string;
}

/**
 * The portable document an import produces. Build targets carry only the fields
 * an author would write; the project parser migrates them to the full schema.
 */
export function codebaseImportDocument(
  plan: CodebaseImportPlan,
  contents: ReadonlyMap<string, string>,
  selection: CodebaseImportSelection = {},
) {
  const chosen = new Set(selection.derivedAssetIds ?? []);
  const skipped: string[] = [];
  const identifiers = new Set<string>();
  const idFor = new Map<string, string>();
  const identify = (name: string) => { const id = fileIdentifier(name, identifiers); idFor.set(name, id); return id; };
  const files: ProjectFile[] = plan.files.map((planned) => savedFile(identify(planned.name), planned.name, contents.get(planned.name) ?? '', planned.language));
  const used = new Set(files.map((file) => file.name.toLowerCase()));
  for (const asset of plan.derivedAssets.filter((candidate) => chosen.has(candidate.id))) {
    files.push(savedFile(identify(asset.fileName), asset.fileName, asset.document, 'text'));
    used.add(asset.fileName.toLowerCase());
  }
  /* A promoted map keeps the exact layout that was found and declares every
   * value as a tile index whose artwork has not been chosen, so nothing about
   * the recovered picture is invented. */
  for (const request of selection.derivedMaps ?? []) {
    const candidate = plan.mapCandidates.find((entry) => entry.id === request.id);
    if (!candidate) continue;
    /* One recovery that cannot be made must not cost the whole project. It is
     * left out and named, and everything else still arrives. */
    let document: ReturnType<typeof tileMapFromCandidate>;
    try { document = tileMapFromCandidate(candidate, request.width, request.height); }
    catch (error) { skipped.push(`${candidate.sourceFile} was not recovered as a map: ${error instanceof Error ? error.message : String(error)}`); continue; }
    let fileName = `${document.name}.map.json`;
    let counter = 2;
    while (used.has(fileName.toLowerCase())) { fileName = `${document.name}-${counter}.map.json`; counter += 1; }
    used.add(fileName.toLowerCase());
    files.push(savedFile(identify(fileName), fileName, serializeTileMapDocument(document), 'text'));
  }
  /* A recovered screen is the bytes that were saved, read as the mode that was
   * chosen. Nothing is converted and nothing is guessed: choosing the wrong
   * mode gives a wrong picture rather than a wrong file, and it can be opened
   * again as the other one. */
  for (const request of selection.derivedScreens ?? []) {
    const candidate = plan.screenCandidates.find((entry) => entry.id === request.id);
    if (!candidate || !candidate.modes.includes(request.mode)) continue;
    let document: ReturnType<typeof screenDocumentFromBytes>;
    try { document = screenDocumentFromBytes(candidate.sourceLabel.slice(0, 80), request.mode, candidate.bytes); }
    catch (error) { skipped.push(`${candidate.sourceFile} was not recovered as a screen: ${error instanceof Error ? error.message : String(error)}`); continue; }
    let fileName = `${candidate.sourceLabel}.screen.json`;
    let counter = 2;
    while (used.has(fileName.toLowerCase())) { fileName = `${candidate.sourceLabel}-${counter}.screen.json`; counter += 1; }
    used.add(fileName.toLowerCase());
    files.push(savedFile(identify(fileName), fileName, serializeScreenDocument(document), 'text'));
  }
  /* The folder's own build targets win over the ones proposed from the
   * source. The proposal is a guess about a codebase that arrived without a
   * description; a manifest is the description. */
  const fromManifest = plan.manifest ? buildTargetsFromManifest(plan.manifest, idFor) : null;
  const buildTargets: Array<Record<string, unknown>> = fromManifest && fromManifest.targets.length
    ? fromManifest.targets
    : plan.targets.map((target) => ({
      schemaVersion: BUILD_TARGET_SCHEMA,
      id: target.id,
      name: target.name,
      entryFileId: idFor.get(target.entryName) ?? target.entryName,
      sourceFileIds: [idFor.get(target.entryName) ?? target.entryName],
      toolchainId: target.toolchainId,
      outputName: target.outputName,
    }));
  if (!buildTargets.length && files.length) {
    const first = files.find((file) => file.language !== 'text') ?? files[0]!;
    const language = first.language === 'text' ? '6502' : first.language;
    const toolchainId = defaultToolchainId(language);
    const stem = basenameOf(first.name).replace(/\.[^.]+$/, '') || 'program';
    buildTargets.push({ schemaVersion: BUILD_TARGET_SCHEMA, id: 'import-default', name: `${stem} build`, entryFileId: first.id, sourceFileIds: [first.id], toolchainId, outputName: `${stem}.${toolchainFor(toolchainId)?.language === 'bbc-basic' ? 'bbc' : 'bin'}` });
  }
  return {
    format: PROJECT_FORMAT,
    name: (selection.projectName ?? plan.name).trim() || 'Imported project',
    files,
    /*
     * The machine the codebase is for, rather than a Model B for everything.
     *
     * Every imported project was configured as a BBC B with DFS and sideways
     * RAM whatever it was written for, so an Electron game arrived pointed at
     * the wrong machine and its first build failed for a reason that had
     * nothing to do with the code. What is fitted is what the source shows it
     * needs, and a capability the chosen machine cannot have is dropped rather
     * than carried: a project cannot be set up with hardware that machine never
     * had.
     */
    target: plan.manifest ? plan.manifest.target : targetFor(plan.platform),
    breakpoints: {},
    bookmarks: [],
    buildTargets,
    /* The manifest's choice of active target, where it names one that exists;
     * otherwise the first, as an import with no manifest always had. */
    activeBuildTargetId: plan.manifest?.activeBuildTargetId && buildTargets.some((target) => target.id === plan.manifest!.activeBuildTargetId)
      ? plan.manifest.activeBuildTargetId
      : (buildTargets[0]?.id ?? 'import-default'),
    ...(plan.manifest ? { settings: plan.manifest.settings } : {}),
    activeBuildTargetId: buildTargets[0]?.id ?? 'import-default',
    /* Recoveries that were asked for and could not be made. The project parser
     * ignores this field; the caller reads it and says so. */
    importSkipped: skipped,
    testPlans: [],
    armBreakpoints: {}, armBreakpointGroups: {}, breakpoints6502: {}, breakpointGroups6502: {},
  };
}

/**
 * An imported codebase becomes a project through the same parser as any other
 * project document, so its build targets are migrated to the current schema and
 * nothing partially formed reaches the workbench.
 */
export function projectFromCodebaseImport(
  plan: CodebaseImportPlan,
  contents: ReadonlyMap<string, string>,
  selection: CodebaseImportSelection = {},
): LocalProject {
  return parseProject(JSON.stringify(codebaseImportDocument(plan, contents, selection)));
}

/** The recoveries an import was asked for and could not make, each with why. */
export function skippedRecoveries(
  plan: CodebaseImportPlan,
  contents: ReadonlyMap<string, string>,
  selection: CodebaseImportSelection = {},
): string[] {
  return codebaseImportDocument(plan, contents, selection).importSkipped;
}

/**
 * A file's identity, which is not its path.
 *
 * An imported file used to be identified by its name, which was harmless while
 * names were flat and stopped being so when they kept their folders: the native
 * build service takes a file id as a bounded identifier and refuses a slash, so
 * a project imported with its directories intact could not be built at all. The
 * id is derived from the name so it stays readable and stable, with anything a
 * path may contain and an identifier may not replaced, and a counter where two
 * names would otherwise derive the same one.
 */
export function fileIdentifier(name: string, used: Set<string>): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
  let id = base.slice(0, 80);
  let counter = 2;
  while (used.has(id.toLowerCase())) { id = `${base.slice(0, 74)}-${counter}`; counter += 1; }
  used.add(id.toLowerCase());
  return id;
}

/**
 * The workbench configuration a detected platform asks for.
 *
 * The variant and firmware come from the machine's own catalogue rather than
 * being written out here, so a machine whose models or ROM sets change does not
 * leave this holding a name nothing recognises.
 */
/**
 * What the codebase needs that this machine cannot currently be given.
 *
 * Detection can find that a program wants a Plus 3 and a disc filing system;
 * whether the workbench can fit one is a separate question, and the answer is
 * usually a ROM the firmware vault does not hold. Reporting the gap is the
 * useful half: it tells somebody exactly which firmware to supply, instead of
 * leaving them with a machine that quietly lacks what the program assumes.
 */
export function fittingGaps(platform: DetectedPlatform): Array<{ id: string; label: string; needs: string; because: string }> {
  const profile = machineProfiles.find((candidate) => candidate.id === platform.machineId);
  if (!profile) return [];
  return platform.capabilities.flatMap((entry) => {
    const capability = profile.capabilities.find((candidate) => candidate.id === entry.id);
    /* A need this machine's catalogue does not model at all (a joystick on a
     * Model B, ADFS on an Electron) was being dropped, which loses exactly the
     * thing worth saying: the program wants hardware this machine, as this
     * product knows it, does not offer. */
    if (!capability) {
      return [{
        id: entry.id,
        label: entry.id,
        needs: `hardware ${profile.label} does not offer in this workbench, so the program may expect a machine or expansion that is not modelled here`,
        because: entry.because.what,
      }];
    }
    if (capability.state === 'supported') return [];
    return [{
      id: entry.id,
      label: capability.label,
      needs: capability.requirement ?? `${capability.label} is ${capability.state} on this machine`,
      because: entry.because.what,
    }];
  });
}

export function targetFor(platform: DetectedPlatform): ProjectTarget {
  const profile = machineProfiles.find((candidate) => candidate.id === platform.machineId);
  if (!profile) return DEFAULT_TARGET;
  /*
   * Only capabilities this machine actually has, and only the ones it can
   * really run. A capability the catalogue marks planned is one whose firmware
   * this product does not hold, so switching it on because the source mentions
   * it would set up a machine that cannot start.
   */
  const usable = new Set(profile.capabilities.filter((capability) => capability.state === 'supported').map((capability) => capability.id));
  const fitted = platform.capabilities.map((entry) => entry.id).filter((id) => usable.has(id));
  /* Whatever the machine has without anything being fitted stays on. */
  const standard = profile.capabilities.filter((capability) => capability.defaultEnabled).map((capability) => capability.id);
  return {
    platformClass: profile.platformClass,
    machineId: profile.id,
    variant: profile.variants[0] ?? DEFAULT_TARGET.variant,
    romId: profile.roms[0]?.id ?? DEFAULT_TARGET.romId,
    enabledCapabilities: [...new Set([...standard, ...fitted])],
  };
}

function savedFile(id: string, name: string, content: string, language: SourceLanguage): ProjectFile {
  return {
    id, name, content, language,
    encoding: 'utf-8', lineEnding: 'lf', modified: false, saved: true,
    savedName: name, savedContent: content, savedEncoding: 'utf-8', savedLineEnding: 'lf',
    kind: 'authored', access: 'editable',
  };
}
