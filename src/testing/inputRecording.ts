/* Turning a person using a controller into a script a machine can replay.
 *
 * Recording is not sampling. A gamepad has no events — the browser reports its
 * state only when asked — and a pointer has far too many, so both are reduced
 * to the moments that change what the machine would see. Writing down every
 * frame would fill the 256-action budget in four seconds with entries that say
 * nothing happened, and a test full of those is one nobody can read.
 *
 * The reductions live here rather than in the panel so that what a recording
 * means can be stated and checked without a browser, a controller or a hand.
 */
import type { GamepadAction } from '../emulator/gamepadInputModel';

/* One recorded action, in the shape the plan and the runtime already use. Each
 * device has its own type as well as the union, because a function that can
 * only produce one of them should say so rather than making its caller narrow
 * a union it was never going to return. */
export interface RecordedGamepadInput { kind: 'gamepad'; action: GamepadAction; code: number; pressed: boolean }
export interface RecordedPointerInput { kind: 'bbc-mouse'; x: number; y: number; buttons: [boolean, boolean] }
export type RecordedInput = RecordedGamepadInput | RecordedPointerInput;

/**
 * How often the pointer is written down, in milliseconds.
 *
 * A pointer produces hundreds of events a second and a test wants the few that
 * matter. Ten a second is fast enough to capture a deliberate movement and slow
 * enough that crossing the panel does not exhaust the budget.
 */
export const POINTER_SAMPLE_INTERVAL_MS = 100;

/**
 * What changed between two readings of a controller.
 *
 * Releases are emitted before presses. A machine reading a joystick sees one
 * state at a time, and replaying a press before the release it replaced would
 * momentarily hold two opposed directions at once — which is a state the
 * hardware cannot be in and a program may well act on.
 */
export function gamepadTransitions(
  previous: readonly GamepadAction[],
  pressed: readonly GamepadAction[],
  code: number,
): RecordedGamepadInput[] {
  const released = previous.filter((action) => !pressed.includes(action));
  const gained = pressed.filter((action) => !previous.includes(action));
  return [
    ...released.map((action) => ({ kind: 'gamepad' as const, action, code, pressed: false })),
    ...gained.map((action) => ({ kind: 'gamepad' as const, action, code, pressed: true })),
  ];
}

export interface PointerSurface { left: number; top: number; width: number; height: number }
export interface PointerReading { clientX: number; clientY: number; buttons: number }

/**
 * Where the pointer is, as the analogue joystick it is mapped to.
 *
 * The position is taken relative to the surface it moved over and scaled to the
 * sixteen-bit range the converter reports. It is clamped rather than refused:
 * a pointer that leaves the surface mid-gesture should record the edge it left
 * by, not a value outside the range or a hole in the script.
 */
export function pointerSample(surface: PointerSurface, reading: PointerReading): RecordedPointerInput | null {
  if (!(surface.width > 0) || !(surface.height > 0)) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const across = clamp((reading.clientX - surface.left) / surface.width);
  const down = clamp((reading.clientY - surface.top) / surface.height);
  return {
    kind: 'bbc-mouse',
    x: Math.round(across * 0xffff),
    y: Math.round(down * 0xffff),
    buttons: [Boolean(reading.buttons & 1), Boolean(reading.buttons & 2)],
  };
}

/**
 * Append recorded actions to a script without exceeding what it may hold.
 *
 * The limit is the runtime's, and it is enforced by dropping the newest rather
 * than the oldest: a recording that silently discarded its own beginning would
 * replay something the person never did.
 */
export function appendRecorded<T>(existing: readonly T[], recorded: readonly T[], limit = 256): T[] {
  const room = Math.max(0, limit - existing.length);
  return room === 0 ? [...existing] : [...existing, ...recorded.slice(0, room)];
}

/** Whether a reading should be written down yet, given when the last one was. */
export function shouldSamplePointer(lastAt: number, now: number, interval = POINTER_SAMPLE_INTERVAL_MS): boolean {
  return now - lastAt >= interval;
}
