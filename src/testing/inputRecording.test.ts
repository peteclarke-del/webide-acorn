import { describe, expect, it } from 'vitest';
import {
  appendRecorded, gamepadTransitions, POINTER_SAMPLE_INTERVAL_MS, pointerSample,
  shouldSamplePointer,
} from './inputRecording';

describe('recording a controller', () => {
  it('writes down only what changed', () => {
    /* A gamepad has no events, so it is polled. Recording the state every
     * frame would fill the 256-action budget in four seconds with entries
     * saying nothing happened. */
    expect(gamepadTransitions([], ['fire1'], 90)).toEqual([
      { kind: 'gamepad', action: 'fire1', code: 90, pressed: true },
    ]);
    expect(gamepadTransitions(['fire1'], ['fire1'], 90)).toEqual([]);
    expect(gamepadTransitions(['fire1'], [], 90)).toEqual([
      { kind: 'gamepad', action: 'fire1', code: 90, pressed: false },
    ]);
  });

  it('releases before it presses, so two opposed directions never overlap', () => {
    /* A machine reads one joystick state at a time. Replaying a press before
     * the release it replaced would hold left and right at once, which the
     * hardware cannot do and a program may well act on. */
    const entries = gamepadTransitions(['left'], ['right'], 90);
    expect(entries.map((entry) => [entry.action, entry.pressed])).toEqual([
      ['left', false],
      ['right', true],
    ]);
  });

  it('handles several directions changing at once', () => {
    const entries = gamepadTransitions(['up', 'left'], ['up', 'right', 'fire1'], 77);
    expect(entries.filter((entry) => !entry.pressed).map((entry) => entry.action)).toEqual(['left']);
    expect(entries.filter((entry) => entry.pressed).map((entry) => entry.action)).toEqual(['right', 'fire1']);
    expect(entries.every((entry) => entry.code === 77)).toBe(true);
  });
});

describe('recording the pointer', () => {
  const surface = { left: 100, top: 50, width: 400, height: 200 };

  it('scales the position to the range the converter reports', () => {
    expect(pointerSample(surface, { clientX: 100, clientY: 50, buttons: 0 }))
      .toEqual({ kind: 'bbc-mouse', x: 0, y: 0, buttons: [false, false] });
    expect(pointerSample(surface, { clientX: 500, clientY: 250, buttons: 0 }))
      .toEqual({ kind: 'bbc-mouse', x: 0xffff, y: 0xffff, buttons: [false, false] });
    expect(pointerSample(surface, { clientX: 300, clientY: 150, buttons: 0 }))
      .toMatchObject({ x: 0x8000 - 1 + 1, y: 0x8000 - 1 + 1 });
  });

  it('clamps rather than refusing when the pointer leaves the surface', () => {
    /* A pointer that leaves mid-gesture should record the edge it left by, not
     * a value outside the range and not a hole in the script. */
    const sample = pointerSample(surface, { clientX: -500, clientY: 9000, buttons: 0 });
    expect(sample).toMatchObject({ x: 0, y: 0xffff });
  });

  it('reads both buttons from the bitmask', () => {
    expect(pointerSample(surface, { clientX: 300, clientY: 150, buttons: 1 })?.buttons).toEqual([true, false]);
    expect(pointerSample(surface, { clientX: 300, clientY: 150, buttons: 2 })?.buttons).toEqual([false, true]);
    expect(pointerSample(surface, { clientX: 300, clientY: 150, buttons: 3 })?.buttons).toEqual([true, true]);
  });

  it('records nothing from a surface with no size', () => {
    /* A panel that has not been laid out yet has a zero box, and dividing by it
     * would put a NaN in somebody's test script. */
    expect(pointerSample({ left: 0, top: 0, width: 0, height: 200 }, { clientX: 1, clientY: 1, buttons: 0 })).toBeNull();
  });

  it('samples at an interval rather than on every event', () => {
    expect(shouldSamplePointer(0, POINTER_SAMPLE_INTERVAL_MS)).toBe(true);
    expect(shouldSamplePointer(0, POINTER_SAMPLE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldSamplePointer(1000, 1000)).toBe(false);
  });
});

describe('keeping inside the budget', () => {
  it('drops the newest rather than the oldest when the script is full', () => {
    /* A recording that silently discarded its own beginning would replay
     * something the person never did. */
    const existing = Array.from({ length: 255 }, (_entry, index) => index);
    const appended = appendRecorded(existing, [900, 901, 902]);
    expect(appended).toHaveLength(256);
    expect(appended[0]).toBe(0);
    expect(appended[255]).toBe(900);
  });

  it('appends nothing once the script is exactly full', () => {
    const full = Array.from({ length: 256 }, (_entry, index) => index);
    expect(appendRecorded(full, [900])).toHaveLength(256);
    expect(appendRecorded(full, [900])[255]).toBe(255);
  });

  it('appends normally when there is room', () => {
    expect(appendRecorded([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  });
});
