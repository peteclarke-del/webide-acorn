// @vitest-environment node

/* The assertion runtime, proved by running it.
 *
 * Generated assembly that nobody executes is assembly nobody should trust, and
 * this build refuses to ship that. So the routine below is assembled with the
 * product's own assembler, executed on its own 6502, and the block it leaves in
 * memory is read back by the same reader the host uses. A mistake in the
 * pointer arithmetic or a branch is a failing test rather than a plausible
 * listing.
 */
import { describe, expect, it } from 'vitest';
import { assemble6502 } from '../build/assembler6502';
import { Cpu6502Runtime } from '../runtime/cpu6502';
import {
  assertionRuntimeSource, bytesForCapacity, capacityForBytes, HEADER_BYTES,
  LAYOUT_VERSION, MAXIMUM_RECORDS, RECORD_BYTES, readNativeAssertions, SIGNATURE,
} from './nativeAssertions';

/** Assemble a program that uses the runtime, run it, and read its block back. */
function runProgram(body: string[], capacity = 8) {
  const source = [
    'ORG &2000',
    '.start',
    '  JSR assert_init',
    ...body,
    '.done',
    '  RTS',
    '',
    assertionRuntimeSource('6502', { block: 'results', capacity, zeroPage: 0x70 }),
  ].join('\n');
  const artifact = assemble6502(source);
  const errors = artifact.diagnostics.filter((item) => item.severity === 'error');
  expect(errors, errors.map((item) => `${item.line}: ${item.message}`).join('; ')).toEqual([]);

  const cpu = new Cpu6502Runtime('6502');
  cpu.load(artifact);
  /* The program ends in RTS with nothing beneath it, so a budget rather than a
   * stop address is what bounds the run. */
  cpu.run(200_000);

  /* The assembler folds labels to upper case, so the host looks the block up
   * by the name it will actually find. */
  const block = artifact.symbols.RESULTS;
  expect(block, 'the generated block must be a label the host can find').toBeTypeOf('number');
  const bytes = Array.from(cpu.memory.slice(block!, block! + bytesForCapacity(capacity)));
  return { artifact, result: readNativeAssertions(bytes), cpu };
}

/** Set a 16-bit value into the zero page the runtime reads its operands from. */
const put = (address: number, value: number) => [
  `  LDA #&${(value & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
  `  STA &${address.toString(16).toUpperCase()}`,
  `  LDA #&${((value >> 8) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
  `  STA &${(address + 1).toString(16).toUpperCase()}`,
];

const assertEqual = (id: number, expected: number, actual: number) => [
  ...put(0x74, expected),
  ...put(0x76, actual),
  `  LDA #${id}`,
  '  JSR assert_equal',
];

describe('the runtime, assembled and executed', () => {
  it('records an assertion that passed', () => {
    const { result } = runProgram(assertEqual(1, 0x1234, 0x1234));
    expect(result.ran).toBe(true);
    if (!result.ran) return;
    expect(result.records).toEqual([{ id: 1, passed: true, expected: 0x1234, actual: 0x1234 }]);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('records one that failed, with both numbers', () => {
    /* A failure nobody can see the numbers for is a failure nobody can fix. */
    const { result } = runProgram(assertEqual(7, 0x00ff, 0x0100));
    expect(result.ran).toBe(true);
    if (!result.ran) return;
    expect(result.records).toEqual([{ id: 7, passed: false, expected: 0x00ff, actual: 0x0100 }]);
    expect(result.summary).toMatch(/0 passed, 1 failed/);
  });

  it('compares both bytes, so a difference in the high byte alone is a failure', () => {
    /* The low bytes are equal here. A comparison that only looked at one byte
     * would call this a pass. */
    const { result } = runProgram(assertEqual(2, 0x0142, 0x0242));
    if (!result.ran) throw new Error('runtime did not run');
    expect(result.records[0]).toMatchObject({ passed: false, expected: 0x0142, actual: 0x0242 });
  });

  it('keeps going after a failure, and records every assertion in order', () => {
    /* Stopping at the first failure would hide every later one, and on a
     * machine with no operating system there is nowhere to stop to. */
    const { result } = runProgram([
      ...assertEqual(10, 1, 1),
      ...assertEqual(11, 2, 3),
      ...assertEqual(12, 0xbeef, 0xbeef),
    ]);
    if (!result.ran) throw new Error('runtime did not run');
    expect(result.records.map((record) => [record.id, record.passed])).toEqual([[10, true], [11, false], [12, true]]);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('writes records at the right stride, proved past the first', () => {
    /* The record address is computed with 8-bit arithmetic, so an error in it
     * shows up on the later records rather than the first. */
    const body = Array.from({ length: 6 }, (_entry, index) => assertEqual(20 + index, index, index)).flat();
    const { result } = runProgram(body);
    if (!result.ran) throw new Error('runtime did not run');
    expect(result.records).toHaveLength(6);
    expect(result.records.map((record) => record.id)).toEqual([20, 21, 22, 23, 24, 25]);
    expect(result.records.every((record) => record.passed)).toBe(true);
  });

  it('counts what it had no room for rather than dropping it', () => {
    /* A program that asserts more times than the block holds must not report
     * only the first few as though that were all that happened. */
    const body = Array.from({ length: 5 }, (_entry, index) => assertEqual(index + 1, 1, 1)).flat();
    const { result } = runProgram(body, 3);
    if (!result.ran) throw new Error('runtime did not run');
    expect(result.records).toHaveLength(3);
    expect(result.overflowed).toBe(2);
    expect(result.summary).toMatch(/2 further assertions had no room/);
  });

  it('claims exactly the zero page it says it does', () => {
    const source = assertionRuntimeSource('6502', { block: 'results', capacity: 4, zeroPage: 0x70 });
    expect(source).toContain('Claims zero page &70 to &77');
  });
});

describe('reading a block that is not one', () => {
  it('reports memory nobody wrote as a runtime that did not run', () => {
    /* Uninitialised memory is not zero on a real machine, and reporting it
     * would turn bytes nobody wrote into passing assertions. */
    const noise = Array.from({ length: 64 }, (_entry, index) => (index * 37) & 0xff);
    const result = readNativeAssertions(noise);
    expect(result.ran).toBe(false);
    if (result.ran) return;
    expect(result.reason).toMatch(/no assertion-runtime signature/);
  });

  it('refuses a block too short to be one', () => {
    const result = readNativeAssertions([...SIGNATURE]);
    expect(result).toMatchObject({ ran: false });
  });

  it('refuses a version it does not know', () => {
    const block = [...SIGNATURE, LAYOUT_VERSION + 1, 0, 1, 0, ...new Array(RECORD_BYTES).fill(0)];
    const result = readNativeAssertions(block);
    if (result.ran) throw new Error('an unknown version was read as results');
    expect(result.reason).toMatch(new RegExp(`version ${LAYOUT_VERSION} result blocks`));
  });

  it('refuses a count larger than the room it declares', () => {
    const block = [...SIGNATURE, LAYOUT_VERSION, 5, 1, 0, ...new Array(RECORD_BYTES).fill(0)];
    const result = readNativeAssertions(block);
    if (result.ran) throw new Error('an impossible count was read as results');
    expect(result.reason).toMatch(/5 assertions recorded and room for only 1/);
  });

  it('refuses a capacity larger than the bytes it was given', () => {
    const block = [...SIGNATURE, LAYOUT_VERSION, 0, 9, 0, ...new Array(RECORD_BYTES).fill(0)];
    const result = readNativeAssertions(block);
    if (result.ran) throw new Error('an impossible capacity was read as results');
    expect(result.reason).toMatch(/room for 9 assertions/);
  });
});

describe('the shape of a block', () => {
  it('agrees with itself about size and capacity', () => {
    expect(bytesForCapacity(0)).toBe(HEADER_BYTES);
    expect(capacityForBytes(bytesForCapacity(10))).toBe(10);
    expect(capacityForBytes(HEADER_BYTES - 1)).toBe(0);
  });

  it('refuses a capacity the 8-bit offset arithmetic could not address', () => {
    /* Six times forty is 240 and six times anything larger is not. A limit that
     * cannot be exceeded beats a wider one that is wrong above some value
     * nobody documents. */
    expect(MAXIMUM_RECORDS * RECORD_BYTES).toBeLessThan(256);
    expect(() => assertionRuntimeSource('6502', { block: 'r', capacity: MAXIMUM_RECORDS + 1, zeroPage: 0x70 })).toThrow(/1 to 40 assertions/);
    expect(() => assertionRuntimeSource('6502', { block: 'r', capacity: 0, zeroPage: 0x70 })).toThrow(/1 to 40/);
  });

  it('refuses a zero page with no room for the seven bytes it needs', () => {
    expect(() => assertionRuntimeSource('6502', { block: 'r', capacity: 4, zeroPage: 0xfe })).toThrow(/leaves no room below &FF/);
  });
});
