import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * What the A310's keyboard can type, and what it deliberately cannot.
 *
 * The runtime turns characters into SDL scancodes and presses them. Its
 * alphabet was letters, digits, space and six punctuation marks, which was
 * enough for the thing it was written for — typing `Run <path>` to launch an
 * application — and not enough to drive the machine for anything else. A
 * measurement that needs to type `HIMEM=1` cannot, because there was no `=`.
 *
 * The characters added are only those whose key is in the same place on the UK
 * layout the machine boots with and the US layout SDL names its scancodes from.
 * That is the whole rule, and it excludes the obvious ones: `"` is Shift-2 here
 * and Shift-' there, `@` is the other way round, and `#` sits on a key US
 * layouts do not have. A wrong mapping does not fail — it types a different
 * character — so a measurement built on one would record something the machine
 * never saw.
 *
 * These read the runtime's own source rather than restating the table, so the
 * rule cannot drift from what ships.
 */
const RUNTIME = readFileSync(resolve(process.cwd(), 'public/archimedes-runtime.js'), 'utf8');

/** The punctuation map, taken from the runtime. */
function symbolMap(): Record<string, string> {
  const start = RUNTIME.indexOf('const symbol = {');
  const end = RUNTIME.indexOf('}[character];', start);
  expect(start, 'the runtime still maps punctuation to scancodes').toBeGreaterThan(-1);
  const body = RUNTIME.slice(start, end);
  const map: Record<string, string> = {};
  for (const match of body.matchAll(/'(\\?.)':\s*\[([^\]]+)\]/g)) map[match[1]!.replace('\\', '')] = match[2]!.trim();
  return map;
}

describe('what the A310 keyboard can type', () => {
  it('can type the characters a BASIC line needs', () => {
    const map = symbolMap();
    for (const character of ['=', '(', ')', ',', ';', ':', '.', '-', '_', '$', '!', '*', '/', '+', '<', '>', '?']) {
      expect(map, `no key for ${character}`).toHaveProperty(character);
    }
  });

  it('refuses the characters whose key moves between layouts', () => {
    /*
     * Not an oversight. Adding these would type something else on the machine,
     * which is a worse failure than refusing, because it is silent.
     */
    const map = symbolMap();
    for (const character of ['"', '@', '#', '~', '\\', '|', "'"]) {
      expect(map, `${character} sits on a different key on a UK keyboard`).not.toHaveProperty(character);
    }
  });

  it('still refuses anything it has no key for, rather than typing nothing', () => {
    expect(RUNTIME).toContain('The A310 keyboard queue contains an unsupported character');
  });
});

/*
 * Reaching the command line, which text alone cannot do.
 *
 * F12 is how anybody gets to a RISC OS supervisor prompt. The runtime already
 * pressed it when launching an application, but only inside that, so nothing
 * else could reach a prompt — and the keyboard has no star key, so a star
 * command was not a way round it either.
 */
describe('pressing a function key', () => {
  it('is a command of its own', () => {
    expect(RUNTIME).toContain("command.type === 'press-function-key'");
  });

  it('bounds the key to the twelve that exist', () => {
    expect(RUNTIME).toContain('A function key is F1 to F12');
    expect(RUNTIME).toMatch(/command\.number < 1 \|\| command\.number > 12/);
  });

  it('numbers them from the scancode the runtime already used for F12', () => {
    /* 57 + 12 is 69, which is the F12 the application launcher presses. If one
     * moves without the other, this is what says so. */
    expect(RUNTIME).toMatch(/F12:\s*69/);
    expect(RUNTIME).toContain('pressMachineKey(57 + command.number');
  });
});
