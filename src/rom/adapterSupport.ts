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
import { BPLUS_MODELS } from '../emulator/bbcBPlus';

export type AdapterSupportState = 'runnable' | 'no-rom-manifest' | 'no-engine-model';

export interface AdapterMachineSupport {
  machineId: string;
  /** Engine that would run it, or null when none in this build can. */
  engine: AdapterEngine | null;
  /*
   * Other engines in this build that can run one of this machine's registered
   * ROM sets. The Electron has two cores and they are not interchangeable, so a
   * single engine field would have to name one and be wrong about the other;
   * which of them actually runs is decided by the ROM set selected.
   */
  additionalEngines: readonly AdapterEngine[];
  /** Model synonyms the engine provides for this machine. */
  engineModels: string[];
  /** ROM manifest identifiers registered for it in this build. */
  romSetIds: string[];
  state: AdapterSupportState;
  /** What a user needs to know, stated positively rather than as an absence. */
  limitation: string;
}

export type AdapterEngine =
  | { id: 'jsbeeb'; version: '1.19.1' }
  | { id: 'arculator'; version: 'webide-1' }
  | { id: 'elkjs'; version: 'ff123355' }
  | { id: 'elkulator'; version: 'allegro5-6785521' };

const JSBEEB = { id: 'jsbeeb', version: '1.19.1' } as const;
const ARCULATOR = { id: 'arculator', version: 'webide-1' } as const;
const ELKJS = { id: 'elkjs', version: 'ff123355' } as const;
const ELKULATOR = { id: 'elkulator', version: 'allegro5-6785521' } as const;

/* Machines served by a core other than jsbeeb, with the models that core has. */
/* The engines this build can start. An engine absent from here has a pinned
 * version and a manifest and no way to run yet. */
const RUNNABLE_ENGINE_IDS = new Set<string>(['jsbeeb', 'elkjs', 'elkulator']);

const ALTERNATE_ENGINES: Record<string, { engine: AdapterEngine; models: string[]; also?: readonly AdapterEngine[] }> = {
  /* Two cores, and which one starts depends on the ROM set. ElkJS is the
   * default because it needs two ROM images and nothing else; Elkulator is what
   * the expansion set names, and is the one with a per-instruction hook. */
  electron: { engine: ELKJS, models: ['Electron'], also: [ELKULATOR] },
};

/*
 * The machine models each profile can be started as.
 *
 * Most are synonyms jsbeeb 1.19.1 publishes. The two B+ models are not: the
 * engine has no B+ and this build adds one, on top of the engine's Model B with
 * the B+'s own paging. They are listed here because what matters to somebody
 * choosing a machine is whether it starts, not whose code starts it — and the
 * contract that holds this table to the engine's own list names them as this
 * build's rather than letting them pass as the engine's.
 *
 * Tube models are fitted to a host by the configuration builder and are not
 * separately selectable, so they are recorded against the hosts that carry one.
 */
const ENGINE_MODELS: Record<string, string[]> = {
  atom: ['Atom', 'Atom-Tape', 'Atom-Tape-FP', 'Atom-DOS'],
  'bbc-a': ['B-DFS1.2', 'B-DFS0.9', 'B1770', 'B1770A'],
  'bbc-b': ['B-DFS1.2', 'B-DFS0.9', 'B1770', 'B1770A'],
  'bbc-bplus': [...BPLUS_MODELS.map((model) => model.synonym)],
  master: ['Master', 'MasterADFS', 'MasterANFS'],
};

const ARM_MACHINES = new Set(['archimedes-a300', 'archimedes-a400', 'a3000', 'a5000', 'riscpc']);
/* The qualified Arculator slice covers the A310 class only. */
const ARM_RUNNABLE = new Set(['archimedes-a300']);

const LIMITATIONS: Record<string, string> = {
  atom: 'The tape and tape-with-floating-point models run here. The MMC and DOS models exist in the engine but need firmware images this build does not register a manifest for.',
  'bbc-a': 'jsbeeb models the BBC B; a Model A differs in fitted RAM and interfaces, and this build registers no separate Model A manifest, so it is described but not run.',
  'bbc-b': 'The 8271 DFS and 1770 DFS or ADFS models all run here. A second processor is not offered: the interface is fitted and answers, but this core never hands the language over on a BBC-family host — the parasite runs its own ROM and waits, and its RAM is never written. It does boot on the Master.',
  'bbc-bplus': 'The B+ runs here on a machine this build adds, because jsbeeb publishes none — not in the pinned 1.19.1 and not in the current 1.22.4. It is the engine\'s Model B with the two things that make a B+ a B+: the twelve kilobytes of paged RAM at &8000 that ROMSEL bit 7 brings in, and the twenty kilobytes of shadow screen selected through &FE34. Both were checked by asking the machine rather than by reading about it — it introduces itself as Acorn OS 64K, a shadow mode leaves HIMEM at &8000 where a Model B would drop it to &3000, and a write to &AFFF with ANDY paged comes back while the ROM underneath is untouched. What is not offered is the B+ 128: its extra sideways RAM makes this operating system report a size no B+ was sold with, so it is not claimed. A second processor is not offered either, for the same reason as on the Model B.',
  electron: 'The Electron has two cores here and the ROM set chooses between them. The Electron OS + BASIC set runs on the vendored ElkJS core, which models a base 32 KB machine with an operating system and BASIC only, and offers no instruction stepping, breakpoints or hardware test execution because it exposes no per-instruction hook. The Electron + Plus 1 expansions set runs on the Elkulator core built for WebAssembly, which has that hook, so stepping, breakpoints, register writing and key injection are available there; running a test plan is not, because the stop is real but its assertions, captures and teardown are not written yet. Cassette media works and is proved: a tape written here was mounted on that core, the machine was typed *LOAD at, it turned its own cassette motor on and the whole file arrived. Disc media is implemented on the same path and unproved, because an Electron reads discs through a Plus 3 and no ADFS or DFS firmware is registered for one. The remaining expansions are declared and their firmware checkable, but none has been exercised through that core, so each stays marked planned until it has been.',
  master: 'The Master 128 runs here with either its MOS 3.20 or its MOS 3.50 combined image, selecting DFS, ADFS or ANFS. The Master Compact cannot be selected: it is a different machine rather than a Master 128 with later firmware, and this engine models no Compact. A 65C102 Turbo second processor can be fitted through the Tube capability, and is the one machine here where the Tube boot completes: the host records it, the language reaches the parasite, and a conformance case asserting it passes on real hardware. Master Turbo, 512 and Compact are separate machines with no model in this engine.',
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
      additionalEngines: [],
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
      additionalEngines: alternate.also ?? [],
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
    additionalEngines: [],
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
    ?? { machineId, engine: null, additionalEngines: [], engineModels: [], romSetIds: [], state: 'no-engine-model', limitation: 'This build has no adapter for that machine and does not substitute another.' };
}

/** One line for the interface, chosen by state rather than by guessing. */
export function adapterSupportSummary(support: AdapterMachineSupport): string {
  if (support.state === 'runnable') {
    const engines = [support.engine!, ...support.additionalEngines].map((entry) => `${entry.id} ${entry.version}`);
    /* Naming only the first would leave a person with the expansion ROM set
     * wondering which core they were about to start. */
    return engines.length === 1 ? `Runs on ${engines[0]}.` : `Runs on ${engines.slice(0, -1).join(', ')} or ${engines.at(-1)}, chosen by the ROM set.`;
  }
  if (support.state === 'no-rom-manifest') return `${support.engine!.id} ${support.engine!.version} has a model for this machine, but this build registers no ROM manifest for it yet.`;
  return 'No emulator in this build can run this machine.';
}
