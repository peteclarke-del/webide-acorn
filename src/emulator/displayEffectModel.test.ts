import { describe, expect, it } from 'vitest';
import { EMULATOR_DISPLAY_EFFECTS, isEmulatorDisplayEffect } from './displayEffectModel';

describe('emulator display effects', () => {
  it('keeps a bounded honest presentation-only catalogue', () => {
    expect(EMULATOR_DISPLAY_EFFECTS.map((effect) => effect.id)).toEqual(['off', 'scanlines', 'soft-crt']);
    expect(EMULATOR_DISPLAY_EFFECTS.every((effect) => /CSS|presentation|framebuffer/i.test(effect.detail))).toBe(true);
  });

  it('rejects unknown persisted values', () => {
    expect(isEmulatorDisplayEffect('soft-crt')).toBe(true);
    expect(isEmulatorDisplayEffect('authentic-phosphor')).toBe(false);
  });
});
