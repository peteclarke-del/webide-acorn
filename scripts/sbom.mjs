/* A software bill of materials, and the licence position it implies.
 *
 * Generated from the lockfile rather than written, because a hand-maintained
 * inventory is out of date the first time anyone runs `npm install` and nobody
 * notices until it matters. The lockfile is what is actually installed.
 *
 * Two things this is careful about.
 *
 * It separates what ships from what does not, and it does so on evidence
 * rather than on the lockfile's development flag. That flag was not enough
 * here: a native image library arrives as a runtime dependency of the emulator
 * core, bringing sixteen LGPL platform binaries with it, and none of them can
 * be in a browser bundle or is present in the built output. Reporting those as
 * distributed would have been sixteen licence obligations this product does not
 * have, which is how a project ends up believing it has a hundred when it has
 * four.
 *
 * The judgement is deliberately one-sided. A package is treated as distributed
 * unless there is a reason it cannot be, so an unproven case over-reports an
 * obligation rather than missing one.
 *
 * It reports a licence it could not determine as undetermined rather than as
 * absent. "No licence found" and "no licence" are different statements, and
 * only one of them is a problem someone has to go and resolve.
 *
 * Vendored code — an emulator core built into the image rather than installed
 * from a registry — is not in the lockfile and is recorded separately in
 * `docs/third-party-components.md`, whose checksums the release gate verifies.
 */

/** Licences that place no condition on distributing a built artifact. */
const PERMISSIVE = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense',
  'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'WTFPL', 'Zlib', 'BSD-3-Clause-Clear',
]);

/** Licences that place conditions worth a person reading before shipping. */
const COPYLEFT = new Set([
  'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only',
  'GPL-3.0-or-later', 'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later',
  'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'AGPL-3.0', 'AGPL-3.0-only',
  'AGPL-3.0-or-later', 'MPL-2.0', 'EPL-2.0', 'CDDL-1.0', 'CDDL-1.1',
]);

/**
 * How a licence expression should be treated. An expression this does not
 * recognise is `other` rather than assumed safe, because assuming safe is the
 * failure that only shows up in a legal review.
 */
export function classifyLicence(expression) {
  if (!expression || !String(expression).trim()) return 'undetermined';
  const text = String(expression).replace(/[()]/g, ' ').trim().replace(/\s+/g, ' ');
  if (PERMISSIVE.has(text)) return 'permissive';
  if (COPYLEFT.has(text)) return 'copyleft';

  /* An OR expression may be satisfied by whichever arm the user picks, so it
   * is as permissive as its most permissive arm. */
  const alternatives = text.split(/\s+OR\s+/i).map((arm) => arm.trim()).filter(Boolean);
  if (alternatives.length > 1) {
    const classes = alternatives.map((arm) => classifyLicence(arm));
    if (classes.includes('permissive')) return 'permissive';
    if (classes.includes('copyleft')) return 'copyleft';
    return 'other';
  }

  /* An AND expression binds every arm at once, so it is only permissive when
   * all of them are, and it is copyleft as soon as one of them is. */
  const conjuncts = text.split(/\s+AND\s+/i).map((arm) => arm.trim()).filter(Boolean);
  if (conjuncts.length > 1) {
    const classes = conjuncts.map((arm) => classifyLicence(arm));
    if (classes.includes('copyleft')) return 'copyleft';
    if (classes.every((entry) => entry === 'permissive')) return 'permissive';
    return 'other';
  }
  return 'other';
}

/**
 * Why a package cannot be in the browser bundle, or null when it could be.
 *
 * `built` is the set of package names actually referenced in the built output.
 * A package absent from it that also cannot run in a browser — a native
 * binding, or a binary published per platform — is not distributed. A package
 * absent from it for any other reason is still treated as distributed, because
 * a bundler renames things and absence from a text search proves nothing on
 * its own.
 */
function notDistributedBecause(meta, name, built) {
  if (built.has(name)) return null;
  const platformSpecific = Array.isArray(meta.os) || Array.isArray(meta.cpu);
  if (meta.hasInstallScript) return 'a native module built at install time, which a browser bundle cannot contain, and it is absent from the built output';
  if (platformSpecific && meta.optional) return 'a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output';
  /* An optional dependency is by definition not required for the product to
   * work, and absence from the built output confirms it is not in what ships.
   * A non-optional package stays distributed unless it cannot be, so the
   * judgement remains one-sided. */
  if (meta.optional) return 'an optional dependency that is absent from the built output';
  return null;
}

/**
 * Every installed package, from the lockfile.
 *
 * `built` is the set of package names found in the built output; pass an empty
 * set to treat every non-development package as distributed, which is the
 * conservative reading.
 */
export function readLockfile(lockfile, built = new Set()) {
  const packages = lockfile.packages ?? {};
  const entries = [];
  for (const [path, meta] of Object.entries(packages)) {
    /* The empty key is the project itself, which is not a dependency. */
    if (!path) continue;
    const name = meta.name ?? path.replace(/^.*node_modules\//, '');
    const development = !!meta.dev;
    const excluded = development ? null : notDistributedBecause(meta, name, built);
    entries.push({
      name,
      version: meta.version ?? 'unknown',
      licence: meta.license ?? null,
      licenceClass: classifyLicence(meta.license),
      development,
      /* Distributed unless it is development-only or there is a reason it
       * cannot be in the built output. */
      shipped: !development && !excluded,
      /* The reason, recorded so the exclusion is reviewable. */
      excludedBecause: excluded,
      optional: !!meta.optional,
      resolved: meta.resolved ?? null,
      integrity: meta.integrity ?? null,
    });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

/** The counts a reader wants, split by what actually ships. */
export function sbomSummary(entries) {
  const shipped = entries.filter((entry) => entry.shipped);
  const count = (list, klass) => list.filter((entry) => entry.licenceClass === klass).length;
  return {
    total: entries.length,
    shipped: shipped.length,
    development: entries.filter((entry) => entry.development).length,
    installedNotDistributed: entries.filter((entry) => entry.excludedBecause).length,
    shippedPermissive: count(shipped, 'permissive'),
    shippedCopyleft: count(shipped, 'copyleft'),
    shippedUndetermined: count(shipped, 'undetermined'),
    shippedOther: count(shipped, 'other'),
    /* Anything without a recorded integrity hash cannot be verified as being
     * what it was when the lockfile was written. */
    withoutIntegrity: entries.filter((entry) => entry.resolved && !entry.integrity).length,
  };
}

/** Shipped packages whose licence someone has to look at. */
export function licencesNeedingReview(entries) {
  return entries.filter((entry) => entry.shipped && entry.licenceClass !== 'permissive');
}

function table(headings, rows) {
  return [
    `| ${headings.join(' | ')} |`,
    `| ${headings.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/** The document, as Markdown. Deterministic, so a test can compare it. */
export function renderSbom(entries, audit) {
  const summary = sbomSummary(entries);
  const review = licencesNeedingReview(entries);
  const shipped = entries.filter((entry) => entry.shipped);
  const excluded = entries.filter((entry) => entry.excludedBecause);

  const vulnerabilities = audit
    ? table(
      ['Severity', 'Count'],
      Object.entries(audit).map(([severity, count]) => [severity, String(count)]),
    )
    : 'No audit result was supplied when this was generated.';

  return [
    '# Software bill of materials',
    '',
    'Generated from the lockfile rather than written, because a hand-maintained',
    'inventory is out of date the first time anyone installs and nobody notices',
    'until it matters. Regenerate it with `npm run sbom`.',
    '',
    'What ships and what does not are counted separately. A development',
    'dependency is not distributed, so its licence constrains the people building',
    'this product and not the people running it; reporting both in one list is',
    'how a project ends up believing it has a hundred licence obligations when it',
    'has four.',
    '',
    '## Counts',
    '',
    table(
      ['Measure', 'Count'],
      [
        ['Packages installed', String(summary.total)],
        ['Of those, distributed with the product', String(summary.shipped)],
        ['Development only', String(summary.development)],
        ['Installed but not distributed, with the reason recorded', String(summary.installedNotDistributed)],
        ['Shipped under a permissive licence', String(summary.shippedPermissive)],
        ['Shipped under a copyleft licence', String(summary.shippedCopyleft)],
        ['Shipped with an unrecognised licence expression', String(summary.shippedOther)],
        ['Shipped with no licence recorded', String(summary.shippedUndetermined)],
        ['Installed without a verifiable integrity hash', String(summary.withoutIntegrity)],
      ],
    ),
    '',
    '## Known vulnerabilities',
    '',
    vulnerabilities,
    '',
    '## Shipped packages whose licence needs a person',
    '',
    review.length
      ? table(
        ['Package', 'Version', 'Licence', 'Why it is listed'],
        review.map((entry) => [
          entry.name,
          entry.version,
          entry.licence ?? '(none recorded)',
          entry.licenceClass === 'copyleft'
            ? 'Copyleft: conditions apply to distributing a built artifact'
            : entry.licenceClass === 'undetermined'
              ? 'No licence recorded. Not the same as having none, and someone has to establish which'
              : 'Licence expression not recognised, so it is not assumed safe',
        ]),
      )
      : 'None. Every shipped package is under a licence that places no condition on distributing a built artifact.',
    '',
    '## Everything distributed with the product',
    '',
    table(
      ['Package', 'Version', 'Licence'],
      shipped.map((entry) => [entry.name, entry.version, entry.licence ?? '(none recorded)']),
    ),
    '',
    '## Installed but not distributed',
    '',
    excluded.length
      ? [
        'These are installed to build or test the product and are not in what it',
        'ships. Each says why, because an exclusion nobody can check is an',
        'exclusion nobody should trust.',
        '',
        table(
          ['Package', 'Version', 'Licence', 'Why it is not distributed'],
          excluded.map((entry) => [entry.name, entry.version, entry.licence ?? '(none recorded)', entry.excludedBecause ?? '']),
        ),
      ].join('\n')
      : 'None. Everything installed and not development-only is distributed.',
    '',
    '## What is not in this list',
    '',
    'Vendored code — an emulator core compiled into the image rather than',
    'installed from a registry — is not in the lockfile. It is recorded in',
    '`docs/third-party-components.md` with its upstream revision and licence, and',
    'the release gate verifies its checksums on every run. The ElkJS core carried',
    'there is GPL-2.0, which is the outstanding licence position recorded in',
    '`docs/adr/0008-elkjs-electron-adapter-and-gpl-position.md`.',
    '',
  ].join('\n');
}
