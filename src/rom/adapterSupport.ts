/* What the pinned emulator adapters can and cannot run.
 *
 * A machine profile in this product describes real hardware. Whether that
 * hardware can be *executed* here is a separate question, and this module is the
 * one place that answers it, so no surface has to infer runnability from the
 * absence of a ROM manifest.
 *
 * Three states are distinguished, because they mean different things to a user:
 *
 *   runnable          the pinned engine has a model and this build registers a
 *                     ROM manifest for it, so supplying firmware makes it run;
 *   no-rom-manifest   the engine has a model but no manifest is registered yet,
 *                     so the work needed is in this repository;
 *   no-engine-model   the pinned engine has no model for the machine at all, so
 *                     supplying firmware can never make it run and saying
 *                     "supply the ROM set" would be misleading.
 *
 * `engineModels` names the model synonyms the pinned engine actually provides.
 * It is written down here rather than imported, to keep the emulator out of the
 * workbench bundle, and a contract test compares it against the engine's own
 * model list so it cannot drift.
 */
import { ROM_SETS } from './romProfiles';

export type AdapterSupportState = 'runnable' | 'no-rom-manifest' | 'no-engine-model';

export interface AdapterMachineSupport {
  machineId: string;
  /** Engine that would run it, or null when none in this build can. */
  engine: { id: 'jsbeeb'; version: '1.19.1' } | { id: 'arculator'; version: 'webide-1' } | { id: 'elkjs'; version: 'ff123355' } | null;
  /** Model synonyms the engine provides for this machine. */
  engineModels: string[];
  /** ROM manifest identifiers registered for it in this build. */
  romSetIds: string[];
  state: AdapterSupportState;
  /** What a user needs to know, stated positively rather than as an absence. */
  limitation: string;
}

const JSBEEB = { id: 'jsbeeb', version: '1.19.1' } as const;
const ARCULATOR = { id: 'arculator', version: 'webide-1' } as const;
const ELKJS = { id: 'elkjs', version: 'ff123355' } as const;

/* Machines served by a core other than jsbeeb, with the models that core has. */
/* The engines this build can start. An engine absent from here has a pinned
 * version and a manifest and no way to run yet. */
const RUNNABLE_ENGINE_IDS = new Set<string>(['jsbeeb', 'elkjs']);

const ALTERNATE_ENGINES: Record<string, { engine: typeof ELKJS; models: string[] }> = {
  electron: { engine: ELKJS, models: ['Electron'] },
};

/* Model synonyms jsbeeb 1.19.1 provides, by machine. Tube models are fitted to
 * a host by the configuration builder and are not separately selectable, so
 * they are recorded against the hosts that can carry one. */
const ENGINE_MODELS: Record<string, string[]> = {
  atom: ['Atom', 'Atom-Tape', 'Atom-Tape-FP', 'Atom-DOS'],
  'bbc-a': ['B-DFS1.2', 'B-DFS0.9', 'B1770', 'B1770A'],
  'bbc-b': ['B-DFS1.2', 'B-DFS0.9', 'B1770', 'B1770A'],
  'bbc-bplus': [],
  master: ['Master', 'MasterADFS', 'MasterANFS'],
};

const ARM_MACHINES = new Set(['archimedes-a300', 'archimedes-a400', 'a3000', 'a5000', 'riscpc']);
/* The qualified Arculator slice covers the A310 class only. */
const ARM_RUNNABLE = new Set(['archimedes-a300']);

const LIMITATIONS: Record<string, string> = {
  atom: 'The tape and tape-with-floating-point models run here. The MMC and DOS models exist in the engine but need firmware images this build does not register a manifest for.',
  'bbc-a': 'jsbeeb models the BBC B; a Model A differs in fitted RAM and interfaces, and this build registers no separate Model A manifest, so it is described but not run.',
  'bbc-b': 'The 8271 DFS and 1770 DFS or ADFS models all run here. A second processor is not offered: the interface is fitted and answers, but this core never hands the language over on a BBC-family host — the parasite runs its own ROM and waits, and its RAM is never written. It does boot on the Master.',
  'bbc-bplus': 'jsbeeb 1.19.1 has no BBC B+ model, so the B+ shadow and sideways memory behaviour cannot be executed here. Supplying B+ firmware would not change that; the profile is listed because the product models the machine, not because this build can emulate it.',
  electron: 'The Electron runs on the vendored ElkJS core, which models a base 32 KB machine with an operating system and BASIC only. It has no Plus 1, Plus 3, AP5 or AP6, no ADFS, no cartridge and no usable expansion ROM slot, and it offers no instruction stepping, breakpoints or hardware test execution because that core exposes no per-instruction hook. Those expansions need the Elkulator port recorded in the backlog, not more firmware.',
  master: 'The Master 128 runs here with its combined MOS 3.20 image, selecting DFS, ADFS or ANFS. A 65C102 Turbo second processor can be fitted through the Tube capability, and is the one machine here where the Tube boot completes: the host records it, the language reaches the parasite, and a conformance case asserting it passes on real hardware. Master Turbo, 512 and Compact are separate machines with no model in this engine.',
  'archimedes-a300': 'The qualified A310 slice runs on the pinned Arculator build. Machine state save and restore stay disabled because that core exposes no complete deterministic serializer.',
};

const ARM_LIMITATION = 'This build qualifies the A310 class only. Later Archimedes and Risc PC profiles are described but have no qualified adapter here, and no other machine is substituted for them.';

function supportFor(machineId: string): AdapterMachineSupport {
  /*
   * Only the sets this build can actually start.
   *
   * A manifest may be registered for an engine that is not yet runnable — the
   * Elkulator port is written down and checked long before it can boot — and
   * listing one here would offer somebody a machine configuration that cannot
   * be selected. The manifest still does its job: firmware can be registered
   * and verified against it. It simply is not advertised as runnable.
   */
  const romSetIds = ROM_SETS
    .filter((set) => set.machineIds.includes(machineId) && RUNNABLE_ENGINE_IDS.has(set.engine.id))
    .map((set) => set.id);
  if (ARM_MACHINES.has(machineId)) {
    const runnable = ARM_RUNNABLE.has(machineId);
    return {
      machineId,
      engine: runnable ? ARCULATOR : null,
      engineModels: runnable ? ['A310'] : [],
      romSetIds,
      state: runnable ? 'runnable' : 'no-engine-model',
      limitation: LIMITATIONS[machineId] ?? ARM_LIMITATION,
    };
  }
  const alternate = ALTERNATE_ENGINES[machineId];
  if (alternate) {
    return {
      machineId,
      engine: alternate.engine,
      engineModels: alternate.models,
      romSetIds,
      state: romSetIds.length ? 'runnable' : 'no-rom-manifest',
      limitation: LIMITATIONS[machineId] ?? 'No limitation has been recorded for this machine.',
    };
  }
  const engineModels = ENGINE_MODELS[machineId] ?? [];
  const state: AdapterSupportState = !engineModels.length ? 'no-engine-model' : romSetIds.length ? 'runnable' : 'no-rom-manifest';
  return {
    machineId,
    engine: engineModels.length ? JSBEEB : null,
    engineModels,
    romSetIds,
    state,
    limitation: LIMITATIONS[machineId] ?? 'No limitation has been recorded for this machine.',
  };
}

export const ADAPTER_SUPPORT: readonly AdapterMachineSupport[] = Object.freeze(
  [...Object.keys(ENGINE_MODELS), ...Object.keys(ALTERNATE_ENGINES), ...ARM_MACHINES].map(supportFor),
);

export function adapterSupportFor(machineId: string): AdapterMachineSupport {
  return ADAPTER_SUPPORT.find((entry) => entry.machineId === machineId)
    ?? { machineId, engine: null, engineModels: [], romSetIds: [], state: 'no-engine-model', limitation: 'This build has no adapter for that machine and does not substitute another.' };
}

/** One line for the interface, chosen by state rather than by guessing. */
export function adapterSupportSummary(support: AdapterMachineSupport): string {
  if (support.state === 'runnable') return `Runs on ${support.engine!.id} ${support.engine!.version}.`;
  if (support.state === 'no-rom-manifest') return `${support.engine!.id} ${support.engine!.version} has a model for this machine, but this build registers no ROM manifest for it yet.`;
  return 'No emulator in this build can run this machine.';
}
