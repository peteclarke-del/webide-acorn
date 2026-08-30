import { describe, expect, it } from 'vitest';
import { decodeArmWord, disassembleArm } from './disassemblerArm';

describe('ARM2/ARM3 disassembler', () => {
  it('decodes a real little-endian ARM2 build with control-flow labels and references', () => {
    const bytes = Uint8Array.from([0x01, 0x00, 0xa0, 0xe3, 0x02, 0x10, 0xa0, 0xe3, 0x01, 0x00, 0x80, 0xe0, 0xfd, 0xff, 0xff, 0xea]);
    const result = disassembleArm(bytes, 0x8000, 0x8000, 'arm2');
    expect(result).toMatchObject({ processor: 'arm2', codeByteCount: 16, dataByteCount: 0, warnings: [] });
    expect(result.rows.map((row) => [row.address, row.mnemonic, row.operand])).toEqual([
      [0x8000, 'MOV', 'R0, #&01'],
      [0x8004, 'MOV', 'R1, #&02'],
      [0x8008, 'ADD', 'R0, R0, R1'],
      [0x800c, 'B', 'loop_00008008'],
    ]);
    expect(result.labels[0x8008]).toBe('loop_00008008');
    expect(result.rows[2]?.references).toEqual([0x800c]);
  });

  it('decodes conditions, rotated immediates, register lists, coprocessors and named RISC OS SWIs', () => {
    expect(decodeArmWord(0x12800001, 0x8000, 'arm2')).toMatchObject({ mnemonic: 'ADDNE', operand: 'R0, R0, #&01' });
    expect(decodeArmWord(0xe3a004ff, 0x8000, 'arm2')).toMatchObject({ mnemonic: 'MOV', operand: 'R0, #&FF000000' });
    expect(decodeArmWord(0xe8bd800f, 0x8000, 'arm2')).toMatchObject({ mnemonic: 'LDMIA', operand: 'SP!, {R0-R3,PC}', flow: 'stop' });
    expect(decodeArmWord(0xef000003, 0x8000, 'arm2')).toMatchObject({ mnemonic: 'SWI', operand: 'OS_NewLine', comment: 'RISC OS OS_NewLine' });
    expect(decodeArmWord(0xee100f10, 0x8000, 'arm3').mnemonic).toBe('MRC');
    expect(decodeArmWord(0xe10f0000, 0x8000, 'arm3')).toMatchObject({ mnemonic: 'MRS', operand: 'R0, CPSR' });
    expect(decodeArmWord(0xe129f000, 0x8000, 'arm3')).toMatchObject({ mnemonic: 'MSR', operand: 'CPSR_cf, R0' });
  });

  it('keeps unreachable words and incomplete trailing bytes as explicit data', () => {
    const bytes = Uint8Array.from([0xfe, 0xff, 0xff, 0xea, 0x01, 0x00, 0xa0, 0xe3, 0xaa]);
    const result = disassembleArm(bytes, 0x8000, 0x8000, 'arm2');
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: 0x8004, kind: 'bytes', mnemonic: 'EQUD', reachable: false }),
      expect.objectContaining({ address: 0x8008, kind: 'bytes', mnemonic: 'EQUB', operand: '&AA' }),
    ]));
    expect(result.warnings[0]).toContain('trailing byte');
  });
});
