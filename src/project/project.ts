export type SourceLanguage = 'bbc-basic' | '6502' | 'arm' | 'c' | 'text';
import { detectLineEnding, MAX_PROJECT_SOURCE_BYTES, MAX_SOURCE_FILE_BYTES, sourceUtf8ByteLength, type SourceEncoding, type SourceLineEnding } from '../editor/sourceTextFormat';
import { validateMachineTapCode } from '../emulator/keyboardInputModel';
import { MAX_SCREEN_GOLDENS, validateScreenGolden, type ScreenGolden } from '../testing/screenAssertion';

export interface ProjectFile {
  id: string;
  name: string;
  content: string;
  language: SourceLanguage;
  encoding?: SourceEncoding;
  lineEnding?: SourceLineEnding;
  modified: boolean;
  saved?: boolean;
  savedName?: string;
  savedContent?: string;
  savedEncoding?: SourceEncoding;
  savedLineEnding?: SourceLineEnding;
  kind?: 'authored' | 'imported' | 'generated';
  access?: 'editable' | 'read-only';
  generator?: string;
}

export interface SourceBookmark {
  id: string;
  fileId: string;
  line: number;
  column: number;
  name: string;
  description: string;
  scope: 'project' | 'private';
  enabled: boolean;
  anchor: string;
  orphaned?: boolean;
}

export interface TargetTestPlan {
  schemaVersion: 2;
  id: string;
  targetId: string;
  name: string;
  suite: string;
  setup: { reset: 'hard' | 'soft' | 'none'; media: 'retain' | 'eject' };
  inputs: Array<
    | { kind: 'delay'; cycles: number }
    | { kind: 'key'; code: string; pressed: boolean }
    | { kind: 'gamepad'; action: 'up' | 'down' | 'left' | 'right' | 'fire1' | 'fire2'; code: number; pressed: boolean }
    | { kind: 'bbc-analogue'; channels: [number, number, number, number]; buttons: [boolean, boolean] }
    | { kind: 'bbc-mouse'; x: number; y: number; buttons: [boolean, boolean] }
    | { kind: 'atom-atommc'; up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean }
    | { kind: 'media'; action: 'eject-disc-0' | 'eject-disc-1' | 'eject-tape' | 'mount-initial-disc-0' | 'mount-initial-disc-1' | 'mount-initial-tape' }
    | { kind: 'emulator-event'; event: 'next-video-frame' }
    | { kind: 'reset'; reset: 'hard' | 'soft' }
  >;
  stop: string;
  assertions: string;
  screenGoldens: ScreenGolden[];
  cycleBudget: number;
  captures: Array<
    | { id: string; kind: 'registers' }
    | { id: string; kind: 'memory'; address: string; length: number }
  >;
  teardown: { action: 'pause' | 'reset' };
  enabled: boolean;
}

export interface PersistedArmBreakpointIntent {
  id: string;
  expression: string;
  enabled: boolean;
  hitTarget?: number;
  conditions: Array<{ register: number; operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; expression: string }>;
  action: 'pause' | 'log' | 'pause-log';
  logMessage?: string;
  groupId?: string;
  resolutionHistory?: ArmBreakpointResolutionRecord[];
}

export interface ArmBreakpointGroup { id: string; name: string; enabled: boolean }
export interface ArmBreakpointResolutionRecord { requestedExpression: string; buildFingerprint: string; address: number | null; verification: 'resolved' | 'rejected'; reason: string }

export interface Persisted6502BreakpointIntent {
  id: string;
  expression: string;
  enabled: boolean;
  condition?: { register: 'a' | 'x' | 'y' | 's' | 'p' | 'pc'; operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; expression: string };
  hitTarget?: number;
  action: 'pause' | 'log' | 'pause-log';
  logMessage?: string;
  groupId?: string;
  resolutionHistory?: Breakpoint6502ResolutionRecord[];
}

export interface Breakpoint6502Group { id: string; name: string; enabled: boolean }
export interface Breakpoint6502ResolutionRecord { requestedExpression: string; buildFingerprint: string; address: number | null; verification: 'resolved' | 'rejected'; reason: string }

import { validateAnalysisAnnotations, type AnalysisAnnotations } from '../analysis/analysisAnnotations';
import { validateDiskSet, type DiskSet } from '../media/diskSet';
import { settingDescriptor } from '../settings/settings';
import { validateTrash, type TrashedFile } from './projectTrash';
import { buildToolchainUpdate, createBuildTarget, defaultToolchainId, migrateBuildTarget, toolchainFor, type BuildTarget } from '../build/buildTarget';
import { normalizeProjectPath } from './safeNames';

export interface LocalProject {
  format: '8bit-net-dev-project-21';
  name: string;
  files: ProjectFile[];
  target: ProjectTarget;
  breakpoints: Record<string, number[]>;
  bookmarks: SourceBookmark[];
  buildTargets: BuildTarget[];
  activeBuildTargetId: string;
  testPlans: TargetTestPlan[];
  armBreakpoints: Record<string, PersistedArmBreakpointIntent[]>;
  armBreakpointGroups: Record<string, ArmBreakpointGroup[]>;
  breakpoints6502: Record<string, Persisted6502BreakpointIntent[]>;
  breakpointGroups6502: Record<string, Breakpoint6502Group[]>;
  /* Static-analysis annotations, keyed by the SHA-256 of the bytes they
   * describe rather than by a file name, so a binary keeps what a reader
   * learned about it however it is reached: from the media browser, a host
   * file, or a build artifact. */
  analysisAnnotations: Record<string, AnalysisAnnotations>;
  /* Disk sets: which build artifacts and project files go on which image, in
   * what order, and how the machine should start from them. */
  diskSets: DiskSet[];
  /* Settings this project carries, overriding the person's own for as long as
   * it is open. Keyed by setting identifier; a value the schema refuses is
   * dropped on the way in rather than applied. */
  settings: Record<string, unknown>;
  /* Files deleted from this project, with what was removed alongside them, so
   * a deletion can be undone rather than only confirmed. */
  trash: TrashedFile[];
}

export interface ProjectTarget {
  platformClass: '8-16-bit' | '32-bit';
  machineId: string;
  variant: string;
  romId: string;
  enabledCapabilities: string[];
}

/* The project document's schema version.
 *
 * Every version this product has ever written is still readable, so the number
 * only goes up and the acceptance rule is derived from it rather than restated.
 * It used to be two hand-maintained lists of every version string, which is a
 * shape that drifts: bumping the version meant remembering to extend both, and
 * a missed entry would reject a document the product had itself written.
 *
 * A version this build does not know is refused with the number it saw, rather
 * than parsed as though the fields it does not contain were simply absent. A
 * newer document is not a corrupt one, and saying so is the difference between
 * "update the workbench" and "your project is broken".
 */
export const PROJECT_FORMAT_VERSION = 21;
const PROJECT_FORMAT_PREFIX = '8bit-net-dev-project-';
export const PROJECT_FORMAT = `${PROJECT_FORMAT_PREFIX}${PROJECT_FORMAT_VERSION}`;

/** The version number of a project format string, or null if it is not one. */
export function projectFormatVersion(format: unknown): number | null {
  if (typeof format !== 'string' || !format.startsWith(PROJECT_FORMAT_PREFIX)) return null;
  const digits = format.slice(PROJECT_FORMAT_PREFIX.length);
  if (!/^[1-9][0-9]{0,3}$/.test(digits)) return null;
  return Number(digits);
}

/* The version at which files began carrying their saved baseline, so an older
 * document's absent baseline is taken from its current content rather than
 * being read as an unsaved edit. */
const SAVED_BASELINE_FROM = 4;
export const DEFAULT_TARGET: ProjectTarget = { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'Model B · 8271 DFS', romId: 'os12-basic2-dfs', enabledCapabilities: ['dfs', 'sideways'] };

export function languageForFilename(name: string): SourceLanguage {
  if (/\.(?:bas|basic)$/i.test(name)) return 'bbc-basic';
  if (/\.(?:6502|s|asm|a65)$/i.test(name)) return '6502';
  if (/\.(?:arm|sarm)$/i.test(name)) return 'arm';
  if (/\.(?:c|h)$/i.test(name)) return 'c';
  return 'text';
}

export function newProject(): LocalProject {
  const file: ProjectFile = {
    id: crypto.randomUUID(), name: 'main.bas', content: '', language: 'bbc-basic', encoding: 'utf-8', lineEnding: 'lf', modified: false, saved: true, savedName: 'main.bas', savedContent: '', savedEncoding: 'utf-8', savedLineEnding: 'lf', kind: 'authored', access: 'editable',
  };
  const buildTarget = createBuildTarget(file);
  return {
    format: PROJECT_FORMAT,
    name: 'Untitled Acorn Project',
    target: { ...DEFAULT_TARGET, enabledCapabilities: [...DEFAULT_TARGET.enabledCapabilities] },
    breakpoints: {},
    bookmarks: [],
    analysisAnnotations: {},
    diskSets: [],
    settings: {},
    trash: [],
    files: [file],
    buildTargets: [buildTarget],
    activeBuildTargetId: buildTarget.id,
    testPlans: [],
    armBreakpoints: {},
    armBreakpointGroups: {},
    breakpoints6502: {},
    breakpointGroups6502: {},
  };
}

export function createProjectFile(name: string, content = ''): ProjectFile {
  return {
    id: crypto.randomUUID(),
    name,
    content,
    language: languageForFilename(name),
    encoding: 'utf-8',
    lineEnding: 'lf',
    modified: true,
    saved: false,
    savedName: name,
    savedContent: content,
    savedEncoding: 'utf-8',
    savedLineEnding: 'lf',
    kind: 'authored',
    access: 'editable',
  };
}

/**
 * Move one file to sit before or after another.
 *
 * The explorer groups files by where they came from, and that grouping is read
 * off each file's recorded origin rather than its position. Moving a file
 * across a group boundary would therefore either do nothing visible or, worse,
 * imply the file's origin had changed. So a move is refused unless both files
 * share an origin, and the caller is told why.
 */
export function reorderProjectFiles(
  files: readonly ProjectFile[],
  movedId: string,
  targetId: string,
  position: 'before' | 'after',
): { files: ProjectFile[]; moved: ProjectFile; refusal?: string } {
  const moved = files.find((file) => file.id === movedId);
  const target = files.find((file) => file.id === targetId);
  if (!moved) return { files: [...files], moved: files[0]!, refusal: 'That file is not in this project' };
  if (!target) return { files: [...files], moved, refusal: 'The file it was dropped on is not in this project' };
  if (movedId === targetId) return { files: [...files], moved };

  const originOf = (file: ProjectFile) => file.kind === 'generated' ? 'generated' : file.kind === 'imported' ? 'imported' : 'authored';
  if (originOf(moved) !== originOf(target)) {
    return {
      files: [...files],
      moved,
      refusal: `${moved.name} is ${originOf(moved)} and ${target.name} is ${originOf(target)}. Files are grouped by where they came from, so one cannot be moved into another group.`,
    };
  }

  const without = files.filter((file) => file.id !== movedId);
  const index = without.findIndex((file) => file.id === targetId);
  const at = position === 'before' ? index : index + 1;
  return { files: [...without.slice(0, at), moved, ...without.slice(at)], moved };
}

/**
 * The name a requested one becomes in this project, together with anything the
 * shared naming rule had to change. A collision is resolved by numbering; a
 * name a filesystem would refuse is repaired before that, so the numbering is
 * applied to the name that will actually be written.
 */
export function namedForProject(requested: string, files: ProjectFile[]): { name: string; reason: string | null } {
  const normalized = normalizeProjectPath(requested);
  return { name: uniqueFilename(normalized.name, files), reason: normalized.reason };
}

export function uniqueFilename(requested: string, files: ProjectFile[]): string {
  /* A name may carry folders, because a project keeps the ones an imported
   * codebase arrived in and typing a path is how a new file joins them. The
   * numbering that resolves a collision is applied to the filename, so
   * `src/main.s` becomes `src/main-2.s` rather than mangling the folder. */
  const clean = normalizeProjectPath(requested).name;
  const used = new Set(files.map((file) => file.name.toLowerCase()));
  if (!used.has(clean.toLowerCase())) return clean;
  const slash = clean.lastIndexOf('/');
  const directory = slash < 0 ? '' : clean.slice(0, slash + 1);
  const base = slash < 0 ? clean : clean.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  let number = 2;
  while (used.has(`${directory}${stem}-${number}${extension}`.toLowerCase())) number += 1;
  return `${directory}${stem}-${number}${extension}`;
}

export function parseProject(value: string): LocalProject {
  const parsed = JSON.parse(value) as Omit<Partial<LocalProject>, 'format'> & { format?: string };
  const version = projectFormatVersion(parsed.format);
  if (version !== null && version > PROJECT_FORMAT_VERSION) {
    throw new Error(`This project was written by a newer version of the workbench (format ${version}; this build reads up to ${PROJECT_FORMAT_VERSION}). Update the workbench to open it.`);
  }
  if (version === null || typeof parsed.name !== 'string' || !Array.isArray(parsed.files)) {
    throw new Error('This is not a supported 8bit-net Dev project file.');
  }
  const names = new Set<string>();
  const files = parsed.files.map((candidate) => {
    if (!candidate || typeof candidate.name !== 'string' || typeof candidate.content !== 'string') {
      throw new Error('The project contains an invalid source file record.');
    }
    const name = candidate.name.trim();
    if (!name || names.has(name.toLowerCase())) throw new Error('Project filenames must be non-empty and unique.');
    names.add(name.toLowerCase());
    const hasSavedBaseline = version >= SAVED_BASELINE_FROM;
    const savedName = hasSavedBaseline && typeof candidate.savedName === 'string' && candidate.savedName.trim() ? candidate.savedName.trim() : name;
    const content = candidate.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    if (sourceUtf8ByteLength(content) > MAX_SOURCE_FILE_BYTES) throw new Error(`${name} exceeds the 1 MiB editable source-file limit.`);
    const rawSavedContent = hasSavedBaseline && typeof candidate.savedContent === 'string' ? candidate.savedContent : candidate.content;
    const savedContent = rawSavedContent.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const saved = !hasSavedBaseline || candidate.saved !== false;
    const encoding: SourceEncoding = candidate.encoding === 'utf-8-bom' || candidate.encoding === 'windows-1252' ? candidate.encoding : 'utf-8';
    const lineEnding: SourceLineEnding = candidate.lineEnding === 'crlf' || candidate.lineEnding === 'cr' ? candidate.lineEnding : detectLineEnding(candidate.content).lineEnding;
    const savedEncoding: SourceEncoding = candidate.savedEncoding === 'utf-8-bom' || candidate.savedEncoding === 'windows-1252' ? candidate.savedEncoding : encoding;
    const savedLineEnding: SourceLineEnding = candidate.savedLineEnding === 'crlf' || candidate.savedLineEnding === 'cr' ? candidate.savedLineEnding : lineEnding;
    const kind: NonNullable<ProjectFile['kind']> = candidate.kind === 'imported' || candidate.kind === 'generated' ? candidate.kind : 'authored';
    const access: NonNullable<ProjectFile['access']> = kind === 'generated' || candidate.access === 'read-only' ? 'read-only' : 'editable';
    const generator = kind === 'generated' ? (typeof candidate.generator === 'string' && candidate.generator.trim() ? candidate.generator.trim().slice(0, 200) : 'Unspecified generator in migrated project') : undefined;
    const modified = hasSavedBaseline && candidate.modified === true && (!saved || name !== savedName || content !== savedContent || encoding !== savedEncoding || lineEnding !== savedLineEnding);
    return {
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : crypto.randomUUID(),
      name,
      content,
      language: languageForFilename(name),
      encoding,
      lineEnding,
      modified,
      saved,
      savedName,
      savedContent,
      savedEncoding,
      savedLineEnding,
      kind,
      access,
      ...(generator ? { generator } : {}),
    } satisfies ProjectFile;
  });
  if (!files.length) throw new Error('The project must contain at least one source file.');
  if (files.reduce((total, file) => total + sourceUtf8ByteLength(file.content), 0) > MAX_PROJECT_SOURCE_BYTES) throw new Error('The project exceeds the 8 MiB editable source total.');
  const candidateTarget = parsed.target;
  const target: ProjectTarget = candidateTarget && (candidateTarget.platformClass === '8-16-bit' || candidateTarget.platformClass === '32-bit')
    ? { platformClass: candidateTarget.platformClass, machineId: String(candidateTarget.machineId || DEFAULT_TARGET.machineId), variant: String(candidateTarget.variant || DEFAULT_TARGET.variant), romId: String(candidateTarget.romId || DEFAULT_TARGET.romId), enabledCapabilities: Array.isArray(candidateTarget.enabledCapabilities) ? candidateTarget.enabledCapabilities.filter((item): item is string => typeof item === 'string') : [] }
    : { ...DEFAULT_TARGET, enabledCapabilities: [...DEFAULT_TARGET.enabledCapabilities] };
  const fileIds = new Set(files.map((file) => file.id));
  const breakpoints = Object.fromEntries(Object.entries(parsed.breakpoints ?? {}).filter(([id, lines]) => fileIds.has(id) && Array.isArray(lines)).map(([id, lines]) => [id, Array.from(new Set(lines.filter((line): line is number => Number.isInteger(line) && line > 0))).sort((a, b) => a - b)]));
  const bookmarkIds = new Set<string>();
  const bookmarks = (Array.isArray(parsed.bookmarks) ? parsed.bookmarks : []).flatMap((candidate): SourceBookmark[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Partial<SourceBookmark>;
    if (typeof item.fileId !== 'string' || !fileIds.has(item.fileId) || !Number.isInteger(item.line) || Number(item.line) < 1) return [];
    const id = typeof item.id === 'string' && item.id && !bookmarkIds.has(item.id) ? item.id : crypto.randomUUID();
    bookmarkIds.add(id);
    const file = files.find((entry) => entry.id === item.fileId)!;
    const maximumLine = Math.max(1, file.content.split('\n').length);
    const line = Math.min(Number(item.line), maximumLine);
    const anchor = typeof item.anchor === 'string' ? item.anchor.slice(0, 240) : (file.content.split('\n')[line - 1] ?? '').trim().slice(0, 240);
    return [{ id, fileId: item.fileId, line, column: Number.isInteger(item.column) && Number(item.column) > 0 ? Number(item.column) : 1, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 120) : `${file.name}:${line}`, description: typeof item.description === 'string' ? item.description.trim().slice(0, 1000) : '', scope: item.scope === 'private' ? 'private' : 'project', enabled: item.enabled !== false, anchor, orphaned: item.orphaned === true }];
  });
  const candidateTargets = Array.isArray(parsed.buildTargets) ? parsed.buildTargets : [];
  const buildTargets = candidateTargets.flatMap((candidate): BuildTarget[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Partial<BuildTarget>;
    if (typeof item.id !== 'string' || !item.id || typeof item.entryFileId !== 'string' || !fileIds.has(item.entryFileId) || typeof item.toolchainId !== 'string' || !toolchainFor(item.toolchainId)) return [];
    const entry = files.find((file) => file.id === item.entryFileId)!;
    return [migrateBuildTarget(item, { id: item.id, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `${entry.name} build`, entryFileId: entry.id, toolchainId: item.toolchainId as BuildTarget['toolchainId'], outputName: typeof item.outputName === 'string' && item.outputName.trim() ? item.outputName.trim() : `${entry.name}.${entry.language === 'bbc-basic' ? 'bbc' : 'bin'}` })];
  });
  if (!buildTargets.length) buildTargets.push(createBuildTarget(files.find((file) => file.language === 'bbc-basic' || file.language === '6502' || file.language === 'arm' || file.language === 'c') ?? files[0]!));
  // Repair old or edited manifests whose toolchain no longer matches their entry language.
  buildTargets.forEach((item) => {
    const entry = files.find((file) => file.id === item.entryFileId)!;
    if (toolchainFor(item.toolchainId)?.language !== entry.language) Object.assign(item, buildToolchainUpdate(defaultToolchainId(entry.language)));
    if (entry.language === 'bbc-basic') {
      Object.assign(item, buildToolchainUpdate(target.machineId === 'atom' ? '8bit-net.basic.atom' : '8bit-net.basic.bbc2'));
      if (/\.(?:bbc|atom\.txt)$/i.test(item.outputName)) item.outputName = item.outputName.replace(/\.(?:bbc|atom\.txt)$/i, target.machineId === 'atom' ? '.atom.txt' : '.bbc');
    }
  });
  const activeBuildTargetId = typeof parsed.activeBuildTargetId === 'string' && buildTargets.some((item) => item.id === parsed.activeBuildTargetId) ? parsed.activeBuildTargetId : buildTargets[0]!.id;
  const targetIds = new Set(buildTargets.map((item) => item.id));
  const candidateArmGroups = parsed.armBreakpointGroups && typeof parsed.armBreakpointGroups === 'object' ? parsed.armBreakpointGroups : {};
  const armBreakpointGroups: Record<string, ArmBreakpointGroup[]> = Object.fromEntries(Object.entries(candidateArmGroups).flatMap(([targetId, candidates]) => {
    if (!targetIds.has(targetId) || !Array.isArray(candidates)) return [];
    const ids = new Set<string>(); const names = new Set<string>();
    const groups = candidates.slice(0, 32).flatMap((candidate): ArmBreakpointGroup[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Partial<ArmBreakpointGroup>;
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 64) : '';
      if (!name || names.has(name.toLowerCase())) return [];
      const id = typeof item.id === 'string' && item.id && !ids.has(item.id) ? item.id.slice(0, 80) : crypto.randomUUID();
      ids.add(id); names.add(name.toLowerCase());
      return [{ id, name, enabled: item.enabled !== false }];
    });
    return groups.length ? [[targetId, groups]] : [];
  }));
  const testPlanIds = new Set<string>();
  const testPlans = (Array.isArray(parsed.testPlans) ? parsed.testPlans : []).flatMap((candidate): TargetTestPlan[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Partial<TargetTestPlan>;
    if (typeof item.targetId !== 'string' || !targetIds.has(item.targetId)) return [];
    const id = typeof item.id === 'string' && item.id && !testPlanIds.has(item.id) ? item.id : crypto.randomUUID(); testPlanIds.add(id);
    const setupCandidate = item.setup && typeof item.setup === 'object' ? item.setup : undefined;
    const setup: TargetTestPlan['setup'] = { reset: setupCandidate?.reset === 'soft' || setupCandidate?.reset === 'none' ? setupCandidate.reset : 'hard', media: setupCandidate?.media === 'eject' ? 'eject' : 'retain' };
    const inputs = (Array.isArray(item.inputs) ? item.inputs : []).slice(0, 256).flatMap((candidateInput): TargetTestPlan['inputs'] => {
      if (!candidateInput || typeof candidateInput !== 'object') return [];
      if (candidateInput.kind === 'delay' && Number.isInteger(candidateInput.cycles) && Number(candidateInput.cycles) >= 1 && Number(candidateInput.cycles) <= 10_000_000) return [{ kind: 'delay', cycles: Number(candidateInput.cycles) }];
      if (candidateInput.kind === 'key' && typeof candidateInput.code === 'string' && /^[A-Za-z0-9]{1,24}$/.test(candidateInput.code) && typeof candidateInput.pressed === 'boolean') return [{ kind: 'key', code: candidateInput.code, pressed: candidateInput.pressed }];
      if (candidateInput.kind === 'gamepad' && ['up', 'down', 'left', 'right', 'fire1', 'fire2'].includes(String(candidateInput.action)) && typeof candidateInput.pressed === 'boolean') {
        try { return [{ kind: 'gamepad', action: candidateInput.action as 'up' | 'down' | 'left' | 'right' | 'fire1' | 'fire2', code: validateMachineTapCode(candidateInput.code), pressed: candidateInput.pressed }]; }
        catch { return []; }
      }
      if (candidateInput.kind === 'bbc-analogue' && Array.isArray(candidateInput.channels) && candidateInput.channels.length === 4 && candidateInput.channels.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff) && Array.isArray(candidateInput.buttons) && candidateInput.buttons.length === 2 && candidateInput.buttons.every((value) => typeof value === 'boolean')) return [{ kind: 'bbc-analogue', channels: candidateInput.channels as [number, number, number, number], buttons: candidateInput.buttons as [boolean, boolean] }];
      if (candidateInput.kind === 'bbc-mouse' && Number.isInteger(candidateInput.x) && candidateInput.x >= 0 && candidateInput.x <= 0xffff && Number.isInteger(candidateInput.y) && candidateInput.y >= 0 && candidateInput.y <= 0xffff && Array.isArray(candidateInput.buttons) && candidateInput.buttons.length === 2 && candidateInput.buttons.every((value) => typeof value === 'boolean')) return [{ kind: 'bbc-mouse', x: candidateInput.x, y: candidateInput.y, buttons: candidateInput.buttons as [boolean, boolean] }];
      if (candidateInput.kind === 'atom-atommc' && ['up', 'down', 'left', 'right', 'fire'].every((key) => typeof candidateInput[key as keyof typeof candidateInput] === 'boolean')) return [{ kind: 'atom-atommc', up: candidateInput.up as boolean, down: candidateInput.down as boolean, left: candidateInput.left as boolean, right: candidateInput.right as boolean, fire: candidateInput.fire as boolean }];
      if (candidateInput.kind === 'media' && ['eject-disc-0', 'eject-disc-1', 'eject-tape', 'mount-initial-disc-0', 'mount-initial-disc-1', 'mount-initial-tape'].includes(String(candidateInput.action))) return [{ kind: 'media', action: candidateInput.action as 'eject-disc-0' | 'eject-disc-1' | 'eject-tape' | 'mount-initial-disc-0' | 'mount-initial-disc-1' | 'mount-initial-tape' }];
      if (candidateInput.kind === 'emulator-event' && candidateInput.event === 'next-video-frame') return [{ kind: 'emulator-event', event: candidateInput.event }];
      if (candidateInput.kind === 'reset' && (candidateInput.reset === 'hard' || candidateInput.reset === 'soft')) return [{ kind: 'reset', reset: candidateInput.reset }];
      return [];
    });
    const captureIds = new Set<string>(); let capturedMemoryBytes = 0;
    const captures = (Array.isArray(item.captures) ? item.captures : []).slice(0, 16).flatMap((candidateCapture): TargetTestPlan['captures'] => {
      if (!candidateCapture || typeof candidateCapture !== 'object') return [];
      const capture = candidateCapture as Partial<TargetTestPlan['captures'][number]>;
      const captureId = typeof capture.id === 'string' && capture.id && !captureIds.has(capture.id) ? capture.id.slice(0, 80) : crypto.randomUUID();
      captureIds.add(captureId);
      if (capture.kind === 'registers') return [{ id: captureId, kind: 'registers' }];
      if (capture.kind === 'memory' && typeof capture.address === 'string' && capture.address.trim() && Number.isInteger(capture.length) && Number(capture.length) >= 1 && Number(capture.length) <= 4096 && capturedMemoryBytes + Number(capture.length) <= 4096) { capturedMemoryBytes += Number(capture.length); return [{ id: captureId, kind: 'memory', address: capture.address.trim().slice(0, 128), length: Number(capture.length) }]; }
      return [];
    });
    const teardown = { action: item.teardown?.action === 'reset' ? 'reset' as const : 'pause' as const };
    const goldenIds = new Set<string>();
    const screenGoldens = (Array.isArray(item.screenGoldens) ? item.screenGoldens : []).slice(0, MAX_SCREEN_GOLDENS).flatMap((candidateGolden): ScreenGolden[] => {
      if (!candidateGolden || typeof candidateGolden !== 'object') return [];
      const golden = candidateGolden as ScreenGolden;
      if (goldenIds.has(golden.id) || validateScreenGolden(golden)) return [];
      goldenIds.add(golden.id);
      return [{ id: golden.id, name: golden.name.trim(), width: golden.width, height: golden.height, rgbaBase64: golden.rgbaBase64 }];
    });
    return [{ schemaVersion: 2, id, targetId: item.targetId, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'Hardware test', suite: typeof item.suite === 'string' && item.suite.trim() ? item.suite.trim().slice(0, 80) : 'Default', setup, inputs, stop: typeof item.stop === 'string' ? item.stop.slice(0, 128) : 'done', assertions: typeof item.assertions === 'string' ? item.assertions.slice(0, 16384) : '', screenGoldens, cycleBudget: Number.isInteger(item.cycleBudget) && Number(item.cycleBudget) >= 100 && Number(item.cycleBudget) <= 10_000_000 ? Number(item.cycleBudget) : 100_000, captures, teardown, enabled: item.enabled !== false }];
  });
  const operators = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
  const actions = new Set(['pause', 'log', 'pause-log']);
  const candidateArmBreakpoints = parsed.armBreakpoints && typeof parsed.armBreakpoints === 'object' ? parsed.armBreakpoints : {};
  const armBreakpoints = Object.fromEntries(Object.entries(candidateArmBreakpoints).flatMap(([targetId, candidates]) => {
    if (!targetIds.has(targetId) || !Array.isArray(candidates)) return [];
    const ids = new Set<string>();
    const intents = candidates.flatMap((candidate): PersistedArmBreakpointIntent[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Partial<PersistedArmBreakpointIntent>;
      const expression = typeof item.expression === 'string' ? item.expression.trim().slice(0, 128) : '';
      if (!expression) return [];
      const conditions = (Array.isArray(item.conditions) ? item.conditions : []).slice(0, 4).flatMap((candidateCondition) => {
        if (!candidateCondition || typeof candidateCondition !== 'object') return [];
        const condition = candidateCondition as { register?: unknown; operator?: unknown; expression?: unknown; value?: unknown };
        if (!Number.isInteger(condition.register) || Number(condition.register) < 0 || Number(condition.register) > 15 || typeof condition.operator !== 'string' || !operators.has(condition.operator)) return [];
        const expression = typeof condition.expression === 'string' ? condition.expression.trim().slice(0, 128) : Number.isInteger(condition.value) && Number(condition.value) >= 0 && Number(condition.value) <= 0xffffffff ? `&${Number(condition.value).toString(16).toUpperCase().padStart(8, '0')}` : '';
        return expression ? [{ register: Number(condition.register), operator: condition.operator as PersistedArmBreakpointIntent['conditions'][number]['operator'], expression }] : [];
      });
      const action = typeof item.action === 'string' && actions.has(item.action) ? item.action as PersistedArmBreakpointIntent['action'] : 'pause';
      if (action !== 'pause' && (typeof item.logMessage !== 'string' || !item.logMessage.trim())) return [];
      const id = typeof item.id === 'string' && item.id && !ids.has(item.id) ? item.id : crypto.randomUUID(); ids.add(id);
      const hitTarget = Number.isInteger(item.hitTarget) && Number(item.hitTarget) >= 1 && Number(item.hitTarget) <= 1_000_000 ? Number(item.hitTarget) : undefined;
      const groupId = typeof item.groupId === 'string' && (armBreakpointGroups[targetId] ?? []).some((group) => group.id === item.groupId) ? item.groupId : undefined;
      const resolutionHistory = (Array.isArray(item.resolutionHistory) ? item.resolutionHistory : []).slice(-8).flatMap((candidateRecord): ArmBreakpointResolutionRecord[] => {
        if (!candidateRecord || typeof candidateRecord !== 'object') return [];
        const record = candidateRecord as Partial<ArmBreakpointResolutionRecord>;
        if (typeof record.requestedExpression !== 'string' || !record.requestedExpression.trim() || typeof record.buildFingerprint !== 'string' || !/^[a-f0-9]{8,128}$/i.test(record.buildFingerprint) || (record.address !== null && (!Number.isInteger(record.address) || Number(record.address) < 0 || Number(record.address) > 0x03ffffff)) || (record.verification !== 'resolved' && record.verification !== 'rejected') || typeof record.reason !== 'string' || !record.reason.trim()) return [];
        return [{ requestedExpression: record.requestedExpression.trim().slice(0, 128), buildFingerprint: record.buildFingerprint.toLowerCase(), address: record.address === null ? null : Number(record.address), verification: record.verification, reason: record.reason.trim().slice(0, 180) }];
      });
      return [{ id, expression, enabled: item.enabled !== false, conditions, action, ...(hitTarget === undefined ? {} : { hitTarget }), ...(typeof item.logMessage === 'string' ? { logMessage: item.logMessage.slice(0, 160) } : {}), ...(groupId === undefined ? {} : { groupId }), ...(resolutionHistory.length ? { resolutionHistory } : {}) }];
    });
    return intents.length ? [[targetId, intents]] : [];
  }));
  const candidate6502Groups = parsed.breakpointGroups6502 && typeof parsed.breakpointGroups6502 === 'object' ? parsed.breakpointGroups6502 : {};
  const breakpointGroups6502: Record<string, Breakpoint6502Group[]> = Object.fromEntries(Object.entries(candidate6502Groups).flatMap(([targetId, candidates]) => {
    if (!targetIds.has(targetId) || !Array.isArray(candidates)) return [];
    const ids = new Set<string>(); const names = new Set<string>();
    const groups = candidates.slice(0, 32).flatMap((candidate): Breakpoint6502Group[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Partial<Breakpoint6502Group>; const name = typeof item.name === 'string' ? item.name.trim().slice(0, 64) : '';
      if (!name || names.has(name.toLowerCase())) return [];
      const id = typeof item.id === 'string' && item.id && !ids.has(item.id) ? item.id.slice(0, 80) : crypto.randomUUID();
      ids.add(id); names.add(name.toLowerCase()); return [{ id, name, enabled: item.enabled !== false }];
    });
    return groups.length ? [[targetId, groups]] : [];
  }));
  const registers6502 = new Set(['a', 'x', 'y', 's', 'p', 'pc']);
  const candidate6502Breakpoints = parsed.breakpoints6502 && typeof parsed.breakpoints6502 === 'object' ? parsed.breakpoints6502 : {};
  const breakpoints6502: Record<string, Persisted6502BreakpointIntent[]> = Object.fromEntries(Object.entries(candidate6502Breakpoints).flatMap(([targetId, candidates]) => {
    if (!targetIds.has(targetId) || !Array.isArray(candidates)) return [];
    const ids = new Set<string>();
    const intents = candidates.slice(0, 64).flatMap((candidate): Persisted6502BreakpointIntent[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Partial<Persisted6502BreakpointIntent>; const expression = typeof item.expression === 'string' ? item.expression.trim().slice(0, 128) : '';
      if (!expression) return [];
      const action = typeof item.action === 'string' && actions.has(item.action) ? item.action as Persisted6502BreakpointIntent['action'] : 'pause';
      if (action !== 'pause' && (typeof item.logMessage !== 'string' || !item.logMessage.trim())) return [];
      const rawCondition = item.condition as Partial<Persisted6502BreakpointIntent['condition']> | undefined;
      const condition = rawCondition && typeof rawCondition.register === 'string' && registers6502.has(rawCondition.register) && typeof rawCondition.operator === 'string' && operators.has(rawCondition.operator) && typeof rawCondition.expression === 'string' && rawCondition.expression.trim()
        ? { register: rawCondition.register as Persisted6502BreakpointIntent['condition'] extends infer C ? C extends { register: infer R } ? R : never : never, operator: rawCondition.operator as 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte', expression: rawCondition.expression.trim().slice(0, 128) } : undefined;
      const id = typeof item.id === 'string' && item.id && !ids.has(item.id) ? item.id : crypto.randomUUID(); ids.add(id);
      const hitTarget = Number.isInteger(item.hitTarget) && Number(item.hitTarget) >= 1 && Number(item.hitTarget) <= 1_000_000 ? Number(item.hitTarget) : undefined;
      const groupId = typeof item.groupId === 'string' && (breakpointGroups6502[targetId] ?? []).some((group) => group.id === item.groupId) ? item.groupId : undefined;
      const resolutionHistory = (Array.isArray(item.resolutionHistory) ? item.resolutionHistory : []).slice(-8).flatMap((candidateRecord): Breakpoint6502ResolutionRecord[] => {
        if (!candidateRecord || typeof candidateRecord !== 'object') return [];
        const record = candidateRecord as Partial<Breakpoint6502ResolutionRecord>;
        if (typeof record.requestedExpression !== 'string' || !record.requestedExpression.trim() || typeof record.buildFingerprint !== 'string' || !/^[a-f0-9]{8,128}$/i.test(record.buildFingerprint) || (record.address !== null && (!Number.isInteger(record.address) || Number(record.address) < 0 || Number(record.address) > 0xffff)) || (record.verification !== 'resolved' && record.verification !== 'rejected') || typeof record.reason !== 'string' || !record.reason.trim()) return [];
        return [{ requestedExpression: record.requestedExpression.trim().slice(0, 128), buildFingerprint: record.buildFingerprint.toLowerCase(), address: record.address === null ? null : Number(record.address), verification: record.verification, reason: record.reason.trim().slice(0, 180) }];
      });
      return [{ id, expression, enabled: item.enabled !== false, action, ...(condition ? { condition } : {}), ...(hitTarget === undefined ? {} : { hitTarget }), ...(typeof item.logMessage === 'string' ? { logMessage: item.logMessage.slice(0, 160) } : {}), ...(groupId ? { groupId } : {}), ...(resolutionHistory.length ? { resolutionHistory } : {}) }];
    });
    return intents.length ? [[targetId, intents]] : [];
  }));
  /* Annotations describe bytes, not files, so an entry whose key is not a
   * digest, or whose document does not validate, is dropped rather than
   * repaired: a half-understood annotation would silently change a listing. */
  const candidateAnnotations = parsed.analysisAnnotations && typeof parsed.analysisAnnotations === 'object' ? parsed.analysisAnnotations as Record<string, unknown> : {};
  const analysisAnnotations: Record<string, AnalysisAnnotations> = {};
  for (const [digest, candidate] of Object.entries(candidateAnnotations).slice(0, 256)) {
    if (!/^[0-9a-f]{64}$/i.test(digest)) continue;
    try {
      const annotations = validateAnalysisAnnotations(candidate);
      if (annotations.sourceSha256 === digest.toLowerCase()) analysisAnnotations[digest.toLowerCase()] = annotations;
    } catch { /* An unreadable annotation set is discarded, not guessed at. */ }
  }
  /* A disk set that no longer validates is dropped with the rest of it intact,
   * rather than partially repaired into something that would write a disc the
   * author did not describe. */
  const diskSets: DiskSet[] = (Array.isArray(parsed.diskSets) ? parsed.diskSets : []).slice(0, 16).flatMap((candidate): DiskSet[] => {
    try { return [validateDiskSet(candidate)]; } catch { return []; }
  });
  /* Project settings are validated against the same schema the interface uses,
   * so an imported project cannot introduce a preference the machine would
   * refuse. One bad entry is dropped; the rest are kept. */
  const candidateSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings as Record<string, unknown> : {};
  const settings: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(candidateSettings).slice(0, 64)) {
    const descriptor = settingDescriptor(id);
    if (!descriptor || descriptor.scope !== 'user-and-project') continue;
    const outcome = descriptor.validate(value);
    if (outcome.ok) settings[id] = outcome.value;
  }
  const trash = validateTrash(parsed.trash, new Set(files.map((file) => file.id)));
  return { format: PROJECT_FORMAT, name: parsed.name.trim() || 'Untitled Acorn Project', files, target, breakpoints, bookmarks, buildTargets, activeBuildTargetId, testPlans, armBreakpoints, armBreakpointGroups, breakpoints6502, breakpointGroups6502, analysisAnnotations, diskSets, settings, trash };
}

export function serializableProject(project: LocalProject): LocalProject {
  return {
    ...project,
    files: project.files.map((file) => ({ ...file, encoding: file.encoding ?? 'utf-8', lineEnding: file.lineEnding ?? 'lf', modified: false, saved: true, savedName: file.name, savedContent: file.content, savedEncoding: file.encoding ?? 'utf-8', savedLineEnding: file.lineEnding ?? 'lf' })),
  };
}

export interface PortableProjectExport {
  project: LocalProject;
  privateBookmarksIncluded: number;
  privateBookmarksExcluded: number;
}

export function portableProject(project: LocalProject, includePrivateBookmarks = false): PortableProjectExport {
  const saved = serializableProject(project);
  const privateBookmarks = saved.bookmarks.filter((bookmark) => bookmark.scope === 'private');
  return {
    project: { ...saved, bookmarks: includePrivateBookmarks ? saved.bookmarks : saved.bookmarks.filter((bookmark) => bookmark.scope !== 'private') },
    privateBookmarksIncluded: includePrivateBookmarks ? privateBookmarks.length : 0,
    privateBookmarksExcluded: includePrivateBookmarks ? 0 : privateBookmarks.length,
  };
}

export function savedProjectFile(project: LocalProject, fileId: string): LocalProject {
  return { ...project, files: project.files.map((file) => file.id === fileId ? { ...file, encoding: file.encoding ?? 'utf-8', lineEnding: file.lineEnding ?? 'lf', modified: false, saved: true, savedName: file.name, savedContent: file.content, savedEncoding: file.encoding ?? 'utf-8', savedLineEnding: file.lineEnding ?? 'lf' } : file) };
}

export function revertedProjectFile(project: LocalProject, fileId: string): LocalProject {
  return { ...project, files: project.files.map((file) => {
    if (file.id !== fileId || file.saved === false) return file;
    const savedName = file.savedName ?? file.name;
    const encoding = file.savedEncoding ?? file.encoding ?? 'utf-8'; const lineEnding = file.savedLineEnding ?? file.lineEnding ?? 'lf';
    return { ...file, content: file.savedContent ?? file.content, encoding, lineEnding, modified: file.name !== savedName };
  }) };
}

export function projectFileIsModified(file: ProjectFile, name = file.name, content = file.content, encoding: SourceEncoding = file.encoding ?? 'utf-8', lineEnding: SourceLineEnding = file.lineEnding ?? 'lf') {
  return file.saved === false || name !== (file.savedName ?? file.name) || content !== (file.savedContent ?? file.content) || encoding !== (file.savedEncoding ?? file.encoding ?? 'utf-8') || lineEnding !== (file.savedLineEnding ?? file.lineEnding ?? 'lf');
}
