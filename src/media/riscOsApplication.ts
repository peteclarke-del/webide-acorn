/* A RISC OS application, as a directory of typed files.
 *
 * The first version of this carried exactly two files, `!Run` and `RunImage`,
 * because that is the smallest thing FileSwitch will launch and proving that
 * much on a real machine was the point. It is not an application anyone would
 * ship. A real one has `!Boot` so the Filer knows about it before it is run,
 * `!Sprites` so it has an icon, and whatever resources the program loads —
 * usually in subdirectories.
 *
 * The model here is a flat list of paths rather than a nested structure,
 * because the directories are implied by the paths and a second representation
 * of the same tree is a second thing to keep correct. The tree is derived when
 * something needs one, which is exactly once: when the application is written
 * to a disc.
 *
 * Two conventions are enforced rather than assumed, because an application that
 * breaks them is broken in a way the Filer will not explain: `!Run` and `!Boot`
 * are Obey files, and `!Sprites` is a sprite file. Everything else may be any
 * type the caller says it is.
 */
import { zipSync } from 'fflate';
import { adfsNameProblem } from './adfsEdit';
import { createAdfsEDisc, type AdfsNodeRequest, type CreatedAdfsEImage } from './adfsImage';
import type { ArmArtifact } from '../build/artifactTypes';

export const RISC_OS_FILETYPE_OBEY = 0xfeb;
export const RISC_OS_FILETYPE_ABSOLUTE = 0xff8;
export const RISC_OS_FILETYPE_SPRITE = 0xff9;
export const RISC_OS_FILETYPE_DATA = 0xffd;
export const RISC_OS_FILETYPE_TEXT = 0xfff;

/** The whole application, including its resources, is bounded. */
export const MAX_APPLICATION_BYTES = 16 * 1024 * 1024;

/** Names whose type RISC OS decides rather than the author. */
const REQUIRED_TYPES = new Map<string, number>([
  ['!Run', RISC_OS_FILETYPE_OBEY],
  ['!Boot', RISC_OS_FILETYPE_OBEY],
  ['!Sprites', RISC_OS_FILETYPE_SPRITE],
]);

export interface RiscOsApplicationFile {
  path: string;
  bytes: Uint8Array;
  filetype: number;
  /** HostFS uses the `,xxx` suffix as its lossless filetype transport. */
  hostFsPath: string;
}

export interface RiscOsApplicationPackage {
  schema: '8bit-net.riscos-application';
  version: 2;
  applicationName: string;
  rootDirectory: string;
  executableFormat: 'absolute';
  executableLoadAddress: 0x8000;
  executablePath: string;
  launchPath: string;
  files: RiscOsApplicationFile[];
}

const typeSuffix = (filetype: number) => filetype.toString(16).padStart(3, '0');

function typedFile(path: string, bytes: Uint8Array, filetype: number): RiscOsApplicationFile {
  return { path, bytes, filetype, hostFsPath: `${path},${typeSuffix(filetype)}` };
}

/**
 * Attach the minimum truthful RISC OS application-directory contract to a raw
 * ARM2 image. FileSwitch defines type &FF8 as absolute code loaded and run at
 * &8000, so no other origin or entry point can be silently repackaged as one.
 */
export function createRiscOsAbsoluteApplication(artifact: ArmArtifact, requestedName: string): RiscOsApplicationPackage {
  const applicationName = normalizeApplicationName(requestedName);
  if (artifact.processor !== 'arm2' || artifact.endianness !== 'little' || artifact.containerFormat !== 'raw') throw new Error('Only a raw little-endian ARM2 artifact can use the first RISC OS Absolute packager.');
  if (artifact.origin !== 0x8000 || artifact.entryPoint !== 0x8000) throw new Error('RISC OS Absolute files are loaded and run at &00008000; rebuild this target with origin and entry point &00008000.');
  if (!artifact.bytes.length) throw new Error('A RISC OS application cannot contain an empty RunImage.');
  if (artifact.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) throw new Error('Resolve build errors before packaging a RISC OS application.');

  const rootDirectory = `!${applicationName}`;
  const runScript = new TextEncoder().encode('Run <Obey$Dir>.RunImage %*0\n');
  const files: RiscOsApplicationFile[] = [
    typedFile(`${rootDirectory}/!Run`, runScript, RISC_OS_FILETYPE_OBEY),
    typedFile(`${rootDirectory}/RunImage`, artifact.bytes.slice(), RISC_OS_FILETYPE_ABSOLUTE),
  ];
  return {
    schema: '8bit-net.riscos-application', version: 2, applicationName, rootDirectory,
    executableFormat: 'absolute', executableLoadAddress: 0x8000,
    executablePath: `${rootDirectory}.RunImage`, launchPath: rootDirectory, files,
  };
}

/**
 * Add a resource at a path inside the application.
 *
 * The path is relative to the application directory and may name
 * subdirectories, which are created by being mentioned. Validation runs on the
 * result, so a resource that would make the application invalid never becomes
 * part of it.
 */
export function addApplicationResource(
  application: RiscOsApplicationPackage,
  relativePath: string,
  bytes: Uint8Array,
  filetype: number,
): RiscOsApplicationPackage {
  const cleaned = relativePath.replace(/^\/+|\/+$/g, '');
  if (!cleaned) throw new Error('A resource needs a name.');
  const path = `${application.rootDirectory}/${cleaned}`;
  if (application.files.some((file) => file.path.toLocaleUpperCase('en-GB') === path.toLocaleUpperCase('en-GB'))) {
    throw new Error(`${application.rootDirectory} already holds ${cleaned}, and RISC OS does not distinguish names by case.`);
  }
  const next: RiscOsApplicationPackage = { ...application, files: [...application.files, typedFile(path, bytes.slice(), filetype)] };
  validateRiscOsApplication(next);
  return next;
}

/** Remove a resource. `!Run` and `RunImage` are not removable. */
export function removeApplicationResource(application: RiscOsApplicationPackage, path: string): RiscOsApplicationPackage {
  if (path === `${application.rootDirectory}/!Run` || path === `${application.rootDirectory}/RunImage`) {
    throw new Error(`${path} is what makes this an application FileSwitch will launch, so it cannot be removed.`);
  }
  const next: RiscOsApplicationPackage = { ...application, files: application.files.filter((file) => file.path !== path) };
  if (next.files.length === application.files.length) throw new Error(`This application holds nothing at ${path}.`);
  validateRiscOsApplication(next);
  return next;
}

export function validateRiscOsApplication(application: RiscOsApplicationPackage): void {
  if (application.schema !== '8bit-net.riscos-application' || application.version !== 2) throw new Error('Unsupported RISC OS application package schema.');
  const expectedRoot = `!${normalizeApplicationName(application.applicationName)}`;
  if (application.rootDirectory !== expectedRoot || application.launchPath !== expectedRoot) throw new Error('RISC OS application root and launch paths must match its application name.');
  if (application.executableFormat !== 'absolute' || application.executableLoadAddress !== 0x8000) throw new Error('The first application packager supports only RISC OS Absolute executables at &00008000.');
  if (application.executablePath !== `${expectedRoot}.RunImage`) throw new Error('The Absolute executable must be the application’s RunImage.');

  const seen = new Set<string>();
  const directories = new Set<string>();
  let total = 0;
  for (const file of application.files) {
    if (!file.path.startsWith(`${expectedRoot}/`)) throw new Error(`${file.path} is not inside ${expectedRoot}.`);
    const identity = file.path.toLocaleUpperCase('en-GB');
    if (seen.has(identity)) throw new Error(`${file.path} appears twice, and RISC OS does not distinguish names by case.`);
    seen.add(identity);
    if (!file.bytes.length) throw new Error(`${file.path} is empty.`);
    if (!Number.isInteger(file.filetype) || file.filetype < 0 || file.filetype > 0xfff) throw new Error(`${file.path} has no valid RISC OS filetype.`);
    if (file.hostFsPath !== `${file.path},${typeSuffix(file.filetype)}`) throw new Error(`HostFS metadata suffix does not match ${file.path}.`);

    const segments = file.path.split('/');
    const leaf = segments[segments.length - 1]!;
    segments.forEach((segment, index) => {
      /* Every segment has to be a name ADFS can hold, because the application
       * has to be able to reach a disc as well as HostFS. */
      const problem = adfsNameProblem(segment);
      if (problem) throw new Error(`${file.path}: ${problem}`);
      if (index < segments.length - 1) directories.add(segments.slice(0, index + 1).join('/'));
    });
    const required = REQUIRED_TYPES.get(leaf);
    if (required !== undefined && file.filetype !== required) {
      throw new Error(`${file.path} must have RISC OS filetype &${required.toString(16).toUpperCase()}; RISC OS decides that one, not the author.`);
    }
    total += file.bytes.length;
  }
  for (const directory of directories) {
    /* A path that is a file in one entry and a directory prefix in another
     * describes a tree that cannot exist, and would otherwise be discovered
     * only when the disc writer tried to build it. */
    if (seen.has(directory.toLocaleUpperCase('en-GB'))) throw new Error(`${directory} is both a file and a directory.`);
  }
  if (total > MAX_APPLICATION_BYTES) throw new Error(`A RISC OS application is limited to ${(MAX_APPLICATION_BYTES / 1024 / 1024).toFixed(0)} MiB; this one is ${total.toLocaleString()} bytes.`);

  const run = application.files.find((file) => file.path === `${expectedRoot}/!Run`);
  const runImage = application.files.find((file) => file.path === `${expectedRoot}/RunImage`);
  if (!run) throw new Error(`${expectedRoot} has no !Run, so nothing would launch it.`);
  if (!runImage) throw new Error(`${expectedRoot} has no RunImage, so !Run has nothing to run.`);
  if (runImage.filetype !== RISC_OS_FILETYPE_ABSOLUTE) throw new Error('RunImage must have RISC OS filetype Absolute (&FF8).');
}

/**
 * The application as a tree, which is the shape a disc writer needs.
 *
 * Derived rather than stored, so the paths remain the only description of where
 * anything is.
 */
export function applicationTree(application: RiscOsApplicationPackage): AdfsNodeRequest[] {
  validateRiscOsApplication(application);
  interface Node { name: string; children: Map<string, Node>; file: RiscOsApplicationFile | null }
  const root: Node = { name: application.rootDirectory, children: new Map(), file: null };
  for (const file of application.files) {
    const segments = file.path.split('/').slice(1);
    let node = root;
    segments.forEach((segment, index) => {
      const last = index === segments.length - 1;
      const existing = node.children.get(segment);
      const next = existing ?? { name: segment, children: new Map(), file: null };
      if (!existing) node.children.set(segment, next);
      if (last) next.file = file;
      node = next;
    });
  }
  const convert = (node: Node): AdfsNodeRequest => node.file
    ? { name: node.name, bytes: node.file.bytes, filetype: node.file.filetype }
    : { name: node.name, children: [...node.children.values()].map(convert) };
  return [convert(root)];
}

/**
 * Write the application onto an ADFS E floppy image.
 *
 * This is the transfer path for a machine with no HostFS: the disc holds the
 * whole application directory, subdirectories and all, and the writer reads it
 * back through the product's own parser before handing it over.
 */
export function createApplicationDisc(application: RiscOsApplicationPackage, title?: string): CreatedAdfsEImage {
  return createAdfsEDisc({ title: title?.trim() || application.applicationName, files: applicationTree(application) });
}

/**
 * The application as a zip, using the `,xxx` names RISC OS archivers use.
 *
 * Filetypes survive the archive because they are part of the names, which is
 * the same trick HostFS uses and the reason an application can cross a machine
 * that knows nothing about RISC OS metadata without losing what it is.
 */
export function createApplicationArchive(application: RiscOsApplicationPackage): Uint8Array {
  validateRiscOsApplication(application);
  const entries: Record<string, Uint8Array> = {};
  /* Copied into this realm's Uint8Array before it is handed to the archiver.
   * Typed arrays made elsewhere — by a document's own TextEncoder, for one —
   * fail an `instanceof` check the archiver uses to tell a file from a folder,
   * and the failure is silent: the bytes come out as a directory of numbered
   * empty entries rather than as the file. */
  for (const file of application.files) entries[file.hostFsPath] = new Uint8Array(file.bytes);
  /* No compression: the archive is a transfer container, and a stored entry is
   * reproducible byte for byte from the same input. */
  return zipSync(entries, { level: 0 });
}

function normalizeApplicationName(value: string): string {
  const withoutBang = value.trim().replace(/^!+/, '');
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,8}$/.test(withoutBang)) throw new Error('Application name must contain 1–9 letters, digits, underscores or hyphens, beginning with a letter.');
  return withoutBang;
}
