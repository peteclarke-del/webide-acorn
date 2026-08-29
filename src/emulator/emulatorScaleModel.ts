export type EmulatorScaleMode = 'fit' | '1x' | '2x';

export const EMULATOR_SCALE_MODES: ReadonlyArray<{ id: EmulatorScaleMode; label: string; detail: string }> = [
  { id: 'fit', label: 'Fit', detail: 'Fit the framebuffer inside the available emulator region.' },
  { id: '1x', label: '1x', detail: 'Use one CSS pixel for each live framebuffer pixel and allow scrolling.' },
  { id: '2x', label: '2x', detail: 'Use a two-times integer framebuffer viewport and allow scrolling.' },
];

export function isEmulatorScaleMode(value: unknown): value is EmulatorScaleMode {
  return value === 'fit' || value === '1x' || value === '2x';
}

export function scaledFramebufferViewport(mode: EmulatorScaleMode, width: unknown, height: unknown): { width: number; height: number } | undefined {
  if (mode === 'fit') return undefined;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) < 1 || Number(height) < 1 || Number(width) > 4096 || Number(height) > 4096) return undefined;
  const multiplier = mode === '2x' ? 2 : 1;
  return { width: Number(width) * multiplier, height: Number(height) * multiplier };
}
