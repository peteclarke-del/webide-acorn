import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMEPAD_CONFIG, activeGamepadActions, atomMmcJoystickState, bbcAnalogueJoystickState, validateGamepadInputConfig } from './gamepadInputModel';

const buttons = (pressed: number[] = []) => Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0 } as GamepadButton));

describe('gamepad input model', () => {
  it('validates a unique bounded Acorn mapping', () => expect(validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, enabled: true, deadZone: 0.456 })).toMatchObject({ enabled: true, gamepadIndex: 0, deadZone: 0.46 }));
  it('rejects unsafe indexes, dead zones, duplicate actions and unknown target keys', () => {
    expect(() => validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, gamepadIndex: 4 })).toThrow(/index/);
    expect(() => validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, deadZone: 0.01 })).toThrow(/dead zone/);
    expect(() => validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, mapping: { ...DEFAULT_GAMEPAD_CONFIG.mapping, fire2: DEFAULT_GAMEPAD_CONFIG.mapping.fire1 } })).toThrow(/different/);
    expect(() => validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, mapping: { ...DEFAULT_GAMEPAD_CONFIG.mapping, fire2: 999 } })).toThrow(/Acorn key/);
  });
  it('combines standard axes, d-pad and two fire buttons at a deterministic threshold', () => {
    expect([...activeGamepadActions({ axes: [-0.6, 0.8], buttons: buttons([0, 12]) }, 0.45)]).toEqual(['up', 'down', 'left', 'fire1']);
    expect([...activeGamepadActions({ axes: [0.2, -0.2], buttons: buttons([1, 15]) }, 0.45)]).toEqual(['right', 'fire2']);
  });
  it('maps four browser axes and two buttons onto the inverted BBC ADC contract', () => {
    expect(bbcAnalogueJoystickState({ axes: [-1, 1, 0.2, -0.6], buttons: buttons([0]) }, 0.45)).toEqual({ channels: [65535, 0, 32768, 52428], buttons: [true, false] });
    expect(validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, interfaceMode: 'bbc-analogue' }).interfaceMode).toBe('bbc-analogue');
    expect(() => validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, interfaceMode: 'native' })).toThrow(/interface/);
  });
  it('maps standard controls onto the active-low AtoMMC joystick port', () => {
    expect(atomMmcJoystickState({ axes: [-1, 1], buttons: buttons([1]) }, 0.45)).toEqual({ up: false, down: true, left: true, right: false, fire: true, port: 0xe9 });
    expect(validateGamepadInputConfig({ ...DEFAULT_GAMEPAD_CONFIG, interfaceMode: 'atom-atommc' }).interfaceMode).toBe('atom-atommc');
  });
});
