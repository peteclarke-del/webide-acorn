import { describe, expect, it } from 'vitest';
import { machineProfiles } from '../data/machines';
import type { MachineProfile, ResolvedTarget } from '../types';
import {
  compareConfigurations,
  configurationSummary,
  resolveConfiguration,
  validateMachineCatalogue,
} from './profileRegistry';

const bbcB = machineProfiles.find((machine) => machine.id === 'bbc-b')!;
const atom = machineProfiles.find((machine) => machine.id === 'atom')!;
const electron = machineProfiles.find((machine) => machine.id === 'electron')!;
const archimedes = machineProfiles.find((machine) => machine.platformClass === '32-bit')!;

const request = (overrides: Partial<Parameters<typeof resolveConfiguration>[0]> = {}) => ({
  platformClass: '8-16-bit',
  machineId: 'bbc-b',
  variant: bbcB.variants[0]!,
  romId: bbcB.roms[0]!.id,
  enabledCapabilities: [] as string[],
  ...overrides,
});

describe('the shipped machine catalogue', () => {
  it('satisfies every rule resolution depends on', () => {
    expect(validateMachineCatalogue()).toEqual([]);
  });

  it('names the problems in a catalogue that does not', () => {
    const broken: MachineProfile[] = [
      { ...bbcB, id: 'bbc-b' },
      { ...atom, id: 'bbc-b', accent: 'red', variants: [], roms: [] },
    ];
    const problems = validateMachineCatalogue(broken);
    const text = problems.map((problem) => `${problem.where}: ${problem.problem}`).join(' | ');
    expect(text).toContain('shares its identifier');
    expect(text).toContain('not a six-digit hexadecimal colour');
    expect(text).toContain('lists no variants');
    expect(text).toContain('lists no ROM profiles');
  });

  it('refuses a capability that is planned yet enabled by default, which resolution would drop', () => {
    const broken: MachineProfile[] = [{
      ...bbcB,
      capabilities: [{ id: 'ghost', label: 'Ghost', description: 'Never applied.', state: 'planned', defaultEnabled: true }],
    }];
    expect(validateMachineCatalogue(broken).map((problem) => problem.problem)).toContain('is planned but enabled by default, which resolution would silently drop');
  });
});

describe('resolving a requested configuration', () => {
  it('reports nothing when everything asked for is available', () => {
    const resolution = resolveConfiguration(request());
    expect(resolution.exact).toBe(true);
    expect(resolution.diagnostics).toEqual([]);
    expect(configurationSummary(resolution)).toBe('The requested configuration is available exactly as asked.');
  });

  it('says which machine it substituted, rather than silently becoming another computer', () => {
    const resolution = resolveConfiguration(request({ machineId: 'bbc-micro-mk2' }));
    expect(resolution.exact).toBe(false);
    expect(resolution.diagnostics[0]).toMatchObject({ kind: 'unknown-machine', requested: 'bbc-micro-mk2' });
    expect(resolution.diagnostics[0]!.reason).toContain('no machine profile called bbc-micro-mk2');
    expect(resolution.diagnostics[0]!.applied).toBe(resolution.target.machine.label);
  });

  it('distinguishes a machine this build does not have from one on another platform class', () => {
    const resolution = resolveConfiguration(request({ machineId: archimedes.id }));
    expect(resolution.diagnostics[0]).toMatchObject({ kind: 'machine-wrong-platform' });
    expect(resolution.diagnostics[0]!.reason).toContain('32-bit');
  });

  it('names a variant and a firmware profile it could not honour', () => {
    const resolution = resolveConfiguration(request({ variant: 'Model Z', romId: 'os9' }));
    expect(resolution.diagnostics.map((item) => item.kind)).toEqual(['unknown-variant', 'unknown-rom']);
    expect(resolution.diagnostics[0]!.reason).toContain('no variant called Model Z');
    expect(resolution.diagnostics[1]!.reason).toContain('no ROM profile called os9');
    expect(resolution.target.variant).toBe(bbcB.variants[0]);
  });

  it('drops a capability this machine does not have, and says so', () => {
    const resolution = resolveConfiguration(request({ enabledCapabilities: ['dfs', 'teletext-adapter'] }));
    expect(resolution.target.enabledCapabilities).toEqual(['dfs']);
    expect(resolution.diagnostics).toEqual([
      { kind: 'unknown-capability', requested: 'teletext-adapter', applied: null, reason: `${bbcB.label} has no capability called teletext-adapter.` },
    ]);
  });

  it('refuses a planned capability with the requirement that would make it real', () => {
    const planned = electron.capabilities.find((capability) => capability.state === 'planned' && capability.requirement)!;
    const resolution = resolveConfiguration({
      platformClass: '8-16-bit', machineId: 'electron', variant: electron.variants[0]!,
      romId: electron.roms[0]!.id, enabledCapabilities: [planned.id],
    });
    expect(resolution.target.enabledCapabilities).toEqual([]);
    expect(resolution.diagnostics[0]).toMatchObject({ kind: 'planned-capability', applied: null });
    expect(resolution.diagnostics[0]!.reason).toContain(planned.requirement!);
  });

  it('refuses a peripheral fitted only to a variant that is not selected', () => {
    /* AtoMMC is fitted to one Atom variant. Enabling it on a plain Atom 12K
     * would claim a mass-storage interface that is not there. */
    const capability = atom.capabilities.find((item) => item.id === 'atommc')!;
    expect(capability.requiresVariant).toBe('Atom 12K + AtoMMC');
    const otherVariant = atom.variants.find((variant) => variant !== capability.requiresVariant)!;
    const resolution = resolveConfiguration({
      platformClass: atom.platformClass, machineId: atom.id, variant: otherVariant,
      romId: atom.roms[0]!.id, enabledCapabilities: [capability.id],
    });
    expect(resolution.target.enabledCapabilities).toEqual([]);
    expect(resolution.diagnostics[0]).toMatchObject({ kind: 'capability-needs-variant' });
    expect(resolution.diagnostics[0]!.reason).toContain('Atom 12K + AtoMMC');

    const fitted = resolveConfiguration({
      platformClass: atom.platformClass, machineId: atom.id, variant: 'Atom 12K + AtoMMC',
      romId: atom.roms[0]!.id, enabledCapabilities: [capability.id],
    });
    expect(fitted.target.enabledCapabilities).toEqual(['atommc']);
    expect(fitted.diagnostics).toEqual([]);
  });

  it('refuses a capability fitted to a variant this machine does not list', () => {
    const broken: MachineProfile[] = [{
      ...atom,
      capabilities: [{ id: 'ghost', label: 'Ghost', description: 'Fitted to nothing.', state: 'preview', requiresVariant: 'Atom 48K' }],
    }];
    expect(validateMachineCatalogue(broken).map((problem) => problem.problem))
      .toContain('is fitted to the Atom 48K variant, which this machine does not list');
  });

  it('falls back to a registered platform class and says the one asked for is not registered', () => {
    const resolution = resolveConfiguration(request({ platformClass: '64-bit' }));
    expect(resolution.diagnostics[0]).toMatchObject({ kind: 'unknown-platform', requested: '64-bit' });
    expect(resolution.target.platformClass).toBe('8-16-bit');
  });

  it('always returns a usable target, however wrong the request', () => {
    const resolution = resolveConfiguration({ platformClass: '', machineId: '', variant: '', romId: '', enabledCapabilities: ['', 'nothing'] });
    expect(resolution.target.machine).toBeDefined();
    expect(resolution.target.machine.variants).toContain(resolution.target.variant);
    expect(resolution.target.machine.roms.map((rom) => rom.id)).toContain(resolution.target.rom.id);
    expect(resolution.diagnostics.length).toBeGreaterThan(3);
  });

  it('counts substitutions separately from requests it simply could not apply', () => {
    const resolution = resolveConfiguration(request({ variant: 'Model Z', enabledCapabilities: ['teletext-adapter'] }));
    expect(configurationSummary(resolution)).toContain('1 substitution');
    expect(configurationSummary(resolution)).toContain('1 request not applied');
  });
});

describe('comparing two configurations', () => {
  const target = (machine: MachineProfile, capabilities: string[] = []): ResolvedTarget => ({
    platformClass: machine.platformClass, machine, variant: machine.variants[0]!, rom: machine.roms[0]!, enabledCapabilities: capabilities,
  });

  it('reports an identical configuration as portable with nothing to say', () => {
    const report = compareConfigurations(target(bbcB, ['dfs']), target(bbcB, ['dfs']));
    expect(report.differences).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.portable).toBe(true);
  });

  it('warns that compiled code does not transfer across a processor family', () => {
    const report = compareConfigurations(target(bbcB), target(archimedes));
    expect(report.portable).toBe(false);
    expect(report.warnings.join(' ')).toContain('will not transfer between them');
    expect(report.differences.map((difference) => difference.field)).toContain('machine');
  });

  it('warns that firmware entry points are not guaranteed to match', () => {
    /* Asserted rather than guarded: a catalogue where the BBC B had only one
     * firmware profile should fail this test, not quietly skip it. */
    expect(bbcB.roms.length).toBeGreaterThan(1);
    const other = { ...target(bbcB), rom: bbcB.roms[1]! };
    const report = compareConfigurations(target(bbcB), other);
    expect(report.warnings.join(' ')).toContain('entry points and workspace addresses');
  });

  it('distinguishes a capability that is merely off from one the target does not have', () => {
    const missing = compareConfigurations(target(bbcB, ['dfs']), target(atom, []));
    expect(missing.warnings.join(' ')).toContain(`does not exist on ${atom.label}`);

    const off = compareConfigurations(target(bbcB, ['dfs']), target(bbcB, []));
    expect(off.warnings.join(' ')).toContain('is not enabled on the target configuration');
  });

  it('reports memory differences, because a fixed load address may not fit', () => {
    const report = compareConfigurations(target(bbcB), target(atom));
    expect(report.warnings.join(' ')).toContain('Fitted memory differs');
  });
});
