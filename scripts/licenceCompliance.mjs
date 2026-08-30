/*
 * Whether what this product distributes carries what its licences require.
 *
 * The inventory in docs/sbom.md says which shipped packages are copyleft. That
 * is the question "what do we owe"; this is the question "have we paid it",
 * and they were not connected: the image shipped Arculator's licence, its exact
 * upstream source, its patch and its build hashes, while jsbeeb and ElkJS —
 * both copyleft, both conveyed in the built output — shipped a licence file and
 * nothing else. Nothing would have noticed the next one either.
 *
 * So the obligation is derived from the inventory rather than from a list
 * somebody remembers to update: every shipped copyleft component must have its
 * licence and its corresponding source in the image, and a component nobody has
 * classified is refused rather than assumed to be fine.
 */

/** A component that ships and carries a copyleft obligation. */
export const COPYLEFT_COMPONENTS = Object.freeze([
  Object.freeze({
    id: 'jsbeeb',
    what: 'The BBC Micro, Master and Atom core, bundled into the built workbench.',
    licence: 'licenses/jsbeeb-COPYING.txt',
    source: 'source/jsbeeb-upstream-source.tar',
  }),
  Object.freeze({
    id: 'elkjs',
    what: 'The Acorn Electron core, vendored and served from the built output.',
    licence: 'licenses/elkjs-LICENSE.txt',
    source: 'source/elkjs-upstream-source.tar',
  }),
  Object.freeze({
    id: 'arculator-wasm',
    what: 'The Archimedes A310 core, built from pinned upstream source.',
    licence: 'licenses/arculator-wasm-COPYING.txt',
    source: 'source/arculator-upstream-source.tar',
  }),
]);

/**
 * Check a Dockerfile ships the licence and corresponding source of everything
 * that carries a copyleft obligation.
 *
 * Reading the Dockerfile rather than the built image on purpose: the check has
 * to run in the gate, which builds the frontend and not the container, and the
 * failure it exists to catch — somebody adding a copyleft dependency and not
 * shipping its source — is visible there.
 */
export function licenceComplianceFindings(dockerfile, shippedCopyleftIds) {
  const findings = [];
  const known = new Set(COPYLEFT_COMPONENTS.map((component) => component.id));
  for (const id of shippedCopyleftIds) {
    if (!known.has(id)) {
      findings.push(`${id} ships under a copyleft licence and nothing here says how its source is distributed. Add it to COPYLEFT_COMPONENTS and ship its source, or stop distributing it.`);
    }
  }
  for (const component of COPYLEFT_COMPONENTS) {
    for (const [what, path] of [['licence', component.licence], ['corresponding source', component.source]]) {
      const destination = `/usr/share/nginx/html/${path}`;
      if (!dockerfile.includes(destination)) {
        findings.push(`${component.id} is distributed under a copyleft licence and the image does not carry its ${what} at ${path}. ${component.what}`);
      }
    }
  }

  return findings;
}
