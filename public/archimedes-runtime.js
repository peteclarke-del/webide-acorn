(() => {
  'use strict';
  const CHANNEL = '8bit-net-archimedes';
  const debugSessionId = new URLSearchParams(window.location.search).get('session') ?? '';
  let eventSequence = 0;
  let lastCommandId = 0;
  let acceptedCommands = 0;
  let commandAudit = [];
  const debugCapabilities = ['execution', 'register-read', 'register-write', 'memory-read', 'memory-write', 'execute-breakpoint', 'conditional-breakpoint', 'logpoint', 'source-step', 'hardware-inspection', 'media', 'screen-capture', 'audio'];
  const status = document.getElementById('runtime-status');
  const progress = document.getElementById('progress');
  const canvas = document.getElementById('canvas');
  const output = document.getElementById('output');
  const audioActivation = document.getElementById('audio-activation');
  let runtimeReady = false;
  let resolveRuntimeReady;
  const runtimeReadyPromise = new Promise((resolve) => { resolveRuntimeReady = resolve; });
  let started = false;
  let runtimeSessionManifest;
  let loadedProgramManifest;
  let profile;
  let snapshotTimer;
  let fastBootWasActive = false;
  let fastBootToken = 0;
  let fastBootProgress;
  const stagedApplications = new Map();
  let pendingLaunch;
  let launchInProgress = false;
  let desiredAudio = false;
  let lastAudioSnapshot = 0;
  let audioCaptureRequested = false;
  const mountedDiscs = new Map();
  let activeBreakpoints = [];
  let temporaryBreakpoint = null;
  const capturedLogMessages = new Map();
  let memoryEditSequence = 0;
  let memoryEdits = [];
  let loadedSourceLocations = new Map();
  let hardwareSampleSequence = 0;
  const performanceBudgets = Object.freeze({ activeSessions: 1, frameBudgetMs: 20, snapshotIntervalMs: 200, audioSampleIntervalMs: 500, crashCapacity: 16, traceCapacity: 64, mediaBytesPerDrive: 2 * 1024 * 1024 });
  let framePerformance = { samples: 0, renderedFrames: 0, lateFrames: 0, droppedFrames: 0, lastIntervalMs: 0, averageIntervalMs: 0, maximumIntervalMs: 0 };
  let lastPresentationAt = 0;
  let backgroundSuspended = document.hidden;
  let resumeAfterBackground = false;
  let crashDiagnostics = [];
  let crashSequence = 0;
  let mouseButtons = 0;
  let lastMouseSample = null;

  const protocolSnapshot = () => ({ version: 2, adapter: 'arculator-wasm', sessionBound: Boolean(debugSessionId), owner: 'workbench-parent', acceptedCommands, lastCommandId, auditCapacity: 32, audit: commandAudit.slice(), capabilities: debugCapabilities.slice() });
  const send = (message) => window.parent.postMessage({ channel: CHANNEL, sessionId: debugSessionId, eventSequence: ++eventSequence, ...(message.type === 'snapshot' ? { ...message, protocol: protocolSnapshot(), programManifest: loadedProgramManifest ?? null } : message) }, window.location.origin);
  const hexSha256 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((value) => value.toString(16).padStart(2, '0')).join('');
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}` : JSON.stringify(value);
  const setStatus = (message, tone = '') => { status.textContent = message; status.className = tone; };
  const ccall = (name, returnType = null, argumentTypes = [], args = []) => window.Module.ccall(name, returnType, argumentTypes, args);
  const mkdir = (path) => { try { window.Module.FS.mkdir(path); } catch (error) { if (error?.errno !== 20) throw error; } };
  const writeFile = (path, bytes) => window.Module.FS.writeFile(path, bytes);
  const appendCrash = (kind, value) => {
    const raw = value instanceof Error ? value.message : String(value);
    const message = raw.replace(/(?:https?|file):\/\/\S+/gi, '[redacted-url]').replace(/\/(?:[^\s/]+\/)+[^\s]+/g, '[redacted-path]').slice(0, 500);
    crashDiagnostics = [...crashDiagnostics, { sequence: ++crashSequence, timeMs: performance.now(), kind, message }].slice(-performanceBudgets.crashCapacity);
  };
  const observePresentation = (now) => {
    if (!document.hidden && lastPresentationAt) {
      const interval = now - lastPresentationAt; const samples = framePerformance.samples + 1;
      framePerformance = { samples, renderedFrames: framePerformance.renderedFrames + 1, lateFrames: framePerformance.lateFrames + (interval > 30 ? 1 : 0), droppedFrames: framePerformance.droppedFrames + Math.max(0, Math.floor(interval / 20) - 1), lastIntervalMs: interval, averageIntervalMs: framePerformance.averageIntervalMs + (interval - framePerformance.averageIntervalMs) / samples, maximumIntervalMs: Math.max(framePerformance.maximumIntervalMs, interval) };
    } else if (!document.hidden) framePerformance.renderedFrames += 1;
    lastPresentationAt = document.hidden ? 0 : now;
    requestAnimationFrame(observePresentation);
  };
  requestAnimationFrame(observePresentation);

  const breakpointConditions = (breakpoint) => Array.isArray(breakpoint.conditions) ? breakpoint.conditions : breakpoint.condition ? [breakpoint.condition] : [];
  const validBreakpointCondition = (condition) => condition && Number.isInteger(condition.register) && condition.register >= 0 && condition.register <= 15 && Number.isInteger(condition.operator) && condition.operator >= 1 && condition.operator <= 6 && Number.isInteger(condition.value) && condition.value >= 0 && condition.value <= 0xffffffff;
  const validBreakpoint = (breakpoint) => {
    if (!breakpoint || !Number.isInteger(breakpoint.address) || breakpoint.address < 0 || breakpoint.address > 0x3fffffc || (breakpoint.address & 3)) return false;
    if (breakpoint.hitTarget !== undefined && (!Number.isInteger(breakpoint.hitTarget) || breakpoint.hitTarget < 1 || breakpoint.hitTarget > 1000000)) return false;
    if (!Number.isInteger(breakpoint.action ?? 0) || (breakpoint.action ?? 0) < 0 || (breakpoint.action ?? 0) > 2) return false;
    if (breakpoint.logMessage !== undefined && (typeof breakpoint.logMessage !== 'string' || breakpoint.logMessage.length > 160)) return false;
    if ((breakpoint.action === 1 || breakpoint.action === 2) && !breakpoint.logMessage?.trim()) return false;
    if (breakpoint.condition && breakpoint.conditions) return false;
    const conditions = breakpointConditions(breakpoint);
    return conditions.length <= 4 && conditions.every(validBreakpointCondition);
  };

  function audioContext() { return window.SDL2?.audioContext ?? window.Module?.SDL2?.audioContext; }

  function programBreakpoints(breakpoints) {
    ccall('arc_webide_clear_breakpoints');
    breakpoints.forEach((breakpoint, slot) => {
      ccall('arc_webide_set_breakpoint', 'number', ['number', 'number'], [slot, breakpoint.address]);
      ccall('arc_webide_configure_breakpoint', 'number', ['number', 'number', 'number', 'number', 'number', 'number'], [slot, breakpoint.hitTarget ?? 1, -1, 0, 0, breakpoint.action ?? 0]);
      breakpointConditions(breakpoint).forEach((condition, conditionIndex) => ccall('arc_webide_set_breakpoint_condition', 'number', ['number', 'number', 'number', 'number', 'number'], [slot, conditionIndex, condition.register, condition.operator, condition.value]));
    });
  }

  function sendAudioState() {
    if (!started) return;
    const available = !!ccall('arc_webide_audio_available', 'number');
    const enabled = !!ccall('arc_webide_audio_enabled', 'number');
    const contextState = audioContext()?.state ?? (available ? 'unknown' : 'unavailable');
    const requiresGesture = desiredAudio && available && contextState !== 'running';
    audioActivation.hidden = !requiresGesture;
    send({ type: 'audio-state', available, enabled, desired: desiredAudio, contextState, requiresGesture, queuedBytes: ccall('arc_webide_audio_queued_bytes', 'number') >>> 0, buffers: 0, peak: 0, recording: audioCaptureRequested });
    if (audioCaptureRequested && !ccall('arc_webide_audio_capture_active', 'number')) finishAudioCapture(true);
  }

  async function setAudio(enabled) {
    if (!enabled && audioCaptureRequested) finishAudioCapture(false);
    desiredAudio = !!enabled;
    ccall('arc_enable_sound', null, ['number'], [desiredAudio ? 1 : 0]);
    if (desiredAudio && audioContext()?.state !== 'running') {
      try { await audioContext()?.resume(); } catch {}
    }
    sendAudioState();
  }

  function pcm16StereoWav(samples, sampleRate) {
    const dataBytes = samples.byteLength;
    const wav = new Uint8Array(44 + dataBytes);
    const view = new DataView(wav.buffer);
    const ascii = (offset, value) => { for (let index = 0; index < value.length; index += 1) wav[offset + index] = value.charCodeAt(index); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, dataBytes, true);
    wav.set(samples, 44);
    return wav;
  }

  function startAudioCapture(seconds) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw new Error('Audio capture duration must be a whole number from 1 to 30 seconds');
    if (!desiredAudio || !ccall('arc_webide_audio_enabled', 'number')) throw new Error('Enable live A310 audio before starting WAV capture');
    if (!ccall('arc_webide_audio_capture_start', 'number', ['number'], [seconds])) throw new Error('The A310 PCM capture buffer could not be allocated');
    audioCaptureRequested = true;
    send({ type: 'audio-capture-state', recording: true, seconds, sampleRate: 48000, channels: 2, limitFrames: seconds * 48000 });
    sendAudioState();
  }

  function finishAudioCapture(limitReached) {
    if (!audioCaptureRequested) return;
    audioCaptureRequested = false;
    ccall('arc_webide_audio_capture_stop');
    const frames = ccall('arc_webide_audio_capture_frames', 'number') >>> 0;
    const pointer = ccall('arc_webide_audio_capture_data', 'number') >>> 0;
    try {
      if (!pointer || !frames) {
        send({ type: 'audio-capture-state', recording: false, frames: 0, sampleRate: 48000, channels: 2, limitReached: false });
        send({ type: 'control-rejected', message: 'A310 audio capture ended before the core produced a complete SDL PCM frame' });
        return;
      }
      const dataBytes = frames * 4;
      const samples = new Uint8Array(dataBytes);
      samples.set(new Uint8Array(window.Module.HEAPU8.buffer, pointer, dataBytes));
      const wav = pcm16StereoWav(samples, 48000);
      const blob = new Blob([wav], { type: 'audio/wav' });
      send({ type: 'audio-captured', blob, filename: `8bit-net-A310-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`, size: wav.length, frames, samples: frames * 2, channels: 2, sampleRate: 48000, durationSeconds: frames / 48000, limitReached });
      send({ type: 'audio-capture-state', recording: false, frames, sampleRate: 48000, channels: 2, limitReached });
    } finally {
      ccall('arc_webide_audio_capture_release');
    }
  }

  function snapshot(reason = 'periodic') {
    if (!started) return;
    const registers = Array.from({ length: 16 }, (_, index) => ccall('arc_webide_get_register', 'number', ['number'], [index]) >>> 0);
    const pc = ccall('arc_webide_get_pc', 'number') >>> 0;
    const paused = !!ccall('arc_webide_is_paused', 'number');
    const breakAddress = ccall('arc_webide_breakpoint_hit', 'number');
    const hookCount = ccall('arc_webide_hook_count', 'number') >>> 0;
    const corePc = ccall('arc_webide_last_hook_pc', 'number') >>> 0;
    const breakpoint0 = ccall('arc_webide_get_breakpoint', 'number', ['number'], [0]);
    const emulationMs = ccall('arc_get_emulation_ms', 'number');
    const memoryKiB = ccall('arc_webide_get_memory_kib', 'number') >>> 0;
    const mode = ccall('arc_webide_get_mode', 'number') >>> 0;
    const pipeline = [0, 1, 2].map((stage) => ({ address: (pc + stage * 4) & 0x03fffffc, word: ccall('arc_webide_get_pipeline_word', 'number', ['number'], [stage]) >>> 0, source: stage < 2 ? 'Arculator pipeline latch' : 'side-effect-free next-fetch preview' }));
    const bankedRegisters = ['user', 'fiq', 'irq', 'supervisor'].map((name, bankMode) => ({ name, mode: bankMode, registers: Array.from({ length: 7 }, (_, offset) => ccall('arc_webide_get_banked_register', 'number', ['number', 'number'], [bankMode, offset + 8]) >>> 0) }));
    const inspect = (group, length) => Array.from({ length }, (_, index) => ccall('arc_webide_inspect_hardware', 'number', ['number', 'number'], [group, index]) >>> 0);
    const [vidc, memc, ioc, vidcState, disc, audioHardware] = [inspect(0, 9), inspect(1, 14), inspect(2, 15), inspect(3, 84), inspect(4, 17), inspect(5, 3)];
    const executeWord = pipeline[0].word;
    const activeSwi = (executeWord & 0x0f000000) === 0x0f000000;
    const hardware = {
      sampleSequence: ++hardwareSampleSequence,
      sampledAtEmulationMs: emulationMs,
      source: 'Arculator live internal state · no mapped I/O reads',
      vidc: { displayEnabled: !!vidc[0], frameCount: vidc[1], dmaLength: vidc[2], clock: vidc[3], videoAddress: vidc[4], cursorAddress: vidc[5], cursorVisible: !!vidc[6], width: canvas.width, height: canvas.height, dimensionsSource: 'live SDL canvas', rawRegisters: vidcState.slice(0, 64), palette: vidcState.slice(0, 20), timing: { line: vidcState[64], horizontalTotal: vidcState[65] * 2 + 2, horizontalSync: vidcState[66] * 2 + 2, horizontalBorderStart: vidcState[67], horizontalDisplayStart: vidcState[68], horizontalDisplayEnd: vidcState[69], horizontalBorderEnd: vidcState[70], verticalTotal: vidcState[71], verticalSync: vidcState[72], verticalBorderStart: vidcState[73], verticalDisplayStart: vidcState[74], verticalDisplayEnd: vidcState[75], verticalBorderEnd: vidcState[76], cursorX: vidcState[77], cursorYStart: vidcState[78], cursorYEnd: vidcState[79], interlace: !!vidcState[80], control: vidcState[81], soundPeriod: vidcState[82], soundHz: vidcState[83] } },
      memc: { videoDmaEnabled: !!memc[0], refreshEnabled: !!memc[1], memc1: !!memc[2], type: memc[3], soundStart: memc[4], soundEnd: memc[5], soundPointer: memc[6], soundPosition: memc[7], soundEndNext: memc[8], soundStartNext: memc[9], soundDmaEnabled: !!memc[10], soundDmaRequest: memc[11], videoDmaRequest: memc[12], cursorDmaRequest: memc[13] },
      ioc: { irqA: ioc[0], irqB: ioc[1], fiq: ioc[2], maskA: ioc[3], maskB: ioc[4], maskF: ioc[5], control: ioc[6], timerCounters: ioc.slice(7, 11), timerLatches: ioc.slice(11, 15) },
      storage: { currentDrive: disc[0], driveSelect: disc[1], motorOn: !!disc[2], fdcReady: !!disc[3], overridden: !!disc[4], drives: Array.from({ length: 4 }, (_, drive) => ({ drive, loaded: !!disc[5 + drive], track: disc[9 + drive], writeProtected: !!disc[13 + drive] })), source: 'Arculator disc and FDC live internal state' },
      audio: { available: !!audioHardware[0], enabled: !!audioHardware[1], queuedBytes: audioHardware[2], source: 'Arculator SDL audio device and MEMC sound DMA state' },
      swi: { active: activeSwi, address: pc, word: executeWord, number: activeSwi ? executeWord & 0x00ffffff : null, source: 'ARM execute pipeline latch' },
      modules: { available: false, source: 'The pinned Arculator adapter does not expose a side-effect-free RISC OS module registry; guest memory is not scanned heuristically' },
    };
    const context = audioContext();
    const contextWithOutput = context ?? {};
    const performanceState = { isolation: 'same-origin sandboxed Arculator WASM iframe; build, analysis and project search use dedicated workers', budgets: performanceBudgets, background: { policy: 'pause the ARM core and suspend active audio while hidden; resume prior run state when visible', hidden: document.hidden, suspended: backgroundSuspended, resumePending: resumeAfterBackground }, frames: { ...framePerformance, source: 'requestAnimationFrame intervals while active; droppedFrames estimates missed 20 ms presentation slots' }, audio: { latencyMs: ((contextWithOutput.baseLatency ?? 0) + (contextWithOutput.outputLatency ?? 0)) * 1000, underrunsAvailable: false, underruns: 0, lastBufferGapMs: 0, backgroundSuspended: backgroundSuspended && desiredAudio, source: 'AudioContext base/output latency and SDL queued bytes are available; the pinned adapter exposes no callback-underrun counter' }, crashes: { retained: crashDiagnostics.length, capacity: performanceBudgets.crashCapacity, records: crashDiagnostics.slice() } };
    const launchAddress = ccall('arc_webide_execution_watch_hit', 'number');
    const fastBootActive = !!fastBootProgress;
    const fastBootPercent = fastBootActive ? Math.min(100, Math.floor(fastBootProgress.completedMs / fastBootProgress.durationMs * 100)) : 100;
    if (fastBootActive !== fastBootWasActive) {
      fastBootWasActive = fastBootActive;
      setStatus(fastBootActive ? `Fast boot · ${fastBootPercent}%` : `A310 · ${profile.romSet} · live core`, fastBootActive ? '' : 'ready');
    } else if (fastBootActive) setStatus(`Fast boot · ${fastBootPercent}%`);
    const breakpoints = activeBreakpoints.map((breakpoint, slot) => ({ ...breakpoint, hits: ccall('arc_webide_get_breakpoint_hits', 'number', ['number'], [slot]) >>> 0, temporary: false }));
    if (temporaryBreakpoint !== null && !activeBreakpoints.some((breakpoint) => breakpoint.address === temporaryBreakpoint)) breakpoints.push({ address: temporaryBreakpoint, hits: ccall('arc_webide_get_breakpoint_hits', 'number', ['number'], [activeBreakpoints.length]) >>> 0, temporary: true });
    const logEventCount = ccall('arc_webide_log_event_count', 'number') >>> 0;
    const logEvents = Array.from({ length: logEventCount }, (_, index) => {
      const sequence = ccall('arc_webide_log_event_value', 'number', ['number', 'number'], [index, 0]) >>> 0;
      const address = ccall('arc_webide_log_event_value', 'number', ['number', 'number'], [index, 1]) >>> 0;
      const currentMessage = activeBreakpoints.find((breakpoint) => breakpoint.address === address)?.logMessage;
      if (currentMessage) capturedLogMessages.set(sequence, currentMessage);
      return { sequence, address, hits: ccall('arc_webide_log_event_value', 'number', ['number', 'number'], [index, 2]) >>> 0, registers: Array.from({ length: 16 }, (_, register) => ccall('arc_webide_log_event_value', 'number', ['number', 'number'], [index, register + 3]) >>> 0), logMessage: capturedLogMessages.get(sequence) ?? 'ARM logpoint at {pc} hit {hits}' };
    });
    const coprocessor = { fpaPresent: false, fpaRegistersAvailable: false, configuredFpa: 0, configuredFpuType: 1, source: 'Pinned A310 runtime profile: fpa = 0; no FPA register file is installed or inferred' };
    send({ type: 'snapshot', reason, running: !paused, sessionManifest: runtimeSessionManifest, registers, pc, status: registers[15] >>> 0, mode, pipeline, bankedRegisters, coprocessor, performance: performanceState, hardware, breakAddress: breakAddress < 0 ? null : breakAddress >>> 0, breakpoints, logEvents, logEventsDropped: ccall('arc_webide_log_event_dropped', 'number') >>> 0, memoryEdits, hookCount, corePc, breakpoint0: breakpoint0 < 0 ? null : breakpoint0 >>> 0, emulationMs, fastBootActive, fastBootPercent, memoryKiB });
    if (temporaryBreakpoint !== null && breakAddress === temporaryBreakpoint) {
      temporaryBreakpoint = null;
      programBreakpoints(activeBreakpoints);
    }
    if (pendingLaunch && launchAddress === pendingLaunch.entryPoint) {
      const completedLaunch = pendingLaunch;
      pendingLaunch = undefined;
      if (completedLaunch.timeout) clearTimeout(completedLaunch.timeout);
      ccall('arc_webide_clear_execution_watch');
      send({ type: 'application-launched', applicationName: completedLaunch.applicationName, rootDirectory: completedLaunch.rootDirectory, launchPath: completedLaunch.launchPath, entryPoint: completedLaunch.entryPoint });
    }
    const now = performance.now();
    if (now - lastAudioSnapshot >= 500) { lastAudioSnapshot = now; sendAudioState(); }
  }

  const yieldToBrowser = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function cancelFastBoot() {
    fastBootToken += 1;
    fastBootProgress = undefined;
    if (started) { ccall('arc_webide_cancel_fast_forward'); ccall('arc_enable_sound', null, ['number'], [desiredAudio ? 1 : 0]); }
  }

  async function accelerateBoot(durationMs) {
    cancelFastBoot();
    if (!durationMs) return;
    const token = fastBootToken;
    const startedAtMs = ccall('arc_get_emulation_ms', 'number');
    const targetMs = startedAtMs + durationMs;
    fastBootProgress = { completedMs: 0, durationMs, startedAtMs, targetMs };
    ccall('arc_fast_forward', null, ['number'], [targetMs]);
    snapshot('fast boot started');
    // Arculator's animation loop performs the genuine machine work. This loop
    // only observes its clock and yields a progress snapshot after every frame.
    while (fastBootProgress && token === fastBootToken && fastBootProgress.completedMs < durationMs) {
      await yieldToBrowser();
      if (!fastBootProgress || token !== fastBootToken) return;
      fastBootProgress.completedMs = Math.min(durationMs, Math.max(0, ccall('arc_get_emulation_ms', 'number') - startedAtMs));
      snapshot('fast boot progress');
    }
    if (token !== fastBootToken) return;
    fastBootProgress = undefined;
    ccall('arc_enable_sound', null, ['number'], [desiredAudio ? 1 : 0]);
    snapshot('fast boot complete');
  }

  async function fetchBytes(path, expectedSize) {
    const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Firmware request failed (${response.status}) for ${path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== expectedSize) throw new Error(`Firmware at ${path} is ${bytes.length} bytes; expected ${expectedSize}`);
    return bytes;
  }

  function readRomVault(key, expectedSize) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('8bit-net-dev-roms', 1);
      open.onerror = () => reject(open.error ?? new Error('ROM vault could not be opened'));
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('roms')) open.result.createObjectStore('roms', { keyPath: 'key' }); };
      open.onsuccess = () => {
        const database = open.result;
        const request = database.transaction('roms', 'readonly').objectStore('roms').get(key);
        request.onerror = () => { database.close(); reject(request.error ?? new Error('ROM vault read failed')); };
        request.onsuccess = () => {
          database.close();
          if (!request.result?.bytes) { resolve(undefined); return; }
          const bytes = new Uint8Array(request.result.bytes);
          if (bytes.length !== expectedSize) { reject(new Error(`Firmware ${key} is ${bytes.length} bytes; expected ${expectedSize}`)); return; }
          resolve(bytes);
        };
      };
    });
  }

  async function loadVaultBytes(key, fallbackPath, expectedSize) {
    try {
      const stored = await readRomVault(key, expectedSize);
      if (stored) return stored;
    } catch (error) {
      if (error instanceof Error && /is \d+ bytes; expected/.test(error.message)) throw error;
    }
    return fetchBytes(fallbackPath, expectedSize);
  }

  async function loadProgram(command) {
    if (!Array.isArray(command.bytes) || !command.bytes.length || command.bytes.length > 0xf8000 || command.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('ARM program bytes must contain 1–1,015,808 byte values');
    if (!Number.isInteger(command.origin) || command.origin < 0x8000 || command.origin + command.bytes.length > 0x100000) throw new Error('ARM program load range must stay within &00008000–&000FFFFF');
    if (!Number.isInteger(command.entryPoint) || (command.entryPoint & 3) || command.entryPoint < command.origin || command.entryPoint >= command.origin + command.bytes.length) throw new Error('ARM entry point must be word-aligned and inside the loaded program');
    const breakpoints = Array.isArray(command.breakpoints) ? command.breakpoints : [];
    if (breakpoints.length > 64 || breakpoints.some((address) => !Number.isInteger(address) || address < command.origin || address >= command.origin + command.bytes.length || (address & 3))) throw new Error('Program breakpoints must contain at most 64 aligned addresses inside the loaded image');
    const sourceEntries = Object.entries(command.sourceLocations ?? {});
    if (sourceEntries.length > 262144 || sourceEntries.some(([rawAddress, location]) => { const address = Number(rawAddress); return !Number.isInteger(address) || address < command.origin || address >= command.origin + command.bytes.length || (address & 3) || !location || typeof location.fileId !== 'string' || typeof location.fileName !== 'string' || !Number.isInteger(location.line) || location.line < 1; })) throw new Error('ARM source locations must be aligned addresses inside the loaded image with valid file and line metadata');
    cancelFastBoot();
    ccall('arc_pause_main_thread');
    ccall('arc_webide_clear_breakpoints');
    ccall('arc_webide_clear_log_events');
    capturedLogMessages.clear();
    memoryEdits = [];
    loadedSourceLocations = new Map(sourceEntries.map(([address, location]) => [Number(address), { fileId: location.fileId, fileName: location.fileName, line: location.line }]));
    const bytes = Uint8Array.from(command.bytes);
    const manifest = command.programManifest;
    if (!manifest || manifest.schema !== '8bit-net.program-load' || manifest.version !== 1 || manifest.sessionFingerprint !== runtimeSessionManifest?.fingerprint || manifest.origin !== command.origin || manifest.entryPoint !== command.entryPoint || manifest.bytes !== bytes.length || !/^[0-9a-f]{64}$/i.test(manifest.fingerprint ?? '')) throw new Error('ARM program load manifest does not match this runtime session or load range');
    const outputSha256 = await hexSha256(bytes);
    if (manifest.expectedSha256 !== outputSha256 || manifest.outputSha256 !== outputSha256) throw new Error('ARM program bytes do not match their declared SHA-256 provenance');
    const { fingerprint, ...declared } = manifest;
    if (await hexSha256(new TextEncoder().encode(canonical(declared))) !== fingerprint) throw new Error('ARM program load manifest fingerprint is invalid');
    loadedProgramManifest = structuredClone(manifest);
    const pointer = window.Module._malloc(bytes.length);
    try {
      window.Module.HEAPU8.set(bytes, pointer);
      if (!ccall('arc_webide_load_program', 'number', ['number', 'number', 'number', 'number', 'number'], [command.origin, pointer, bytes.length, command.entryPoint, 1])) throw new Error('The paused ARM core rejected the program load: its bounded physical-RAM debug mapping or exact byte verification failed');
    } finally { window.Module._free(pointer); }
    breakpoints.forEach((address, slot) => ccall('arc_webide_set_breakpoint', 'number', ['number', 'number'], [slot, address]));
    send({ type: 'program-loaded', format: 'ARM2 raw debug image', address: command.origin, entryPoint: command.entryPoint, size: bytes.length, programManifest: loadedProgramManifest });
    if (command.autorun) ccall('arc_webide_resume');
    snapshot(command.autorun ? 'program running' : 'program loaded');
  }

  async function sourceStep(command) {
    if (!ccall('arc_webide_is_paused', 'number')) throw new Error('ARM source stepping requires a paused core');
    const startPc = ccall('arc_webide_get_pc', 'number') >>> 0;
    const startLocation = loadedSourceLocations.get(startPc);
    if (!startLocation) throw new Error('The current ARM instruction has no build source location');
    const key = (location) => `${location.fileId}:${location.line}`;
    const startKey = key(startLocation);
    const opcode = ccall('arc_webide_get_pipeline_word', 'number', ['number'], [0]) >>> 0;
    if (command.mode === 'over' && (opcode & 0x0f000000) === 0x0b000000) {
      const target = [...loadedSourceLocations.entries()].filter(([address, location]) => address > startPc && key(location) !== startKey).sort((left, right) => left[0] - right[0])[0];
      if (!target) throw new Error('No following source statement is available after this ARM BL instruction');
      temporaryBreakpoint = target[0]; programBreakpoints(activeBreakpoints.some((breakpoint) => breakpoint.address === target[0]) ? activeBreakpoints : [...activeBreakpoints, { address: target[0] }]); ccall('arc_webide_resume'); snapshot('source step over ARM call');
      send({ type: 'source-step-started', mode: 'over', from: startPc, target: target[0], source: startLocation });
      return;
    }
    const budget = Number.isInteger(command.instructionBudget) ? command.instructionBudget : 100000;
    if (budget < 1 || budget > 1000000) throw new Error('ARM source-step budget must be between 1 and 1,000,000 instructions');
    for (let instructions = 1; instructions <= budget; instructions += 1) {
      ccall('arc_webide_step');
      const pc = ccall('arc_webide_get_pc', 'number') >>> 0;
      const location = loadedSourceLocations.get(pc);
      if (location && key(location) !== startKey) { snapshot(`source step ${command.mode === 'over' ? 'over' : 'in'}`); send({ type: 'source-step-complete', mode: command.mode === 'over' ? 'over' : 'in', from: startPc, to: pc, instructions, source: location }); return; }
      if ((instructions & 255) === 0) await yieldToBrowser();
    }
    snapshot('source step budget exhausted');
    send({ type: 'source-step-budget', from: startPc, instructionBudget: budget, source: startLocation });
  }

  function loadDisc(command) {
    if (!Number.isInteger(command.drive) || command.drive < 0 || command.drive > 1) throw new Error('A310 floppy drive must be 0 or 1');
    if (typeof command.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}\.adf$/i.test(command.name)) throw new Error('The qualified A310 media path accepts a simple .adf filename');
    if (!Array.isArray(command.bytes) || command.bytes.length !== 800 * 1024 || command.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('The qualified A310 floppy path requires an exact 800 KiB ADFS .adf image');
    const signature = (offset) => String.fromCharCode(...command.bytes.slice(offset, offset + 4));
    const dFormat = signature(0x401) === 'Nick' && signature(0xbfb) === 'Nick';
    const eFormat = signature(0x801) === 'Nick' && signature(0xffb) === 'Nick';
    if (!dFormat && !eFormat) throw new Error('The ADFS D/E root directory signatures are missing or invalid');
    cancelFastBoot();
    mkdir('/media'); mkdir(`/media/drive${command.drive}`);
    const path = `/media/drive${command.drive}/${command.name}`;
    writeFile(path, Uint8Array.from(command.bytes));
    ccall('arc_disc_change', null, ['number', 'string'], [command.drive, path]);
    if (!ccall('arc_webide_disc_loaded', 'number', ['number'], [command.drive])) throw new Error('The A310 floppy controller rejected this ADFS image');
    mountedDiscs.set(command.drive, { path, name: command.name, size: command.bytes.length });
    send({ type: 'media-loaded', kind: 'disc', format: eFormat ? 'ADFS E 800K ADF' : 'ADFS D 800K ADF', name: command.name, size: command.bytes.length, drive: command.drive });
    snapshot('disc mounted');
  }

  function captureScreen() {
    canvas.toBlob((blob) => {
      if (!blob) { send({ type: 'error', message: 'The live A310 framebuffer could not be encoded as PNG' }); return; }
      send({ type: 'screen-captured', blob, filename: `a310-screen-${Date.now()}.png`, width: canvas.width, height: canvas.height, size: blob.size });
    }, 'image/png');
  }

  function stageRiscOsApplication(command) {
    if (!profile?.hostFsAvailable) throw new Error('The bundled HostFS support ROM is available only with a qualified RISC OS 3 profile');
    const application = command.application;
    if (!application || application.schema !== '8bit-net.riscos-application' || application.version !== 2) throw new Error('Unsupported RISC OS application package schema');
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,8}$/.test(application.applicationName) || application.rootDirectory !== `!${application.applicationName}` || application.launchPath !== application.rootDirectory) throw new Error('Invalid RISC OS application identity or launch path');
    if (application.executableFormat !== 'absolute' || application.executableLoadAddress !== 0x8000 || application.executablePath !== `${application.rootDirectory}.RunImage`) throw new Error('HostFS staging currently accepts only an Absolute RunImage at &00008000');
    if (!Array.isArray(application.files) || !application.files.length) throw new Error('A RISC OS application must contain at least !Run and RunImage');
    /* Names whose type RISC OS decides rather than the author. Everything else
     * may carry whatever type the package says, which is the point of holding
     * arbitrary resources at all. */
    const decided = new Map([['!Run', 0xfeb], ['!Boot', 0xfeb], ['!Sprites', 0xff9]]);
    const seen = new Set();
    const directories = new Set();
    let totalBytes = 0;
    application.files.forEach((file) => {
      if (typeof file.path !== 'string' || !file.path.startsWith(`${application.rootDirectory}/`)) throw new Error(`${String(file.path)} is not inside ${application.rootDirectory}`);
      const segments = file.path.split('/');
      if (segments.some((segment) => !/^[!A-Za-z0-9_+-]{1,10}$/.test(segment))) throw new Error(`${file.path} contains a name ADFS or HostFS could not hold`);
      if (!Number.isInteger(file.filetype) || file.filetype < 0 || file.filetype > 0xfff) throw new Error(`${file.path} has no valid RISC OS filetype`);
      const required = decided.get(segments[segments.length - 1]);
      if (required !== undefined && file.filetype !== required) throw new Error(`${file.path} must have RISC OS filetype &${required.toString(16).toUpperCase()}`);
      if (file.hostFsPath !== `${file.path},${file.filetype.toString(16).padStart(3, '0')}`) throw new Error(`Invalid or lossy RISC OS metadata for ${String(file.path)}`);
      if (seen.has(file.path)) throw new Error(`Duplicate RISC OS application path: ${file.path}`);
      seen.add(file.path);
      for (let index = 1; index < segments.length - 1; index += 1) directories.add(segments.slice(0, index + 1).join('/'));
      if (!Array.isArray(file.bytes) || !file.bytes.length || file.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error(`${file.path} must contain bounded byte values`);
      totalBytes += file.bytes.length;
    });
    if (!seen.has(`${application.rootDirectory}/!Run`)) throw new Error(`${application.rootDirectory} has no !Run, so nothing would launch it`);
    if (!seen.has(`${application.rootDirectory}/RunImage`)) throw new Error(`${application.rootDirectory} has no RunImage, so !Run has nothing to run`);
    for (const directory of directories) { if (seen.has(directory)) throw new Error(`${directory} is both a file and a directory`); }
    if (totalBytes > 16 * 1024 * 1024) throw new Error('RISC OS HostFS staging is limited to 16 MiB per application');
    mkdir(`/hostfs/${application.rootDirectory}`);
    /* Shallowest first, so a subdirectory is never created before its parent. */
    [...directories].sort((left, right) => left.split('/').length - right.split('/').length).forEach((directory) => mkdir(`/hostfs/${directory}`));
    application.files.forEach((file) => writeFile(`/hostfs/${file.hostFsPath}`, Uint8Array.from(file.bytes)));
    const launchPath = `HostFS::HostFS.$.${application.launchPath}`;
    stagedApplications.set(application.applicationName, { applicationName: application.applicationName, rootDirectory: application.rootDirectory, launchPath, entryPoint: application.executableLoadAddress });
    send({ type: 'application-staged', format: 'RISC OS application directory', applicationName: application.applicationName, rootDirectory: application.rootDirectory, launchPath, files: application.files.map((file) => ({ path: file.path, hostFsPath: file.hostFsPath, filetype: file.filetype, size: file.bytes.length })), totalBytes });
  }

  const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));
  const SDL_SCANCODE = { Enter: 40, F12: 69, Space: 44, Minus: 45, Period: 55, Semicolon: 51, Shift: 225 };

  function scancodeForCharacter(character) {
    if (/^[a-z]$/i.test(character)) return { scancode: 4 + character.toUpperCase().charCodeAt(0) - 65, shift: character === character.toUpperCase() };
    if (/^[1-9]$/.test(character)) return { scancode: 29 + Number(character), shift: false };
    if (character === '0') return { scancode: 39, shift: false };
    const symbol = { ' ': [SDL_SCANCODE.Space, false], '-': [SDL_SCANCODE.Minus, false], '_': [SDL_SCANCODE.Minus, true], '.': [SDL_SCANCODE.Period, false], ':': [SDL_SCANCODE.Semicolon, true], '!': [30, true], '$': [33, true] }[character];
    if (!symbol) throw new Error(`The A310 keyboard queue contains an unsupported character: ${character}`);
    return { scancode: symbol[0], shift: symbol[1] };
  }

  async function pressMachineKey(scancode, shift = false) {
    if (shift) ccall('arc_webide_set_host_key', 'number', ['number', 'number'], [SDL_SCANCODE.Shift, 1]);
    ccall('arc_webide_set_host_key', 'number', ['number', 'number'], [scancode, 1]);
    await wait(70);
    ccall('arc_webide_set_host_key', 'number', ['number', 'number'], [scancode, 0]);
    if (shift) ccall('arc_webide_set_host_key', 'number', ['number', 'number'], [SDL_SCANCODE.Shift, 0]);
    await wait(35);
  }

  async function enterMachineText(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 4096) throw new Error('A310 machine text must contain 1 to 4,096 characters');
    const text = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    if (launchInProgress) throw new Error('Wait for the current A310 keyboard queue to finish');
    canvas.focus(); launchInProgress = true;
    try {
      for (const character of text) {
        if (character === '\n') await pressMachineKey(SDL_SCANCODE.Enter);
        else { const keyStroke = scancodeForCharacter(character); await pressMachineKey(keyStroke.scancode, keyStroke.shift); }
      }
    } finally { ccall('arc_webide_clear_host_keys'); launchInProgress = false; }
    send({ type: 'text-queued', characters: text.length });
  }

  async function enterRiscOsLaunch(staged) {
    if (launchInProgress) throw new Error('A RISC OS launch command is already being entered');
    cancelFastBoot();
    ccall('arc_webide_clear_execution_watch');
    if (!ccall('arc_webide_watch_execution', 'number', ['number'], [staged.entryPoint])) throw new Error('The ARM core rejected the application entry watch');
    pendingLaunch = { ...staged };
    send({ type: 'application-launch-started', applicationName: staged.applicationName, rootDirectory: staged.rootDirectory, launchPath: staged.launchPath, entryPoint: staged.entryPoint });
    canvas.focus();
    launchInProgress = true;
    try {
      await pressMachineKey(SDL_SCANCODE.F12);
      for (const character of `Run ${staged.launchPath}`) {
        const keyStroke = scancodeForCharacter(character);
        await pressMachineKey(keyStroke.scancode, keyStroke.shift);
      }
      await pressMachineKey(SDL_SCANCODE.Enter);
    } finally {
      ccall('arc_webide_clear_host_keys');
      launchInProgress = false;
    }
    send({ type: 'application-launch-command-entered', applicationName: staged.applicationName, launchPath: staged.launchPath, entryPoint: staged.entryPoint });
    if (pendingLaunch) pendingLaunch.timeout = setTimeout(() => {
      if (!pendingLaunch || pendingLaunch.applicationName !== staged.applicationName) return;
      pendingLaunch = undefined;
      ccall('arc_webide_clear_execution_watch');
      send({ type: 'application-launch-timeout', applicationName: staged.applicationName, launchPath: staged.launchPath, entryPoint: staged.entryPoint, message: 'RISC OS did not enter the application within 15 seconds; confirm that the desktop or command line has finished starting' });
    }, 15000);
    snapshot('application launch command entered');
  }

  async function launchRiscOsApplication(command) {
    const staged = stagedApplications.get(command.applicationName);
    if (!staged) throw new Error('Stage this application in HostFS before launching it');
    await enterRiscOsLaunch(staged);
  }

  async function launchAdfsFile(command) {
    if (!Number.isInteger(command.drive) || !mountedDiscs.has(command.drive)) throw new Error('Mount the selected ADFS drive before launching a file');
    if (typeof command.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,9}$/.test(command.name)) throw new Error('The ADFS launch file must be a simple 1–10 character Acorn name');
    await enterRiscOsLaunch({ applicationName: command.name, rootDirectory: '$', launchPath: `ADFS::${command.drive}.$.${command.name}`, entryPoint: 0x8000 });
  }

  async function initialise(command) {
    if (!command.sessionManifest || command.sessionManifest.id !== debugSessionId || command.sessionManifest.adapter?.id !== 'arculator-wasm' || command.sessionManifest.machine?.romSetId !== command.profileId || !/^[0-9a-f]{64}$/i.test(command.sessionManifest.fingerprint ?? '')) throw new Error('Runtime session manifest does not match this A310 child or resolved machine profile');
    runtimeSessionManifest = command.sessionManifest;
    loadedProgramManifest = undefined;
    if (started) throw new Error('This isolated Archimedes frame has already been initialized');
    if (!/^(arthur120|riscos200|riscos201|riscos300|riscos310|riscos311)$/.test(command.romSet)) throw new Error('Unsupported Archimedes ROM-set identity');
    if (!/^[a-z0-9-]{1,40}$/.test(command.profileId)) throw new Error('Invalid Archimedes firmware profile identity');
    if (!Number.isInteger(command.memoryKiB) || command.memoryKiB < 512 || command.memoryKiB > 16384) throw new Error('Invalid Archimedes RAM size');
    if (!Number.isInteger(command.fastBootMs) || command.fastBootMs < 0 || command.fastBootMs > 60000) throw new Error('Fast boot duration must be between 0 and 60,000 emulated milliseconds');
    profile = { profileId: command.profileId, romSet: command.romSet, memoryKiB: command.memoryKiB, fastBootMs: command.fastBootMs, hostFsAvailable: /^riscos3/.test(command.romSet) };
    setStatus(`Loading ${command.romSet} from the browser-local vault…`);
    send({ type: 'initialisation-progress', phase: 'firmware', label: `Loading ${command.romSet} firmware` });
    const base = `/user-roms/archimedes/${encodeURIComponent(command.profileId)}`;
    const vaultPrefix = `archimedes/${command.profileId}`;
    const [rom, cmos, supportRom] = await Promise.all([loadVaultBytes(`${vaultPrefix}/roms/${command.romSet}/rom.bin`, `${base}/roms/${command.romSet}/rom.bin`, command.romSize), loadVaultBytes(`${vaultPrefix}/cmos/${command.cmosFilename}`, `${base}/cmos/${command.cmosFilename}`, 256), profile.hostFsAvailable ? fetchBytes('/arculator/arcrom_ext', 65536) : Promise.resolve(undefined)]);
    if (!runtimeReady) {
      setStatus('Firmware ready · finishing emulator core startup…');
      send({ type: 'initialisation-progress', phase: 'runtime', label: 'Firmware ready · finishing emulator core startup' });
      await runtimeReadyPromise;
    }
    send({ type: 'initialisation-progress', phase: 'filesystem', label: 'Preparing isolated machine files' });
    mkdir('/roms'); mkdir(`/roms/${command.romSet}`); mkdir('/cmos'); mkdir('/configs'); mkdir('/hostfs');
    writeFile(`/roms/${command.romSet}/rom.bin`, rom);
    if (supportRom) writeFile('/roms/arcrom_ext', supportRom);
    writeFile(`/cmos/a310.${command.cmosRuntimeName}.cmos.bin`, cmos);
    writeFile('/arc.cfg', new TextEncoder().encode('sound_enable = 0\nfirst_fullscreen = 0\nstereo = 1\ndisc_noise_gain = 0\n'));
    const configuration = `machine = a310\ndisc_name_0 =\ndisc_name_1 =\ndisc_name_2 =\ndisc_name_3 =\nmem_size = ${command.memoryKiB}\ncpu_type = 0\nmemc_type = 0\nfpa = 0\nfpu_type = 1\ndisplay_mode = 0\ndouble_scan = 1\nvideo_scale = 1\nvideo_fullscreen_scale = 0\nvideo_linear_filtering = 0\nfdc_type = 0\nst506_present = 0\nrom_set = ${command.romSet}\nmonitor_type = multisync\njoystick_if = none\nunique_id = 324508639\nrenderer_driver = auto\npodule_0 =\npodule_1 =\npodule_2 =\npodule_3 =\nsupport_rom_enabled = ${profile.hostFsAvailable ? 1 : 0}\n`;
    writeFile('/configs/a310.cfg', new TextEncoder().encode(configuration));
    setStatus('Starting genuine A310 hardware core…');
    send({ type: 'initialisation-progress', phase: 'hardware', label: 'Starting A310 hardware core' });
    try { window.Module.callMain(['0', 'a310']); } catch (error) { if (error !== 'unwind') throw error; }
    started = true; canvas.focus();
    await setAudio(false);
    send({ type: 'initialisation-progress', phase: 'boot', label: command.fastBootMs ? 'Accelerating genuine RISC OS boot' : 'Running authentic-speed RISC OS boot' });
    clearInterval(snapshotTimer); snapshotTimer = setInterval(() => snapshot('timer'), 100); snapshot('initialized');
    await accelerateBoot(command.fastBootMs);
  }

  async function receive(command) {
    if (!command || command.channel !== CHANNEL || typeof command.type !== 'string') return;
    if (command.type === 'initialise') return initialise(command);
    if (command.type === 'set-display-filter') {
      if (command.filter !== 'nearest' && command.filter !== 'linear') { send({ type: 'control-rejected', message: 'Display filter must be nearest-neighbour or linear' }); return; }
      canvas.style.imageRendering = command.filter === 'nearest' ? 'pixelated' : 'auto'; send({ type: 'display-filter', filter: command.filter }); return;
    }
    if (!started) throw new Error('Archimedes runtime is not initialized');
    if (command.type === 'pause') { cancelFastBoot(); ccall('arc_pause_main_thread'); snapshot('paused'); }
    else if (command.type === 'stop') { cancelFastBoot(); pendingLaunch = undefined; ccall('arc_webide_clear_execution_watch'); temporaryBreakpoint = null; programBreakpoints(activeBreakpoints); ccall('arc_pause_main_thread'); snapshot('debug session stopped'); }
    else if (command.type === 'run') { cancelFastBoot(); ccall('arc_webide_resume'); snapshot('resumed'); }
    else if (command.type === 'step') { cancelFastBoot(); ccall('arc_webide_step'); snapshot('single instruction'); }
    else if (command.type === 'source-step') await sourceStep(command);
    else if (command.type === 'reset') { cancelFastBoot(); if (audioCaptureRequested) finishAudioCapture(false); pendingLaunch = undefined; ccall('arc_webide_clear_execution_watch'); ccall('arc_webide_clear_host_keys'); ccall('arc_webide_clear_host_mouse'); mouseButtons = 0; ccall('arc_do_reset'); snapshot('reset'); await accelerateBoot(Number.isInteger(command.fastBootMs) ? command.fastBootMs : 0); }
    else if (command.type === 'load-arm-program') await loadProgram(command);
    else if (command.type === 'load-disc') loadDisc(command);
    else if (command.type === 'stage-riscos-application') stageRiscOsApplication(command);
    else if (command.type === 'stage-and-launch-riscos-application') { stageRiscOsApplication(command); await launchRiscOsApplication({ applicationName: command.application.applicationName }); }
    else if (command.type === 'launch-riscos-application') await launchRiscOsApplication(command);
    else if (command.type === 'launch-adfs-file') await launchAdfsFile(command);
    else if (command.type === 'set-audio') await setAudio(!!command.enabled);
    else if (command.type === 'set-volume') send({ type: 'control-rejected', message: 'A310 volume control is unavailable because the pinned SDL audio path exposes enable and queue state but no qualified master gain' });
    else if (command.type === 'start-audio-capture') startAudioCapture(command.seconds);
    else if (command.type === 'stop-audio-capture') finishAudioCapture(false);
    else if (command.type === 'focus-input') { canvas.focus(); send({ type: 'input-focus', captured: document.activeElement === canvas }); }
    else if (command.type === 'release-input') { ccall('arc_webide_clear_host_keys'); ccall('arc_webide_clear_host_mouse'); mouseButtons = 0; canvas.blur(); send({ type: 'input-focus', captured: false }); }
    else if (command.type === 'inject-text') await enterMachineText(command.text);
    else if (command.type === 'set-register') {
      if (!Number.isInteger(command.register) || command.register < 0 || command.register > 15 || !Number.isInteger(command.value) || command.value < 0 || command.value > 0xffffffff || (command.register === 15 && (command.value > 0x3fffffc || (command.value & 3)))) throw new Error('Register edits require R0–R14 unsigned values or an aligned 26-bit R15 execute address');
      if (!ccall('arc_webide_set_register', 'number', ['number', 'number'], [command.register, command.value])) throw new Error('The ARM core rejected the register edit; pause the machine and verify the value');
      snapshot(`R${command.register} edited and verified`);
    }
    else if (command.type === 'capture-screen') captureScreen();
    else if (command.type === 'set-breakpoints') {
      const requested = Array.isArray(command.breakpoints) ? command.breakpoints : Array.isArray(command.addresses) ? command.addresses.map((address) => ({ address })) : null;
      if (!requested || requested.length > 64 || requested.some((breakpoint) => !validBreakpoint(breakpoint))) throw new Error('Breakpoints require at most 64 aligned 26-bit addresses with no more than four bounded AND conditions, actions and log messages');
      activeBreakpoints = requested.filter((breakpoint, index) => requested.findIndex((candidate) => candidate.address === breakpoint.address) === index).map((breakpoint) => ({ address: breakpoint.address, action: breakpoint.action ?? 0, ...(breakpoint.hitTarget === undefined ? {} : { hitTarget: breakpoint.hitTarget }), ...(breakpointConditions(breakpoint).length ? { conditions: breakpointConditions(breakpoint).map((condition) => ({ ...condition })) } : {}), ...(breakpoint.logMessage === undefined ? {} : { logMessage: breakpoint.logMessage }) })); temporaryBreakpoint = null; programBreakpoints(activeBreakpoints); snapshot('breakpoints changed');
    } else if (command.type === 'run-to') {
      if (!Number.isInteger(command.address) || command.address < 0 || command.address > 0x3fffffc || (command.address & 3)) throw new Error('Run-to target must be an aligned 26-bit address');
      cancelFastBoot(); temporaryBreakpoint = command.address; programBreakpoints(activeBreakpoints.some((breakpoint) => breakpoint.address === command.address) ? activeBreakpoints : [...activeBreakpoints, { address: command.address }]); ccall('arc_webide_resume'); snapshot('run to address');
    } else if (command.type === 'clear-log-events') { ccall('arc_webide_clear_log_events'); capturedLogMessages.clear(); snapshot('logpoint events cleared'); }
    else if (command.type === 'read-memory-map') {
      const kinds = ['unmapped', 'ram', 'rom', 'support-rom', 'extension-rom', 'other'];
      const pages = Array.from({ length: 16384 }, (_, page) => { const kind = ccall('arc_webide_memory_page', 'number', ['number', 'number'], [page, 0]) >>> 0; const physicalPage = ccall('arc_webide_memory_page', 'number', ['number', 'number'], [page, 1]) >>> 0; return { page, kind: kinds[kind] ?? 'other', physicalPage: physicalPage === 0xffffffff ? null : physicalPage }; });
      send({ type: 'memory-map', requestId: command.requestId, pages, emulationMs: ccall('arc_get_emulation_ms', 'number'), running: !ccall('arc_webide_is_paused', 'number'), source: 'Arculator live mempoint page table and backing allocations' });
    }
    else if (command.type === 'write-memory') {
      if (!Number.isInteger(command.address) || !Array.isArray(command.bytes) || command.address < 0 || command.address > 0x3ffffff || command.bytes.length < 1 || command.bytes.length > 256 || command.address + command.bytes.length > 0x4000000 || command.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('ARM memory writes require 1–256 bytes in a non-wrapping 26-bit logical range');
      const before = command.bytes.map((_, offset) => ccall('arc_webide_read_byte', 'number', ['number'], [command.address + offset]) >>> 0);
      const bytes = Uint8Array.from(command.bytes); const pointer = window.Module._malloc(bytes.length);
      try { window.Module.HEAPU8.set(bytes, pointer); if (!ccall('arc_webide_write_memory', 'number', ['number', 'number', 'number'], [command.address, pointer, bytes.length])) throw new Error('The paused ARM core rejected this write: every destination must resolve to physical main RAM'); }
      finally { window.Module._free(pointer); }
      const after = command.bytes.map((_, offset) => ccall('arc_webide_read_byte', 'number', ['number'], [command.address + offset]) >>> 0);
      memoryEdits = [...memoryEdits, { sequence: ++memoryEditSequence, address: command.address, before, after, emulationMs: ccall('arc_get_emulation_ms', 'number') }].slice(-32);
      send({ type: 'memory', requestId: command.requestId, address: command.address, bytes: after, emulationMs: ccall('arc_get_emulation_ms', 'number'), running: false, addressSpace: 'ARM 26-bit logical current mapping' });
      snapshot('memory edited and verified');
    }
    else if (command.type === 'read-memory') {
      if (!Number.isInteger(command.address) || !Number.isInteger(command.length) || command.address < 0 || command.address > 0x3ffffff || command.length < 1 || command.length > 4096 || command.address + command.length > 0x4000000) throw new Error('Memory reads are limited to 1–4,096 non-wrapping bytes in the 26-bit logical address space');
      const bytes = Array.from({ length: command.length }, (_, offset) => ccall('arc_webide_read_byte', 'number', ['number'], [command.address + offset]));
      send({ type: 'memory', requestId: command.requestId, address: command.address, bytes, emulationMs: ccall('arc_get_emulation_ms', 'number'), running: !ccall('arc_webide_is_paused', 'number'), addressSpace: 'ARM 26-bit logical current mapping' });
    } else throw new Error(`Unsupported Archimedes runtime command: ${command.type}`);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const command = event.data;
    const sessionMatches = debugSessionId ? command?.sessionId === debugSessionId : command?.sessionId === undefined || command?.sessionId === '';
    const sequenceMatches = debugSessionId ? Number.isSafeInteger(command?.commandId) && command.commandId > lastCommandId : command?.commandId === undefined || Number.isSafeInteger(command.commandId) && command.commandId > lastCommandId;
    if (!command || command.channel !== CHANNEL || !sessionMatches || !sequenceMatches) return;
    if (command.commandId !== undefined) lastCommandId = command.commandId;
    commandAudit = [...commandAudit, { sequence: ++acceptedCommands, commandId: command.commandId ?? 0, type: command.type, acceptedAtMs: performance.now() }].slice(-32);
    send({ type: 'command-accepted', commandId: command.commandId ?? 0, queued: 0, capacity: 64 });
    Promise.resolve(receive(command)).catch((error) => { appendCrash('command', error); setStatus(error instanceof Error ? error.message : String(error), 'error'); send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); if (started) snapshot('command error'); });
  });
  send({ type: 'listener-ready' });
  window.Module = {
    noInitialRun: true,
    canvas,
    locateFile: (path) => `/arculator/${path}`,
    print: (text) => { output.textContent += `${text}\n`; },
    printErr: (text) => { output.textContent += `${text}\n`; },
    setStatus: (text) => { if (text) setStatus(text); },
    monitorRunDependencies: (remaining) => { progress.hidden = remaining === 0; },
    onRuntimeInitialized: () => { runtimeReady = true; resolveRuntimeReady(); setStatus('Arculator core ready · waiting for browser-local firmware'); send({ type: 'ready', engine: 'arculator-wasm', revision: '579ac437b9a4ebe83b9b5f9b8e50b0c9c530509e' }); },
  };
  audioActivation.addEventListener('click', () => void setAudio(true));
  function mousePosition(event) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !canvas.width || !canvas.height) return null;
    return {
      x: Math.max(0, Math.min(canvas.width - 1, Math.round((event.clientX - bounds.left) * canvas.width / bounds.width))),
      y: Math.max(0, Math.min(canvas.height - 1, Math.round((event.clientY - bounds.top) * canvas.height / bounds.height))),
    };
  }
  function deliverMouse(event) {
    if (!started) return;
    const position = mousePosition(event);
    if (!position || !ccall('arc_webide_set_host_mouse', 'number', ['number', 'number', 'number'], [position.x, position.y, mouseButtons])) return;
    const sample = `${position.x}:${position.y}:${mouseButtons}`;
    if (sample !== lastMouseSample) {
      lastMouseSample = sample;
      send({ type: 'mouse-input', ...position, buttons: mouseButtons, width: canvas.width, height: canvas.height, source: 'Arculator absolute host mouse path' });
    }
  }
  canvas.addEventListener('mousemove', deliverMouse);
  canvas.addEventListener('mousedown', (event) => {
    if (event.button < 0 || event.button > 2) return;
    event.preventDefault(); canvas.focus();
    mouseButtons |= event.button === 0 ? 1 : event.button === 2 ? 2 : 4;
    deliverMouse(event);
  });
  canvas.addEventListener('mouseup', (event) => {
    if (event.button < 0 || event.button > 2) return;
    event.preventDefault();
    mouseButtons &= ~(event.button === 0 ? 1 : event.button === 2 ? 2 : 4);
    deliverMouse(event);
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('mouseleave', () => { if (started) ccall('arc_webide_clear_host_mouse'); mouseButtons = 0; lastMouseSample = null; send({ type: 'mouse-input-released', reason: 'pointer left canvas' }); });
  canvas.addEventListener('focus', () => send({ type: 'input-focus', captured: true }));
  canvas.addEventListener('blur', () => { if (started) { ccall('arc_webide_clear_host_keys'); ccall('arc_webide_clear_host_mouse'); } mouseButtons = 0; lastMouseSample = null; send({ type: 'input-focus', captured: false }); send({ type: 'mouse-input-released', reason: 'canvas lost focus' }); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      backgroundSuspended = true;
      resumeAfterBackground = started && !ccall('arc_webide_is_paused', 'number');
      if (started) ccall('arc_pause_main_thread');
      void audioContext()?.suspend();
      if (started) snapshot('background suspended');
      return;
    }
    backgroundSuspended = false;
    lastPresentationAt = 0;
    if (started && resumeAfterBackground) ccall('arc_webide_resume');
    resumeAfterBackground = false;
    if (desiredAudio) void audioContext()?.resume();
    if (started) snapshot('foreground resumed');
  });
  window.addEventListener('error', (event) => { appendCrash('error', event.error ?? event.message); if (started) snapshot('browser error'); });
  window.addEventListener('unhandledrejection', (event) => { appendCrash('unhandled-rejection', event.reason); if (started) snapshot('unhandled rejection'); });
  window.addEventListener('pagehide', () => {
    cancelFastBoot(); pendingLaunch = undefined; clearInterval(snapshotTimer); snapshotTimer = 0;
    if (started) { if (audioCaptureRequested) { audioCaptureRequested = false; ccall('arc_webide_audio_capture_release'); } ccall('arc_webide_clear_execution_watch'); ccall('arc_webide_clear_host_keys'); ccall('arc_webide_clear_host_mouse'); ccall('arc_pause_main_thread'); }
    void audioContext()?.suspend(); started = false;
  }, { once: true });
})();
