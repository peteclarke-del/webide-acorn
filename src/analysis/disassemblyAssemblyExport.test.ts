import { describe, expect, it } from 'vitest';
import { disassemble6502 } from './disassembler6502';
import { createVerified6502AssemblySource } from './disassemblyAssemblyExport';

describe('verified disassembly assembly-source export', () => {
  it('round-trips reachable code, control-flow labels, quoted data, and arbitrary bytes exactly', () => {
    const bytes = Uint8Array.from([
      0xa9, 0x22, 0x20, 0xee, 0xff, 0xd0, 0x02, 0x60, 0xea,
      0x60, 0x48, 0x69, 0x22, 0x5c, 0x00, 0xff,
    ]);
    const analysis = disassemble6502(bytes, 0x1900, 0x1900, '6502');
    const exported = createVerified6502AssemblySource(analysis, bytes, { 0x1909: 'finished' });

    expect(exported.verified).toBe(true);
    expect(exported.source).toContain('ORG &1900');
    expect(exported.source).toContain('.ENTRY');
    expect(exported.source).toContain('BNE finished');
    expect(exported.source).toContain('EQUB &48,&69,&22,&5C');
    expect(exported.verificationMessage).toContain('reassembled 16 bytes exactly');
  });

  it('round-trips 65C02-only instructions', () => {
    const bytes = Uint8Array.from([0x80, 0x01, 0xea, 0x60]);
    const analysis = disassemble6502(bytes, 0x4000, 0x4000, '65c02');
    expect(createVerified6502AssemblySource(analysis, bytes).verified).toBe(true);
  });

  it('refuses to claim verification for an unsupported processor', () => {
    const analysis = { ...disassemble6502(Uint8Array.of(0x60), 0x1900, 0x1900, '6502'), processor: 'arm2' as const };
    expect(createVerified6502AssemblySource(analysis, Uint8Array.of(0x60)).verified).toBe(false);
  });
});
