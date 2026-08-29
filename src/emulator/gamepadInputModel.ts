import { validateMachineTapCode } from './keyboardInputModel';

export type GamepadAction = 'up' | 'down' | 'left' | 'right' | 'fire1' | 'fire2';
export type GamepadMapping = Record<GamepadAction, number>;
export type GamepadInterfaceMode = 'keys' | 'bbc-analogue' | 'atom-atommc';
export interface GamepadInputConfig { enabled: boolean; gamepadIndex: number; deadZone: number; interfaceMode: GamepadInterfaceMode; mapping: GamepadMapping }
export interface BbcAnalogueJoystickState { channels: [number, number, number, number]; buttons: [boolean, boolean] }
export interface AtomMmcJoystickState { up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean; port: number }

export const GAMEPAD_ACTIONS: ReadonlyArray<{ id: GamepadAction; label: string }> = Object.freeze([
  { id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }, { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'fire1', label: 'Fire 1' }, { id: 'fire2', label: 'Fire 2' },
]);
export const DEFAULT_GAMEPAD_CONFIG: GamepadInputConfig = Object.freeze({ enabled: false, gamepadIndex: 0, deadZone: 0.45, interfaceMode: 'keys', mapping: Object.freeze({ up: 38, down: 40, left: 37, right: 39, fire1: 90, fire2: 88 }) });

export function validateGamepadInputConfig(value: unknown): GamepadInputConfig {
  if (!value || typeof value !== 'object') throw new Error('Gamepad input configuration is missing');
  const candidate = value as GamepadInputConfig;
  if (typeof candidate.enabled !== 'boolean') throw new Error('Gamepad enabled state must be boolean');
  if (!Number.isInteger(candidate.gamepadIndex) || candidate.gamepadIndex < 0 || candidate.gamepadIndex > 3) throw new Error('Gamepad index must be between 0 and 3');
  if (!Number.isFinite(candidate.deadZone) || candidate.deadZone < 0.1 || candidate.deadZone > 0.9) throw new Error('Gamepad dead zone must be between 0.10 and 0.90');
  const interfaceMode = candidate.interfaceMode === undefined ? 'keys' : candidate.interfaceMode;
  if (interfaceMode !== 'keys' && interfaceMode !== 'bbc-analogue' && interfaceMode !== 'atom-atommc') throw new Error('Gamepad interface must be keys, BBC analogue or Atom AtoMMC');
  if (!candidate.mapping || typeof candidate.mapping !== 'object') throw new Error('Gamepad action mapping is missing');
  const mapping = Object.fromEntries(GAMEPAD_ACTIONS.map(({ id }) => [id, validateMachineTapCode(candidate.mapping[id])])) as GamepadMapping;
  if (new Set(Object.values(mapping)).size !== GAMEPAD_ACTIONS.length) throw new Error('Each gamepad action must map to a different Acorn key');
  return Object.freeze({ enabled: candidate.enabled, gamepadIndex: candidate.gamepadIndex, deadZone: Math.round(candidate.deadZone * 100) / 100, interfaceMode, mapping: Object.freeze(mapping) });
}

export function bbcAnalogueJoystickState(gamepad: Pick<Gamepad, 'axes' | 'buttons'>, deadZone: number): BbcAnalogueJoystickState {
  const axis = (index: number) => { const raw = Math.max(-1, Math.min(1, Number(gamepad.axes[index] ?? 0))); const normalized = Math.abs(raw) < deadZone ? 0 : raw; return Math.round(((1 - normalized) / 2) * 0xffff); };
  const pressed = (index: number) => Boolean(gamepad.buttons[index]?.pressed || Number(gamepad.buttons[index]?.value ?? 0) >= 0.5);
  return { channels: [axis(0), axis(1), axis(2), axis(3)], buttons: [pressed(0), pressed(1)] };
}

export function activeGamepadActions(gamepad: Pick<Gamepad, 'axes' | 'buttons'>, deadZone: number): Set<GamepadAction> {
  const axisX = Number(gamepad.axes[0] ?? 0); const axisY = Number(gamepad.axes[1] ?? 0);
  const pressed = (index: number) => Boolean(gamepad.buttons[index]?.pressed || Number(gamepad.buttons[index]?.value ?? 0) >= 0.5);
  return new Set<GamepadAction>([
    ...(axisY <= -deadZone || pressed(12) ? ['up' as const] : []), ...(axisY >= deadZone || pressed(13) ? ['down' as const] : []),
    ...(axisX <= -deadZone || pressed(14) ? ['left' as const] : []), ...(axisX >= deadZone || pressed(15) ? ['right' as const] : []),
    ...(pressed(0) ? ['fire1' as const] : []), ...(pressed(1) ? ['fire2' as const] : []),
  ]);
}

export function atomMmcJoystickState(gamepad: Pick<Gamepad, 'axes' | 'buttons'>, deadZone: number): AtomMmcJoystickState {
  const actions = activeGamepadActions(gamepad, deadZone);
  const state = { up: actions.has('up'), down: actions.has('down'), left: actions.has('left'), right: actions.has('right'), fire: actions.has('fire1') || actions.has('fire2') };
  return { ...state, port: 0xff ^ (state.right ? 0x01 : 0) ^ (state.left ? 0x02 : 0) ^ (state.down ? 0x04 : 0) ^ (state.up ? 0x08 : 0) ^ (state.fire ? 0x10 : 0) };
}
