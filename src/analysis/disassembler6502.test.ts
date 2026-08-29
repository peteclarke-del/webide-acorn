import { describe, expect, it } from 'vitest';
import { disassemble6502 } from './disassembler6502';

describe('flow-aware Acorn 6502 disassembler', () => {
  it('follows calls, names routines, annotates MOS calls and leaves data as data', () => {
    const bytes = Uint8Array.from([
      0xa9, 0x16, 0x20, 0xee, 0xff, 0x20, 0x09, 0x19, 0x60,
      0xa9, 0x41, 0x20, 0xee, 0xff, 0x60,
      0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x00,
    ]);
    const result = disassemble6502(bytes, 0x1900, 0x1900, '6502');

    expect(result.rows.find((row) => row.address === 0x1902)?.operand).toBe('OSWRCH');
    expect(result.rows.find((row) => row.address === 0x1902)?.comment).toContain('VDU 22');
    expect(result.labels[0x1909]).toBe('write_character_1909');
    expect(result.rows.find((row) => row.address === 0x190f)?.kind).toBe('text');
    expect(result.codeByteCount).toBe(15);
  });

  it('supports Master 65C12 instructions without inventing them for NMOS 6502', () => {
    const bytes = Uint8Array.from([0x80, 0xfe]);
    expect(disassemble6502(bytes, 0x2000, 0x2000, '65c02').rows[0]?.mnemonic).toBe('BRA');
    expect(disassemble6502(bytes, 0x2000, 0x2000, '6502').rows[0]?.mnemonic).toBe('EQUB');
  });

  it('does not decode bytes after an unconditional return as executable code', () => {
    const result = disassemble6502(Uint8Array.from([0x60, 0xa9, 0x01]), 0x3000, 0x3000, '6502');
    expect(result.rows[0]?.mnemonic).toBe('RTS');
    expect(result.rows[1]?.kind).toBe('bytes');
    expect(result.dataByteCount).toBe(2);
  });
});
