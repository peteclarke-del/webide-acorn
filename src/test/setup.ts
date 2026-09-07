import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

/*
 * How long a `findBy` waits for something to appear.
 *
 * Testing Library's default is one second, and one second is a measurement of
 * the machine rather than of the code. A completion list that renders in 40 ms
 * on an idle box took past a second under a full parallel run on eight cores,
 * and the suite failed on a query that was right about what it wanted and wrong
 * about how long the machine would take to get there.
 *
 * Five seconds, for the same reason the per-test and hook bounds are thirty: a
 * wait is there to catch something that never happens, not to time the run. It
 * stays well inside the test timeout so a genuine never-appears still fails as
 * the missing element it is, naming what was looked for, rather than as a bare
 * timeout around it.
 */
configure({ asyncUtilTimeout: 5_000 });

/*
 * jsdom has no 2D canvas, and says so by throwing.
 *
 * The workspaces that draw previews are written for that: each asks for a
 * context with `canvas?.getContext?.('2d')` and returns early when there is
 * none, leaving the structured grid it renders beside the picture. But jsdom's
 * unimplemented `getContext` does not return nothing — it raises, from inside a
 * React effect, where nothing is waiting to catch it. So the guard never runs
 * and the error escapes as an unhandled rejection.
 *
 * A single run produced 306 of them, from three call sites, each carrying a
 * stack trace to the reporter. Vitest says of these that they "might cause
 * false positive tests", and the flood also stalled its own reporting channel
 * often enough to fail a release gate on which every one of 2,484 tests had
 * passed.
 *
 * Returning null is what the product is written against, so the guard is
 * exercised rather than bypassed. Nothing here pretends a canvas was drawn on:
 * that is checked where it can be, by the smoke and browser stages, which run
 * the built workbench in a real browser with a real canvas.
 */
const unimplemented2dContext = () => {
  const prototype = globalThis.HTMLCanvasElement?.prototype;
  if (!prototype) return;
  prototype.getContext = function getContext(): null {
    return null;
  } as HTMLCanvasElement['getContext'];
};
unimplemented2dContext();
