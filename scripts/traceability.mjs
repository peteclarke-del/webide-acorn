/* Requirement to evidence, read from the backlog rather than maintained twice.
 *
 * The backlog already carries the requirement identifiers and, under the ones
 * that are done, what was built and how it was verified. A separate
 * traceability matrix maintained by hand would be a second copy of that, and a
 * second copy is a copy that disagrees. So this reads the backlog and reports
 * what it finds.
 *
 * The report exists to answer one question honestly: which completed
 * requirements say how they were verified, and which do not. A tick with
 * nothing behind it is the failure this is for — it looks like progress and is
 * not, and the only way to see it is to count.
 *
 * It reports three states rather than two, because two would be a lie in both
 * directions:
 *
 *   traced      the requirement records its verification under an Evidence
 *               heading, where it can be found
 *   described   the requirement names contracts, tests or a browser run in its
 *               prose but not under that heading. The work was done; the
 *               record is harder to follow
 *   untraced    neither. This is the finding
 *
 * Nothing here decides whether the evidence is good. It decides whether
 * verification was recorded at all, which is the part a machine can settle.
 */

/** A requirement, as the backlog records it. */
export function parseBacklog(markdown) {
  const lines = markdown.split('\n');
  const requirements = [];
  let current = null;
  let section = '';

  for (const line of lines) {
    const heading = /^#{2,3}\s+(.*)$/.exec(line);
    if (heading) { section = heading[1].trim(); continue; }

    /* A requirement is a top-level checkbox whose text opens with an
     * identifier. Anything else at that level is a note and is not traced. */
    /* An identifier can carry more than two segments — AST-INC-01 — so the
     * pattern takes every hyphenated part rather than stopping at the first,
     * which would read that as AST-INC and then fail to match the line. */
    const top = /^- \[([ x])\] ([A-Z][A-Z0-9]*(?:-[0-9A-Z]+)+)\s+(.*)$/.exec(line);
    if (top) {
      current = {
        id: top[2],
        complete: top[1] === 'x',
        title: top[3].trim(),
        section,
        evidence: [],
        prose: [],
        subItems: 0,
        subItemsComplete: 0,
      };
      requirements.push(current);
      continue;
    }
    if (/^- \[[ x]\]/.test(line)) { current = null; continue; }
    if (/^#/.test(line)) { current = null; continue; }
    if (!current) continue;

    const sub = /^\s+- \[([ x])\]\s+(.*)$/.exec(line);
    if (sub) {
      current.subItems += 1;
      if (sub[1] === 'x') current.subItemsComplete += 1;
      /* Evidence is recorded deliberately, under its own heading, so that it
       * can be found. A claim buried in prose is not traceable. */
      if (/^Evidence[:.]/i.test(sub[2])) current.evidence.push(sub[2].replace(/^Evidence[:.]\s*/i, ''));
      else current.prose.push(sub[2]);
      continue;
    }
    /* A continuation of whichever line was last opened. Two spaces, because
     * that is how the backlog wraps a top-level item; a deeper indent is a
     * sub-item and was matched above. */
    if (/^\s{2,}\S/.test(line)) {
      if (current.evidence.length) current.evidence[current.evidence.length - 1] += ` ${line.trim()}`;
      else if (current.prose.length) current.prose[current.prose.length - 1] += ` ${line.trim()}`;
      else current.title += ` ${line.trim()}`;
    }
  }
  return requirements;
}

/* Words that name a verification rather than describe a feature. Deliberately
 * narrow: "tested" on its own is a claim, while a contract, a test count or a
 * browser run is a thing someone can go and look at. */
const VERIFICATION = /\b(contract|contracts|test|tests|suite|browser run|chromium|gate|verified|evidence|assertions?)\b/i;

/** How a requirement records its verification: traced, described, or neither. */
export function traceState(requirement) {
  if (!requirement.complete) return 'open';
  if (requirement.evidence.length) return 'traced';
  const text = [requirement.title, ...requirement.prose].join(' ');
  return VERIFICATION.test(text) ? 'described' : 'untraced';
}

/** The counts a reader wants first, and the one that matters most. */
export function traceabilitySummary(requirements) {
  const count = (state) => requirements.filter((requirement) => traceState(requirement) === state).length;
  const complete = requirements.filter((requirement) => requirement.complete).length;
  return {
    total: requirements.length,
    complete,
    open: count('open'),
    traced: count('traced'),
    described: count('described'),
    /* The finding this report exists for. */
    untraced: count('untraced'),
  };
}

/** Requirements marked done that say nothing about verification. */
export function untracedRequirements(requirements) {
  return requirements.filter((requirement) => traceState(requirement) === 'untraced');
}

function table(headings, rows) {
  return [
    `| ${headings.join(' | ')} |`,
    `| ${headings.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/** Trim a sentence for a table cell without cutting a word in half. */
function shorten(text, limit) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** The report, as Markdown. Deterministic, so a test can compare it. */
export function renderTraceability(requirements) {
  const summary = traceabilitySummary(requirements);
  const untraced = untracedRequirements(requirements);
  const byPrefix = new Map();
  for (const requirement of requirements) {
    const prefix = requirement.id.split('-')[0];
    const entry = byPrefix.get(prefix) ?? { prefix, total: 0, complete: 0, traced: 0, described: 0, untraced: 0 };
    entry.total += 1;
    if (requirement.complete) entry.complete += 1;
    const state = traceState(requirement);
    if (state === 'traced' || state === 'described' || state === 'untraced') entry[state] += 1;
    byPrefix.set(prefix, entry);
  }

  return [
    '# Requirement traceability',
    '',
    'This report is generated from the backlog, which already carries the',
    'requirement identifiers and, under the ones that are done, what was built',
    'and how it was verified. A matrix maintained separately would be a second',
    'copy of that, and a second copy is a copy that disagrees. Regenerate it',
    'with `npm run traceability`.',
    '',
    'It answers one question: which completed requirements say how they were',
    'verified, and which do not. A tick with nothing behind it looks like',
    'progress and is not, and the only way to see it is to count. Nothing here',
    'decides whether the evidence is good — only whether it was recorded, which',
    'is the part a machine can settle.',
    '',
    '## What the three states mean',
    '',
    '- **Traced** — the requirement records its verification under an Evidence heading, where it can be found.',
    '- **Described** — the requirement names contracts, tests or a browser run in its prose but not under that heading. The work was done; the record is harder to follow.',
    '- **Untraced** — neither. This is the finding.',
    '',
    '## Where the work stands',
    '',
    table(
      ['Measure', 'Count'],
      [
        ['Requirements tracked', String(summary.total)],
        ['Complete', String(summary.complete)],
        ['Complete and traced', String(summary.traced)],
        ['Complete and described', String(summary.described)],
        ['Complete and untraced', String(summary.untraced)],
        ['Open', String(summary.open)],
      ],
    ),
    '',
    '## By area',
    '',
    table(
      ['Area', 'Tracked', 'Complete', 'Traced', 'Described', 'Untraced'],
      [...byPrefix.values()]
        .sort((left, right) => right.total - left.total || left.prefix.localeCompare(right.prefix))
        .map((entry) => [entry.prefix, String(entry.total), String(entry.complete), String(entry.traced), String(entry.described), String(entry.untraced)]),
    ),
    '',
    '## Completed requirements that say nothing about verification',
    '',
    untraced.length
      ? [
        'Each of these is marked done and names no contract, test or run. They',
        'are listed rather than quietly counted.',
        '',
        table(['Requirement', 'Title'], untraced.map((requirement) => [requirement.id, shorten(requirement.title, 90)])),
      ].join('\n')
      : 'None. Every completed requirement records how it was verified.',
    '',
    '## Completed requirements and their evidence',
    '',
    table(
      ['Requirement', 'Title', 'Evidence'],
      requirements
        .filter((requirement) => traceState(requirement) === 'traced')
        .map((requirement) => [requirement.id, shorten(requirement.title, 70), shorten(requirement.evidence.join(' '), 220)]),
    ),
    '',
    '## Open requirements',
    '',
    table(
      ['Requirement', 'Title', 'Progress'],
      requirements
        .filter((requirement) => !requirement.complete)
        .map((requirement) => [
          requirement.id,
          shorten(requirement.title, 90),
          requirement.subItems ? `${requirement.subItemsComplete} of ${requirement.subItems} parts done` : 'not started',
        ]),
    ),
    '',
  ].join('\n');
}
