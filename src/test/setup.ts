import '@testing-library/jest-dom/vitest';

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
