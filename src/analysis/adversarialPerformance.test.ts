// @vitest-environment node

/* Inputs chosen to be the worst case for each reader, not the average one.
 *
 * The property tests already prove these readers either parse random bytes or
 * refuse them. That says nothing about what they cost. A reader that is correct
 * on every input and quadratic on one of them still hangs the analysis worker,
 * and the worker's twenty-second ceiling turns that into a refusal rather than
 * a crash — which is the right behaviour and the wrong outcome, because the
 * person gets nothing.
 *
 * So each case here is built to be pathological in a specific, named way, and
 * two things are asserted about it. The first is that the reader did the work:
 * a case that quietly produced nothing would pass a timing check while proving
 * nothing at all. The second is a wall-clock ceiling, set generously — this
 * catches an input that costs a hundred times what it should, not one that
 * costs twice as much on a slow machine.
 */
import { describe, expect, it, vi } from 'vitest';
import { compareArtifacts, searchArtifact } from './artifactInspector';
import { decodeTokenizedBasic, decodePlainText, isProbablyText } from './bbcBasic';
import { disassemble6502 } from './disassembler6502';
import { disassembleArm } from './disassemblerArm';
import { parseAdfsCatalogue } from '../media/adfsCatalogue';
import { parseDfsCatalogue } from '../media/dfsCatalogue';

/*
 * What these tests are for is an input that costs orders of magnitude more than
 * it should — a reader that goes quadratic on a pathological file. What they
 * are not for is measuring the machine they run on, and a fixed millisecond
 * ceiling does exactly that: four seconds is generous on an idle box and not
 * generous on a shared runner building four other things, where this failed a
 * gate on a green tree.
 *
 * So the budget is calibrated against the machine. A fixed, neutral piece of
 * arithmetic is timed three times and the fastest run is taken, because the
 * fastest is the one least disturbed by whatever else is happening. A machine
 * twice as slow gets twice the budget; a reader that has become quadratic still
 * exceeds it by orders of magnitude.
 *
 * The bounds matter as much as the multiple. The floor stops a very fast
 * machine producing a budget that ordinary scheduling noise would fail, and the
 * ceiling keeps the budget below the timeout the test itself has, so that a
 * slow reader fails on the budget with a number in the message rather than on a
 * timeout with none.
 */
const CALIBRATION_MS = (() => {
  let fastest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    let sum = 0;
    for (let index = 0; index < 3_000_000; index += 1) sum = (sum + index * 31) >>> 0;
    if (sum === -1) throw new Error('unreachable'); /* read, so nothing is optimised away */
    fastest = Math.min(fastest, performance.now() - started);
  }
  return Math.max(fastest, 0.5);
})();

/* Four hundred, because the slowest of these readers legitimately costs about
 * two hundred times the calibration on an idle machine and the budget has to
 * leave room above that rather than sit on it. Twenty seconds is the cap, well
 * inside the timeout below, and four seconds the floor, which is what the fixed
 * ceiling used to be. */
const CEILING_MS = Math.min(20_000, Math.max(4_000, CALIBRATION_MS * 400));

/* Room for the budget to be what fails, rather than the timeout around it. */
vi.setConfig({ testTimeout: 30_000 });

function timed<T>(work: () => T): { value: T; durationMs: number } {
  const started = performance.now();
  const value = work();
  return { value, durationMs: performance.now() - started };
}

/** 64 KiB: the whole of a 6502 address space, and a realistic worst case. */
const BANK = 64 * 1024;

describe('the 6502 reader against its worst inputs', () => {
  it('handles a bank of the same one-byte instruction', () => {
    /* &EA is NOP: 65,536 instructions, one per byte, the largest listing this
     * reader can be asked to produce for a 6502 machine. */
    const { value, durationMs } = timed(() => disassemble6502(new Uint8Array(BANK).fill(0xea), 0, 0, '6502'));
    expect(value.rows.length).toBeGreaterThan(60000);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles a bank of nothing but calls, which is the worst case for its label map', () => {
    /* &20 is JSR: every instruction names a target, so the label map is asked
     * to hold a fifth of the address space and every row has to look one up. */
    const bytes = new Uint8Array(BANK);
    for (let offset = 0; offset < bytes.length; offset += 3) {
      bytes[offset] = 0x20;
      bytes[offset + 1] = offset & 0xff;
      bytes[offset + 2] = (offset >> 8) & 0xff;
    }
    const { value, durationMs } = timed(() => disassemble6502(bytes, 0, 0, '6502'));
    expect(value.rows.length).toBeGreaterThan(20000);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles a bank of undefined opcodes, where nothing decodes and everything is a warning', () => {
    /* Undefined on a plain 6502, so the reader takes its unknown-byte path for
     * every single byte rather than its decode path. */
    const { value, durationMs } = timed(() => disassemble6502(new Uint8Array(BANK).fill(0xff), 0, 0, '6502'));
    expect(value.rows.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles a bank of branches that all land on the same byte', () => {
    /* &F0 is BEQ with a relative operand. Every branch resolves to a target,
     * and a great many of them resolve to the same one. */
    const bytes = new Uint8Array(BANK);
    for (let offset = 0; offset < bytes.length; offset += 2) { bytes[offset] = 0xf0; bytes[offset + 1] = 0xfe; }
    const { value, durationMs } = timed(() => disassemble6502(bytes, 0x1900, 0x1900, '6502'));
    expect(value.rows.length).toBeGreaterThan(20000);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });
});

/* An ARM branch is `cond 101 L offset`, where the offset is the distance from
 * two instructions past this one, in words. Built here rather than described,
 * so the cases below are branches the reader really decodes. */
function armBranch(condition: number, at: number, target: number): number {
  const offset = ((target - (at + 8)) >> 2) & 0x00ffffff;
  return (((condition << 28) | 0x0a000000) >>> 0) | offset;
}

function armWords(words: number[]): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  words.forEach((word, index) => {
    const offset = index * 4;
    bytes[offset] = word & 0xff;
    bytes[offset + 1] = (word >>> 8) & 0xff;
    bytes[offset + 2] = (word >>> 16) & 0xff;
    bytes[offset + 3] = (word >>> 24) & 0xff;
  });
  return bytes;
}

describe('the ARM reader against its worst inputs', () => {
  const ORIGIN = 0x8000;

  it('handles a chain of branches that each reach a different word', () => {
    /* Every word decodes and every one names a target nothing else names, so
     * the queue and the reference map are both asked to hold one entry per
     * instruction — the largest either can be made to be for a given size. */
    const words = 48 * 1024;
    const bytes = armWords(Array.from({ length: words }, (_, index) =>
      armBranch(14, ORIGIN + index * 4, ORIGIN + Math.min(index + 2, words - 1) * 4)));
    const { value, durationMs } = timed(() => disassembleArm(bytes, ORIGIN, ORIGIN, 'arm2'));
    expect(value.rows.filter((row) => row.kind === 'instruction').length).toBeGreaterThan(words / 4);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles a run of conditional branches that all name the same word', () => {
    /* A conditional branch does not end the run, so every one of these decodes
     * and every one records a reference to the same address. That is the worst
     * case for however the reader accumulates references against a target. */
    const words = 32 * 1024;
    const bytes = armWords(Array.from({ length: words }, (_, index) => armBranch(0, ORIGIN + index * 4, ORIGIN)));
    const { value, durationMs } = timed(() => disassembleArm(bytes, ORIGIN, ORIGIN, 'arm2'));
    expect(value.rows.filter((row) => row.kind === 'instruction').length).toBe(words);
    expect(value.rows[0]!.references.length).toBe(words);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles words that decode to nothing this reader knows', () => {
    const bytes = new Uint8Array(64 * 1024 * 4).fill(0xf7);
    const { value, durationMs } = timed(() => disassembleArm(bytes, 0x8000, 0x8000, 'arm2'));
    expect(value.rows.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });
});

describe('the byte inspector against its worst inputs', () => {
  it('handles a pattern that matches at every single offset', () => {
    /* The largest result set a search can produce, and the case where the cap
     * on retained matches has to hold while the true total keeps counting. */
    const { value, durationMs } = timed(() => searchArtifact(new Uint8Array(BANK), '00', 'hex'));
    expect(value.total).toBe(BANK);
    expect(value.offsets.length).toBeLessThanOrEqual(10_000);
    expect(value.truncated).toBe(true);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles the near-miss pattern that is the classic worst case for a plain scan', () => {
    /* A haystack of one repeated byte and a needle that agrees with it for its
     * whole length but the last byte: every offset is compared for the length
     * of the pattern and every one of them fails at the end. */
    const haystack = new Uint8Array(BANK).fill(0x61);
    const needle = `${'61'.repeat(255)}62`;
    const { value, durationMs } = timed(() => searchArtifact(haystack, needle, 'hex'));
    expect(value.total).toBe(0);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles two images that differ at every byte', () => {
    const left = new Uint8Array(BANK).fill(0x00);
    const right = new Uint8Array(BANK).fill(0xff);
    const { value, durationMs } = timed(() => compareArtifacts(left, right));
    expect(value.changed).toBe(BANK);
    expect(value.differences.length).toBeLessThanOrEqual(512);
    expect(value.truncated).toBe(true);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles a comparison where one image is entirely additional', () => {
    const { value, durationMs } = timed(() => compareArtifacts(new Uint8Array(), new Uint8Array(BANK).fill(0x41)));
    expect(value.added).toBe(BANK);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });
});

describe('the BASIC readers against their worst inputs', () => {
  it('handles a program made of the shortest possible lines', () => {
    /* The most lines a tokenised program of a given size can hold, so the most
     * work per byte the line reader can be given. */
    const parts: number[] = [];
    /* Five bytes is the shortest line this format can express: the carriage
     * return, two bytes of line number, the length, and one byte of body. */
    for (let line = 1; line <= 20000; line += 1) {
      parts.push(0x0d, (line >> 8) & 0xff, line & 0xff, 5, 0x20);
    }
    parts.push(0x0d, 0xff);
    const { value, durationMs } = timed(() => decodeTokenizedBasic(Uint8Array.from(parts)));
    expect(value?.lines.length).toBe(20000);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('refuses a line claiming a length the file does not have, without scanning for it', () => {
    /* A declared length far beyond the file. The reader must decide from what
     * it has rather than search the rest of the buffer for a terminator. */
    const bytes = new Uint8Array(BANK);
    bytes[0] = 0x0d; bytes[1] = 0x00; bytes[2] = 0x0a; bytes[3] = 0xff;
    const { durationMs } = timed(() => decodeTokenizedBasic(bytes));
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('handles a large plain-text file', () => {
    const text = new TextEncoder().encode('10 PRINT "HELLO"\n'.repeat(20000));
    const { value, durationMs } = timed(() => { isProbablyText(text); return decodePlainText(text); });
    expect(value.length).toBeGreaterThan(300000);
    expect(durationMs).toBeLessThan(CEILING_MS);
  });
});

describe('the media readers against their worst inputs', () => {
  it('refuses a disc image that is nothing but plausible-looking noise, quickly', () => {
    /* Not random: bytes chosen to keep looking like the start of a catalogue
     * for as long as the reader will let them. */
    const image = new Uint8Array(800 * 1024).fill(0x0d);
    const { durationMs } = timed(() => { try { parseAdfsCatalogue(image); } catch { /* refusing is the expected outcome */ } });
    expect(durationMs).toBeLessThan(CEILING_MS);
  });

  it('refuses a DFS catalogue of maximum declared size without walking the whole disc', () => {
    const image = new Uint8Array(200 * 1024).fill(0xff);
    const { durationMs } = timed(() => { try { parseDfsCatalogue(image); } catch { /* refusing is the expected outcome */ } });
    expect(durationMs).toBeLessThan(CEILING_MS);
  });
});
