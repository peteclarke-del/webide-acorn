declare module 'jsbeeb/src/fake6502.js' {
  export function fake6502(model: JsBeebModel, options?: Record<string, unknown>): JsBeebCpu;
}

/* The silent parts the engine's own factory fits to every machine: a CMOS
 * clock, the two noise generators for the disc drive and the relay, and the
 * Music 5000 stand-in. Nothing reads them here; they are constructor furniture,
 * and describing them further would be a second account of somebody else's
 * classes. */
declare module 'jsbeeb/src/cmos.js' { export class Cmos { constructor(persistence?: unknown); } }
declare module 'jsbeeb/src/ddnoise.js' { export class FakeDdNoise {} }
declare module 'jsbeeb/src/relaynoise.js' { export class FakeRelayNoise {} }
declare module 'jsbeeb/src/music5000.js' { export class FakeMusic5000 {} }

declare module 'jsbeeb/src/6502.js' {
  /*
   * Only what the B+ built on top of this needs to see. jsbeeb's processor
   * carries far more than this; naming the rest here would be a second,
   * unchecked description of somebody else's class.
   */
  export class Cpu6502 {
    constructor(model: JsBeebModel, options: Record<string, unknown>);
    romSelect(value: number): void;
    writeDevice(address: number, value: number): void;
    memLook: Int32Array;
    memStat: Uint8Array;
    romsel: number;
    romOffset: number;
    osOffset: number;
    videoDisplayPage: number;
    model: JsBeebModel;
  }
  export class AtomCpu6502 extends Cpu6502 {}
}

declare module 'jsbeeb/src/models.js' {
  export function findModel(name: string): JsBeebModel | null;
  /** Every model the pinned engine publishes, with its selectable synonyms. */
  export const allModels: ReadonlyArray<JsBeebModel & { name: string; synonyms: string[] }>;
}

declare module 'jsbeeb/src/video.js' {
  export class Video {
    constructor(isMaster: boolean, framebuffer: Uint32Array, paint: (minX: number, minY: number, maxX: number, maxY: number) => void, options?: { isAtom?: boolean });
    paint(): void;
    snapshotState(): Record<string, unknown>;
    bitmapX: number; bitmapY: number; frameCount: number; inHSync: boolean; inVSync: boolean;
    scanlineCounter: number; horizCounter: number; vertCounter: number; addr: number;
    ulaMode: number; ulactrl: number; actualPal: Uint8Array;
  }
}

declare module 'jsbeeb/src/utils.js' {
  export function setBaseUrl(url: string): void;
  export function stringToBBCKeys(value: string): unknown[];
}

declare module 'jsbeeb/src/utils_atom.js' {
  export function stringToATOMKeys(value: string): unknown[];
}

declare module 'jsbeeb/src/keyboard.js' {
  export class Keyboard {
    constructor(options: { processor: JsBeebCpu; inputEnabledFunction: () => boolean; dbgr: { enabled(): boolean; keyPress(): boolean } });
    setRunning(running: boolean): void;
    setKeyLayout(layout: 'physical' | 'natural' | 'gaming'): void;
    sendRawKeyboard(keys: unknown[], checkCapsAndShiftLocks: boolean): void;
    keyDown(event: KeyboardEvent): void;
    keyUp(event: KeyboardEvent): void;
  }
}

declare module 'jsbeeb/src/fdc.js' {
  export function discFor(fdc: unknown, name: string, bytes: Uint8Array, onChange?: (bytes: Uint8Array) => void): unknown;
}

declare module 'jsbeeb/src/tapes.js' {
  export interface JsBeebTape {
    rewind(): void;
    poll(device: unknown): number | undefined;
  }
  export function loadTapeFromData(name: string, data: Uint8Array, model: JsBeebModel): Promise<JsBeebTape | null>;
}

declare module 'jsbeeb/src/snapshot.js' {
  export interface JsBeebSnapshot {
    format: string;
    version: number;
    model: string;
    coProcessor: boolean;
    timestamp: string;
    state: unknown;
    media?: { drives?: Array<{ drive: number; name: string; bytes: Uint8Array }> };
  }
  export function createSnapshot(cpu: JsBeebCpu, model: JsBeebModel, media?: JsBeebSnapshot['media']): JsBeebSnapshot;
  export function restoreSnapshot(cpu: JsBeebCpu, model: JsBeebModel, snapshot: JsBeebSnapshot): void;
  export function snapshotToJSON(snapshot: JsBeebSnapshot): string;
  export function snapshotFromJSON(json: string): JsBeebSnapshot;
}

declare module 'jsbeeb/src/soundchip.js' {
  export class SoundChip {
    constructor(onBuffer: (buffer: Float32Array) => void);
    mute(): void;
    unmute(): void;
  }
  export class AtomSoundChip extends SoundChip {
    constructor(onBuffer: (buffer: Float32Array) => void, options: { cpuSpeed: number });
  }
}

declare module '*?url' { const url: string; export default url; }

interface JsBeebModel {
  name: string;
  isMaster: boolean;
  isAtom: boolean;
  nmos: boolean;
  _cpuModel: number;
  cyclesPerSecond: number;
  swram: boolean[];
}

interface JsBeebDebugHookHandle { remove(): void; }
interface JsBeebDebugHook { add(callback: (address: number, value?: number) => boolean | void): JsBeebDebugHookHandle; }

interface JsBeebCpu {
  initialise(): Promise<void>;
  execute(cycles: number): boolean;
  reset(hard: boolean): void;
  stop(): void;
  readmem(address: number): number;
  peekmem(address: number): number;
  writemem(address: number, value: number): void;
  pc: number; a: number; x: number; y: number; s: number;
  p: { asByte(): number; setFromByte(byte: number): void };
  checkInt(): void;
  interrupt: number;
  takeInt: boolean;
  _nmiLevel: boolean;
  _nmiEdge: boolean;
  opcodes: { opcodes: Record<number, string | undefined> };
  model: JsBeebModel;
  currentCycles: number;
  cycleSeconds: number;
  breakpointResume: boolean;
  peripheralCyclesPerSecond: number;
  config: { extraRoms: string[]; [key: string]: unknown };
  romsel: number;
  acccon: number;
  romOffset: number;
  osOffset: number;
  ramRomOs: Uint8Array;
  scheduler: unknown;
  fdc: { loadDisc(drive: number, disc: unknown): void; snapshotState(): Record<string, unknown> };
  sysvia?: { keyDown(code: number, shift?: boolean): void; keyUp(code: number): void; clearKeys?(): void; snapshotState(): Record<string, unknown>; keys?: ArrayLike<ArrayLike<number>>; keyboardEnabled?: boolean };
  uservia?: { snapshotState(): Record<string, unknown> };
  acia?: { setTape(tape: unknown): void; snapshotState(): Record<string, unknown> };
  adconverter?: { snapshotState(): Record<string, unknown> };
  soundChip?: { snapshotState(): Record<string, unknown> };
  hasTube?: boolean;
  tube?: {
    snapshotState(options?: Record<string, unknown>): Record<string, unknown>;
    restoreState(state: unknown): void;
    /* The parasite's own bus. `writemem` reaches its RAM and, at &FEF8 to
     * &FEFF, the ULA — so a loader has to keep out of that window. */
    readmem(address: number): number;
    writemem(address: number, value: number): void;
    memory?: Uint8Array;
    resetHeldLow?: boolean;
    romPaged?: boolean;
    pc: number;
    cycles?: number;
    tube?: {
      hostRead(address: number): number;
      hostWrite(address: number, value: number): void;
      parasiteRead(address: number): number;
      parasiteWrite(address: number, value: number): void;
    };
  };
  atomppia?: { keyDown(code: number, shift?: boolean): void; keyUp(code: number): void; clearKeys?(): void; setTape(tape: unknown): void; snapshotState(): Record<string, unknown>; keys?: ArrayLike<ArrayLike<number>>; keyboardEnabled?: boolean; latcha?: number; latchc?: number };
  atommc?: { attachGamepad(gamepad: { gamepadButtons: boolean[] }): void; gamepad?: { gamepadButtons?: boolean[] }; read(address: number): number; write(address: number, value: number): void };
  debugInstruction: JsBeebDebugHook;
  debugRead: JsBeebDebugHook;
  debugWrite: JsBeebDebugHook;
  disassembler: { disassemble(address: number, plain?: boolean): [string, number, number?] };
  snapshotState(options?: { includeRoms?: boolean }): unknown;
  restoreState(state: unknown): void;
}
