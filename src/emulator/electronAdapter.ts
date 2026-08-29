/* What the vendored ElkJS Electron adapter can and cannot be asked to do.
 *
 * The workbench emulator panel speaks one command vocabulary to every attached
 * core. jsbeeb answers nearly all of it; the Electron core answers a genuine
 * subset. Rather than let the unanswered commands reach the frame and be
 * silently dropped — which would leave the debugger showing stale values that
 * look live — every command the panel can emit is classified here, and the ones
 * this core cannot honour are refused in the workbench with the reason.
 *
 * The capability and unavailability lists mirror the declaration inside
 * `public/electron-runtime.js`. A contract test parses that file and compares
 * the two, so the workbench's idea of the adapter cannot drift from the adapter.
 */

export const ELECTRON_CAPABILITIES = [
  'execution',
  'reset',
  'register-read',
  'memory-read',
  'memory-write',
  'program-load',
  'keyboard-input',
  'display',
  'display-filter',
  'screen-capture',
  'input-focus',
  'audio-toggle',
] as const;

export type ElectronCapability = (typeof ELECTRON_CAPABILITIES)[number];

/** Capability identifier to the reason this core cannot provide it. */
export const ELECTRON_UNAVAILABLE: Readonly<Record<string, string>> = Object.freeze({
  'instruction-step': 'ElkJS runs a batch of cycles per call and exposes no per-instruction hook.',
  'execute-breakpoint': 'ElkJS exposes no per-instruction hook, so a breakpoint could not be honoured exactly.',
  'conditional-breakpoint': 'ElkJS exposes no per-instruction hook.',
  logpoint: 'ElkJS exposes no per-instruction hook.',
  watchpoint: 'ElkJS exposes no memory-access hook.',
  trace: 'ElkJS exposes no per-instruction hook.',
  disassembly: 'Live disassembly needs a per-instruction hook to place its window against executed code; this core has none.',
  'register-write': 'ElkJS exposes no register setter; only a whole-processor snapshot can be restored.',
  'hardware-inspection': 'This slice does not publish a verified ULA register map.',
  'interrupt-monitor': 'ElkJS raises its real-time-clock and vertical-blank interrupts from the frame loop and exposes no interrupt hook to observe them.',
  'raster-monitor': 'ElkJS renders a whole row at a time and exposes no per-cycle beam position.',
  profiler: 'Sampling needs a per-instruction hook, which this core does not provide.',
  replay: 'Reverse execution needs deterministic per-instruction state capture, which this core does not provide.',
  'run-test': 'A stop-address test needs a per-instruction hook, which this core does not provide.',
  tube: 'The Acorn Electron has no Tube interface, and this core models none.',
  media: 'Tape and disk are not offered by this slice; the upstream tape modules are not vendored.',
  'basic-load': 'This slice loads machine code only. Injecting a tokenised BASIC program needs the Electron BASIC workspace pointers, which this core does not expose.',
  'key-injection': 'ElkJS owns the document key handlers and exposes no programmatic key queue, so typing must go through the real keyboard over the live display.',
  'keyboard-mapping': 'ElkJS uses a fixed host key map with no remapping hook.',
  joystick: 'This slice models a base Electron, which has no analogue port; a joystick needs the Plus 1 the core does not model.',
  volume: 'ElkJS connects its sample source straight to the audio destination and exposes no gain stage.',
  speed: 'ElkJS runs its frame loop at one speed and exposes no cycle-rate control.',
  'audio-capture': 'ElkJS writes its samples into the audio destination and exposes no tap to record from.',
  'state-save': 'ElkJS snapshots cover RAM and the processor only, not the full machine state.',
});

/* Every command type the emulator panel can emit, against the capability it
 * needs. A command absent from this map is one this adapter has never been
 * taught, and is refused as such rather than assumed harmless. */
export const ELECTRON_COMMAND_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  initialise: 'execution',
  run: 'execution',
  pause: 'execution',
  stop: 'execution',
  reset: 'reset',
  step: 'instruction-step',
  'step-over': 'instruction-step',
  'step-out': 'instruction-step',
  'source-step': 'instruction-step',
  'run-to': 'instruction-step',
  'reverse-step': 'replay',
  'reverse-continue': 'replay',
  'replay-config': 'replay',
  breakpoint: 'execute-breakpoint',
  'set-breakpoints': 'execute-breakpoint',
  watchpoint: 'watchpoint',
  'read-memory': 'memory-read',
  'write-memory': 'memory-write',
  'read-tube-memory': 'tube',
  'read-disassembly': 'disassembly',
  'write-registers': 'register-write',
  'inspect-hardware': 'hardware-inspection',
  'interrupt-monitor': 'interrupt-monitor',
  'interrupt-history-clear': 'interrupt-monitor',
  'raster-monitor': 'raster-monitor',
  'raster-timeline-clear': 'raster-monitor',
  'profiler-config': 'profiler',
  'profiler-clear': 'profiler',
  'trace-config': 'trace',
  'trace-clear': 'trace',
  'run-test': 'run-test',
  'load-machine-code': 'program-load',
  'load-basic': 'basic-load',
  'load-disc': 'media',
  'load-tape': 'media',
  'eject-disc': 'media',
  'export-disc': 'media',
  'eject-tape': 'media',
  'save-state': 'state-save',
  'load-state': 'state-save',
  'capture-screen': 'screen-capture',
  'focus-input': 'input-focus',
  'release-input': 'input-focus',
  'set-keyboard-layout': 'keyboard-mapping',
  'set-key-remaps': 'keyboard-mapping',
  'inject-text': 'key-injection',
  'tap-key': 'key-injection',
  'gamepad-key-edge': 'joystick',
  'bbc-analogue-joystick': 'joystick',
  'atom-atommc-joystick': 'joystick',
  'set-bbc-mouse-joystick': 'joystick',
  'set-audio': 'audio-toggle',
  'start-audio-capture': 'audio-capture',
  'stop-audio-capture': 'audio-capture',
  'set-speed': 'speed',
  'set-volume': 'volume',
  'set-display-filter': 'display-filter',
});

const SUPPORTED = new Set<string>(ELECTRON_CAPABILITIES);

/**
 * The reason this Electron adapter cannot honour a command, or `null` when it
 * can. Callers refuse and report rather than sending, so nothing that reaches
 * the core is quietly ignored.
 */
export function electronCommandRefusal(type: string): string | null {
  const capability = ELECTRON_COMMAND_CAPABILITY[type];
  if (capability === undefined) return `${type} is not a command the Electron adapter accepts.`;
  if (SUPPORTED.has(capability)) return null;
  const reason = ELECTRON_UNAVAILABLE[capability];
  return reason ?? `${type} is unavailable on the Electron adapter.`;
}

/** One sentence naming what the Electron slice does offer, for the interface. */
export const ELECTRON_ADAPTER_SUMMARY =
  'The Acorn Electron runs on the vendored ElkJS core: execution, reset, register and memory reading, memory writing, machine-code loading, the real keyboard over the live display, screen capture and a sound toggle. Instruction stepping, breakpoints, watchpoints, tracing, disassembly, profiling, hardware inspection, media and machine-state save are not offered, because that core exposes no per-instruction hook and models no expansions.';
