/* 8bit-net Acorn Electron runtime.
 *
 * Drives the vendored ElkJS hardware modules directly rather than its upstream
 * user interface, so this page owns the frame loop, the firmware it loads and
 * the debug surface it exposes.
 *
 * The capability list below is the honest one for this core. ElkJS keeps its
 * registers in closure variables reachable only through `makeSnapshotData()`,
 * and runs a batch of cycles per call with no per-instruction hook, so there is
 * no way to offer instruction stepping, breakpoints, watchpoints, tracing or
 * stop-address test execution without changing the emulator itself. Those are
 * declared unavailable here and refused if asked for, rather than accepted and
 * silently approximated.
 */
(() => {
  'use strict';
  const CHANNEL = '8bit-net-electron';
  const debugSessionId = new URLSearchParams(window.location.search).get('session') ?? '';
  const ENGINE = { id: 'elkjs', version: 'ff123355', machine: 'Acorn Electron' };

  /* Kept in step with `src/emulator/electronAdapter.ts` by a contract test, so
   * the workbench refuses what this core cannot do with the same reason this
   * core would give. */
  const CAPABILITIES = [
    'execution', 'reset', 'register-read', 'memory-read', 'memory-write',
    'program-load', 'keyboard-input', 'display', 'display-filter',
    'screen-capture', 'input-focus', 'audio-toggle',
  ];
  const UNAVAILABLE = {
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
  };
  /* Every command the workbench emulator panel can emit, against the capability
   * it needs. A command missing from this map has never been taught to this
   * adapter and is refused as such. */
  const COMMAND_CAPABILITY = {
    initialise: 'execution', run: 'execution', pause: 'execution', stop: 'execution', reset: 'reset',
    step: 'instruction-step', 'step-over': 'instruction-step', 'step-out': 'instruction-step',
    'source-step': 'instruction-step', 'run-to': 'instruction-step',
    'reverse-step': 'replay', 'reverse-continue': 'replay', 'replay-config': 'replay',
    breakpoint: 'execute-breakpoint', 'set-breakpoints': 'execute-breakpoint',
    watchpoint: 'watchpoint',
    'read-memory': 'memory-read', 'write-memory': 'memory-write',
    'read-tube-memory': 'tube', 'read-disassembly': 'disassembly',
    'write-registers': 'register-write', 'inspect-hardware': 'hardware-inspection',
    'interrupt-monitor': 'interrupt-monitor', 'interrupt-history-clear': 'interrupt-monitor',
    'raster-monitor': 'raster-monitor', 'raster-timeline-clear': 'raster-monitor',
    'profiler-config': 'profiler', 'profiler-clear': 'profiler',
    'trace-config': 'trace', 'trace-clear': 'trace',
    'run-test': 'run-test',
    'load-machine-code': 'program-load', 'load-basic': 'basic-load',
    'load-disc': 'media', 'load-tape': 'media', 'eject-disc': 'media', 'export-disc': 'media', 'eject-tape': 'media',
    'save-state': 'state-save', 'load-state': 'state-save',
    'capture-screen': 'screen-capture',
    'focus-input': 'input-focus', 'release-input': 'input-focus',
    'set-keyboard-layout': 'keyboard-mapping', 'set-key-remaps': 'keyboard-mapping',
    'inject-text': 'key-injection', 'tap-key': 'key-injection',
    'gamepad-key-edge': 'joystick', 'bbc-analogue-joystick': 'joystick',
    'atom-atommc-joystick': 'joystick', 'set-bbc-mouse-joystick': 'joystick',
    'set-audio': 'audio-toggle', 'start-audio-capture': 'audio-capture', 'stop-audio-capture': 'audio-capture',
    'set-speed': 'speed', 'set-volume': 'volume', 'set-display-filter': 'display-filter',
  };

  const status = document.getElementById('runtime-status');
  const output = document.getElementById('output');
  let eventSequence = 0;
  let lastCommandId = 0;
  let acceptedCommands = 0;
  let commandAudit = [];

  let machine = null;
  let running = false;
  let frameTimer = null;
  let romsLoaded = false;
  let sessionManifest = null;
  let loadedProgram = null;
  /* ElkJS gates its own sample writing on the argument to `endFrame`, so audio
   * is off until the workbench asks for it. */
  let audioEnabled = false;
  let displayFilter = 'nearest';
  let inputCaptured = false;

  function log(line) {
    if (!output) return;
    output.textContent = `${output.textContent}${line}\n`.split('\n').slice(-200).join('\n');
  }

  function setStatus(text, state) {
    if (status) { status.textContent = text; status.dataset.state = state ?? 'ready'; }
  }

  /* The workbench transport stamps `sessionId` and `commandId` on every command
   * and expects the same names back, so this adapter speaks that envelope rather
   * than one of its own. */
  function send(payload) {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({
      channel: CHANNEL,
      sessionId: debugSessionId,
      eventSequence: ++eventSequence,
      engine: ENGINE,
      ...payload,
    }, window.location.origin);
  }

  /* ---- machine ---------------------------------------------------------- */

  function buildMachine(roms) {
    const sheila = ElkJs.Sheila({});
    const keyboard = ElkJs.Keyboard({});
    const memory = ElkJs.Memory({ sheila, keyboard, roms });
    const display = ElkJs.Display({ sheila, memory, output: 'screen' });
    const processor = ElkJs.Processor({ memory, sheila, display });
    const sound = ElkJs.Sound({ sheila });
    processor.initialise();
    return { sheila, keyboard, memory, display, processor, sound };
  }

  /** ElkJS exposes its registers only through the snapshot it can already make. */
  function readRegisters() {
    if (!machine) return null;
    const bytes = machine.processor.makeSnapshotData();
    return {
      a: bytes[1] & 0xff,
      p: bytes[2] & 0xff,
      x: bytes[3] & 0xff,
      y: bytes[4] & 0xff,
      s: bytes[5] & 0xff,
      pc: (bytes[6] | (bytes[7] << 8)) & 0xffff,
      source: 'ElkJS processor snapshot',
    };
  }

  function readMemory(address, length) {
    const bytes = [];
    for (let offset = 0; offset < length; offset += 1) {
      /* `direct` avoids the RAM-sync side effect the CPU path applies. */
      bytes.push(machine.memory.readmem((address + offset) & 0xffff, true) & 0xff);
    }
    return bytes;
  }

  function runFrame() {
    frameTimer = null;
    if (!machine || !running) return;
    const started = performance.now();
    try {
      machine.display.startFrame();
      machine.sound.startFrame();
      let rows = 0;
      while (machine.display.beamRow < 312 && rows < 400) {
        machine.display.startRow();
        machine.processor.runCode();
        machine.display.processRow();
        machine.sound.processRow();
        if (machine.display.beamRow === 99) machine.sheila.trigger_rtc();
        if (machine.display.beamRow === 255) machine.sheila.trigger_vbl();
        rows += 1;
      }
      machine.sound.endFrame(audioEnabled);
    } catch (error) {
      running = false;
      stopLoop();
      setStatus(`Electron execution stopped: ${error.message}`, 'error');
      send({ type: 'error', message: `Electron execution stopped: ${error.message}` });
      return;
    }
    const elapsed = performance.now() - started;
    frameTimer = window.setTimeout(runFrame, Math.max(1, 20 - elapsed));
  }

  /* The workbench shows the register values this core last reported, so a
   * running machine has to keep reporting; otherwise the panel would hold a
   * true-but-stale reading that reads as a live one. */
  const SNAPSHOT_INTERVAL_MS = 500;
  let snapshotTimer = null;

  function startLoop() {
    if (snapshotTimer === null) snapshotTimer = window.setInterval(() => { if (running) snapshot('running'); }, SNAPSHOT_INTERVAL_MS);
    if (frameTimer !== null) return;
    frameTimer = window.setTimeout(runFrame, 1);
  }

  function stopLoop() {
    if (frameTimer !== null) { window.clearTimeout(frameTimer); frameTimer = null; }
    if (snapshotTimer !== null) { window.clearInterval(snapshotTimer); snapshotTimer = null; }
  }

  function snapshot(reason) {
    if (!machine) return;
    send({
      type: 'state',
      reason,
      running,
      registers: readRegisters(),
      capabilities: CAPABILITIES,
      unavailable: UNAVAILABLE,
      acceptedCommands,
      lastCommandId,
      commandAudit: commandAudit.slice(-32),
      program: loadedProgram,
      manifest: sessionManifest,
      audioEnabled,
      displayFilter,
      inputCaptured,
    });
  }

  /* ---- commands --------------------------------------------------------- */

  async function initialise(payload) {
    const roms = {};
    for (const [name, path] of Object.entries(payload.roms ?? {})) {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${name} ROM was not supplied (${response.status})`);
      roms[name] = new Uint8Array(await response.arrayBuffer());
    }
    if (!roms.os || !roms.basic) throw new Error('The Electron needs both an operating system and a BASIC ROM');
    machine = buildMachine(roms);
    romsLoaded = true;
    sessionManifest = payload.sessionManifest ?? null;
    machine.processor.reset6502e();
    running = true;
    startLoop();
    setStatus('Acorn Electron running on ElkJS', 'ready');
    log(`ElkJS ${ENGINE.version} initialised with ${Object.keys(roms).length} ROM images.`);
    snapshot('initialised');
  }

  function loadProgram(payload) {
    if (!machine) throw new Error('The Electron is not initialised');
    const bytes = payload.bytes ?? [];
    const origin = payload.origin & 0xffff;
    if (!bytes.length || origin + bytes.length > 0x8000) throw new Error('An Electron program must fit inside the 32 KiB of RAM');
    const wasRunning = running;
    running = false; stopLoop();
    for (let offset = 0; offset < bytes.length; offset += 1) machine.memory.writemem(origin + offset, bytes[offset] & 0xff);
    /* The only way into the processor is its own snapshot format: update byte,
     * accumulator, status, X, Y, stack, then the program counter. */
    const entry = payload.entryPoint & 0xffff;
    machine.processor.loadSnapshot([0, 0, 0, 0, 0, 0xff, entry & 0xff, entry >> 8], 1);
    const programManifest = payload.programManifest ?? null;
    if (programManifest && sessionManifest && programManifest.sessionFingerprint !== sessionManifest.fingerprint) {
      running = wasRunning; if (running) startLoop();
      throw new Error('The program is bound to another runtime session and was not loaded');
    }
    loadedProgram = { origin, entryPoint: entry, bytes: bytes.length, programManifest };
    running = payload.autorun !== false;
    if (running) startLoop();
    send({ type: 'program-loaded', format: '6502 machine code', size: bytes.length, address: origin, entryPoint: entry, programManifest });
    snapshot('program loaded');
  }

  function handle(command) {
    switch (command.type) {
      case 'initialise': return initialise(command);
      case 'run': running = true; startLoop(); snapshot('running'); return;
      case 'pause': running = false; stopLoop(); snapshot('paused'); return;
      case 'reset':
        if (!machine) throw new Error('The Electron is not initialised');
        machine.memory.reset(); machine.sheila.reset(); machine.processor.reset6502e();
        loadedProgram = null; running = true; startLoop(); snapshot('reset'); return;
      case 'load-program':
      case 'load-machine-code': return loadProgram(command);
      case 'read-memory': {
        if (!machine) throw new Error('The Electron is not initialised');
        const length = Math.max(1, Math.min(4096, command.length | 0));
        send({ type: 'memory', requestId: command.requestId, address: command.address & 0xffff, bytes: readMemory(command.address & 0xffff, length) });
        return;
      }
      case 'write-memory': {
        if (!machine) throw new Error('The Electron is not initialised');
        for (const [index, value] of (command.bytes ?? []).entries()) machine.memory.writemem((command.address + index) & 0xffff, value & 0xff);
        snapshot('memory written'); return;
      }
      case 'snapshot': snapshot('requested'); return;
      case 'capabilities':
        send({ type: 'capabilities', capabilities: CAPABILITIES, unavailable: UNAVAILABLE });
        return;
      case 'set-audio':
        audioEnabled = command.enabled !== false;
        send({ type: 'audio-state', enabled: audioEnabled, source: 'ElkJS frame sample writer' });
        return;
      case 'set-display-filter': {
        const filter = command.filter === 'linear' ? 'linear' : 'nearest';
        displayFilter = filter;
        const canvas = document.getElementById('screen');
        if (canvas) canvas.style.imageRendering = filter === 'linear' ? 'auto' : 'pixelated';
        send({ type: 'display-filter', filter });
        return;
      }
      case 'focus-input':
      case 'release-input': {
        const canvas = document.getElementById('screen');
        inputCaptured = command.type === 'focus-input';
        if (canvas) { if (inputCaptured) canvas.focus(); else canvas.blur(); }
        send({ type: 'input-focus', captured: inputCaptured });
        return;
      }
      case 'capture-screen': return captureScreen();
      default: {
        const capability = COMMAND_CAPABILITY[command.type];
        if (capability === undefined) throw new Error(`${command.type} is not a command this Electron adapter accepts`);
        throw new Error(`${command.type} is not available on this Electron adapter: ${UNAVAILABLE[capability] ?? 'no reason was recorded'}`);
      }
    }
  }

  /* The vendored display module draws into a real canvas, so a capture is the
   * pixels the core produced rather than a re-render of assumed state. */
  function captureScreen() {
    const canvas = document.getElementById('screen');
    if (!canvas) throw new Error('The Electron display canvas is not present');
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('The browser refused to encode the Electron framebuffer')); return; }
        send({ type: 'screen-captured', blob, filename: 'acorn-electron-screen.png', width: canvas.width, height: canvas.height, size: blob.size });
        resolve();
      }, 'image/png');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window.parent) return;
    const command = event.data;
    if (!command || command.channel !== CHANNEL) return;
    if (command.sessionId !== debugSessionId) { send({ type: 'error', message: 'Command rejected: wrong runtime session' }); return; }
    if (!Number.isSafeInteger(command.commandId) || command.commandId <= lastCommandId) { send({ type: 'error', message: 'Command rejected: stale or duplicate sequence' }); return; }
    lastCommandId = command.commandId;
    Promise.resolve()
      .then(() => handle(command))
      .then(() => {
        acceptedCommands += 1;
        commandAudit = [...commandAudit, { commandId: command.commandId, type: command.type }].slice(-32);
        send({ type: 'command-accepted', commandId: command.commandId, command: command.type, queued: 0, capacity: 64 });
      })
      .catch((error) => {
        send({ type: 'error', commandId: command.commandId, command: command.type, message: error.message });
        log(`Refused ${command.type}: ${error.message}`);
      });
  });

  /* ElkJS installs its own document key handlers when its keyboard module is
   * created, so this page adds none of its own; doing so would consume the
   * events its emulated matrix is waiting for. */

  setStatus('Waiting for firmware from the local vault…', 'pending');
  send({ type: 'ready', capabilities: CAPABILITIES, unavailable: UNAVAILABLE, romsLoaded });
  window.__electronRuntime = { readRegisters, readMemory, isRunning: () => running, engine: ENGINE, capabilities: CAPABILITIES, unavailable: UNAVAILABLE };
})();
