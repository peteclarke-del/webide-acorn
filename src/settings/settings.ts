/* Settings, in layers, with a schema.
 *
 * Before this, every preference was its own `localStorage` key read and written
 * where it happened to be used. That works until someone wants to move their
 * setup to another browser, reset one thing without resetting everything, or
 * keep a preference with a project rather than with a machine. It also means a
 * corrupt value is discovered at the point of use rather than when it is read.
 *
 * Three layers, in increasing precedence:
 *
 *   default    what this build ships, always valid;
 *   user       what the person chose in this browser;
 *   project    what a project carries, so a preference can travel with work
 *              that needs it without changing the person's own default.
 *
 * A value that fails its schema does not silently become something else: the
 * layer is skipped, the layer below answers, and the reason is reported. And a
 * setting this build has never heard of is preserved rather than dropped, so a
 * document written by a newer build survives a round trip through an older one.
 */

import { validateMachineVolume, type EmulatorDisplayFilter } from '../emulator/audioDisplayControlModel';
import { EMULATOR_DISPLAY_EFFECTS, type EmulatorDisplayEffect } from '../emulator/displayEffectModel';
import { EMULATOR_SCALE_MODES, type EmulatorScaleMode } from '../emulator/emulatorScaleModel';
import { DEFAULT_GAMEPAD_CONFIG, validateGamepadInputConfig, type GamepadInputConfig } from '../emulator/gamepadInputModel';
import { validateMachineKeyRemaps, type MachineKeyRemap } from '../emulator/keyRemapModel';
import type { JsBeebKeyboardLayout } from '../emulator/keyboardInputModel';
import { RUNTIME_SPEEDS, validateRuntimeSpeed, type RuntimeSpeed } from '../emulator/runtimeSpeedModel';

export type SettingScope = 'user' | 'user-and-project';

export interface SettingDescriptor<T = unknown> {
  id: string;
  /** The `localStorage` key this setting has always used. */
  storageKey: string;
  label: string;
  description: string;
  scope: SettingScope;
  defaultValue: T;
  /** Parse the stored string form, or return null when it is not valid. */
  decode: (raw: string) => T | null;
  /** The stored string form. */
  encode: (value: T) => string;
  /** Accept a decoded value from a document, or say why not. */
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; reason: string };
}

export const SETTINGS_SCHEMA = '8bit-net.settings';
export const SETTINGS_VERSION = 1;

const oneOf = <T extends string>(values: readonly T[]) => (value: unknown) =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
    ? { ok: true as const, value: value as T }
    : { ok: false as const, reason: `must be one of ${values.join(', ')}` };

const boolean = (value: unknown) => typeof value === 'boolean'
  ? { ok: true as const, value }
  : { ok: false as const, reason: 'must be true or false' };

/* Value sets come from the modules that own them rather than being restated
 * here, so a setting can never offer something the runtime would refuse. */
const EMULATOR_SCALES = EMULATOR_SCALE_MODES.map((mode) => mode.id) as readonly EmulatorScaleMode[];
const DISPLAY_EFFECTS = EMULATOR_DISPLAY_EFFECTS.map((effect) => effect.id) as readonly EmulatorDisplayEffect[];
const DISPLAY_FILTERS = ['nearest', 'linear'] as const satisfies readonly EmulatorDisplayFilter[];
const KEYBOARD_LAYOUTS = ['physical', 'natural', 'gaming'] as const satisfies readonly JsBeebKeyboardLayout[];
const SPEEDS = RUNTIME_SPEEDS.map((entry) => entry.value) as readonly RuntimeSpeed[];

function stringSetting<T extends string>(
  id: string, storageKey: string, label: string, description: string,
  values: readonly T[], defaultValue: T, scope: SettingScope = 'user-and-project',
): SettingDescriptor<T> {
  const validate = oneOf(values);
  return {
    id, storageKey, label, description, scope, defaultValue,
    decode: (raw) => (values as readonly string[]).includes(raw) ? raw as T : null,
    encode: (value) => value,
    validate,
  };
}

/* Erases the value type so descriptors of different types can sit in one
 * registry; the typed accessors below reintroduce it at the point of use. */
const define = <T>(descriptor: SettingDescriptor<T>): SettingDescriptor<never> => descriptor as unknown as SettingDescriptor<never>;

/* Every setting this build knows. The storage keys are the ones already in use,
 * so adopting this registry migrates nothing and breaks nobody's browser. */
export const SETTING_DESCRIPTORS: ReadonlyArray<SettingDescriptor<never>> = Object.freeze([
  define(stringSetting('emulator.scale', '8bit-net-dev:emulator-scale', 'Emulator scaling', 'How the machine framebuffer is fitted into the panel.', EMULATOR_SCALES, 'fit')),
  define(stringSetting('emulator.displayFilter', '8bit-net-dev:display-filter', 'Framebuffer filter', 'Nearest-neighbour keeps pixels square; linear smooths them.', DISPLAY_FILTERS, 'nearest')),
  define(stringSetting('emulator.displayEffect', '8bit-net-dev:emulator-display-effect', 'Display effect', 'An optional screen treatment applied to the live framebuffer.', DISPLAY_EFFECTS, 'off')),
  define(stringSetting('machine.keyboardLayout', '8bit-net-dev:jsbeeb-keyboard-layout', 'Keyboard mapping', 'How host keys are mapped onto the emulated keyboard.', KEYBOARD_LAYOUTS, 'physical')),
  define(stringSetting('archimedes.boot', '8bit-net-dev:archimedes-boot', 'A310 boot', 'Whether the A310 fast-boots or runs its authentic startup.', ['fast', 'authentic'] as const, 'fast')),
  define<number>({
    id: 'machine.volume', storageKey: '8bit-net-dev:machine-volume', label: 'Machine volume',
    description: 'Output level of the emulated machine, as a percentage.',
    scope: 'user-and-project', defaultValue: 100,
    decode: (raw) => { const value = Number(raw); return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null; },
    encode: (value) => String(value),
    validate: (value) => { try { return { ok: true, value: validateMachineVolume(value) }; } catch { return { ok: false, reason: 'must be a whole number between 0 and 100' }; } },
  }),
  define<number>({
    id: 'machine.runtimeSpeed', storageKey: '8bit-net-dev:runtime-speed', label: 'Runtime speed',
    description: 'CPU pacing multiplier. Only 1x is qualified for machine audio.',
    scope: 'user-and-project', defaultValue: 1,
    decode: (raw) => { const value = Number(raw); return (SPEEDS as readonly number[]).includes(value) ? value : null; },
    encode: (value) => String(value),
    validate: (value) => { try { return { ok: true, value: validateRuntimeSpeed(value) }; } catch { return { ok: false, reason: `must be one of ${SPEEDS.join(', ')}` }; } },
  }),
  /* Two settings whose values are structures rather than scalars. They reuse
   * the validators the runtime already applies, so a document cannot introduce
   * a mapping the machine would refuse. */
  define<MachineKeyRemap[]>({
    id: 'machine.keyRemaps', storageKey: '8bit-net-dev:key-remaps', label: 'Custom key mappings',
    description: 'Host keys remapped onto specific emulated keys.',
    scope: 'user-and-project', defaultValue: [],
    decode: (raw) => { try { return validateMachineKeyRemaps(JSON.parse(raw)); } catch { return null; } },
    encode: (value) => JSON.stringify(value),
    validate: (value) => { try { return { ok: true, value: validateMachineKeyRemaps(value) }; } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'is not a valid key mapping list' }; } },
  }),
  define<GamepadInputConfig>({
    id: 'machine.gamepad', storageKey: '8bit-net-dev:gamepad-input', label: 'Gamepad input',
    description: 'Which gamepad drives the machine, how far a stick must move, and what its controls do.',
    scope: 'user-and-project', defaultValue: DEFAULT_GAMEPAD_CONFIG,
    decode: (raw) => { try { return validateGamepadInputConfig(JSON.parse(raw)); } catch { return null; } },
    encode: (value) => JSON.stringify(value),
    validate: (value) => { try { return { ok: true, value: validateGamepadInputConfig(value) }; } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'is not a valid gamepad configuration' }; } },
  }),
  define<boolean>({
    id: 'machine.bbcMouseJoystick', storageKey: '8bit-net-dev:bbc-mouse-joystick', label: 'Mouse as BBC joystick',
    description: 'Drives the BBC analogue port from pointer movement over the live display.',
    scope: 'user-and-project', defaultValue: false,
    decode: (raw) => raw === 'enabled' ? true : raw === 'disabled' ? false : null,
    encode: (value) => value ? 'enabled' : 'disabled',
    validate: boolean,
  }),
]);

const BY_ID = new Map(SETTING_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));
const BY_KEY = new Map(SETTING_DESCRIPTORS.map((descriptor) => [descriptor.storageKey, descriptor]));

/* Browser-local data that is emphatically not a setting: a project, a firmware
 * vault, a test history, an asset draft. Exporting these would move work, or
 * ROM bytes, somewhere they were never meant to go. */
const NON_SETTING_KEY_PATTERNS = [
  /^8bit-net-dev:local-project$/,
  /^8bit-net-dev:test-history-v1$/,
  /^8bit-net-dev:pixel-asset:/,
  /^8bit-net-dev:(?:tile-map|palette|font|screen|song)$/,
  /^8bit-net-dev:basic-numbering:/,
];

export function isSettingKey(key: string): boolean {
  if (!key.startsWith('8bit-net-dev:')) return false;
  return !NON_SETTING_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function settingDescriptor(id: string): SettingDescriptor | undefined {
  return BY_ID.get(id) as SettingDescriptor | undefined;
}

/* ---- reading ------------------------------------------------------------- */

export interface SettingLayers {
  /** Values a project carries, keyed by setting identifier. */
  project?: Readonly<Record<string, unknown>>;
}

export interface ResolvedSetting<T> {
  value: T;
  /** Which layer answered. */
  layer: 'default' | 'user' | 'project';
  /** Layers that were skipped because their value did not validate. */
  rejected: Array<{ layer: 'user' | 'project'; reason: string }>;
}

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * The value in effect and where it came from. A layer whose stored value does
 * not validate is skipped rather than repaired, and the reason is returned so
 * an interface can say what was ignored.
 */
export function resolveSetting<T>(id: string, layers: SettingLayers = {}): ResolvedSetting<T> {
  const descriptor = BY_ID.get(id) as SettingDescriptor<T> | undefined;
  if (!descriptor) throw new Error(`${id} is not a setting this build knows`);
  const rejected: ResolvedSetting<T>['rejected'] = [];

  if (descriptor.scope === 'user-and-project' && layers.project && id in layers.project) {
    const carried = layers.project[id];
    const outcome = descriptor.validate(carried);
    if (outcome.ok) return { value: outcome.value, layer: 'project', rejected };
    rejected.push({ layer: 'project', reason: `${JSON.stringify(carried)} ${outcome.reason}` });
  }
  const raw = readStorage(descriptor.storageKey);
  if (raw !== null) {
    const decoded = descriptor.decode(raw);
    if (decoded !== null) return { value: decoded, layer: 'user', rejected };
    const outcome = descriptor.validate(raw);
    rejected.push({ layer: 'user', reason: `${JSON.stringify(raw)} ${outcome.ok ? 'could not be decoded' : outcome.reason}` });
  }
  return { value: descriptor.defaultValue, layer: 'default', rejected };
}

/** The value in effect, without the provenance. */
export function readSetting<T>(id: string, layers: SettingLayers = {}): T {
  return resolveSetting<T>(id, layers).value;
}

/** Write a user-layer value, or remove it when the value is the default. */
export function writeSetting<T>(id: string, value: T): void {
  const descriptor = BY_ID.get(id) as SettingDescriptor<T> | undefined;
  if (!descriptor) throw new Error(`${id} is not a setting this build knows`);
  const outcome = descriptor.validate(value);
  if (!outcome.ok) throw new Error(`${descriptor.label} ${outcome.reason}`);
  try { localStorage.setItem(descriptor.storageKey, descriptor.encode(outcome.value)); } catch { /* a browser refusing storage is reported by the quota panel */ }
}

/* ---- documents ----------------------------------------------------------- */

export interface SettingsDocument {
  schema: typeof SETTINGS_SCHEMA;
  version: typeof SETTINGS_VERSION;
  exportedAt: string;
  /** Known settings, by identifier. */
  settings: Record<string, unknown>;
  /**
   * Storage entries this build does not recognise, kept verbatim so a document
   * written by a newer build is not quietly stripped by an older one.
   */
  unknown: Record<string, string>;
}

/** Everything currently set in this browser, plus anything unrecognised. */
export function exportSettings(now: string): SettingsDocument {
  const settings: Record<string, unknown> = {};
  for (const descriptor of SETTING_DESCRIPTORS) {
    const raw = readStorage(descriptor.storageKey);
    if (raw === null) continue;
    const decoded = descriptor.decode(raw);
    if (decoded !== null) settings[descriptor.id] = decoded;
  }
  const unknown: Record<string, string> = {};
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !isSettingKey(key) || BY_KEY.has(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) unknown[key] = value;
    }
  } catch { /* enumeration refused; the known settings still export */ }
  return { schema: SETTINGS_SCHEMA, version: SETTINGS_VERSION, exportedAt: now, settings, unknown };
}

export interface SettingsImportReport {
  applied: string[];
  /** Settings refused, each with the reason, rather than being coerced. */
  rejected: Array<{ id: string; reason: string }>;
  /** Settings this build has never heard of, kept as they were. */
  preserved: string[];
}

/**
 * Apply a settings document. Each value is validated on its own, so one bad
 * entry does not discard the rest, and unknown entries are written back exactly
 * as they arrived.
 */
export function importSettings(candidate: unknown): SettingsImportReport {
  if (!candidate || typeof candidate !== 'object') throw new Error('A settings document must be an object');
  const document = candidate as Partial<SettingsDocument>;
  if (document.schema !== SETTINGS_SCHEMA) throw new Error(`A settings document must declare schema ${SETTINGS_SCHEMA}`);
  if (document.version !== SETTINGS_VERSION) throw new Error(`Settings document version ${SETTINGS_VERSION} is required`);
  const settings = document.settings && typeof document.settings === 'object' ? document.settings : {};
  const unknown = document.unknown && typeof document.unknown === 'object' ? document.unknown : {};

  const report: SettingsImportReport = { applied: [], rejected: [], preserved: [] };
  for (const [id, value] of Object.entries(settings)) {
    const descriptor = BY_ID.get(id);
    if (!descriptor) { report.rejected.push({ id, reason: 'is not a setting this build knows' }); continue; }
    const outcome = descriptor.validate(value);
    if (!outcome.ok) { report.rejected.push({ id, reason: outcome.reason }); continue; }
    try { localStorage.setItem(descriptor.storageKey, descriptor.encode(outcome.value)); report.applied.push(id); }
    catch { report.rejected.push({ id, reason: 'could not be stored by this browser' }); }
  }
  for (const [key, value] of Object.entries(unknown)) {
    if (!isSettingKey(key) || BY_KEY.has(key) || typeof value !== 'string') continue;
    try { localStorage.setItem(key, value); report.preserved.push(key); } catch { /* nothing to report beyond storage refusal */ }
  }
  return report;
}

/** Remove every known user-layer value, leaving the defaults in effect. */
export function resetSettings(): string[] {
  const cleared: string[] = [];
  for (const descriptor of SETTING_DESCRIPTORS) {
    try {
      if (localStorage.getItem(descriptor.storageKey) === null) continue;
      localStorage.removeItem(descriptor.storageKey);
      cleared.push(descriptor.id);
    } catch { /* a browser refusing storage has nothing to clear */ }
  }
  return cleared;
}

/** One line for the interface. */
export function settingsSummary(document: SettingsDocument): string {
  const known = Object.keys(document.settings).length;
  const unknown = Object.keys(document.unknown).length;
  return `${known} setting${known === 1 ? '' : 's'}${unknown ? ` · ${unknown} unrecognised entr${unknown === 1 ? 'y' : 'ies'} preserved` : ''}`;
}
