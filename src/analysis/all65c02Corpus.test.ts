// @vitest-environment node

/*
 * The disassembler against an exhaustive corpus the assembler produced.
 *
 * This is the processor-specific contract ANL-310 asks for: real bytes for
 * every valid opcode, decoded by the table the product ships, checked against
 * the mnemonic the assembler's own source names — so nothing in the answer
 * comes from the thing being tested.
 */
import { describe, expect, it } from 'vitest';
import { opcodeTable } from './disassembler6502';
import { ALL_65C02_BYTES, ALL_65C02_OPCODES, ALL_65C02_PROVENANCE } from './all65c02Corpus';

const bytes = Uint8Array.from(ALL_65C02_BYTES.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));

describe('every 65C02 opcode the assembler can produce', () => {
  it('decodes the whole image without meeting a byte it does not know', () => {
    /* Walked as a stream rather than opcode by opcode, so a wrong instruction
     * length shows up as the next decode landing on an operand. */
    const table = opcodeTable('65c02');
    const decoded: Array<[number, string]> = [];
    let index = 0;
    while (index < bytes.length) {
      const opcode = table[bytes[index]!];
      expect(opcode, `byte &${bytes[index]!.toString(16).toUpperCase()} at offset ${index}`).toBeDefined();
      decoded.push([bytes[index]!, opcode!.mnemonic]);
      index += opcode!.size;
    }
    /* Landing exactly on the end is the check that every length was right. */
    expect(index).toBe(bytes.length);
    expect(decoded).toEqual(ALL_65C02_OPCODES);
  });

  it('covers the CMOS instructions the NMOS part does not have', () => {
    /* Otherwise the corpus could pass against the 6502 table and prove
     * nothing about the 65C02 one. */
    const nmos = opcodeTable('6502');
    const cmosOnly = ALL_65C02_OPCODES.filter(([opcode]) => nmos[opcode] === undefined);
    expect(cmosOnly.length).toBeGreaterThan(20);
    for (const mnemonic of ['TSB', 'TRB', 'STZ', 'PHX', 'PHY', 'PLX', 'PLY', 'BRA']) {
      expect(cmosOnly.map(([, name]) => name), mnemonic).toContain(mnemonic);
    }
  });

  it('is refused by the NMOS table, which is what makes the two tables different', () => {
    /* A 6502 does not have these opcodes, and decoding them there would
     * disassemble a Master program as though it ran on a Model B. */
    const nmos = opcodeTable('6502');
    expect(nmos[0x80]).toBeUndefined();
    expect(nmos[0x64]).toBeUndefined();
    expect(opcodeTable('65c02')[0x80]?.mnemonic).toBe('BRA');
  });

  it('does not decode the Rockwell bit operations either table leaves out', () => {
    /* The parts Acorn shipped do not have them, so decoding them would invent
     * instructions for a machine that cannot run them. */
    for (const opcode of [0x07, 0x17, 0x47, 0x0f, 0x8f]) {
      expect(opcodeTable('65c02')[opcode], `&${opcode.toString(16)}`).toBeUndefined();
    }
  });

  it('says where the corpus came from, so it can be produced again', () => {
    expect(ALL_65C02_PROVENANCE.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ALL_65C02_PROVENANCE.source).toContain('all65C02');
  });
});
