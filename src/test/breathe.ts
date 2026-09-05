/*
 * Letting the event loop breathe inside a long fuzz loop.
 *
 * The property suites run hundreds of cases in a single test body, and a test
 * body is synchronous unless something in it awaits. A synchronous body holds
 * its worker's event loop for as long as it runs, and that has two consequences
 * neither of which is visible from the test:
 *
 *  - Vitest's own timeout cannot fire. It is armed with a timer, and a timer
 *    cannot run while the loop is blocked, so a test configured to fail after
 *    ten seconds ran for twelve and passed. The suite's guardrail was not
 *    applying to the tests most likely to need it.
 *  - The worker cannot answer the runner. Vitest's worker and runner talk over
 *    a channel with a sixty-second deadline, and a file with six eleven-second
 *    cases back to back blocks for seventy. The deadline then expires and the
 *    whole run fails with every test passed — which is how a release gate came
 *    to fail four times on a green tree.
 *
 * Awaiting a macrotask every so often fixes both without changing what is
 * tested: the same cases, in the same order, from the same seed.
 */

/** How many cases to run between breaths. Small enough to stay under any
 * timeout, large enough that the yields cost nothing measurable. */
export const CASES_BETWEEN_BREATHS = 16;

/**
 * Yield to the event loop every so often inside a long loop.
 *
 * Call it with the loop index. It awaits a macrotask — not a microtask — so
 * timers, and therefore timeouts, actually get a chance to run.
 */
export async function breathe(index: number, every = CASES_BETWEEN_BREATHS): Promise<void> {
  if (index % every !== every - 1) return;
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}
