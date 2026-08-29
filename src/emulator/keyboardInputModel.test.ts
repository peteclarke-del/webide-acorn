import { describe, expect, it } from 'vitest';
import { isJsBeebKeyboardLayout, MACHINE_TEXT_LIMIT, validateMachineTapCode, validateMachineText } from './keyboardInputModel';

describe('machine keyboard input policy', () => {
  it('normalizes bounded ASCII text without interpreting it', () => {
    expect(validateMachineText('PRINT "HELLO"\r\nRUN')).toBe('PRINT "HELLO"\nRUN');
    expect(validateMachineText('A'.repeat(MACHINE_TEXT_LIMIT))).toHaveLength(MACHINE_TEXT_LIMIT);
  });

  it('rejects empty, oversized and unsupported text', () => {
    expect(() => validateMachineText('')).toThrow(/1 to 4,096/);
    expect(() => validateMachineText('A'.repeat(MACHINE_TEXT_LIMIT + 1))).toThrow(/1 to 4,096/);
    expect(() => validateMachineText('PRINT “HELLO”')).toThrow(/U\+201C/);
  });

  it('accepts only maintained layout and on-screen key identities', () => {
    expect(isJsBeebKeyboardLayout('gaming')).toBe(true);
    expect(isJsBeebKeyboardLayout('custom')).toBe(false);
    expect(validateMachineTapCode(13)).toBe(13);
    expect(() => validateMachineTapCode(999)).toThrow(/maintained Acorn key surface/);
  });
});
