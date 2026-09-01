/* 8bit-net Acorn Electron runtime, on the Elkulator core.
 *
 * There are two Electron cores in this build. This is the second: Elkulator
 * compiled to WebAssembly, which is the full machine — sideways ROM banks, the
 * Plus 1 and Plus 3, and a debugger hook before every instruction — where ElkJS
 * is a 32 KB machine with two ROMs and no hook at all.
 *
 * Everything this page asks of the machine goes through the bridge in
 * `docker/elkulator/webide_bridge.c`, which is deliberately the whole of that
 * interface. So the capability list below is not a summary of what Elkulator
 * can do; it is a statement of what this build exposes, and the reasons for the
 * refusals say which of the two a missing capability is.
 *
 * The core owns its own canvas and its own frame: Allegro's SDL backend renders
 * into it and the browser drives one iteration of the emulator's loop per
 * animation frame. This page therefore does not run a frame loop of its own, and
 * running or pausing is a question asked of the bridge rather than of a timer
 * here.
 */
(() => {
  'use strict';
  const CHANNEL = '8bit-net-elkulator';
  const debugSessionId = new URLSearchParams(window.location.search).get('session') ?? '';
  const ENGINE = { id: 'elkulator', version: '6785521a', machine: 'Acorn Electron' };

  /* Kept in step with `src/emulator/elkulatorAdapter.ts` by a contract test, so
   * the workbench refuses what this build cannot do with the same reason this
   * page would give. */
  const CAPABILITIES = [
    'execution', 'reset', 'instruction-step', 'execute-breakpoint',
    'register-read', 'register-write', 'memory-read', 'memory-write',
    'program-load', 'run-test', 'keyboard-input', 'key-injection',
    'display', 'display-filter', 'screen-capture', 'input-focus',
  ];
  const UNAVAILABLE = {
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
  };
  /* Every command the workbench emulator panel can emit, against the capability
   * it needs. A command missing from this map has never been taught to this
   * adapter and is refused as such. */
  const COMMAND_CAPABILITY = {
    initialise: 'execution', run: 'execution', pause: 'execution', stop: 'execution', reset: 'reset',
    step: 'instruction-step', 'step-over': 'instruction-step', 'step-out': 'instruction-step',
    'source-step': 'instruction-step', 'run-to': 'execute-breakpoint',
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

  /* The register order the bridge uses. Kept here rather than passed around as
   * numbers so that a mistake is a missing name rather than a wrong reading. */
  const REGISTER = { a: 0, x: 1, y: 2, s: 3, p: 4, pc: 5 };

  /* The Electron keys the bridge accepts, in its own enumeration order. Only
   * the ones this page can name are listed: a key nobody can spell is not a key
   * the workbench can ask for. */
  const ELK_KEY = {
    0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10,
    a: 11, b: 12, c: 13, d: 14, e: 15, f: 16, g: 17, h: 18, i: 19, j: 20, k: 21, l: 22, m: 23,
    n: 24, o: 25, p: 26, q: 27, r: 28, s: 29, t: 30, u: 31, v: 32, w: 33, x: 34, y: 35, z: 36,
    '=': 37, ',': 38, '.': 39, '/': 40, ';': 41, ':': 42,
    left: 43, right: 44, up: 45, down: 46,
    func: 47, copy: 48, ctrl: 49, shift: 50, delete: 51, ' ': 52, enter: 53, escape: 54, break: 55,
  };
  const SHIFTED = {
    '!': '1', '"': '2', '#': '3', $: '4', '%': '5', '&': '6', "'": '7', '(': '8', ')': '9', '@': '0',
    '<': ',', '>': '.', '?': '/', '+': ';', '*': ':',
  };

  /* Allegro's SDL backend finds its drawing surface with the selector
   * "#canvas", so that is what the surface is called here — a canvas named
   * anything else would not be the one the emulator renders into. */
  const SCREEN_ID = 'canvas';
  const screenElement = () => document.getElementById(SCREEN_ID);

  const status = document.getElementById('runtime-status');
  const output = document.getElementById('output');
  let eventSequence = 0;
  let lastCommandId = 0;
  let acceptedCommands = 0;
  let commandAudit = [];

  let core = null;
  let sessionManifest = null;
  let loadedProgram = null;
  let displayFilter = 'nearest';
  let inputCaptured = false;
  let breakpointSlots = [];
  let pendingTest = null;

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

  /* ---- the core --------------------------------------------------------- */

  const call = (name, ...args) => core.ccall(name, 'number', args.map(() => 'number'), args);

  /*
   * A screen capture has to be the pixels the core produced, and a WebGL canvas
   * throws its drawing buffer away at the end of every frame unless it is asked
   * not to. SDL creates the context, so the attribute is forced here before
   * anything can create one. It costs a copy per frame and buys a capture that
   * is the machine's own picture rather than a black rectangle.
   */
  function preserveDrawingBuffer() {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(kind, attributes) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') {
        return original.call(this, kind, { ...(attributes ?? {}), preserveDrawingBuffer: true });
      }
      return original.call(this, kind, attributes);
    };
  }

  function readRegisters() {
    if (!core) return null;
    const registers = {};
    for (const [name, index] of Object.entries(REGISTER)) registers[name] = call('elk_webide_get_register', index);
    registers.source = 'Elkulator 6502 state at an instruction boundary';
    return registers;
  }

  /* Two readings, and the caller says which it wants. `direct` is the RAM array,
   * which cannot disturb anything and answers nothing above &7FFF; otherwise the
   * processor's own view, where paged ROM and the ULA answer and a read can have
   * a side effect. */
  function readMemory(address, length, direct) {
    const bytes = [];
    const entry = direct ? 'elk_webide_read_ram' : 'elk_webide_read_memory';
    for (let offset = 0; offset < length; offset += 1) {
      const value = call(entry, (address + offset) & 0xffff);
      bytes.push(value < 0 ? null : value & 0xff);
    }
    return bytes;
  }

  function isRunning() {
    return Boolean(core) && call('elk_webide_paused') === 0;
  }

  function snapshot(reason) {
    if (!core) return;
    const hit = call('elk_webide_breakpoint_hit');
    send({
      type: 'state',
      reason,
      running: isRunning(),
      registers: readRegisters(),
      capabilities: CAPABILITIES,
      unavailable: UNAVAILABLE,
      acceptedCommands,
      lastCommandId,
      commandAudit: commandAudit.slice(-32),
      program: loadedProgram,
      manifest: sessionManifest,
      breakpoints: breakpointSlots.map((address, slot) => ({ slot, address, hits: call('elk_webide_breakpoint_hits', slot) })),
      breakpointHit: hit < 0 ? null : { slot: hit, address: breakpointSlots[hit] ?? null },
      frames: call('elk_webide_frames'),
      /* Zero would read as "nothing has executed", which is a different claim
       * from "nobody asked for a count". */
      instructions: call('elk_webide_counting') ? call('elk_webide_instructions') : null,
      displayFilter,
      inputCaptured,
    });
  }

  /* ---- commands --------------------------------------------------------- */

  /*
   * Bring the machine up.
   *
   * Elkulator reads its firmware from a `roms` directory before `main` returns,
   * so every image has to be in the virtual file system first. Only the
   * operating system and BASIC are required; an Electron with no Plus 1 is a
   * real Electron, and a ROM the person does not own is simply an expansion that
   * is not fitted.
   */
  async function initialise(payload) {
    if (core) throw new Error('The Electron is already initialised; reload the runtime to change its firmware');
    const supplied = payload.roms ?? {};
    if (!supplied.os || !supplied.basic) throw new Error('The Electron needs both an operating system and a BASIC ROM');
    const images = {};
    for (const [name, path] of Object.entries(supplied)) {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${name} ROM was not supplied (${response.status})`);
      images[name] = new Uint8Array(await response.arrayBuffer());
    }
    preserveDrawingBuffer();
    core = await createElkulator({ canvas: screenElement(), print: log, printErr: log });
    core.FS.mkdir('/roms');
    /* The names are Elkulator's own; a supplied ROM whose name is not one of
     * them would be written and never read, so it is refused instead. */
    const FILENAMES = { os: 'os', basic: 'basic.rom', mrbos: 'os300.rom', adfs: 'adfs.rom', dfs: 'dfs.rom', sound: 'sndrom', plus1: 'plus1.rom' };
    for (const [name, bytes] of Object.entries(images)) {
      const filename = FILENAMES[name];
      if (!filename) throw new Error(`${name} is not a ROM socket this Electron has`);
      core.FS.writeFile(`/roms/${filename}`, bytes);
    }
    core.callMain([]);
    sessionManifest = payload.sessionManifest ?? null;
    setStatus('Acorn Electron running on Elkulator', 'ready');
    log(`Elkulator ${ENGINE.version} initialised with ${Object.keys(images).length} ROM images.`);
    snapshot('initialised');
  }

  function requireCore() {
    if (!core) throw new Error('The Electron is not initialised');
  }

  function loadProgram(payload) {
    requireCore();
    const bytes = payload.bytes ?? [];
    const origin = payload.origin & 0xffff;
    if (!bytes.length || origin + bytes.length > 0x8000) throw new Error('An Electron program must fit inside the 32 KiB of RAM');
    const programManifest = payload.programManifest ?? null;
    if (programManifest && sessionManifest && programManifest.sessionFingerprint !== sessionManifest.fingerprint) {
      throw new Error('The program is bound to another runtime session and was not loaded');
    }
    call('elk_webide_pause');
    const buffer = core._malloc(bytes.length);
    try {
      core.HEAPU8.set(Uint8Array.from(bytes, (value) => value & 0xff), buffer);
      const written = call('elk_webide_load', origin, buffer, bytes.length);
      if (written !== bytes.length) throw new Error('The Electron refused the program; it would not fit in RAM');
    } finally {
      core._free(buffer);
    }
    const entry = payload.entryPoint & 0xffff;
    call('elk_webide_set_register', REGISTER.pc, entry);
    loadedProgram = { origin, entryPoint: entry, bytes: bytes.length, programManifest };
    if (payload.autorun !== false) call('elk_webide_resume');
    send({ type: 'program-loaded', format: '6502 machine code', size: bytes.length, address: origin, entryPoint: entry, programManifest });
    snapshot('program loaded');
  }

  function setBreakpoints(addresses) {
    call('elk_webide_clear_breakpoints');
    breakpointSlots = [];
    const wanted = [...new Set(addresses.map((address) => address & 0xffff))];
    if (wanted.length > 32) throw new Error('The Electron bridge holds 32 breakpoints; more were asked for than it has slots');
    for (const [slot, address] of wanted.entries()) {
      if (!call('elk_webide_set_breakpoint', slot, address)) throw new Error(`The Electron refused a breakpoint at &${address.toString(16).toUpperCase()}`);
      breakpointSlots.push(address);
    }
  }

  /*
   * A stop-address test: run until the program reaches the address it halts at,
   * or until the time allowed runs out.
   *
   * This is the one thing the ElkJS Electron has to refuse outright, and it is
   * honest here only because the stop is a real breakpoint on a real
   * instruction hook rather than a poll that happens to catch the machine in
   * the right place.
   */
  function runTest(command) {
    requireCore();
    if (pendingTest) throw new Error('A test is already running on this Electron');
    const stopAddress = command.stopAddress & 0xffff;
    const timeoutMs = Math.max(100, Math.min(60_000, command.timeoutMs | 0 || 5_000));
    setBreakpoints([stopAddress]);
    if (typeof command.entryPoint === 'number') call('elk_webide_set_register', REGISTER.pc, command.entryPoint & 0xffff);
    call('elk_webide_resume');
    const started = performance.now();
    const finish = (outcome) => {
      window.clearInterval(pendingTest.poll);
      pendingTest = null;
      call('elk_webide_pause');
      send({
        type: 'test-result',
        requestId: command.requestId,
        outcome,
        stopAddress,
        elapsedMs: Math.round(performance.now() - started),
        registers: readRegisters(),
        frames: call('elk_webide_frames'),
      });
      snapshot(`test ${outcome}`);
    };
    pendingTest = {
      poll: window.setInterval(() => {
        if (call('elk_webide_breakpoint_hit') >= 0) { finish('reached'); return; }
        if (performance.now() - started > timeoutMs) finish('timed out');
      }, 20),
    };
  }

  /* A key press the workbench asked for, rather than one somebody typed. The
   * bridge sets the Electron's own key state, so this does not depend on the
   * page having focus and cannot be swallowed by the workbench around it. */
  function keyName(character) {
    const lower = String(character).toLowerCase();
    if (ELK_KEY[lower] !== undefined) return { key: lower, shift: false };
    const unshifted = SHIFTED[character];
    if (unshifted !== undefined) return { key: unshifted, shift: true };
    if (character >= 'A' && character <= 'Z') return { key: lower, shift: true };
    return null;
  }

  function tapKeys(characters, holdMs) {
    requireCore();
    const hold = Math.max(20, Math.min(500, holdMs | 0 || 60));
    let at = 0;
    let tapped = 0;
    for (const character of characters) {
      const named = keyName(character);
      if (!named) throw new Error(`The Electron keyboard has no key for ${JSON.stringify(character)}`);
      const code = ELK_KEY[named.key];
      window.setTimeout(() => {
        if (named.shift) call('elk_webide_set_key', ELK_KEY.shift, 1);
        call('elk_webide_set_key', code, 1);
      }, at);
      window.setTimeout(() => {
        call('elk_webide_set_key', code, 0);
        if (named.shift) call('elk_webide_set_key', ELK_KEY.shift, 0);
      }, at + hold);
      at += hold * 2;
      tapped += 1;
    }
    return { keys: tapped, durationMs: at };
  }

  function handle(command) {
    switch (command.type) {
      case 'initialise': return initialise(command);
      case 'run': requireCore(); call('elk_webide_resume'); snapshot('running'); return;
      case 'pause':
      case 'stop': requireCore(); call('elk_webide_pause'); snapshot('paused'); return;
      case 'reset':
        requireCore();
        call('elk_webide_reset');
        call('elk_webide_resume');
        loadedProgram = null;
        snapshot('reset');
        return;
      case 'step':
      case 'step-over':
      case 'step-out':
      case 'source-step': {
        requireCore();
        const count = Math.max(1, Math.min(100_000, command.instructions | 0 || 1));
        if (!call('elk_webide_step', count)) throw new Error('The Electron refused a step of that length');
        /* The step is taken by the machine's own loop on the next field, so the
         * state is reported once it has actually happened rather than now. */
        window.setTimeout(() => snapshot('stepped'), 40);
        return;
      }
      case 'run-to': {
        requireCore();
        setBreakpoints([command.address & 0xffff]);
        call('elk_webide_resume');
        snapshot('running to address');
        return;
      }
      case 'breakpoint':
      case 'set-breakpoints': {
        requireCore();
        const addresses = command.type === 'breakpoint'
          ? [command.address & 0xffff]
          : (command.breakpoints ?? []).map((entry) => (typeof entry === 'number' ? entry : entry.address) & 0xffff);
        setBreakpoints(addresses);
        snapshot('breakpoints set');
        return;
      }
      case 'load-program':
      case 'load-machine-code': return loadProgram(command);
      case 'read-memory': {
        requireCore();
        const length = Math.max(1, Math.min(4096, command.length | 0));
        const address = command.address & 0xffff;
        send({ type: 'memory', requestId: command.requestId, address, direct: command.direct !== false, bytes: readMemory(address, length, command.direct !== false) });
        return;
      }
      case 'write-memory': {
        requireCore();
        for (const [index, value] of (command.bytes ?? []).entries()) {
          if (!call('elk_webide_write_memory', (command.address + index) & 0xffff, value & 0xff)) throw new Error('The Electron refused a memory write');
        }
        snapshot('memory written');
        return;
      }
      case 'write-registers': {
        requireCore();
        for (const [name, value] of Object.entries(command.registers ?? {})) {
          const index = REGISTER[name];
          if (index === undefined) throw new Error(`The Electron 6502 has no register named ${name}`);
          if (!call('elk_webide_set_register', index, value >>> 0)) throw new Error(`The Electron refused a write to ${name}`);
        }
        snapshot('registers written');
        return;
      }
      case 'run-test': return runTest(command);
      case 'inject-text': {
        const result = tapKeys(String(command.text ?? ''), command.holdMs);
        send({ type: 'text-injected', ...result });
        return;
      }
      case 'tap-key': {
        requireCore();
        const code = ELK_KEY[String(command.key ?? '').toLowerCase()];
        if (code === undefined) throw new Error(`The Electron keyboard has no key named ${JSON.stringify(command.key)}`);
        call('elk_webide_set_key', code, command.pressed === false ? 0 : 1);
        send({ type: 'key-state', key: command.key, pressed: command.pressed !== false });
        return;
      }
      case 'snapshot': snapshot('requested'); return;
      case 'capabilities':
        send({ type: 'capabilities', capabilities: CAPABILITIES, unavailable: UNAVAILABLE });
        return;
      case 'set-display-filter': {
        const filter = command.filter === 'linear' ? 'linear' : 'nearest';
        displayFilter = filter;
        const canvas = screenElement();
        if (canvas) canvas.style.imageRendering = filter === 'linear' ? 'auto' : 'pixelated';
        send({ type: 'display-filter', filter });
        return;
      }
      case 'focus-input':
      case 'release-input': {
        const canvas = screenElement();
        inputCaptured = command.type === 'focus-input';
        if (canvas) { if (inputCaptured) canvas.focus(); else canvas.blur(); }
        /* Anything held down when focus leaves would stay held on the emulated
         * matrix, which is how a machine ends up typing by itself. */
        if (!inputCaptured && core) call('elk_webide_clear_keys');
        send({ type: 'input-focus', captured: inputCaptured });
        return;
      }
      case 'capture-screen': return captureScreen();
      default: {
        const capability = COMMAND_CAPABILITY[command.type];
        if (capability === undefined) throw new Error(`${command.type} is not a command this Elkulator adapter accepts`);
        throw new Error(`${command.type} is not available on this Elkulator adapter: ${UNAVAILABLE[capability] ?? 'no reason was recorded'}`);
      }
    }
  }

  function captureScreen() {
    const canvas = screenElement();
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

  /* SDL installs its own key handlers on the canvas, so the real keyboard
   * reaches the emulated matrix without this page adding handlers that would
   * consume the events it is waiting for. */

  setStatus('Waiting for firmware from the local vault…', 'pending');
  send({ type: 'ready', capabilities: CAPABILITIES, unavailable: UNAVAILABLE, romsLoaded: false });
  window.__elkulatorRuntime = {
    readRegisters, readMemory, isRunning, engine: ENGINE, capabilities: CAPABILITIES, unavailable: UNAVAILABLE,
    handle, keyName, ELK_KEY, REGISTER,
  };
})();
