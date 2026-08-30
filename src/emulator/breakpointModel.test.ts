import { describe, expect, it } from 'vitest';
import { breakpointMatches, renderBreakpointLog, validateBreakpointSpec, type BreakpointSpec } from './breakpointModel';

const registers = { a: 0x41, x: 3, y: 4, s: 0xfd, p: 0x30, pc: 0x1902 };
const base: BreakpointSpec = { address: 0x1902, enabled: true, stop: true };

describe('hardware breakpoint domain model', () => {
  it('combines hit target and typed register conditions deterministically', () => {
    const spec = { ...base, hitTarget: 3, condition: { register: 'x' as const, operator: 'eq' as const, value: 3 } };
    expect(breakpointMatches(spec, registers, 2)).toBe(false);
    expect(breakpointMatches(spec, registers, 3)).toBe(true);
    expect(breakpointMatches({ ...spec, condition: { ...spec.condition, operator: 'ne' } }, registers, 3)).toBe(false);
  });

  it('validates bounded addresses, values, hit targets and non-stopping logpoints', () => {
    expect(validateBreakpointSpec({ ...base, stop: false, logMessage: 'X={x}' })).toMatchObject({ stop: false, logMessage: 'X={x}' });
    expect(() => validateBreakpointSpec({ ...base, address: 0x10000 })).toThrow('16-bit');
    expect(() => validateBreakpointSpec({ ...base, hitTarget: 0 })).toThrow('hit target');
    expect(() => validateBreakpointSpec({ ...base, condition: { register: 'a', operator: 'eq', value: 256 } })).toThrow('out of range');
    expect(() => validateBreakpointSpec({ ...base, stop: false })).toThrow('requires a log message');
  });

  it('renders only documented register and hit-count placeholders', () => {
    expect(renderBreakpointLog('PC={pc} A={A} X={x} hit {hits} {unknown}', registers, 7)).toBe('PC=&1902 A=&41 X=&03 hit 7 {unknown}');
  });
});
