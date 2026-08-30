/* A portable project bundle: what is in it, what is deliberately not, and
 * whether it arrived intact.
 *
 * Exporting used to be a plain JSON dump. That is enough to move work between
 * two copies of the same build, and not enough for anything else: it does not
 * say what the project needs in order to build, it does not say what was left
 * out, and it cannot tell a truncated or edited file from a good one.
 *
 * Three things this adds, each because leaving it out would let the product
 * mislead someone.
 *
 * An integrity manifest, so a bundle that was altered or truncated in transit
 * is refused with the file that no longer matches, rather than opened as if it
 * were what the author sent.
 *
 * A dependency report, so the receiver knows which toolchains, machine profile,
 * firmware set and capabilities the work expects before discovering it by
 * failing to build.
 *
 * An exclusion report, so what is *not* in the bundle is stated rather than
 * assumed. ROM images and the firmware vault never travel, and the reader
 * should be told that rather than wonder why the machine will not start.
 */
import { sha256Hex } from '../build/digest';
import { PROJECT_FORMAT, parseProject, portableProject, type LocalProject } from './project';

export const PROJECT_BUNDLE_SCHEMA = '8bit-net.project-bundle';
export const PROJECT_BUNDLE_VERSION = 1;

export interface BundleFileIntegrity {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
}

export interface BundleDependencies {
  /** Toolchain identifiers every build target names. */
  toolchains: string[];
  machine: { platformClass: string; machineId: string; variant: string; romId: string };
  /** Capabilities the project expects to be enabled. */
  capabilities: string[];
  /** Build targets, with the entry file each one needs. */
  buildTargets: Array<{ id: string; name: string; toolchainId: string; entryFileName: string }>;
  /** Source files a build target names that the bundle does not contain. */
  missingSources: string[];
}

export interface BundleExclusion {
  what: string;
  why: string;
  count?: number;
}

export interface PossibleSecret {
  fileName: string;
  line: number;
  kind: string;
  /** The matched text with its value masked, so the report never repeats it. */
  masked: string;
}

export interface ProjectBundle {
  schema: typeof PROJECT_BUNDLE_SCHEMA;
  version: typeof PROJECT_BUNDLE_VERSION;
  createdAt: string;
  producedBy: { product: string; projectFormat: string };
  project: LocalProject;
  integrity: {
    /** SHA-256 over the canonical form of the project this bundle carries. */
    projectSha256: string;
    files: BundleFileIntegrity[];
  };
  dependencies: BundleDependencies;
  excluded: BundleExclusion[];
  /** Anything in the source that looks like a credential, reported not removed. */
  possibleSecrets: PossibleSecret[];
}

/* Canonical JSON, so the same project always produces the same digest whatever
 * order its keys happen to be in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const encoder = new TextEncoder();
const digestOf = (text: string) => sha256Hex(encoder.encode(text));

/**
 * The digest a bundle records for the project it carries. Exported so a caller
 * can verify a bundle the same way this module does, rather than reimplementing
 * the canonical form and getting a different answer.
 */
export function projectDigest(project: LocalProject): string {
  return digestOf(canonical(project));
}

/* Patterns for things that should not leave a machine inside source. Each is
 * deliberately narrow: a false alarm on every hexadecimal constant in a 6502
 * listing would be worse than useless. */
const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { kind: 'authorization header', pattern: /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+\S{8,}/i },
  { kind: 'assigned password', pattern: /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{8,}/i },
  { kind: 'connection string', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i },
  { kind: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
];

/** Scan source text for anything that looks like a credential. */
export function findPossibleSecrets(files: ReadonlyArray<{ name: string; content: string }>): PossibleSecret[] {
  const found: PossibleSecret[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length && found.length < 64; index += 1) {
      const line = lines[index]!;
      for (const { kind, pattern } of SECRET_PATTERNS) {
        const match = pattern.exec(line);
        if (!match) continue;
        /* The report names the kind and where, never the value itself. */
        const masked = match[0].length > 24 ? `${match[0].slice(0, 16)}…` : match[0];
        found.push({ fileName: file.name, line: index + 1, kind, masked: masked.replace(/[^\s:=]{6,}$/, '(value hidden)') });
        break;
      }
    }
  }
  return found;
}

export interface BundleOptions {
  includePrivateBookmarks?: boolean;
  /** ISO timestamp; passed in so a bundle is reproducible in a test. */
  createdAt: string;
  /** Machine capabilities offered by the profile, for the dependency report. */
  capabilityLabels?: Readonly<Record<string, string>>;
}

/** Build a bundle from the project in hand. */
export function createProjectBundle(project: LocalProject, options: BundleOptions): ProjectBundle {
  const exported = portableProject(project, options.includePrivateBookmarks ?? false);
  const carried = exported.project;

  const files: BundleFileIntegrity[] = carried.files.map((file) => ({
    id: file.id,
    name: file.name,
    bytes: encoder.encode(file.content).length,
    sha256: digestOf(file.content),
  }));

  const fileById = new Map(carried.files.map((file) => [file.id, file]));
  const missingSources: string[] = [];
  const buildTargets = carried.buildTargets.map((target) => {
    const entry = fileById.get(target.entryFileId);
    if (!entry) missingSources.push(`${target.name} names entry file ${target.entryFileId}`);
    for (const sourceId of target.sourceFileIds ?? []) {
      if (!fileById.has(sourceId)) missingSources.push(`${target.name} names source file ${sourceId}`);
    }
    return { id: target.id, name: target.name, toolchainId: target.toolchainId, entryFileName: entry?.name ?? '(missing)' };
  });

  const excluded: BundleExclusion[] = [
    { what: 'ROM and firmware images', why: 'Firmware is stored in the browser-local vault and never travels with a project. The receiver supplies their own.' },
    { what: 'Build artifacts', why: 'Artifacts are rebuilt from the sources in this bundle rather than carried, so what is built is what is here.' },
    { what: 'Browser settings', why: 'Settings belong to the person and their browser. Only settings the project deliberately carries are included.' },
    { what: 'Test history', why: 'Recorded runs describe one machine and one session, so they would not be evidence about this bundle.' },
  ];
  if (exported.privateBookmarksExcluded) {
    excluded.push({ what: 'Private bookmarks', why: 'Bookmarks marked private are held back unless explicitly included.', count: exported.privateBookmarksExcluded });
  }

  return {
    schema: PROJECT_BUNDLE_SCHEMA,
    version: PROJECT_BUNDLE_VERSION,
    createdAt: options.createdAt,
    producedBy: { product: '8bit-net Acorn workbench', projectFormat: PROJECT_FORMAT },
    project: carried,
    integrity: { projectSha256: projectDigest(carried), files },
    dependencies: {
      toolchains: [...new Set(carried.buildTargets.map((target) => target.toolchainId))].sort(),
      machine: {
        platformClass: carried.target.platformClass,
        machineId: carried.target.machineId,
        variant: carried.target.variant,
        romId: carried.target.romId,
      },
      capabilities: [...carried.target.enabledCapabilities].sort(),
      buildTargets,
      missingSources,
    },
    excluded,
    possibleSecrets: findPossibleSecrets(carried.files.map((file) => ({ name: file.name, content: file.content }))),
  };
}

export interface BundleOpenResult {
  project: LocalProject;
  bundle: ProjectBundle;
  /** Files whose recorded digest does not match their content. */
  corrupted: string[];
  /** True when the project format was older than this build's and was migrated. */
  migratedFrom: string | null;
}

/**
 * Open a bundle, refusing one whose contents do not match what it records.
 * A digest that disagrees means the bundle is not what its author sent, and
 * opening it anyway would attribute someone else's edits to them.
 */
export function openProjectBundle(text: string): BundleOpenResult {
  let candidate: unknown;
  try { candidate = JSON.parse(text); }
  catch { throw new Error('That file is not a project bundle: it is not valid JSON'); }
  if (!candidate || typeof candidate !== 'object') throw new Error('A project bundle must be an object');
  const bundle = candidate as Partial<ProjectBundle>;
  if (bundle.schema !== PROJECT_BUNDLE_SCHEMA) throw new Error(`A project bundle must declare schema ${PROJECT_BUNDLE_SCHEMA}`);
  /* A bundle from a newer build is not a malformed one. Saying "update the
   * workbench" is actionable; "version 1 is required" invites someone to edit
   * the number, which would then fail the digest check for the wrong reason. */
  if (typeof bundle.version === 'number' && bundle.version > PROJECT_BUNDLE_VERSION) {
    throw new Error(`This bundle was written by a newer version of the workbench (bundle version ${bundle.version}; this build reads version ${PROJECT_BUNDLE_VERSION}). Update the workbench to open it.`);
  }
  if (bundle.version !== PROJECT_BUNDLE_VERSION) throw new Error(`Project bundle version ${PROJECT_BUNDLE_VERSION} is required, not ${bundle.version}`);
  if (!bundle.project || typeof bundle.project !== 'object') throw new Error('The bundle carries no project');
  if (!bundle.integrity?.projectSha256) throw new Error('The bundle carries no integrity manifest, so its contents cannot be verified');

  const declaredFormat = String((bundle.project as LocalProject).format ?? '');
  const actual = projectDigest(bundle.project as LocalProject);
  if (actual !== bundle.integrity.projectSha256) {
    throw new Error(`This bundle has been altered since it was created: the project digest is ${actual}, not the ${bundle.integrity.projectSha256} it records`);
  }

  const carried = bundle.project as LocalProject;
  const byId = new Map(carried.files.map((file) => [file.id, file]));
  const corrupted: string[] = [];
  for (const record of bundle.integrity.files ?? []) {
    const file = byId.get(record.id);
    if (!file) { corrupted.push(`${record.name} is recorded in the manifest but absent from the bundle`); continue; }
    if (digestOf(file.content) !== record.sha256) corrupted.push(`${file.name} does not match its recorded digest`);
  }
  const recorded = new Set((bundle.integrity.files ?? []).map((record) => record.id));
  for (const file of carried.files) if (!recorded.has(file.id)) corrupted.push(`${file.name} is in the bundle but not in its manifest`);
  if (corrupted.length) throw new Error(`This bundle does not match its own manifest: ${corrupted.join('; ')}`);

  /* Only now is the project parsed, which is also where an older format is
   * migrated forward. Verifying first means a migration never runs over
   * contents that were not what the author sent. */
  const project = parseProject(JSON.stringify(carried));
  return {
    project,
    bundle: bundle as ProjectBundle,
    corrupted,
    migratedFrom: declaredFormat && declaredFormat !== PROJECT_FORMAT ? declaredFormat : null,
  };
}

/** One line for the interface. */
export function bundleSummary(bundle: ProjectBundle): string {
  const parts = [
    `${bundle.project.files.length} file${bundle.project.files.length === 1 ? '' : 's'}`,
    `${bundle.dependencies.buildTargets.length} build target${bundle.dependencies.buildTargets.length === 1 ? '' : 's'}`,
    `${bundle.dependencies.toolchains.length} toolchain${bundle.dependencies.toolchains.length === 1 ? '' : 's'}`,
  ];
  if (bundle.dependencies.missingSources.length) parts.push(`${bundle.dependencies.missingSources.length} missing source reference${bundle.dependencies.missingSources.length === 1 ? '' : 's'}`);
  if (bundle.possibleSecrets.length) parts.push(`${bundle.possibleSecrets.length} possible secret${bundle.possibleSecrets.length === 1 ? '' : 's'} to review`);
  return parts.join(' · ');
}
