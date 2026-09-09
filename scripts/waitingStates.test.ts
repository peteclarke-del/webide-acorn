import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * How this product says that something is absent, or not finished yet.
 *
 * UX-125 asks for the empty, loading, stale, offline, error, permission, quota
 * and unsupported states to be defined, and for the interface to avoid
 * ambiguous spinners. The second half is the part a test can hold, and the
 * answer this build reached is a strong one: there are no spinners at all.
 * Nothing anywhere turns indefinitely. A state is a sentence saying which
 * condition holds ("No media is mounted in this session", "The selected
 * toolchain supplied address symbols and source locations, but no type
 * records"), and a sentence can be read by somebody who cannot see the
 * animation, announced to a screen reader, and acted on.
 *
 * That is worth pinning, because a spinner is the easy thing to reach for and
 * it says only that the product is doing something, or possibly that it has
 * stopped and nobody noticed.
 *
 * One animation loops, and it is named: the machine's own screen cursor, which
 * imitates a BBC Micro's blinking block. That is a picture of hardware rather
 * than a claim about progress.
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/** The one loop that is a picture of a machine rather than a progress claim. */
const ALLOWED_LOOPS = ['screen-blink'];

describe('waiting, and saying so', () => {
  it('has no indefinite animation except the machine cursor', () => {
    const loops = [...CSS.matchAll(/animation:\s*([^;]*\binfinite\b[^;]*)/g)].map((match) => match[1]!.trim());
    const unexplained = loops.filter((loop) => !ALLOWED_LOOPS.some((name) => loop.includes(name)));
    expect(unexplained, 'an animation that repeats for ever is a spinner however it is drawn').toEqual([]);
  });

  it('still has the machine cursor, so the exception is describing something real', () => {
    /* Otherwise the allowance outlives the thing it was written for. */
    const loops = [...CSS.matchAll(/animation:\s*([^;]*\binfinite\b[^;]*)/g)].map((match) => match[1]!);
    expect(loops.some((loop) => loop.includes('screen-blink'))).toBe(true);
  });

  it('gives the empty state a class of its own, so it can be found and checked', () => {
    /* The accessibility sweep reaches these by rendering; this only holds the
     * convention in place so that a new one is written the same way. */
    expect(CSS).toContain('.honest-empty');
  });
});
