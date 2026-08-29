export type EmulatorDisplayEffect = 'off' | 'scanlines' | 'soft-crt';

export const EMULATOR_DISPLAY_EFFECTS: ReadonlyArray<{ id: EmulatorDisplayEffect; label: string; detail: string }> = Object.freeze([
  { id: 'off', label: 'CLEAN', detail: 'No presentation overlay. The emulator framebuffer remains unchanged.' },
  { id: 'scanlines', label: 'LINES', detail: 'A CSS scanline overlay for visual preference. It is not a hardware-accuracy claim.' },
  { id: 'soft-crt', label: 'SOFT CRT', detail: 'CSS scanlines, grille and vignette for presentation only. Captured PNG pixels remain unchanged.' },
]);

export const isEmulatorDisplayEffect = (value: unknown): value is EmulatorDisplayEffect => EMULATOR_DISPLAY_EFFECTS.some((effect) => effect.id === value);

