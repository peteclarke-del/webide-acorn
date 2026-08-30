/* Machine profiles that arrive from outside this build.
 *
 * The shipped catalogue is a TypeScript literal and is checked by a contract,
 * so it cannot be wrong at run time. A manifest is the other case: a profile
 * written by someone else, exported by an older build, or carried inside a
 * project, none of which this build wrote and none of which it can assume.
 *
 * Two things follow, and they are the whole of this module.
 *
 * A manifest declares its schema version, and every version this product has
 * written stays readable. A manifest from a newer build is refused by name —
 * saying which version it carries and which this build reads — rather than
 * parsed as though the fields it does not contain were simply absent. That
 * distinction is the difference between "update the workbench" and "your
 * profile is broken", and only one of those is true.
 *
 * A field this build cannot use is dropped and reported, never guessed at. A
 * capability whose state is not one this product defines is not quietly
 * promoted to `supported`, because a machine claiming hardware it does not have
 * is the one failure this catalogue exists to prevent.
 */
import type { MachineCapability, MachineProfile, RomProfile } from '../types';
import { platformClasses } from '../data/machines';

export const PROFILE_MANIFEST_SCHEMA = '8bit-net.machine-profile';

/**
 * The manifest schema version this build writes.
 *
 * 1. The original shape: identity, hardware description, variants, ROM
 *    profiles and capabilities.
 * 2. Adds `requiresVariant` to a capability, so a peripheral that only exists
 *    on one variant cannot be enabled on the others. Version 1 manifests are
 *    read with that field absent, which means the capability is unrestricted —
 *    which is what version 1 meant.
 */
export const PROFILE_MANIFEST_VERSION = 2;

/* The version at which a capability could name the variant it needs. Below it
 * the field did not exist, so its absence is not missing information. */
const REQUIRES_VARIANT_FROM = 2;

const CAPABILITY_STATES = new Set(['supported', 'preview', 'planned']);

export interface ProfileManifest {
  schema: typeof PROFILE_MANIFEST_SCHEMA;
  version: number;
  profile: MachineProfile;
}

export type ManifestNoteKind =
  | 'migrated'
  | 'dropped-capability'
  | 'dropped-rom'
  | 'dropped-variant'
  | 'defaulted-field'
  | 'unknown-platform-class';

export interface ManifestNote {
  kind: ManifestNoteKind;
  /** What the manifest said. */
  found: string;
  /** What this build did about it, in the user's terms. */
  reason: string;
}

export interface ManifestReadResult {
  profile: MachineProfile;
  /** Everything changed or dropped on the way in. Never silent. */
  notes: ManifestNote[];
  /** The version the manifest declared, before any migration. */
  from: number;
}

function text(value: unknown, limit = 120): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function readCapability(candidate: unknown, version: number, notes: ManifestNote[]): MachineCapability | null {
  if (!candidate || typeof candidate !== 'object') {
    notes.push({ kind: 'dropped-capability', found: '(not an object)', reason: 'A capability must be an object, so this entry was dropped rather than guessed at.' });
    return null;
  }
  const entry = candidate as Record<string, unknown>;
  const id = text(entry.id, 60);
  const label = text(entry.label, 80);
  if (!id || !label) {
    notes.push({ kind: 'dropped-capability', found: id || label || '(unnamed)', reason: 'A capability needs both an identifier and a label to be shown or enabled, so this entry was dropped.' });
    return null;
  }
  const state = text(entry.state, 20);
  if (!CAPABILITY_STATES.has(state)) {
    /* Deliberately dropped rather than defaulted. Defaulting to `supported`
     * would claim hardware; defaulting to `planned` would silently remove a
     * capability the machine has. Neither is this build's decision to make. */
    notes.push({ kind: 'dropped-capability', found: `${label} (state ${state || 'absent'})`, reason: `A capability state must be supported, preview or planned. This build will not guess which, so ${label} was dropped rather than have a state invented for it.` });
    return null;
  }
  const capability: MachineCapability = {
    id,
    label,
    description: text(entry.description, 200),
    state: state as MachineCapability['state'],
    defaultEnabled: entry.defaultEnabled === true,
  };
  /* Free prose about what a capability still needs. Carried through rather
   * than dropped: it is often the only thing telling a reader why something
   * is planned instead of fitted. */
  const requirement = text(entry.requirement, 200);
  if (requirement) capability.requirement = requirement;
  /* A field the manifest's own version predates is absent rather than missing:
   * version 1 had no per-variant restriction, so a version 1 capability is
   * unrestricted, which is exactly what it meant. */
  if (version >= REQUIRES_VARIANT_FROM) {
    const requires = text(entry.requiresVariant, 80);
    if (requires) capability.requiresVariant = requires;
  }
  return capability;
}

function readRom(candidate: unknown, notes: ManifestNote[]): RomProfile | null {
  if (!candidate || typeof candidate !== 'object') {
    notes.push({ kind: 'dropped-rom', found: '(not an object)', reason: 'A ROM profile must be an object, so this entry was dropped.' });
    return null;
  }
  const entry = candidate as Record<string, unknown>;
  const id = text(entry.id, 60);
  const label = text(entry.label, 100);
  if (!id || !label) {
    notes.push({ kind: 'dropped-rom', found: id || label || '(unnamed)', reason: 'A ROM profile needs both an identifier and a label to be selected, so this entry was dropped.' });
    return null;
  }
  return { id, label, detail: text(entry.detail, 200) };
}

export class ProfileManifestError extends Error {
  constructor(message: string) { super(message); this.name = 'ProfileManifestError'; }
}

/**
 * Read a machine profile manifest, migrating it forward and reporting
 * everything that changed on the way in.
 *
 * Throws only when the document is not a manifest at all, or declares a version
 * this build cannot read. Everything else is a note: a manifest that is partly
 * usable is more useful than one refused whole, provided nothing is invented
 * and nothing is dropped in silence.
 */
export function readProfileManifest(candidate: unknown): ManifestReadResult {
  if (!candidate || typeof candidate !== 'object') throw new ProfileManifestError('A machine profile manifest must be an object.');
  const manifest = candidate as Record<string, unknown>;
  if (manifest.schema !== PROFILE_MANIFEST_SCHEMA) {
    throw new ProfileManifestError(`A machine profile manifest must declare schema ${PROFILE_MANIFEST_SCHEMA}, not ${JSON.stringify(manifest.schema ?? null)}.`);
  }
  const version = manifest.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProfileManifestError(`A machine profile manifest must declare a whole version number of at least 1, not ${JSON.stringify(version ?? null)}.`);
  }
  if (version > PROFILE_MANIFEST_VERSION) {
    throw new ProfileManifestError(`This machine profile was written by a newer version of the workbench (manifest version ${version}; this build reads up to ${PROFILE_MANIFEST_VERSION}). Update the workbench to use it.`);
  }
  const source = manifest.profile;
  if (!source || typeof source !== 'object') throw new ProfileManifestError('The manifest carries no machine profile.');
  const raw = source as Record<string, unknown>;

  const notes: ManifestNote[] = [];
  const id = text(raw.id, 60);
  const label = text(raw.label, 100);
  if (!id || !label) throw new ProfileManifestError('A machine profile needs both an identifier and a label; without them it cannot be selected or shown.');

  const classes = platformClasses.map((entry) => entry.id) as string[];
  let platformClass = text(raw.platformClass, 40);
  if (!classes.includes(platformClass)) {
    notes.push({
      kind: 'unknown-platform-class',
      found: platformClass || '(absent)',
      reason: `This build registers no platform class called ${platformClass || 'that'}, so ${label} was placed in ${classes[0]} and should be checked before it is used.`,
    });
    platformClass = classes[0]!;
  }

  const variants = Array.isArray(raw.variants)
    ? raw.variants.map((variant) => text(variant, 80)).filter((variant, index, all) => {
      if (!variant) { notes.push({ kind: 'dropped-variant', found: '(empty)', reason: 'A variant needs a name to be selected, so an empty one was dropped.' }); return false; }
      if (all.indexOf(variant) !== index) { notes.push({ kind: 'dropped-variant', found: variant, reason: `${variant} was listed twice; the duplicate was dropped.` }); return false; }
      return true;
    })
    : [];
  if (!variants.length) {
    notes.push({ kind: 'defaulted-field', found: 'variants', reason: `${label} listed no usable variant, so a single "Standard" variant was supplied to keep it selectable.` });
    variants.push('Standard');
  }

  const roms = Array.isArray(raw.roms) ? raw.roms.map((rom) => readRom(rom, notes)).filter((rom): rom is RomProfile => !!rom) : [];
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.map((capability) => readCapability(capability, version, notes)).filter((capability): capability is MachineCapability => !!capability)
    : [];

  if (version < PROFILE_MANIFEST_VERSION) {
    notes.push({
      kind: 'migrated',
      found: `version ${version}`,
      reason: `Written by an earlier build and migrated forward to version ${PROFILE_MANIFEST_VERSION}. A capability from version 1 carries no variant restriction, which is what version 1 meant.`,
    });
  }

  return {
    from: version,
    notes,
    profile: {
      id,
      platformClass: platformClass as MachineProfile['platformClass'],
      family: text(raw.family, 80) || label,
      label,
      shortLabel: text(raw.shortLabel, 40) || label,
      generation: text(raw.generation, 120),
      cpu: text(raw.cpu, 120),
      memory: text(raw.memory, 120),
      variants,
      roms,
      capabilities,
      /* An accent is presentation. A malformed one is corrected rather than
       * refused, because nobody should lose a machine over a colour. */
      accent: /^#[0-9a-f]{6}$/i.test(text(raw.accent, 7)) ? text(raw.accent, 7) : '#8b8b8b',
    },
  };
}

/** Write a profile as a manifest at the version this build produces. */
export function writeProfileManifest(profile: MachineProfile): ProfileManifest {
  return { schema: PROFILE_MANIFEST_SCHEMA, version: PROFILE_MANIFEST_VERSION, profile };
}

/** One line per note, for an interface that has to say what it changed. */
export function manifestNoteSummary(notes: readonly ManifestNote[]): string[] {
  return notes.map((note) => `${note.found}: ${note.reason}`);
}
