// @vitest-environment node

/* Checked against a real ld65 debug file rather than one written to suit the
 * parser. `fixtures/cc65-debug-info.c` was compiled and linked by the pinned
 * toolchain — cc65 2.19-1, which reports itself as V2.18 — and the output kept
 * exactly as it came out, so what these contracts describe is what the product
 * will actually be handed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Cc65DebugInfoError,
  cFunctionFrames,
  hasTypeInformation,
  parseCc65DebugInfo,
} from './cc65DebugInfo';

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/cc65-debug-info.dbg', import.meta.url)), 'utf8');
const info = parseCc65DebugInfo(fixture);

describe('reading what ld65 recorded', () => {
  it('reads every record the file says it holds', () => {
    /* The file states its own record counts, so a parser that quietly dropped
     * a malformed record is caught by the file rather than by someone noticing
     * a missing variable much later. */
    expect(info.disagreements).toEqual([]);
    expect(info.counts.parsed).toMatchObject({ line: 307, sym: 15, scope: 3, seg: 8, span: 51, csym: 6, mod: 13, type: 1 });
    expect(info.version).toEqual({ major: 2, minor: 0 });
  });

  it('reports the one stated count that this toolchain does not mean as a record count', () => {
    /* `info` says file=517 and the file holds 18 file records. Enforcing that
     * one would fail every real build, so it is reported and not enforced —
     * which is a different thing from pretending the file agreed. */
    expect(info.counts.declared.file).toBe(517);
    expect(info.counts.parsed.file).toBe(18);
  });

  it('leaves no record kind unread without saying so', () => {
    expect(info.unreadKinds).toEqual([]);
  });

  it('reads a symbol with its address, size, segment and where it was defined', () => {
    const add = info.symbols.find((symbol) => symbol.name === '_add')!;
    expect(add).toMatchObject({ addrsize: 'absolute', size: 48, value: 0x1923, type: 'lab' });
    expect(add.referenceLines.length).toBeGreaterThan(0);
    const imported = info.symbols.find((symbol) => symbol.name === 'pusha')!;
    expect(imported.type).toBe('imp');
    expect(imported.value).toBeNull();
  });

  it('reads where each segment ended up, including one that reached no output file', () => {
    const code = info.segments.find((segment) => segment.name === 'CODE')!;
    expect(code).toMatchObject({ start: 0x1923, size: 0xee, outputName: 'out.bin', outputOffset: 35 });
    const bss = info.segments.find((segment) => segment.name === 'BSS')!;
    expect(bss.outputName).toBeNull();
    expect(bss.outputOffset).toBeNull();
  });
});

describe('what the file says about C', () => {
  it('says plainly that this toolchain records no type information', () => {
    /* One type record, `val="00"`, with every C symbol pointing at it. A build
     * that decoded a type from this would be inventing it. */
    expect(info.types).toEqual([{ id: 0, encoded: '00' }]);
    expect(info.cSymbols.every((symbol) => symbol.type === 0)).toBe(true);
    expect(hasTypeInformation(info)).toBe(false);
  });

  it('gives each function its locals with exact storage classes and frame offsets', () => {
    const frames = cFunctionFrames(info);
    expect(frames.map((frame) => frame.function)).toEqual(['add', 'main']);
    const add = frames.find((frame) => frame.function === 'add')!;
    expect(add.address).toBe(0x1923);
    expect(add.size).toBe(48);
    expect(add.entries).toEqual([
      { name: 'add', storage: 'ext', offset: null, address: 0x1923 },
      { name: 'a', storage: 'auto', offset: 1, address: null },
      { name: 'b', storage: 'auto', offset: null, address: null },
      { name: 'local', storage: 'auto', offset: -2, address: null },
    ]);
    const main = frames.find((frame) => frame.function === 'main')!;
    expect(main.entries.map((entry) => entry.name)).toEqual(['main', 'p']);
    expect(main.entries.find((entry) => entry.name === 'p')!.offset).toBe(-3);
  });

});

describe('what the reader refuses', () => {
  it('refuses a file that is not one', () => {
    expect(() => parseCc65DebugInfo('this is not a debug file\n')).toThrow(Cc65DebugInfoError);
    expect(() => parseCc65DebugInfo('sym\tid=0,name="x",addrsize=absolute,type=lab\n')).toThrow(/no version record/);
  });

  it('refuses a file whose own stated counts do not match what came out of it', () => {
    /* The check that makes the completeness claim mean something: drop one
     * record and the file itself is what notices. */
    const damaged = fixture.split('\n').filter((line, index) => !(line.startsWith('sym\t') && index % 2 === 0)).join('\n');
    expect(() => parseCc65DebugInfo(damaged)).toThrow(/says it holds 15 sym records/);
  });

  it('refuses a record whose fields are malformed rather than reading half of it', () => {
    expect(() => parseCc65DebugInfo('version\tmajor=2,minor=0\nseg\tid=0,name="unclosed\n')).toThrow(/never closed/);
    expect(() => parseCc65DebugInfo('version\tmajor=2,minor=0\nspan\tid=0,seg=0\n')).toThrow(/missing its start/);
  });
});
