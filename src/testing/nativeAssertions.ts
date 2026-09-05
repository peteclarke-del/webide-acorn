/* Assertions made by the program itself, on the machine, in its own words.
 *
 * Every hardware test this build runs so far asserts from outside: the host
 * stops the machine at an address and reads its registers and memory. That is
 * the right way to check what a program left behind, and it cannot check
 * anything that happened in between. A loop that was correct on its last
 * iteration and wrong on its fourth looks identical from outside, and a routine
 * called twenty times can only be judged on the twentieth.
 *
 * So a program can also assert as it runs. It calls a small routine with a
 * number it computed and the number it expected, and the routine writes both
 * into a block of memory the host reads afterwards. The program keeps running
 * either way — a failed assertion is recorded, not fatal — because stopping at
 * the first failure would hide every later one, and on a machine with no
 * operating system to catch it there is nowhere to stop to.
 *
 * Two things make the block trustworthy rather than merely present:
 *
 *   - **It is signed.** Uninitialised memory is not zero on a real machine, and
 *     a block of plausible-looking bytes read from RAM nobody wrote would
 *     otherwise be reported as a run of passing assertions. The runtime writes
 *     a signature when it initialises, and a block without it is reported as a
 *     runtime that never ran rather than as a test that passed.
 *
 *   - **It counts what it could not record.** The block is a fixed size, and a
 *     program that asserts more times than it has room for must not silently
 *     report only the first few. The overflow count is kept separately and the
 *     result says so.
 */

export const NATIVE_ASSERTION_SCHEMA = '8bit-net.native-assertions' as const;

/** 'ASRT' — written by the runtime, checked by the reader. */
export const SIGNATURE = [0x41, 0x53, 0x52, 0x54] as const;
export const LAYOUT_VERSION = 1;

/** Bytes before the first record: signature, version, count, capacity, overflow. */
export const HEADER_BYTES = 8;
/** identifier, outcome, expected low/high, actual low/high. */
export const RECORD_BYTES = 6;

/** How many records a block of a given size can hold. */
export function capacityForBytes(bytes: number): number {
  return Math.max(0, Math.floor((bytes - HEADER_BYTES) / RECORD_BYTES));
}

/** The bytes a block of a given capacity needs. */
export function bytesForCapacity(capacity: number): number {
  return HEADER_BYTES + capacity * RECORD_BYTES;
}

export interface NativeAssertionRecord {
  /** The number the program used to identify this assertion. */
  id: number;
  passed: boolean;
  expected: number;
  actual: number;
}

export type NativeAssertionResult =
  | {
      ran: true;
      version: number;
      capacity: number;
      /** Assertions the block holds. */
      records: NativeAssertionRecord[];
      /** Assertions the program made with no room left to record them. */
      overflowed: number;
      passed: number;
      failed: number;
      summary: string;
    }
  | { ran: false; reason: string };

/**
 * Read a result block out of machine memory.
 *
 * Refuses rather than guesses. Every way the block can fail to be a block —
 * too short, unsigned, a version this build does not know, a count larger than
 * the capacity — is reported as the runtime not having run, because each of
 * them is indistinguishable from memory nobody wrote and reporting any of them
 * as results would be inventing them.
 */
export function readNativeAssertions(bytes: ArrayLike<number>): NativeAssertionResult {
  if (bytes.length < HEADER_BYTES) {
    return { ran: false, reason: `A result block is at least ${HEADER_BYTES} bytes and this is ${bytes.length}.` };
  }
  for (const [index, expected] of SIGNATURE.entries()) {
    if ((bytes[index] ?? -1) !== expected) {
      return {
        ran: false,
        reason: 'This memory carries no assertion-runtime signature, so the runtime did not initialise it. Uninitialised memory is not zero on a real machine, and reporting it would turn bytes nobody wrote into passing assertions.',
      };
    }
  }
  const version = bytes[4] ?? 0;
  if (version !== LAYOUT_VERSION) {
    return { ran: false, reason: `This build reads version ${LAYOUT_VERSION} result blocks and this one is version ${version}.` };
  }
  const count = bytes[5] ?? 0;
  const capacity = bytes[6] ?? 0;
  const overflowed = bytes[7] ?? 0;
  if (capacity > capacityForBytes(bytes.length)) {
    return { ran: false, reason: `The block declares room for ${capacity} assertions and ${bytes.length} bytes only holds ${capacityForBytes(bytes.length)}.` };
  }
  if (count > capacity) {
    return { ran: false, reason: `The block declares ${count} assertions recorded and room for only ${capacity}.` };
  }

  const records: NativeAssertionRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = HEADER_BYTES + index * RECORD_BYTES;
    records.push({
      id: bytes[at] ?? 0,
      passed: (bytes[at + 1] ?? 0) === 1,
      expected: (bytes[at + 2] ?? 0) | ((bytes[at + 3] ?? 0) << 8),
      actual: (bytes[at + 4] ?? 0) | ((bytes[at + 5] ?? 0) << 8),
    });
  }
  const passed = records.filter((record) => record.passed).length;
  const failed = records.length - passed;
  const overflowNote = overflowed > 0
    ? ` · ${overflowed} further assertion${overflowed === 1 ? '' : 's'} had no room and ${overflowed === 1 ? 'was' : 'were'} not recorded`
    : '';
  return {
    ran: true, version, capacity, records, overflowed, passed, failed,
    summary: `${records.length} assertion${records.length === 1 ? '' : 's'} made on the machine · ${passed} passed, ${failed} failed${overflowNote}`,
  };
}

export type NativeCpuFamily = '6502';

/**
 * The most assertions one block may hold.
 *
 * Forty rather than the 255 a byte could count, because the record offset is
 * computed in a single 8-bit accumulator: six times forty is 240 and six times
 * anything larger is not. A limit that cannot be exceeded is worth more than a
 * wider one that is wrong above some value nobody documents.
 */
export const MAXIMUM_RECORDS = 40;

export interface AssertionRuntimeOptions {
  /** Label the block is emitted under, so the host knows where to read. */
  block: string;
  capacity: number;
  /** First of the seven zero-page bytes the runtime claims. */
  zeroPage: number;
}

/**
 * The runtime a program links against, and the block it writes into.
 *
 * Generated rather than shipped as a file so the layout above and the code that
 * fills it cannot drift: both come from the same constants. The block is
 * emitted here too, under its own labels, so the routine can reach it with
 * `#<label` and `#>label` and never needs the assembler to evaluate an
 * expression.
 *
 * Only the 6502 is generated. An ARM form would be written the same way, but
 * this build has no ARM execution it could be proved against, and assembly
 * nobody has run is assembly nobody should trust — the 6502 form below is
 * assembled and executed by a contract.
 */
export function assertionRuntimeSource(family: NativeCpuFamily, options: AssertionRuntimeOptions): string {
  const { block, capacity, zeroPage } = options;
  if (family !== '6502') {
    throw new Error(`Only a 6502 assertion runtime is generated; ${family} would be assembly this build cannot execute to prove.`);
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAXIMUM_RECORDS) {
    throw new Error(`A result block holds 1 to ${MAXIMUM_RECORDS} assertions; ${capacity} is not a count it can hold.`);
  }
  if (!Number.isInteger(zeroPage) || zeroPage < 0 || zeroPage > 0xf8) {
    throw new Error(`The runtime claims seven zero-page bytes from the address given; &${zeroPage.toString(16).toUpperCase()} leaves no room below &FF.`);
  }
  const hex = (value: number) => `&${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const pointer = zeroPage;
  const scratch = zeroPage + 2;
  const identifier = zeroPage + 3;
  const expectedLow = zeroPage + 4;
  const expectedHigh = zeroPage + 5;
  const actualLow = zeroPage + 6;

  return [
    `; Assertion runtime · room for ${capacity} · block ${block}`,
    `; Claims zero page ${hex(pointer)} to ${hex(actualLow + 1)}.`,
    ';',
    '; Call assert_init once, then assert_equal with the identifier in A, the',
    `; expected value in ${hex(expectedLow)}/${hex(expectedHigh)} and the actual`,
    `; in ${hex(actualLow)}/${hex(actualLow + 1)}. A failed assertion is recorded`,
    '; and execution continues: stopping at the first would hide every later one.',
    '.assert_init',
    ...SIGNATURE.map((byte, index) => `  LDA #${hex(byte)}\n  STA ${block}+${index}`),
    `  LDA #${LAYOUT_VERSION}`,
    `  STA ${block}+4`,
    '  LDA #0',
    `  STA ${block}+5`,
    `  LDA #${capacity}`,
    `  STA ${block}+6`,
    '  LDA #0',
    `  STA ${block}+7`,
    '  RTS',
    '',
    '.assert_equal',
    `  STA ${hex(identifier)}`,
    `  LDA ${block}+5`,
    `  CMP #${capacity}`,
    '  BCC assert_room',
    '  ; No room left. Counted rather than dropped, so the reader is told that',
    '  ; what it can see is not all of what happened.',
    `  INC ${block}+7`,
    '  RTS',
    '.assert_room',
    `  ; offset = count * ${RECORD_BYTES}, which fits one byte because capacity`,
    `  ; is at most ${MAXIMUM_RECORDS}.`,
    '  ASL A',
    `  STA ${hex(scratch)}`,
    '  ASL A',
    '  CLC',
    `  ADC ${hex(scratch)}`,
    '  CLC',
    `  ADC #<${block}_records`,
    `  STA ${hex(pointer)}`,
    `  LDA #>${block}_records`,
    '  ADC #0',
    `  STA ${hex(pointer + 1)}`,
    '  LDY #0',
    `  LDA ${hex(identifier)}`,
    `  STA (${hex(pointer)}),Y`,
    '  ; The outcome, from comparing both bytes of each value.',
    '  LDA #0',
    `  LDX ${hex(expectedLow)}`,
    `  CPX ${hex(actualLow)}`,
    '  BNE assert_store_outcome',
    `  LDX ${hex(expectedHigh)}`,
    `  CPX ${hex(actualLow + 1)}`,
    '  BNE assert_store_outcome',
    '  LDA #1',
    '.assert_store_outcome',
    '  INY',
    `  STA (${hex(pointer)}),Y`,
    '  ; Both numbers are written whether or not they matched: a failure nobody',
    '  ; can see the numbers for is a failure nobody can fix.',
    '  INY',
    `  LDA ${hex(expectedLow)}`,
    `  STA (${hex(pointer)}),Y`,
    '  INY',
    `  LDA ${hex(expectedHigh)}`,
    `  STA (${hex(pointer)}),Y`,
    '  INY',
    `  LDA ${hex(actualLow)}`,
    `  STA (${hex(pointer)}),Y`,
    '  INY',
    `  LDA ${hex(actualLow + 1)}`,
    `  STA (${hex(pointer)}),Y`,
    `  INC ${block}+5`,
    '  RTS',
    '',
    `; The block itself. The header is separate from the records so the routine`,
    `; can reach the first record with #<label and #>label and never needs the`,
    `; assembler to evaluate an expression.`,
    `.${block}`,
    `EQUB ${new Array(HEADER_BYTES).fill(0).join(', ')}`,
    `.${block}_records`,
    ...Array.from({ length: capacity }, () => `EQUB ${new Array(RECORD_BYTES).fill(0).join(', ')}`),
    '',
  ].join('\n');
}
