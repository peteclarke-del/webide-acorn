import { describe, expect, it } from 'vitest';
import {
  emptyAnalysisAnnotations,
  withComment,
  withEntryPoint,
  withIndirectTarget,
  withLabel,
  withRegion,
} from './analysisAnnotations';
import { disassemble6502 } from './disassembler6502';

const DIGEST = 'c'.repeat(64);
const ORIGIN = 0x1900;

/* A small program whose shape is exactly the case reachability cannot solve.
 *
 *   1900  LDA #&00        entry: reachable
 *   1902  JMP (&1910)     jumps through a pointer the bytes do not resolve
 *   1905  LDA #&42        only reachable if someone says where the jump goes
 *   1907  RTS
 *   1908  "HI"            text the reader knows is text
 *   190A  EA EA           bytes that decode as NOP but are a table
 *   190C  60              an entry the loader calls from outside the file
 */
const PROGRAM = Uint8Array.from([
  0xa9, 0x00,
  0x6c, 0x10, 0x19,
  0xa9, 0x42,
  0x60,
  0x48, 0x49,
  0xea, 0xea,
  0x60,
]);

const rowAt = (rows: ReturnType<typeof disassemble6502>['rows'], address: number) => rows.find((row) => row.address === address);

describe('disassembly with recorded annotations', () => {
  it('leaves a jump through a pointer unfollowed when nothing is recorded', () => {
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502');
    expect(rowAt(result.rows, 0x1902)?.mnemonic).toBe('JMP');
    /* &1905 is real code, but nothing in the bytes says so, so it is not
     * claimed as code. That is the honest answer, not a defect. */
    expect(rowAt(result.rows, 0x1905)?.kind).not.toBe('instruction');
  });

  it('follows a recorded indirect target and decodes what it reaches', () => {
    const annotations = withIndirectTarget(emptyAnalysisAnnotations(DIGEST), {
      from: 0x1902, targets: [0x1905], note: 'vector points at the loader tail',
    });
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    const row = rowAt(result.rows, 0x1905);
    expect(row?.kind).toBe('instruction');
    expect(row?.mnemonic).toBe('LDA');
    expect(row?.operand).toBe('#&42');
    expect(rowAt(result.rows, 0x1907)?.mnemonic).toBe('RTS');
    expect(rowAt(result.rows, 0x1902)?.comment).toContain('Recorded flow to');
  });

  it('names the recorded flow by the label of its destination when there is one', () => {
    let annotations = withIndirectTarget(emptyAnalysisAnnotations(DIGEST), { from: 0x1902, targets: [0x1905] });
    annotations = withLabel(annotations, 0x1905, 'loader_tail');
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(rowAt(result.rows, 0x1902)?.comment).toContain('Recorded flow to loader_tail');
  });

  it('decodes an extra entry point the loader would call from outside the file', () => {
    const annotations = withEntryPoint(emptyAnalysisAnnotations(DIGEST), 0x190c);
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    const row = rowAt(result.rows, 0x190c);
    expect(row?.kind).toBe('instruction');
    expect(row?.mnemonic).toBe('RTS');
    expect(result.labels[0x190c]).toBe('entry_190C');
  });

  it('warns rather than inventing a row when a recorded entry point is outside the file', () => {
    const annotations = withEntryPoint(emptyAnalysisAnnotations(DIGEST), 0x8000);
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(result.warnings.some((warning) => warning.includes('&8000') && warning.includes('outside'))).toBe(true);
    expect(result.rows.some((row) => row.address === 0x8000)).toBe(false);
  });

  it('shows a span marked as text as one text row carrying the note', () => {
    const annotations = withRegion(emptyAnalysisAnnotations(DIGEST), {
      start: 0x1908, end: 0x1909, kind: 'text', note: 'status line',
    });
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    const row = rowAt(result.rows, 0x1908);
    expect(row?.kind).toBe('text');
    expect(row?.operand).toBe('"HI"');
    expect(row?.comment).toBe('Marked as text: status line');
  });

  it('keeps bytes marked as data out of the decoder even when control reaches them', () => {
    /* Without the marking, an entry point at &190A decodes two NOPs. */
    const plain = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', withEntryPoint(emptyAnalysisAnnotations(DIGEST), 0x190a));
    expect(rowAt(plain.rows, 0x190a)?.mnemonic).toBe('NOP');

    let annotations = withEntryPoint(emptyAnalysisAnnotations(DIGEST), 0x190a);
    annotations = withRegion(annotations, { start: 0x190a, end: 0x190b, kind: 'data', note: 'dispatch table' });
    const marked = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    const row = rowAt(marked.rows, 0x190a);
    expect(row?.kind).toBe('bytes');
    expect(row?.bytes).toEqual([0xea, 0xea]);
    expect(row?.comment).toBe('Marked as data: dispatch table');
  });

  it('refuses to decode an instruction that would run into a span marked as data', () => {
    let annotations = emptyAnalysisAnnotations(DIGEST);
    annotations = withRegion(annotations, { start: 0x1901, end: 0x1901, kind: 'data' });
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(result.warnings.some((warning) => warning.includes('&1900') && warning.includes('marked as data'))).toBe(true);
    expect(rowAt(result.rows, 0x1900)?.kind).not.toBe('instruction');
  });

  it('lets a recorded label win over the generated one', () => {
    const annotations = withLabel(emptyAnalysisAnnotations(DIGEST), ORIGIN, 'game_start');
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(result.labels[ORIGIN]).toBe('game_start');
    expect(rowAt(result.rows, ORIGIN)?.label).toBe('game_start');
  });

  it('puts a recorded comment first and keeps the derived one after it', () => {
    const annotations = withComment(emptyAnalysisAnnotations(DIGEST), 0x1902, 'jumps via the OS vector');
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(rowAt(result.rows, 0x1902)?.comment?.startsWith('jumps via the OS vector')).toBe(true);
  });

  it('attaches a recorded comment to a data row as well as an instruction', () => {
    let annotations = withRegion(emptyAnalysisAnnotations(DIGEST), { start: 0x190a, end: 0x190b, kind: 'data' });
    annotations = withComment(annotations, 0x190a, 'two entries, low byte first');
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(rowAt(result.rows, 0x190a)?.comment).toBe('two entries, low byte first · Marked as data');
  });

  it('produces the same listing for the same annotations, so an analysis is reproducible', () => {
    let annotations = withEntryPoint(emptyAnalysisAnnotations(DIGEST), 0x190c);
    annotations = withIndirectTarget(annotations, { from: 0x1902, targets: [0x1905] });
    annotations = withRegion(annotations, { start: 0x1908, end: 0x1909, kind: 'text' });
    const first = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    const second = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('changes nothing when no annotations are supplied', () => {
    const withoutAnnotations = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502');
    const withEmpty = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', emptyAnalysisAnnotations(DIGEST));
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(withoutAnnotations));
  });

  it('counts bytes marked as data as data, not as code', () => {
    const annotations = withRegion(withEntryPoint(emptyAnalysisAnnotations(DIGEST), 0x190a), { start: 0x190a, end: 0x190b, kind: 'data' });
    const result = disassemble6502(PROGRAM, ORIGIN, ORIGIN, '6502', annotations);
    expect(result.codeByteCount + result.dataByteCount).toBe(PROGRAM.length);
    expect(result.rows.filter((row) => row.address >= 0x190a && row.address <= 0x190b).every((row) => row.kind !== 'instruction')).toBe(true);
  });
});
