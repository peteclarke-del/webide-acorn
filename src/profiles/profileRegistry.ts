/* The machine profile registry: validating the catalogue, and resolving a
 * requested configuration without quietly becoming a different machine.
 *
 * Resolution used to substitute in silence. A project asking for a machine,
 * variant or ROM this build does not have got the first one in the list
 * instead, and capabilities it asked for were dropped without a word. Opening
 * someone else's project could therefore hand you a different computer than the
 * one they wrote for, with no indication that anything had changed.
 *
 * This module keeps the substitution — a workbench has to show something — but
 * makes it visible. Every departure from what was asked for is returned as a
 * diagnostic naming what was requested, what is in effect, and why. Callers
 * show them; nothing is inferred from their absence.
 *
 * The catalogue itself is validated rather than trusted, because a profile with
 * a duplicate identifier or an empty variant list produces exactly the kind of
 * silent wrong answer this module exists to prevent.
 */
import { machineProfiles, platformClasses } from '../data/machines';
import type { MachineProfile, PlatformClassId, ResolvedTarget } from '../types';

export type ProfileDiagnosticKind =
  | 'unknown-platform'
  | 'unknown-machine'
  | 'machine-wrong-platform'
  | 'unknown-variant'
  | 'unknown-rom'
  | 'unknown-capability'
  | 'planned-capability'
  | 'capability-needs-variant';

export interface ProfileDiagnostic {
  kind: ProfileDiagnosticKind;
  /** What the project or interface asked for. */
  requested: string;
  /** What is in effect instead, or null when the request was simply dropped. */
  applied: string | null;
  /** Why, in the user's terms. */
  reason: string;
}

export interface TargetRequest {
  platformClass: string;
  machineId: string;
  variant: string;
  romId: string;
  enabledCapabilities: string[];
}

export interface ResolvedConfiguration {
  target: ResolvedTarget;
  diagnostics: ProfileDiagnostic[];
  /** True when everything requested was available exactly as asked. */
  exact: boolean;
}

/* ---- catalogue validation ------------------------------------------------- */

export interface CatalogueProblem {
  where: string;
  problem: string;
}

const CAPABILITY_STATES = new Set(['supported', 'preview', 'planned']);

/**
 * Check the shipped catalogue against the rules resolution depends on. This is
 * run by a contract test rather than at startup: a broken catalogue is a build
 * defect, and failing a test is more useful than failing a user's session.
 */
export function validateMachineCatalogue(
  catalogue: readonly MachineProfile[] = machineProfiles,
  classes: ReadonlyArray<{ id: PlatformClassId }> = platformClasses,
): CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];
  const knownClasses = new Set(classes.map((entry) => entry.id));
  const machineIds = new Set<string>();

  for (const machine of catalogue) {
    const where = machine.id || '(machine with no identifier)';
    if (!machine.id) problems.push({ where, problem: 'has no identifier' });
    else if (machineIds.has(machine.id)) problems.push({ where, problem: 'shares its identifier with another machine' });
    machineIds.add(machine.id);

    if (!knownClasses.has(machine.platformClass)) problems.push({ where, problem: `names platform class ${machine.platformClass}, which is not registered` });
    for (const field of ['family', 'label', 'shortLabel', 'generation', 'cpu', 'memory'] as const) {
      if (!machine[field] || !String(machine[field]).trim()) problems.push({ where, problem: `has no ${field}` });
    }
    if (!/^#[0-9a-f]{6}$/i.test(machine.accent)) problems.push({ where, problem: `accent ${machine.accent} is not a six-digit hexadecimal colour` });

    if (!machine.variants.length) problems.push({ where, problem: 'lists no variants, so no configuration could be resolved for it' });
    if (new Set(machine.variants).size !== machine.variants.length) problems.push({ where, problem: 'lists the same variant more than once' });

    if (!machine.roms.length) problems.push({ where, problem: 'lists no ROM profiles, so no configuration could be resolved for it' });
    const romIds = new Set<string>();
    for (const rom of machine.roms) {
      if (!rom.id) problems.push({ where, problem: 'has a ROM profile with no identifier' });
      else if (romIds.has(rom.id)) problems.push({ where, problem: `lists ROM profile ${rom.id} more than once` });
      romIds.add(rom.id);
      if (!rom.label?.trim()) problems.push({ where: `${where}/${rom.id}`, problem: 'has no label' });
      if (!rom.detail?.trim()) problems.push({ where: `${where}/${rom.id}`, problem: 'has no detail' });
    }

    const capabilityIds = new Set<string>();
    for (const capability of machine.capabilities) {
      const at = `${where}/${capability.id || '(capability with no identifier)'}`;
      if (!capability.id) problems.push({ where: at, problem: 'has no identifier' });
      else if (capabilityIds.has(capability.id)) problems.push({ where: at, problem: 'is listed more than once' });
      capabilityIds.add(capability.id);
      if (!CAPABILITY_STATES.has(capability.state)) problems.push({ where: at, problem: `state ${capability.state} is not supported, preview or planned` });
      if (!capability.label?.trim()) problems.push({ where: at, problem: 'has no label' });
      if (!capability.description?.trim()) problems.push({ where: at, problem: 'has no description' });
      /* A planned capability cannot be selected, so one enabled by default
       * would be dropped on every resolution and never take effect. */
      if (capability.state === 'planned' && capability.defaultEnabled) problems.push({ where: at, problem: 'is planned but enabled by default, which resolution would silently drop' });
      /* A capability fitted to a variant has to name a variant this machine
       * has, or resolution could never enable it. */
      if (capability.requiresVariant && !machine.variants.includes(capability.requiresVariant)) {
        problems.push({ where: at, problem: `is fitted to the ${capability.requiresVariant} variant, which this machine does not list` });
      }
    }
  }
  return problems;
}

/* ---- resolution ----------------------------------------------------------- */

function diagnostic(kind: ProfileDiagnosticKind, requested: string, applied: string | null, reason: string): ProfileDiagnostic {
  return { kind, requested, applied, reason };
}

/**
 * Resolve a requested configuration against the catalogue, reporting every
 * departure from it. The returned target is always usable; the diagnostics say
 * what it cost to make it so.
 */
export function resolveConfiguration(
  request: TargetRequest,
  catalogue: readonly MachineProfile[] = machineProfiles,
): ResolvedConfiguration {
  const diagnostics: ProfileDiagnostic[] = [];

  const classes = platformClasses.map((entry) => entry.id);
  let platformClass = request.platformClass as PlatformClassId;
  if (!classes.includes(platformClass)) {
    const fallback = classes[0]!;
    diagnostics.push(diagnostic('unknown-platform', request.platformClass, fallback, `This build registers no platform class called ${request.platformClass}.`));
    platformClass = fallback;
  }

  const available = catalogue.filter((machine) => machine.platformClass === platformClass);
  const requestedMachine = catalogue.find((machine) => machine.id === request.machineId);
  let machine = available.find((candidate) => candidate.id === request.machineId);
  if (!machine) {
    const fallback = available[0];
    if (!fallback) throw new Error(`No machine profiles are registered for ${platformClass}`);
    if (requestedMachine) {
      diagnostics.push(diagnostic('machine-wrong-platform', requestedMachine.label, fallback.label, `${requestedMachine.label} is a ${requestedMachine.platformClass} machine, and the selected platform class is ${platformClass}.`));
    } else {
      diagnostics.push(diagnostic('unknown-machine', request.machineId, fallback.label, `This build has no machine profile called ${request.machineId}.`));
    }
    machine = fallback;
  }

  let variant = request.variant;
  if (!machine.variants.includes(variant)) {
    const fallback = machine.variants[0] ?? 'Default';
    diagnostics.push(diagnostic('unknown-variant', request.variant || '(none)', fallback, `${machine.label} has no variant called ${request.variant || '(none)'}.`));
    variant = fallback;
  }

  let rom = machine.roms.find((candidate) => candidate.id === request.romId);
  if (!rom) {
    const fallback = machine.roms[0];
    if (!fallback) throw new Error(`No ROM profiles are registered for ${machine.id}`);
    diagnostics.push(diagnostic('unknown-rom', request.romId || '(none)', fallback.label, `${machine.label} has no ROM profile called ${request.romId || '(none)'}.`));
    rom = fallback;
  }

  const byId = new Map(machine.capabilities.map((capability) => [capability.id, capability]));
  const enabledCapabilities: string[] = [];
  for (const id of request.enabledCapabilities) {
    const capability = byId.get(id);
    if (!capability) {
      diagnostics.push(diagnostic('unknown-capability', id, null, `${machine.label} has no capability called ${id}.`));
      continue;
    }
    if (capability.state === 'planned') {
      diagnostics.push(diagnostic('planned-capability', capability.label, null, capability.requirement
        ? `${capability.label} is planned for ${machine.label}: it needs ${capability.requirement}.`
        : `${capability.label} is planned for ${machine.label} and no adapter in this build reproduces it.`));
      continue;
    }
    /* A capability whose requirement names a variant only applies on that
     * variant. Enabling it elsewhere would claim hardware that is not fitted. */
    if (capability.requiresVariant && capability.requiresVariant !== variant) {
      diagnostics.push(diagnostic('capability-needs-variant', capability.label, null, `${capability.label} is fitted to the ${capability.requiresVariant} variant, and ${variant} is selected.`));
      continue;
    }
    enabledCapabilities.push(id);
  }

  return {
    target: { platformClass, machine, variant, rom, enabledCapabilities },
    diagnostics,
    exact: diagnostics.length === 0,
  };
}

/** One line for a status area. */
export function configurationSummary(resolution: ResolvedConfiguration): string {
  if (resolution.exact) return 'The requested configuration is available exactly as asked.';
  const substituted = resolution.diagnostics.filter((item) => item.applied !== null).length;
  const dropped = resolution.diagnostics.length - substituted;
  const parts: string[] = [];
  if (substituted) parts.push(`${substituted} substitution${substituted === 1 ? '' : 's'}`);
  if (dropped) parts.push(`${dropped} request${dropped === 1 ? '' : 's'} not applied`);
  return `${parts.join(' · ')} · ${resolution.target.machine.label} ${resolution.target.variant}`;
}

/* ---- comparison and portability -------------------------------------------- */

export interface ProfileDifference {
  field: string;
  from: string;
  to: string;
}

export interface PortabilityReport {
  differences: ProfileDifference[];
  /** What would not survive a move, each with the reason. */
  warnings: string[];
  portable: boolean;
}

/**
 * What changes when work written for one configuration is opened against
 * another, and what would not survive the move. Capability differences matter
 * more than cosmetic ones: a program relying on a filing system the other
 * machine does not offer will not run, and saying so before it is opened is the
 * whole point.
 */
export function compareConfigurations(from: ResolvedTarget, to: ResolvedTarget): PortabilityReport {
  const differences: ProfileDifference[] = [];
  const warnings: string[] = [];

  if (from.machine.id !== to.machine.id) {
    differences.push({ field: 'machine', from: from.machine.label, to: to.machine.label });
    if (from.machine.platformClass !== to.machine.platformClass) {
      warnings.push(`${from.machine.label} is a ${from.machine.platformClass} machine and ${to.machine.label} is ${to.machine.platformClass}; compiled code will not transfer between them.`);
    } else if (from.machine.cpu !== to.machine.cpu) {
      warnings.push(`${from.machine.label} runs a ${from.machine.cpu} and ${to.machine.label} a ${to.machine.cpu}; timing-dependent code may behave differently.`);
    }
    if (from.machine.memory !== to.machine.memory) {
      warnings.push(`Fitted memory differs: ${from.machine.memory} against ${to.machine.memory}. A program loading at a fixed address may not fit.`);
    }
  }
  if (from.variant !== to.variant) differences.push({ field: 'variant', from: from.variant, to: to.variant });
  if (from.rom.id !== to.rom.id) {
    differences.push({ field: 'firmware', from: from.rom.label, to: to.rom.label });
    warnings.push(`Firmware differs: ${from.rom.label} against ${to.rom.label}. Operating-system entry points and workspace addresses are not guaranteed to match.`);
  }

  const fromCapabilities = new Set(from.enabledCapabilities);
  const toCapabilities = new Set(to.enabledCapabilities);
  const lost = [...fromCapabilities].filter((id) => !toCapabilities.has(id));
  const gained = [...toCapabilities].filter((id) => !fromCapabilities.has(id));
  if (lost.length || gained.length) {
    differences.push({ field: 'capabilities', from: [...fromCapabilities].sort().join(', ') || 'none', to: [...toCapabilities].sort().join(', ') || 'none' });
  }
  for (const id of lost) {
    const capability = from.machine.capabilities.find((item) => item.id === id);
    const offered = to.machine.capabilities.find((item) => item.id === id);
    warnings.push(offered
      ? `${capability?.label ?? id} is not enabled on the target configuration; work that depends on it will not run there until it is.`
      : `${capability?.label ?? id} does not exist on ${to.machine.label}; work that depends on it cannot run there.`);
  }

  return { differences, warnings, portable: warnings.length === 0 };
}
