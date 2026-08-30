/* The compatibility matrix, generated from the catalogues rather than written.
 *
 * A hand-written support table is a promise made once and then left behind by
 * the code. This one is derived from the same declarations the product runs
 * on — the machine profiles, the adapter support map, the toolchain registry
 * and the emulator adapter descriptors — and a contract test compares the
 * checked-in document against what this module produces. A support claim
 * therefore cannot outlive the thing it describes: change what the product
 * does and the document either changes with it or the release gate fails.
 *
 * The tiers are defined here rather than assumed, because "supported" is the
 * word most often stretched:
 *
 *   Runnable    a qualified emulator core in this build executes the machine,
 *               with firmware the person supplies.
 *   Described   the product models the machine — its variants, ROM sets and
 *               hardware — and no core in this build executes it. Nothing is
 *               substituted for it.
 *   Fitted      a capability the machine has and this build drives.
 *   Preview     a capability that does something, with known gaps.
 *   Planned     not fitted. It is listed because the machine has it, not
 *               because this build does anything with it.
 *
 * The distinction that matters most is the last one. A planned capability is
 * an absence, and this document is the place it has to be readable as one.
 */
import { machineProfiles } from './machines';
import { ADAPTER_SUPPORT, type AdapterMachineSupport } from '../rom/adapterSupport';
import { TOOLCHAINS } from '../build/buildTarget';
import { productionAdapterDescriptors } from '../emulator/adapterContract';
import { ELECTRON_ADAPTER_SUMMARY, ELECTRON_CAPABILITIES, ELECTRON_UNAVAILABLE } from '../emulator/electronAdapter';

export type SupportTier = 'runnable' | 'described';

export interface MachineRow {
  id: string;
  label: string;
  cpu: string;
  memory: string;
  tier: SupportTier;
  engine: string;
  variants: number;
  romSets: number;
  fitted: string[];
  preview: string[];
  planned: string[];
  limitation: string;
}

function tierOf(support: AdapterMachineSupport): SupportTier {
  return support.state === 'runnable' ? 'runnable' : 'described';
}

/** One row per machine, from the profile and the adapter support map together. */
export function machineRows(): MachineRow[] {
  return machineProfiles.map((machine) => {
    const support = ADAPTER_SUPPORT.find((entry) => entry.machineId === machine.id);
    const byState = (state: string) => machine.capabilities.filter((capability) => capability.state === state).map((capability) => capability.label);
    return {
      id: machine.id,
      label: machine.label,
      cpu: machine.cpu,
      memory: machine.memory,
      tier: support ? tierOf(support) : 'described',
      /* Naming a core beside a machine it will not run reads as a support
       * claim. A machine that is only described says what is missing instead. */
      engine: !support ? 'no adapter record'
        : support.state === 'runnable' && support.engine ? `${support.engine.id} ${support.engine.version}`
        : support.state === 'no-rom-manifest' ? 'no ROM manifest registered here'
        : 'no model in any core here',
      variants: machine.variants.length,
      romSets: machine.roms.length,
      fitted: byState('supported'),
      preview: byState('preview'),
      planned: byState('planned'),
      limitation: support?.limitation ?? 'No adapter support record is registered for this machine in this build.',
    };
  });
}

function table(headings: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return [
    `| ${headings.join(' | ')} |`,
    `| ${headings.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const list = (values: readonly string[]) => values.length ? values.join(', ') : '—';

/**
 * The document, as Markdown. Deterministic: the same catalogues always produce
 * the same bytes, so a test can compare it against the file on disk.
 */
export function renderCompatibilityMatrix(): string {
  const rows = machineRows();
  const runnable = rows.filter((row) => row.tier === 'runnable');

  const sections: string[] = [];

  sections.push([
    '# Compatibility matrix',
    '',
    'This document is generated from the machine profiles, the adapter support',
    'map, the toolchain registry and the emulator adapter descriptors that the',
    'product actually runs on. It is not maintained by hand, and a contract test',
    'fails the release gate whenever it stops matching the code. Regenerate it',
    'with `npm run compatibility`.',
    '',
    '## What the words mean',
    '',
    '- **Runnable** — a qualified emulator core in this build executes the machine, with firmware you supply yourself.',
    '- **Described** — the product models the machine, its variants, ROM sets and hardware, and no core in this build executes it. Nothing is substituted for it.',
    '- **Fitted** — a capability the machine has and this build drives.',
    '- **Preview** — a capability that does something, with known gaps.',
    '- **Planned** — not fitted. It is listed because the machine has it, not because this build does anything with it.',
    '',
    'No firmware is distributed with this product. Every runnable machine needs',
    'ROM images you own and supply.',
  ].join('\n'));

  sections.push([
    '## Machines',
    '',
    `${runnable.length} of ${rows.length} registered machine profiles are runnable in this build.`,
    '',
    table(
      ['Machine', 'CPU', 'RAM', 'Tier', 'Emulator core', 'Variants', 'ROM sets'],
      rows.map((row) => [row.label, row.cpu, row.memory, row.tier === 'runnable' ? 'Runnable' : 'Described', row.engine, String(row.variants), String(row.romSets)]),
    ),
  ].join('\n'));

  sections.push([
    '## Hardware capabilities, by machine',
    '',
    'A planned capability is an absence. It appears here so that it can be read as one.',
    '',
    table(
      ['Machine', 'Fitted', 'Preview', 'Planned'],
      rows.map((row) => [row.label, list(row.fitted), list(row.preview), list(row.planned)]),
    ),
  ].join('\n'));

  sections.push([
    '## Known inaccuracies and limitations',
    '',
    ...rows.map((row) => `- **${row.label}** — ${row.limitation}`),
  ].join('\n'));

  sections.push([
    '## Toolchains',
    '',
    'Every toolchain here is deterministic: the same source and the same target',
    'produce the same bytes. Browser-local toolchains run in this tab. Isolated',
    'native toolchains run in the service container.',
    '',
    table(
      ['Toolchain', 'Version', 'Language', 'Processor', 'Output', 'Runs'],
      TOOLCHAINS.map((toolchain) => [
        toolchain.label,
        toolchain.version,
        toolchain.language,
        toolchain.processor ?? '—',
        toolchain.artifactKind,
        toolchain.execution === 'browser-local' ? 'in this browser' : 'in the isolated container',
      ]),
    ),
  ].join('\n'));

  const adapters = Object.values(productionAdapterDescriptors);
  sections.push([
    '## Emulator adapters',
    '',
    table(
      ['Adapter', 'Version', 'Operations unavailable', 'Limitations'],
      [
        ...adapters.map((descriptor) => [
          descriptor.id,
          descriptor.version,
          list(Object.entries(descriptor.operations).filter(([, available]) => !available).map(([name]) => name)),
          list(descriptor.limitations),
        ]),
        [
          'elkjs',
          'ff123355',
          `${Object.keys(ELECTRON_UNAVAILABLE).length} of ${ELECTRON_CAPABILITIES.length + Object.keys(ELECTRON_UNAVAILABLE).length} declared capabilities`,
          ELECTRON_ADAPTER_SUMMARY.replace(/\s+/g, ' ').trim(),
        ],
      ],
    ),
  ].join('\n'));

  sections.push([
    '## Portability guarantees',
    '',
    '- A project document opens in any build whose format version is at least the one it declares. Every version this product has ever written is still readable, and a document from a newer build is refused by name rather than parsed as though its missing fields were simply absent.',
    '- A portable bundle carries an integrity manifest. Its contents are verified against their recorded digests before anything is migrated, so a migration never runs over contents that are not what the author sent.',
    '- A build is reproducible: the same source, target and toolchain produce identical bytes, and the build records the toolchain identity and version that produced them.',
    '- No firmware, disk image, credential or captured session is ever part of this product or its bundles. The release gate scans for all four.',
    '',
    '## Upstream components and licences',
    '',
    'Every vendored component, its upstream revision and its licence are recorded in',
    '`docs/third-party-components.md`, with checksums verified by the release gate.',
  ].join('\n'));

  return `${sections.join('\n\n')}\n`;
}
