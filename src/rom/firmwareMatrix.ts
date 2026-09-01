/*
 * Which firmware each machine needs, and what this product does and does not do
 * with it.
 *
 * Generated from the ROM manifests, the Archimedes firmware profiles and the
 * adapter support map, so it says what the code requires rather than what
 * somebody once wrote down. A contract test regenerates it and fails the
 * release gate the moment the two disagree.
 *
 * The reason it exists at all is that firmware is the one input this product
 * asks a person for and cannot supply. Every other input is theirs already or
 * this build's to make. So what it needs, what it will accept, where it puts it
 * and what it never does with it are worth stating in one place rather than
 * being spread across a manifest, a store and a policy.
 */
import { ADAPTER_SUPPORT } from './adapterSupport';
import { ARCHIMEDES_ROM_PROFILES } from './archimedesRom';
import { ROM_SETS, romStorageKey, type RomRequirement } from './romProfiles';
import { machineProfiles } from '../data/machines';

const size = (bytes: number): string => (bytes % 1024 === 0 ? `${bytes / 1024} KiB` : `${bytes.toLocaleString()} bytes`);

function requirementRow(setId: string, requirement: RomRequirement): string[] {
  const need = requirement.required
    ? 'required'
    : `optional · needed for ${requirement.requiredByCapability ?? 'a capability that is not recorded'}`;
  return [
    requirement.label,
    requirement.purpose.replace('-', ' '),
    need,
    requirement.acceptedSizes.map(size).join(' or '),
    `\`${romStorageKey(setId, requirement)}\``,
    requirement.provenanceNote ?? (requirement.supportStatus === 'development' ? 'Development snapshot; re-import after a firmware rebuild.' : '—'),
  ];
}

function table(headings: string[], rows: string[][]): string {
  return [
    `| ${headings.join(' | ')} |`,
    `| ${headings.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`),
  ].join('\n');
}

export function renderFirmwareMatrix(): string {
  const sections: string[] = [];

  sections.push([
    '# Firmware matrix',
    '',
    'Generated from the ROM manifests, the Archimedes firmware profiles and the',
    'adapter support map. It is not maintained by hand, and a contract test fails',
    'the release gate whenever it stops matching the code.',
    '',
    '## What this product does with firmware',
    '',
    '- **It never ships any.** No ROM, disc or tape image is in this repository or',
    '  in the container image, and an executable check refuses one that is added.',
    '  The machine you run is one you supplied the firmware for.',
    '- **Ownership does not change.** The images are yours. This build stores them',
    '  in your browser and serves them to the emulator frame; nothing is uploaded,',
    '  and a project export deliberately excludes them, so a project you send to',
    '  somebody else does not carry firmware they may not have.',
    '- **Storage is origin-private.** The vault is IndexedDB under this origin,',
    '  read back through a service worker at `/user-roms/`, which is what lets an',
    '  emulator frame ask for a ROM by path without a general-purpose file',
    '  endpoint existing.',
    '- **A manifest checks size, not content.** Each entry below names the lengths',
    '  it accepts, so a wrong file is refused before it can produce a machine that',
    '  half works. It is not a hash: this build does not hold a list of accepted',
    '  digests, and inventing one would refuse legitimate regional and revision',
    '  variants somebody owns.',
    '- **Continuous integration is given the same files.** The headless runner',
    '  takes a ROM manifest naming local paths, so a pipeline supplies firmware the',
    '  same way a person does. There is no substitute image and no ROM-less mode',
    '  for the paths that need one; a run without firmware is reported as a run',
    '  that did not happen.',
    '',
  ].join('\n'));

  sections.push(['## ROM sets', ''].join('\n'));
  for (const set of ROM_SETS) {
    const machines = set.machineIds
      .map((id) => machineProfiles.find((profile) => profile.id === id)?.label ?? id)
      .join(', ');
    const support = ADAPTER_SUPPORT.find((entry) => entry.romSetIds.includes(set.id));
    sections.push([
      `### ${set.label}`,
      '',
      `- Machines: ${machines}`,
      `- Engine: ${set.engine.id} ${set.engine.version}${support ? '' : ' · not advertised, because this build cannot start that engine yet'}`,
      `- Adapter model: \`${set.adapterModel}\``,
      '',
      table(
        ['ROM', 'Purpose', 'Needed', 'Accepted length', 'Vault key', 'Note'],
        set.requirements.map((requirement) => requirementRow(set.id, requirement)),
      ),
      '',
    ].join('\n'));
  }

  sections.push([
    '## Archimedes firmware',
    '',
    'The Archimedes profiles are not ROM sets in the sense above: a machine takes',
    'one image built from four byte-lane ROMs interleaved together, plus a CMOS',
    'image. The lanes are named because that is how the files arrive.',
    '',
    table(
      ['Profile', 'Arculator ROM set', 'Byte lanes', 'Lane length', 'CMOS'],
      ARCHIMEDES_ROM_PROFILES.map((profile) => [
        profile.label,
        `\`${profile.arculatorRomSet}\``,
        profile.laneFilenames.map((name) => `\`${name}\``).join(', '),
        size(profile.laneSize),
        `\`${profile.cmosFilename}\``,
      ]),
    ),
    '',
  ].join('\n'));

  sections.push([
    '## What is not here',
    '',
    '- **Accepted digests.** Length is the only check. A per-image hash list would',
    '  reject the regional and revision variants people legitimately own, and this',
    '  build has measured none of them.',
    '- **Redistribution.** There is nothing to state a position on, because nothing',
    '  is redistributed.',
    '- **Sharing between people.** Firmware is not part of a project export and the',
    '  store holds none, so there is no sharing rule to write.',
    '',
  ].join('\n'));

  return `${sections.join('\n')}\n`;
}
