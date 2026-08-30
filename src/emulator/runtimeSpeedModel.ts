export const RUNTIME_SPEEDS = [
  { value: 0.5, label: '0.5x', detail: 'Half-speed execution for inspecting timing-sensitive behaviour.' },
  { value: 1, label: '1x', detail: 'Authentic machine speed with qualified audio output.' },
  { value: 2, label: '2x', detail: 'Double-speed execution. Audio is unavailable outside 1x.' },
  { value: 4, label: '4x', detail: 'Four-times turbo execution. Audio is unavailable outside 1x.' },
] as const;

export type RuntimeSpeed = (typeof RUNTIME_SPEEDS)[number]['value'];

export function isRuntimeSpeed(value: unknown): value is RuntimeSpeed {
  return typeof value === 'number' && RUNTIME_SPEEDS.some((entry) => entry.value === value);
}

export function validateRuntimeSpeed(value: unknown): RuntimeSpeed {
  if (!isRuntimeSpeed(value)) throw new Error('Runtime speed must be 0.5x, 1x, 2x or 4x');
  return value;
}

export function cyclesForPresentationFrame(cyclesPerSecond: number, speed: RuntimeSpeed, frameRate = 50): number {
  if (!Number.isFinite(cyclesPerSecond) || cyclesPerSecond <= 0) throw new Error('CPU cycle rate must be positive');
  if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error('Presentation frame rate must be positive');
  return Math.floor(cyclesPerSecond * speed / frameRate);
}
