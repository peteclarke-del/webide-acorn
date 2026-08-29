/* The versioning policy, written from the constants it describes.
 *
 * A policy document that names version numbers goes stale the first time one
 * of them changes, and a stale policy is worse than none: it is a commitment
 * the product no longer keeps, in writing. So the numbers here are imported
 * from the modules that define them, and a contract compares the checked-in
 * document against what this renders. The prose is a promise; the numbers
 * cannot drift away from it.
 *
 * The policy itself is short because the product's actual rule is short: every
 * version of a document this product has ever written stays readable, and a
 * document from a newer build is refused by name rather than half-parsed.
 * Everything below is that rule applied to each versioned surface.
 */
import { PROJECT_FORMAT, PROJECT_FORMAT_VERSION } from '../project/project';
import { PROJECT_BUNDLE_SCHEMA, PROJECT_BUNDLE_VERSION } from '../project/projectBundle';
import { BUILD_TARGET_SCHEMA, TOOLCHAIN_REGISTRY_VERSION } from '../build/buildTarget';
import { EMULATOR_ADAPTER_API_VERSION } from '../emulator/adapterContract';
import { ANALYSIS_ANNOTATIONS_SCHEMA, ANALYSIS_ANNOTATIONS_VERSION } from '../analysis/analysisAnnotations';
import { DISK_SET_SCHEMA, DISK_SET_VERSION } from '../media/diskSet';
import { SETTINGS_SCHEMA, SETTINGS_VERSION } from '../settings/settings';
import { TEMPLATE_CATALOGUE_SCHEMA, TEMPLATE_CATALOGUE_VERSION } from '../project/templateCatalogue';
import { PROFILE_MANIFEST_SCHEMA, PROFILE_MANIFEST_VERSION } from '../profiles/profileManifest';

export interface VersionedSurface {
  name: string;
  identifier: string;
  version: string;
  /** What is promised to a person holding an older one. */
  compatibility: string;
}

/** Every surface this product versions, with the rule that governs it. */
export function versionedSurfaces(): VersionedSurface[] {
  return [
    {
      name: 'Project document',
      identifier: PROJECT_FORMAT,
      version: String(PROJECT_FORMAT_VERSION),
      compatibility: `Every version from 1 to ${PROJECT_FORMAT_VERSION} opens and is migrated forward on the way in. A document declaring a higher version is refused by name, saying which version it carries and which this build reads.`,
    },
    {
      name: 'Portable project bundle',
      identifier: PROJECT_BUNDLE_SCHEMA,
      version: String(PROJECT_BUNDLE_VERSION),
      compatibility: 'Contents are verified against the bundle’s own integrity manifest before anything is migrated, so a migration never runs over contents that are not what the author sent. A bundle from a newer build is refused as newer rather than as malformed.',
    },
    {
      name: 'Build target',
      identifier: 'build-target.schemaVersion',
      version: String(BUILD_TARGET_SCHEMA),
      compatibility: 'Migrated forward when a project document is opened. A target that names a toolchain this build does not register keeps its declaration and is reported as unavailable rather than silently reassigned.',
    },
    {
      name: 'Toolchain registry',
      identifier: 'toolchain-registry',
      version: TOOLCHAIN_REGISTRY_VERSION,
      compatibility: 'A build records the toolchain identity and version that produced it. Changing a toolchain changes this version, so an artifact can always be traced to what made it.',
    },
    {
      name: 'Emulator adapter API',
      identifier: 'emulator-adapter',
      version: String(EMULATOR_ADAPTER_API_VERSION),
      compatibility: 'An adapter declares the API version it implements, every operation it supports, and its limitations. An adapter declaring a different API version is not loaded.',
    },
    {
      name: 'Analysis annotations',
      identifier: ANALYSIS_ANNOTATIONS_SCHEMA,
      version: String(ANALYSIS_ANNOTATIONS_VERSION),
      compatibility: 'Bound to the SHA-256 of the bytes described, so annotations follow the program rather than a filename and are never applied to different bytes.',
    },
    {
      name: 'Disk set',
      identifier: DISK_SET_SCHEMA,
      version: String(DISK_SET_VERSION),
      compatibility: 'Carried inside the project document and migrated with it.',
    },
    {
      name: 'Settings',
      identifier: SETTINGS_SCHEMA,
      version: String(SETTINGS_VERSION),
      compatibility: 'A stored value the current schema refuses is dropped on the way in rather than applied, and the default is used.',
    },
    {
      name: 'Machine profile manifest',
      identifier: PROFILE_MANIFEST_SCHEMA,
      version: String(PROFILE_MANIFEST_VERSION),
      compatibility: 'Every earlier version is read and migrated forward, with everything changed or dropped reported rather than applied in silence. A field the manifest’s own version predates is absent rather than missing, so a version 1 capability carries no variant restriction because version 1 could not express one. A capability whose state this build does not define is dropped and named rather than defaulted, because defaulting would either claim hardware or remove it.',
    },
    {
      name: 'Template catalogue',
      identifier: TEMPLATE_CATALOGUE_SCHEMA,
      version: String(TEMPLATE_CATALOGUE_VERSION),
      compatibility: 'Shipped with the build rather than stored, so it has no backward-compatibility obligation. It is validated by a contract at build time.',
    },
  ];
}

function table(headings: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return [
    `| ${headings.join(' | ')} |`,
    `| ${headings.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/** The document, as Markdown. Deterministic, so a test can compare it. */
export function renderVersioningPolicy(): string {
  return [
    '# Release, versioning and deprecation policy',
    '',
    'This document is generated from the constants it describes. A policy that',
    'names version numbers goes stale the first time one of them changes, and a',
    'stale policy is worse than none: it is a commitment the product no longer',
    'keeps, in writing. A contract fails the release gate whenever this document',
    'stops matching the code. Regenerate it with `npm run policy`.',
    '',
    '## The rule',
    '',
    'Every version of a document this product has ever written stays readable. A',
    'document from a newer build is refused by name — saying which version it',
    'carries and which this build reads — rather than parsed as though the fields',
    'it does not contain were simply absent. A newer document is not a corrupt',
    'one, and the difference is the difference between "update the workbench" and',
    '"your project is broken".',
    '',
    '## Versioned surfaces',
    '',
    table(
      ['Surface', 'Identifier', 'Version', 'What is promised'],
      versionedSurfaces().map((surface) => [surface.name, `\`${surface.identifier}\``, surface.version, surface.compatibility]),
    ),
    '',
    '## When a version goes up',
    '',
    '- **A stored document** — whenever a field is added, removed or changes meaning. The reader accepts every earlier version and migrates it forward; the writer only ever writes the current one.',
    '- **A registry or catalogue shipped with the build** — machine profiles, toolchains, reference packs. These are not stored in anyone’s project, so they carry a version for provenance rather than for compatibility: an artifact records the version that produced it.',
    '- **An adapter API** — whenever the contract an adapter implements changes. An adapter declaring a different version is not loaded, because a partially-matching adapter is the one failure mode that produces wrong answers rather than no answers.',
    '',
    '## Deprecation',
    '',
    'A capability is never removed silently.',
    '',
    '1. It is marked in the interface and in the compatibility matrix, with what replaces it.',
    '2. It keeps working for at least one further release.',
    '3. When it is removed, anything that still names it reports the removal by name and says what to use instead. Nothing is substituted for it.',
    '',
    'A machine capability declared `planned` has never been fitted and is not a',
    'deprecation. It is listed because the machine has the hardware, not because',
    'this build does anything with it.',
    '',
    '## What a release states',
    '',
    'Every release records the project format version it writes, the toolchain',
    'registry version its builds were produced with, the vendored component',
    'revisions and their licences, and the compatibility matrix generated from',
    'the catalogues in that build. All four are checked by the release gate.',
    '',
  ].join('\n');
}
