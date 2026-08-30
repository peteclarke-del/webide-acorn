// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  SIDEWAYS_BANKS,
  SIDEWAYS_BANK_BYTES,
  assignBank,
  bankRows,
  clearBank,
  isBank,
  serviceCallOrder,
  validateLayout,
  validateSidewaysImage,
  type SidewaysAssignment,
} from './sidewaysSlots';

const rom = (bank: number, romId: string, reserved = false): SidewaysAssignment =>
  ({ bank, romId, label: `${romId} ROM`, ...(reserved ? { reserved: true } : {}) });

/* A 16 KiB image carrying a plausible sideways header: a language entry, a
 * service entry, a type byte declaring both, and a copyright offset pointing at
 * a terminated string. Built rather than fixtured so the test states it. */
function sidewaysImage(): Uint8Array {
  const bytes = new Uint8Array(SIDEWAYS_BANK_BYTES);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 7) & 0xff;
  bytes[0] = 0x4c;            /* JMP language entry */
  bytes[3] = 0x4c;            /* JMP service entry */
  bytes[6] = 0xc2;            /* type byte: language and service */
  bytes[7] = 0x09;            /* copyright offset */
  bytes[8] = 0x01;            /* binary version */
  bytes[9] = 0x00;            /* terminator before the copyright string */
  return bytes;
}

describe('what a bank is', () => {
  it('has sixteen of them, because the select register is four bits wide', () => {
    expect(SIDEWAYS_BANKS).toBe(16);
    expect(bankRows([])).toHaveLength(16);
  });

  it('accepts every bank the hardware has and refuses the rest', () => {
    for (let bank = 0; bank < SIDEWAYS_BANKS; bank += 1) expect(isBank(bank), String(bank)).toBe(true);
    for (const value of [-1, 16, 1.5, '3', null, undefined]) expect(isBank(value), String(value)).toBe(false);
  });

  it('shows every bank, filled or not, because an empty one is where the next ROM goes', () => {
    const rows = bankRows([rom(12, 'basic')]);
    expect(rows.filter((row) => row.assignment)).toHaveLength(1);
    expect(rows.filter((row) => !row.assignment)).toHaveLength(15);
    expect(rows[12]!.assignment!.romId).toBe('basic');
  });
});

describe('placing a ROM', () => {
  it('places it in the bank that was asked for and keeps the banks in order', () => {
    const first = assignBank([], rom(4, 'dfs'));
    expect(first.problem).toBeNull();
    const second = assignBank(first.layout, rom(1, 'toolkit'));
    expect(second.layout.map((entry) => entry.bank)).toEqual([1, 4]);
  });

  it('refuses a bank that is already occupied rather than moving anything', () => {
    /* Relocating on someone's behalf would change the service-call priority
     * they were setting, which is the whole reason to choose a bank. */
    const { layout, problem } = assignBank([rom(9, 'dfs')], rom(9, 'toolkit'));
    expect(problem).toMatchObject({ kind: 'bank-occupied', bank: 9 });
    expect(problem!.reason).toMatch(/nothing is moved for you/i);
    expect(layout).toHaveLength(1);
    expect(layout[0]!.romId).toBe('dfs');
  });

  it('refuses a bank the machine’s own firmware occupies', () => {
    const { problem } = assignBank([rom(15, 'mos-basic', true)], rom(15, 'toolkit'));
    expect(problem).toMatchObject({ kind: 'bank-reserved' });
    expect(problem!.reason).toMatch(/own firmware/i);
  });

  it('refuses a bank the hardware does not have', () => {
    for (const bank of [-1, 16, 99]) {
      expect(assignBank([], rom(bank, 'toolkit')).problem, String(bank)).toMatchObject({ kind: 'bank-out-of-range' });
    }
  });

  it('refuses the same image in two banks, saying what that would do', () => {
    const { problem } = assignBank([rom(3, 'toolkit')], rom(7, 'toolkit'));
    expect(problem).toMatchObject({ kind: 'duplicate-rom' });
    expect(problem!.reason).toMatch(/answers every service call twice/i);
  });
});

describe('clearing a bank', () => {
  it('empties one the user filled', () => {
    const { layout, problem } = clearBank([rom(2, 'dfs'), rom(5, 'toolkit')], 2);
    expect(problem).toBeNull();
    expect(layout.map((entry) => entry.bank)).toEqual([5]);
  });

  it('refuses to empty one the machine’s firmware occupies', () => {
    const { layout, problem } = clearBank([rom(15, 'mos-basic', true)], 15);
    expect(problem).toMatchObject({ kind: 'bank-reserved' });
    expect(layout).toHaveLength(1);
  });

  it('does nothing to an already empty bank rather than failing', () => {
    const { layout, problem } = clearBank([rom(2, 'dfs')], 7);
    expect(problem).toBeNull();
    expect(layout).toHaveLength(1);
  });
});

describe('checking an image before it is placed', () => {
  it('accepts a 16 KiB image with a usable sideways header', () => {
    expect(validateSidewaysImage(sidewaysImage(), 'Toolkit')).toEqual([]);
  });

  it('refuses anything that is not exactly one bank, and says a combined image must be split', () => {
    const combined = validateSidewaysImage(new Uint8Array(SIDEWAYS_BANK_BYTES * 4), 'Combined');
    expect(combined[0]).toMatchObject({ kind: 'image-wrong-size' });
    expect(combined[0]!.reason).toMatch(/split into its banks/i);

    const short = validateSidewaysImage(new Uint8Array(8192), 'Half');
    expect(short[0]).toMatchObject({ kind: 'image-wrong-size' });
    expect(short[0]!.reason).not.toMatch(/split/i);
  });

  it('refuses a blank image, which is a socket rather than a ROM', () => {
    const blank = validateSidewaysImage(new Uint8Array(SIDEWAYS_BANK_BYTES).fill(0xff), 'Blank');
    expect(blank.some((problem) => problem.kind === 'image-not-sideways')).toBe(true);
  });
});

describe('a layout that arrived from somewhere else', () => {
  it('reports a bank recorded twice, because only one image can occupy one', () => {
    const problems = validateLayout([rom(4, 'dfs'), rom(4, 'toolkit')]);
    expect(problems[0]).toMatchObject({ kind: 'bank-occupied', bank: 4 });
  });

  it('reports the same image recorded in two banks, naming both', () => {
    const problems = validateLayout([rom(4, 'toolkit'), rom(9, 'toolkit')]);
    expect(problems[0]).toMatchObject({ kind: 'duplicate-rom' });
    expect(problems[0]!.reason).toContain('banks 4 and 9');
  });

  it('reports a bank number the hardware does not have', () => {
    expect(validateLayout([rom(31, 'toolkit')])[0]).toMatchObject({ kind: 'bank-out-of-range' });
  });

  it('says nothing about a layout that is fine', () => {
    expect(validateLayout([rom(0, 'a'), rom(7, 'b'), rom(15, 'c', true)])).toEqual([]);
  });
});

describe('the order the machine asks its ROMs', () => {
  it('offers a service call to the highest bank first, which is why the number matters', () => {
    /* Two ROMs claiming the same star command are resolved by bank number, and
     * anyone arranging ROMs is doing it for this reason. */
    const order = serviceCallOrder([rom(2, 'low'), rom(15, 'high'), rom(9, 'middle')]);
    expect(order.map((entry) => entry.romId)).toEqual(['high', 'middle', 'low']);
  });

  it('leaves the layout it was given alone', () => {
    const layout = [rom(2, 'low'), rom(15, 'high')];
    serviceCallOrder(layout);
    expect(layout.map((entry) => entry.romId)).toEqual(['low', 'high']);
  });
});
