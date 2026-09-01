/* What the Elkulator Electron core can and cannot be asked to do.
 *
 * There are two Electron cores in this build and they are not interchangeable.
 * ElkJS is a 32 KB machine with two ROMs and no per-instruction hook; Elkulator
 * is the full Electron with sideways ROM banks, the Plus 1 and Plus 3, and a
 * debugger hook before every instruction. This adapter describes the second, so
 * it offers stepping, breakpoints, register writing and key injection that the
 * ElkJS adapter has to refuse.
 *
 * What it refuses is refused for a stated reason, and the reasons here are of
 * two kinds that are worth keeping apart. Some are properties of the machine or
 * the core — the Electron has no Tube, and Elkulator's memory access has no hook
 * to hang a watchpoint on. Others are properties of this slice: the bridge in
 * `docker/elkulator/webide_bridge.c` is deliberately the whole of what the
 * workbench may ask, so a capability the bridge does not carry is unavailable
 * however capable the emulator underneath might be. Both are said plainly,
 * because "this core cannot" and "this build does not" are different promises.
 *
 * The capability and unavailability lists mirror the declaration inside
 * `public/elkulator-runtime.js`. A contract test parses that file and compares
 * the two, so the workbench's idea of the adapter cannot drift from the adapter.
 */

export const ELKULATOR_CAPABILITIES = [
  'execution',
  'reset',
  'instruction-step',
  'execute-breakpoint',
  'register-read',
  'register-write',
  'memory-read',
  'memory-write',
  'program-load',
  'run-test',
  'keyboard-input',
  'key-injection',
  'display',
  'display-filter',
  'screen-capture',
  'input-focus',
] as const;

export type ElkulatorCapability = (typeof ELKULATOR_CAPABILITIES)[number];

/** Capability identifier to the reason this adapter cannot provide it. */
export const ELKULATOR_UNAVAILABLE: Readonly<Record<string, string>> = Object.freeze({
  'conditional-breakpoint': 'The instruction hook compares the program counter and nothing else; a condition would have to be evaluated in the bridge, and it is not.',
  logpoint: 'A logpoint records registers and resumes; the bridge stops the machine or leaves it alone, and keeps no log buffer.',
  watchpoint: 'Elkulator reads and writes memory through plain functions with no hook, so a memory watch could not be honoured exactly.',
  trace: 'The instruction hook could feed a trace, but the bridge records no trace buffer and this slice publishes no instruction stream.',
  disassembly: 'Live disassembly needs an instruction stream placed against executed code; the bridge publishes memory and registers, not that.',
  'hardware-inspection': 'This slice publishes no verified ULA, ADC or 1770 register map, so an inspector would be reading addresses nobody has checked.',
  'interrupt-monitor': 'Elkulator raises its interrupts inside the ULA with no hook to observe them, so an interrupt history could not be recorded.',
  'raster-monitor': 'The ULA renders a scanline at a time; a per-cycle beam position is not published.',
  profiler: 'Sampling would run off the instruction hook, but the bridge keeps no sample buffer.',
  replay: 'Reverse execution needs deterministic per-instruction state capture, which this slice does not record.',
  tube: 'The Acorn Electron has no Tube interface, and Elkulator models none.',
  media: 'Elkulator reads tape and disc images, but the bridge mounts none and this slice has exercised neither path.',
  'basic-load': 'Injecting a tokenised BASIC program needs the Electron BASIC workspace pointers, which this slice does not resolve.',
  'keyboard-mapping': 'The bridge sets Electron key states directly, so there is no host key map to remap.',
  joystick: 'An analogue joystick needs the Plus 1, and this slice fits no expansion ROM.',
  'audio-toggle': 'The OpenAL path has not been verified under Emscripten in this build, so a toggle would claim control of sound that may not be produced.',
  volume: 'No gain stage is exposed; the sound path itself is unverified here.',
  'audio-capture': 'There is no tap to record from, and the sound path itself is unverified here.',
  speed: 'The machine is driven one field per animation frame and the bridge exposes no cycle-rate control.',
  'state-save': 'Elkulator has a save-state format, but the bridge does not carry it and a partial restore would be worse than none.',
});

/* Every command type the emulator panel can emit, against the capability it
 * needs. A command absent from this map is one this adapter has never been
 * taught, and is refused as such rather than assumed harmless. */
export const ELKULATOR_COMMAND_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  initialise: 'execution',
  run: 'execution',
  pause: 'execution',
  stop: 'execution',
  reset: 'reset',
  step: 'instruction-step',
  'step-over': 'instruction-step',
  'step-out': 'instruction-step',
  'source-step': 'instruction-step',
  'run-to': 'execute-breakpoint',
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

const SUPPORTED = new Set<string>(ELKULATOR_CAPABILITIES);

/**
 * The reason this Elkulator adapter cannot honour a command, or `null` when it
 * can. Callers refuse and report rather than sending, so nothing that reaches
 * the core is quietly ignored.
 */
export function elkulatorCommandRefusal(type: string): string | null {
  const capability = ELKULATOR_COMMAND_CAPABILITY[type];
  if (capability === undefined) return `${type} is not a command the Elkulator adapter accepts.`;
  if (SUPPORTED.has(capability)) return null;
  const reason = ELKULATOR_UNAVAILABLE[capability];
  return reason ?? `${type} is unavailable on the Elkulator adapter.`;
}

/** One sentence naming what the Elkulator slice does offer, for the interface. */
export const ELKULATOR_ADAPTER_SUMMARY =
  'The Acorn Electron also runs on the Elkulator core built for WebAssembly, which adds what ElkJS cannot do: instruction stepping and execution breakpoints against a real per-instruction hook, register writing, key injection and stop-address test execution, alongside execution, reset, memory reading and writing, machine-code loading, the real keyboard over the live display and screen capture. Watchpoints, tracing, disassembly, profiling, replay, hardware inspection, media, sound and machine-state save are not offered: some because the core provides no hook for them, and the rest because the bridge this build exposes deliberately does not carry them.';
