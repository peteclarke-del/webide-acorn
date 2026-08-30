import { describe, expect, it } from 'vitest';
import {
  analyseFile,
  inferAcornAddresses,
  logical6502Address,
  metadataForHostFile,
  parseHexAddress,
  parseInfSidecar,
} from './fileAnalysis';

describe('file analysis routing', () => {
  it('recognises a numbered plain-text BASIC listing', () => {
    const bytes = new TextEncoder().encode('10 MODE 7\r20 PRINT "HELLO"\r');
    const result = analyseFile(bytes, 'MENU', { origin: 0x1900, entryPoint: 0x1900, processor: '6502' });
    expect(result.kind).toBe('bbc-basic');
    if (result.kind === 'bbc-basic') {
      expect(result.lines[1]?.lineNumber).toBe(20);
      expect(result).toMatchObject({ dialect: 'BBC BASIC II', encoding: 'plain-text' });
      expect(result.lines.map((line) => line.offset)).toEqual([0, 10]);
    }
  });

  it('analyses Atom numbered text as its own dialect with labels and control-flow targets', () => {
    const bytes = new TextEncoder().encode("10aPRINT \"ATOM\"'\n20 GOSUB a\n30 END\n");
    const result = analyseFile(bytes, 'GAME.bas', { origin: 0x2900, entryPoint: 0x2900, processor: '6502', basicDialect: 'atom-basic' });
    expect(result.kind).toBe('bbc-basic');
    if (result.kind === 'bbc-basic') {
      expect(result).toMatchObject({ dialect: 'Atom BASIC', encoding: 'atom-text' });
      expect(result.lines[0]).toMatchObject({ lineNumber: 10, label: 'a', source: "PRINT \"ATOM\"'" });
      expect(result.lines[1]?.references).toEqual(['a']);
      expect(result.warnings[0]).toContain('no BBC keyword tokens');
    }
  });

  it('infers common load/execute suffixes without confusing RISC OS filetypes', () => {
    expect(inferAcornAddresses('CODE,1900-1A20')).toEqual({ origin: 0x1900, entryPoint: 0x1a20 });
    expect(inferAcornAddresses('!RunImage,ff8')).toBeNull();
  });

  it('parses Acorn and conventional hexadecimal addresses safely', () => {
    expect(parseHexAddress('&8000')).toBe(0x8000);
    expect(parseHexAddress('0xFFEE')).toBe(0xffee);
    expect(parseHexAddress('80000')).toBeNull();
    expect(parseHexAddress('&00008000', 8)).toBe(0x8000);
  });

  it('routes binary input to the selected ARM analyser without truncating 26-bit addresses', () => {
    const bytes = Uint8Array.from([0x01, 0x00, 0xa0, 0xe3, 0xfe, 0xff, 0xff, 0xea]);
    const result = analyseFile(bytes, 'RunImage', { origin: 0x10000, entryPoint: 0x10000, processor: 'arm2' });
    expect(result).toMatchObject({ kind: 'machine-code', processor: 'arm2', origin: 0x10000, codeByteCount: 8 });
  });

  it('parses quoted .inf metadata including length and lock state', () => {
    expect(parseInfSidecar('"R.MY GAME" FFFF1900 FFFF8023 00000007 Locked\n', 'GAME.inf')).toEqual({
      source: 'sidecar', catalogueName: 'MY GAME', load: 0xffff1900,
      execute: 0xffff8023, declaredLength: 7, locked: true,
      sidecarName: 'GAME.inf', warnings: [],
    });
    expect(logical6502Address(0xffff1900, 0)).toBe(0x1900);
  });

  it('gives a selected sidecar precedence and reports filename conflicts', () => {
    const metadata = metadataForHostFile('CODE,1900-1900', {
      name: 'CODE,1900-1900.inf', text: '$.CODE FFFF2000 FFFF2003 Locked',
    });
    expect(metadata.source).toBe('sidecar');
    expect(metadata.load).toBe(0xffff2000);
    expect(metadata.warnings[0]).toContain('takes precedence');
  });

  it('retains filename metadata when a sidecar is malformed', () => {
    const metadata = metadataForHostFile('CODE,1900-1900', { name: 'CODE.inf', text: 'not metadata' });
    expect(metadata.source).toBe('filename');
    expect(metadata.warnings[0]).toContain('malformed');
  });

  it('uses embedded container metadata ahead of filename hints and an explicit sidecar ahead of both', () => {
    const container = { source: 'container' as const, catalogueName: 'ATMFILE', load: 0x2900, execute: 0x2905, declaredLength: 8, containerFormat: 'Atom ATM' as const, containerByteLength: 30, warnings: [] };
    const embedded = metadataForHostFile('GAME,3000-3000', undefined, container);
    expect(embedded).toMatchObject({ source: 'container', load: 0x2900, execute: 0x2905, containerFormat: 'Atom ATM' });
    expect(embedded.warnings[0]).toContain('container metadata takes precedence');
    const sidecar = metadataForHostFile('GAME,3000-3000', { name: 'GAME.inf', text: '$.GAME 3100 3103 8' }, container);
    expect(sidecar).toMatchObject({ source: 'sidecar', load: 0x3100, execute: 0x3103, containerFormat: 'Atom ATM', containerByteLength: 30 });
    expect(sidecar.warnings[0]).toContain('Sidecar and container addresses disagree');
  });
});
