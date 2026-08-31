/* Dependency scanning, and an honest account of what it does not scan.
 *
 * SEC-901 asks for SAST, dependency, container, secret and licence scans, an
 * SBOM review, DAST, fuzzing and an independent penetration test. Several of
 * those already run in this gate under their own names — PHPStan is the PHP
 * static analysis, `hygiene` is the secret scan, `licenceCompliance` and the
 * SBOM are their own stages, and the property and adversarial suites are the
 * fuzzing. What was missing was the one that goes stale fastest: a check of
 * the dependencies against what is known about them today.
 *
 * A vulnerability scan is unlike the rest of the gate in one way that governs
 * the design. Every other check fails because this repository changed; this one
 * fails because the world did. A dependency that was clean this morning can be
 * a critical advisory this afternoon with nothing here having moved. So the
 * threshold is set where a person would actually act — high and critical fail,
 * moderate and low are reported and do not — and the report always says what
 * was scanned, so a run that scanned nothing cannot read as a run that found
 * nothing.
 */

/** Severities that stop a release, and those that are reported and do not. */
export const FAILING_SEVERITIES = Object.freeze(['critical', 'high']);
export const REPORTED_SEVERITIES = Object.freeze(['moderate', 'low']);

/**
 * What this stage deliberately does not do, and why.
 *
 * Named here rather than omitted, because a security stage that reported only
 * its own scope would read as a clean bill of health for the whole of SEC-901.
 */
export const UNSCANNED = Object.freeze([
  {
    id: 'container',
    label: 'Container image scan',
    reason: 'No image scanner is installed in this environment, and a scan that silently did not run is worse than one that is known not to have. Running `trivy image` or `grype` against the built images is the missing step; the images themselves are built by the release workflow, which is where it belongs.',
  },
  {
    id: 'dast',
    label: 'Dynamic application security testing',
    reason: 'DAST needs the application running behind a scanner. The gate already boots the built workbench under the shipped security headers and fails on any policy violation, which is a narrow slice of the same idea, but it is not a DAST run and is not claimed as one.',
  },
  {
    id: 'penetration-test',
    label: 'Independent penetration test',
    reason: 'The word in the requirement is independent. Nothing this repository runs against itself can satisfy it, however thorough, because the point is a party that did not write the code. This needs commissioning.',
  },
]);

/**
 * Read an `npm audit --json` document.
 *
 * @param {string} raw
 * @returns {{ counts: Record<string, number>, total: number }}
 */
export function readNpmAudit(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('npm audit did not return JSON, so nothing says whether the dependencies were scanned.');
  }
  const counts = parsed?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') {
    throw new Error('npm audit returned JSON with no vulnerability summary, so its result cannot be read.');
  }
  const numeric = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value) || 0]));
  return { counts: numeric, total: Number(counts.total) || 0 };
}

/**
 * Read a `composer audit --format=json` document.
 *
 * Composer reports advisories per package rather than a severity tally, and
 * treats an abandoned package as a separate finding — which it is: a package
 * nobody maintains will not be fixed when something is found in it.
 *
 * @param {string} raw
 * @returns {{ advisories: number, abandoned: string[] }}
 */
export function readComposerAudit(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('composer audit did not return JSON, so nothing says whether the backend dependencies were scanned.');
  }
  const advisories = parsed?.advisories;
  if (advisories === undefined) {
    throw new Error('composer audit returned JSON with no advisories field, so its result cannot be read.');
  }
  const count = Array.isArray(advisories)
    ? advisories.length
    : Object.values(advisories).reduce((total, list) => total + (Array.isArray(list) ? list.length : 1), 0);
  const abandoned = parsed?.abandoned && !Array.isArray(parsed.abandoned) ? Object.keys(parsed.abandoned) : [];
  return { advisories: count, abandoned };
}

/**
 * Everything that should stop a release, in the words a reader needs.
 *
 * @param {{ counts: Record<string, number> }} npm
 * @param {{ advisories: number, abandoned: string[] }} composer
 * @returns {string[]}
 */
export function scanFindings(npm, composer) {
  const findings = [];
  for (const severity of FAILING_SEVERITIES) {
    const count = npm.counts[severity] ?? 0;
    if (count > 0) {
      findings.push(`${count} ${severity} npm advisor${count === 1 ? 'y' : 'ies'}. Run \`npm audit\` for the packages and \`npm audit fix\` where an upgrade exists.`);
    }
  }
  if (composer.advisories > 0) {
    findings.push(`${composer.advisories} composer advisor${composer.advisories === 1 ? 'y' : 'ies'} against the backend. Run \`composer audit\` in backend/ for the packages.`);
  }
  if (composer.abandoned.length) {
    findings.push(`${composer.abandoned.length} abandoned backend package${composer.abandoned.length === 1 ? '' : 's'}: ${composer.abandoned.join(', ')}. An unmaintained package will not be fixed when something is found in it.`);
  }
  return findings;
}

/** What the stage reports when it found nothing to fail on. */
export function scanSummary(npm, composer) {
  const reported = REPORTED_SEVERITIES
    .map((severity) => ({ severity, count: npm.counts[severity] ?? 0 }))
    .filter((entry) => entry.count > 0);
  const lesser = reported.length
    ? `, ${reported.map((entry) => `${entry.count} ${entry.severity}`).join(' and ')} reported and not failing`
    : '';
  return `no high or critical advisories across npm and composer${lesser} · ${UNSCANNED.length} scans not run and named`;
}
