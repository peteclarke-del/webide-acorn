import { describe, expect, it } from 'vitest';
import { assemble6502 } from './assembler6502';

describe('6502 assembler adapter', () => {
  it('assembles labels, branches, MOS calls and data with a source map', () => {
    const result = assemble6502(`ORG &1900\n.start\n LDX #0\n.loop\n LDA message,X\n BEQ done\n JSR OSWRCH\n INX\n BNE loop\n.done\n BRK\n.message\n EQUS "HI"\n EQUB 13,0`);
    expect(result.diagnostics).toEqual([]);
    expect(result.origin).toBe(0x1900);
    expect(result.entryPoint).toBe(0x1900);
    expect(result.symbols.LOOP).toBe(0x1902);
    expect(result.bytes[0]).toBe(0xa2);
    expect(result.bytes).toContain(0x20);
    expect(result.sourceMap[0x1900]).toBe(3);
  });

  it('reports unknown symbols and out-of-range branches', () => {
    const result = assemble6502(`ORG &1000\n BNE &2000\n LDA missing`);
    expect(result.diagnostics.map((item) => item.message).join(' ')).toMatch(/out of range/);
    expect(result.diagnostics.map((item) => item.message).join(' ')).toMatch(/Unknown/);
  });

  it('rejects 65C02-only instructions for NMOS and accepts them for CMOS', () => {
    expect(assemble6502('BRA &1900', '6502').diagnostics[0]?.message).toMatch(/does not support/);
    expect(assemble6502('BRA &1900', '65c02').diagnostics).toEqual([]);
  });

  it('selects the low and high byte of a 16-bit label or expression', () => {
    const result = assemble6502(`ORG &1234\n.table\nEQUB 0\n.start\nLDA #<table\nLDX #>table\nSTA &70\nSTX &71\nEQUB <table + 2, >table\nRTS`);
    expect(result.diagnostics).toEqual([]);
    expect(result.symbols.TABLE).toBe(0x1234);
    // A9 34, A2 12, 85 70, 86 71, then EQUB &36,&12, then RTS.
    expect(Array.from(result.bytes)).toEqual([0x00, 0xa9, 0x34, 0xa2, 0x12, 0x85, 0x70, 0x86, 0x71, 0x36, 0x12, 0x60]);
  });

  it('rejects a byte selector that has no resolvable operand', () => {
    expect(assemble6502('ORG &1900\nLDA #<missing').diagnostics[0]?.message).toMatch(/Unknown or invalid expression/);
  });

  it('reserves uninitialised space with SKIP without emitting or padding bytes', () => {
    const result = assemble6502(`ORG &1900\n.start\nLDA buffer\nRTS\n.buffer\nSKIP 16\n.after\nEQUB &AA`);
    expect(result.diagnostics).toEqual([]);
    expect(result.symbols.BUFFER).toBe(0x1904);
    expect(result.symbols.AFTER).toBe(0x1914);
    expect(result.bytes).toHaveLength(0x15);
    expect(Array.from(result.bytes.slice(0, 4))).toEqual([0xad, 0x04, 0x19, 0x60]);
    // Reserved bytes are left as zero and the final EQUB lands after them.
    expect(Array.from(result.bytes.slice(4, 20))).toEqual(Array(16).fill(0));
    expect(result.bytes[0x14]).toBe(0xaa);
  });

  it('does not pad the binary for a trailing reservation', () => {
    const result = assemble6502(`ORG &1900\n.start\nRTS\n.scratch\nSKIP 256`);
    expect(result.diagnostics).toEqual([]);
    expect(result.symbols.SCRATCH).toBe(0x1901);
    expect(result.bytes).toHaveLength(1);
  });

  it('rejects a reservation that is not a resolvable constant', () => {
    expect(assemble6502('ORG &1900\nSKIP later\n.later\nRTS').diagnostics[0]?.message).toMatch(/SKIP requires a constant/);
  });

  it('assembles a sideways-RAM loader with indexed payload copy and cross-region jump', () => {
    const source = `ORG &1900\n.start\nLDA #3\nSTA &FE30\nLDX #0\n.copy\nLDA payload,X\nSTA &8000,X\nINX\nCPX #7\nBNE copy\nJMP &8000\n.done\nJMP done\n.payload\nINX\nSTX &2000\nJMP done`;
    const result = assemble6502(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.symbols.DONE).toBe(0x1915);
    expect(result.symbols.PAYLOAD).toBe(0x1918);
    expect(Array.from(result.bytes.slice(-7))).toEqual([0xe8, 0x8e, 0x00, 0x20, 0x4c, 0x15, 0x19]);
  });
});

describe('symbolic constants', () => {
  /* BeebAsm accepts `NAME = expr` and real Acorn source is full of them, so
   * until this was added a project imported from a BeebAsm tree assembled
   * everywhere except here. */
  it('defines a constant and uses it as an address and as an immediate', () => {
    const artifact = assemble6502([
      'screen = &7C00',
      'space = 32',
      'ORG &1900',
      '.start',
      '  LDA #space',
      '  STA screen',
      '  RTS',
    ].join('\n'));
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.symbols.SCREEN).toBe(0x7c00);
    expect(artifact.symbols.SPACE).toBe(32);
    expect(Array.from(artifact.bytes)).toEqual([0xa9, 32, 0x8d, 0x00, 0x7c, 0x60]);
  });

  it('evaluates an expression built from constants already defined', () => {
    const artifact = assemble6502([
      'base = &70',
      'pointer = base + 2',
      'ORG &1900',
      '  LDA pointer',
      '  RTS',
    ].join('\n'));
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.symbols.POINTER).toBe(0x72);
  });

  it('accepts a known address restated at the value it already has', () => {
    /* Almost every listing opens by writing out the MOS calls it uses, and
     * this assembler already knows them. Agreeing is not an error. */
    const artifact = assemble6502(['OSWRCH = &FFEE', 'ORG &1900', '  JSR OSWRCH', '  RTS'].join('\n'));
    expect(artifact.diagnostics).toEqual([]);
    expect(Array.from(artifact.bytes)).toEqual([0x20, 0xee, 0xff, 0x60]);
  });

  it('reports a reassignment that disagrees, naming both values', () => {
    const artifact = assemble6502(['OSWRCH = &FFC0', 'ORG &1900', '  RTS'].join('\n'));
    expect(artifact.diagnostics).toHaveLength(1);
    expect(artifact.diagnostics[0]!.message).toContain('already');
    expect(artifact.diagnostics[0]!.message).toContain('&FFC0');
  });

  it('reports a constant that depends on something not yet known, rather than resolving it to zero', () => {
    const artifact = assemble6502(['pointer = later + 1', 'ORG &1900', '.later', '  RTS'].join('\n'));
    expect(artifact.diagnostics).toHaveLength(1);
    expect(artifact.diagnostics[0]!.message).toContain('cannot be evaluated here');
    expect(artifact.diagnostics[0]!.line).toBe(1);
  });

  it('refuses a value that is not a 16-bit quantity', () => {
    const artifact = assemble6502(['big = &1FFFF', 'ORG &1900', '  RTS'].join('\n'));
    expect(artifact.diagnostics[0]!.message).toContain('not a 16-bit value');
  });

  it('does not mistake an instruction or an origin for a constant', () => {
    const artifact = assemble6502(['* = &2000', '  LDA #1', '  RTS'].join('\n'));
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.origin).toBe(0x2000);
  });
});
