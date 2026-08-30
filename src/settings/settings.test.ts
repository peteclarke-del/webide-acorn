import { beforeEach, describe, expect, it } from 'vitest';
import {
  SETTINGS_SCHEMA,
  SETTING_DESCRIPTORS,
  exportSettings,
  importSettings,
  isSettingKey,
  readSetting,
  resetSettings,
  resolveSetting,
  settingsSummary,
  writeSetting,
  settingDescriptor,
} from './settings';
import { isEmulatorDisplayFilter } from '../emulator/audioDisplayControlModel';
import { EMULATOR_DISPLAY_EFFECTS } from '../emulator/displayEffectModel';
import { EMULATOR_SCALE_MODES, isEmulatorScaleMode } from '../emulator/emulatorScaleModel';
import { isJsBeebKeyboardLayout } from '../emulator/keyboardInputModel';
import { isRuntimeSpeed } from '../emulator/runtimeSpeedModel';

const NOW = '2026-08-27T00:00:00.000Z';

beforeEach(() => { localStorage.clear(); });

describe('layered settings', () => {
  it('answers from the built-in default when nothing has been chosen', () => {
    const resolved = resolveSetting<string>('emulator.scale');
    expect(resolved).toEqual({ value: 'fit', layer: 'default', rejected: [] });
  });

  it('prefers what the person chose in this browser', () => {
    writeSetting('emulator.scale', '2x');
    expect(resolveSetting<string>('emulator.scale')).toEqual({ value: '2x', layer: 'user', rejected: [] });
  });

  it('lets a project override the person for that project only', () => {
    writeSetting('machine.volume', 40);
    const resolved = resolveSetting<number>('machine.volume', { project: { 'machine.volume': 75 } });
    expect(resolved).toEqual({ value: 75, layer: 'project', rejected: [] });
    /* Without the project layer, the person's own value is unchanged. */
    expect(readSetting<number>('machine.volume')).toBe(40);
  });

  it('skips a project value that does not validate and says why, rather than coercing it', () => {
    writeSetting('machine.volume', 40);
    const resolved = resolveSetting<number>('machine.volume', { project: { 'machine.volume': 900 } });
    expect(resolved.value).toBe(40);
    expect(resolved.layer).toBe('user');
    expect(resolved.rejected).toEqual([{ layer: 'project', reason: '900 must be a whole number between 0 and 100' }]);
  });

  it('falls through a corrupt stored value to the default and reports it', () => {
    localStorage.setItem('8bit-net-dev:emulator-scale', 'enormous');
    const resolved = resolveSetting<string>('emulator.scale');
    expect(resolved.value).toBe('fit');
    expect(resolved.layer).toBe('default');
    expect(resolved.rejected[0]?.layer).toBe('user');
    expect(resolved.rejected[0]?.reason).toBe('"enormous" must be one of fit, 1x, 2x');
  });

  it('refuses to write a value the schema does not accept', () => {
    expect(() => writeSetting('machine.volume', 101)).toThrow(/must be a whole number between 0 and 100/);
    expect(() => writeSetting('machine.runtimeSpeed', 3)).toThrow(/must be one of 0\.5, 1, 2, 4/);
    expect(localStorage.getItem('8bit-net-dev:machine-volume')).toBeNull();
  });

  it('refuses a setting identifier it has never heard of, rather than inventing storage for it', () => {
    expect(() => readSetting('nonsense.setting')).toThrow(/not a setting this build knows/);
    expect(() => writeSetting('nonsense.setting', 1)).toThrow(/not a setting this build knows/);
  });

  it('validates a structured setting with the same rules the runtime applies', () => {
    expect(() => writeSetting('machine.gamepad', { enabled: 'yes' })).toThrow();
    writeSetting('machine.keyRemaps', []);
    expect(readSetting('machine.keyRemaps')).toEqual([]);
  });
});

describe('settings documents', () => {
  it('exports only what has been set, and summarises it', () => {
    writeSetting('emulator.scale', '2x');
    writeSetting('machine.volume', 25);
    const document = exportSettings(NOW);
    expect(document.schema).toBe(SETTINGS_SCHEMA);
    expect(document.exportedAt).toBe(NOW);
    expect(document.settings).toEqual({ 'emulator.scale': '2x', 'machine.volume': 25 });
    expect(settingsSummary(document)).toBe('2 settings');
  });

  it('never exports a project, a test history or an asset draft as if it were a setting', () => {
    localStorage.setItem('8bit-net-dev:local-project', '{"format":"x"}');
    localStorage.setItem('8bit-net-dev:test-history-v1', '[]');
    localStorage.setItem('8bit-net-dev:pixel-asset:sprites', '{}');
    localStorage.setItem('8bit-net-dev:tile-map', '{}');
    const document = exportSettings(NOW);
    expect(Object.keys(document.unknown)).toEqual([]);
    expect(isSettingKey('8bit-net-dev:local-project')).toBe(false);
    expect(isSettingKey('8bit-net-dev:pixel-asset:sprites')).toBe(false);
    expect(isSettingKey('unrelated-key')).toBe(false);
  });

  it('preserves a setting a newer build wrote that this one does not know', () => {
    localStorage.setItem('8bit-net-dev:future-preference', 'kept');
    const document = exportSettings(NOW);
    expect(document.unknown).toEqual({ '8bit-net-dev:future-preference': 'kept' });
    expect(settingsSummary(document)).toContain('1 unrecognised entry preserved');

    localStorage.clear();
    const report = importSettings(document);
    expect(report.preserved).toEqual(['8bit-net-dev:future-preference']);
    expect(localStorage.getItem('8bit-net-dev:future-preference')).toBe('kept');
  });

  it('round-trips every known setting exactly', () => {
    writeSetting('emulator.scale', '1x');
    writeSetting('emulator.displayFilter', 'linear');
    writeSetting('machine.keyboardLayout', 'gaming');
    writeSetting('machine.volume', 60);
    writeSetting('machine.runtimeSpeed', 4);
    writeSetting('machine.bbcMouseJoystick', true);
    const document = exportSettings(NOW);

    localStorage.clear();
    const report = importSettings(document);
    expect(report.rejected).toEqual([]);
    expect(report.applied.sort()).toEqual(Object.keys(document.settings).sort());
    expect(exportSettings(NOW).settings).toEqual(document.settings);
  });

  it('applies the good entries and reports the bad ones instead of refusing the whole document', () => {
    const report = importSettings({
      schema: SETTINGS_SCHEMA, version: 1, exportedAt: NOW,
      settings: { 'emulator.scale': '2x', 'machine.volume': 900, 'from.the.future': 1 },
      unknown: {},
    });
    expect(report.applied).toEqual(['emulator.scale']);
    expect(report.rejected).toEqual([
      { id: 'machine.volume', reason: 'must be a whole number between 0 and 100' },
      { id: 'from.the.future', reason: 'is not a setting this build knows' },
    ]);
    expect(readSetting('emulator.scale')).toBe('2x');
    expect(readSetting('machine.volume')).toBe(100);
  });

  it('refuses a document that is not one, naming what is wrong', () => {
    expect(() => importSettings(null)).toThrow(/must be an object/);
    expect(() => importSettings({ schema: 'other', version: 1 })).toThrow(/must declare schema/);
    expect(() => importSettings({ schema: SETTINGS_SCHEMA, version: 2 })).toThrow(/version 1 is required/);
  });

  it('will not smuggle a project back in through the unknown entries of a document', () => {
    const report = importSettings({
      schema: SETTINGS_SCHEMA, version: 1, exportedAt: NOW, settings: {},
      unknown: { '8bit-net-dev:local-project': '{"format":"stolen"}', '8bit-net-dev:future': 'ok' },
    });
    expect(report.preserved).toEqual(['8bit-net-dev:future']);
    expect(localStorage.getItem('8bit-net-dev:local-project')).toBeNull();
  });

  it('resets only the settings that were set, and names them', () => {
    writeSetting('emulator.scale', '2x');
    writeSetting('machine.volume', 10);
    localStorage.setItem('8bit-net-dev:local-project', 'kept');
    const cleared = resetSettings().sort();
    expect(cleared).toEqual(['emulator.scale', 'machine.volume']);
    expect(readSetting('emulator.scale')).toBe('fit');
    expect(localStorage.getItem('8bit-net-dev:local-project')).toBe('kept');
    expect(resetSettings()).toEqual([]);
  });

  it('gives every registered setting a distinct identifier, storage key and description', () => {
    const ids = SETTING_DESCRIPTORS.map((descriptor) => descriptor.id);
    const keys = SETTING_DESCRIPTORS.map((descriptor) => descriptor.storageKey);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const descriptor of SETTING_DESCRIPTORS) {
      expect(descriptor.label.length, `${descriptor.id} has a label`).toBeGreaterThan(0);
      expect(descriptor.description.length, `${descriptor.id} explains itself`).toBeGreaterThan(20);
      expect(descriptor.validate(descriptor.defaultValue).ok, `${descriptor.id} default passes its own schema`).toBe(true);
    }
  });
});

/* The registry describes settings the runtime also validates its own way. A
 * value set that drifts from the runtime's would let the settings surface offer
 * something the machine then refuses, so the two are compared here. */
describe('settings schema against the runtime it configures', () => {
  it('offers exactly the emulator scale modes the runtime accepts', () => {
    const descriptor = settingDescriptor('emulator.scale')!;
    for (const mode of EMULATOR_SCALE_MODES) expect(descriptor.validate(mode.id).ok, `${mode.id} is offered`).toBe(true);
    expect(EMULATOR_SCALE_MODES.every((mode) => isEmulatorScaleMode(mode.id))).toBe(true);
    expect(descriptor.validate('enormous').ok).toBe(false);
  });

  it('offers exactly the display effects the runtime accepts', () => {
    const descriptor = settingDescriptor('emulator.displayEffect')!;
    for (const effect of EMULATOR_DISPLAY_EFFECTS) expect(descriptor.validate(effect.id).ok, `${effect.id} is offered`).toBe(true);
    expect(descriptor.validate('phosphor').ok).toBe(false);
  });

  it('offers only values the runtime guards accept, and rejects everything they reject', () => {
    const filter = settingDescriptor('emulator.displayFilter')!;
    const layout = settingDescriptor('machine.keyboardLayout')!;
    const speed = settingDescriptor('machine.runtimeSpeed')!;
    for (const value of ['nearest', 'linear']) expect(filter.validate(value).ok && isEmulatorDisplayFilter(value)).toBe(true);
    for (const value of ['physical', 'natural', 'gaming']) expect(layout.validate(value).ok && isJsBeebKeyboardLayout(value)).toBe(true);
    for (const value of [0.5, 1, 2, 4]) expect(speed.validate(value).ok && isRuntimeSpeed(value)).toBe(true);
    expect(filter.validate('bilinear').ok || isEmulatorDisplayFilter('bilinear')).toBe(false);
    expect(speed.validate(3).ok || isRuntimeSpeed(3)).toBe(false);
  });
});
