import { describe, expect, it } from 'vitest';
import { armPipelineStageName, decodeArm26Status, decodeIocInterrupts } from './armStateModel';

describe('ARM 26-bit debugger state', () => {
  it('separates flags, interrupt masks, address and processor mode from R15', () => {
    const state = decodeArm26Status(0xd8008003);
    expect(state).toMatchObject({ raw: 0xd8008003, pc: 0x8000, mode: 3, modeName: 'Supervisor' });
    expect(Object.fromEntries(state.flags.map((flag) => [flag.name, flag.set]))).toEqual({ N: true, Z: true, C: false, V: true, I: true, F: false });
  });

  it('names only core-latched execute/decode and the separately sourced next-fetch preview', () => {
    expect([0, 1, 2].map(armPipelineStageName)).toEqual(['Execute', 'Decode', 'Next fetch']);
  });

  it('distinguishes asserted, enabled and genuinely pending IOC interrupt sources', () => {
    const sources = decodeIocInterrupts('A', 0x68, 0x60);
    expect(sources.filter((source) => source.asserted).map((source) => source.label)).toEqual(['VBlank', 'Timer 0', 'Timer 1']);
    expect(sources.filter((source) => source.pending).map((source) => source.label)).toEqual(['Timer 0', 'Timer 1']);
  });
});
