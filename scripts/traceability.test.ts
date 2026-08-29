// @vitest-environment node

/* The report is derived output: the test regenerates it from the backlog every
 * run rather than comparing against a checked-in copy, because the backlog
 * changes with every completed requirement and a stale-file comparison would
 * fail the gate on the very commit that did the work. What is asserted here is
 * that the parser reads the backlog correctly and that the report says what it
 * claims to say. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  parseBacklog,
  renderTraceability,
  traceState,
  traceabilitySummary,
  untracedRequirements,
} from './traceability.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let backlog = '';
let requirements: ReturnType<typeof parseBacklog> = [];

beforeAll(async () => {
  backlog = await readFile(join(root, 'docs', 'todo.md'), 'utf8');
  requirements = parseBacklog(backlog);
  await writeFile(join(root, 'docs', 'traceability.md'), renderTraceability(requirements), 'utf8');
});

describe('reading the backlog', () => {
  it('finds every requirement the backlog states, and nothing that is not one', () => {
    const identifiers = (backlog.match(/^- \[[ x]\] [A-Z][A-Z0-9]*(?:-[0-9A-Z]+)+\s/gm) ?? []).length;
    expect(requirements).toHaveLength(identifiers);
    expect(requirements.length).toBeGreaterThan(200);
    for (const requirement of requirements) expect(requirement.id).toMatch(/^[A-Z][A-Z0-9]*(?:-[0-9A-Z]+)+$/);
  });

  it('reads a wrapped title as one title rather than losing the rest of it', () => {
    /* The backlog wraps a long requirement across lines with a two-space
     * indent. Reading only the first line would drop the half that usually
     * says how the work was verified. */
    const parsed = parseBacklog([
      '- [x] ABC-100 A requirement whose title runs on',
      '  across a second line and mentions its contracts.',
    ].join('\n'));
    expect(parsed[0]!.title).toContain('across a second line');
    expect(traceState(parsed[0]!)).toBe('described');
  });

  it('separates an Evidence sub-item from ordinary prose', () => {
    const parsed = parseBacklog([
      '- [x] ABC-100 A requirement',
      '  - [x] Something that was built.',
      '  - [x] Evidence: 12 contracts covering the boundary.',
      '    and a browser run against the built artefact.',
    ].join('\n'));
    expect(parsed[0]!.evidence).toHaveLength(1);
    expect(parsed[0]!.evidence[0]).toContain('12 contracts');
    expect(parsed[0]!.evidence[0]).toContain('browser run');
    expect(parsed[0]!.prose).toHaveLength(1);
    expect(traceState(parsed[0]!)).toBe('traced');
  });

  it('counts the parts of an open requirement that are done', () => {
    const parsed = parseBacklog([
      '- [ ] ABC-100 A requirement in progress',
      '  - [x] One part done.',
      '  - [x] Another part done.',
      '  - [ ] A part still open.',
    ].join('\n'));
    expect(parsed[0]).toMatchObject({ complete: false, subItems: 3, subItemsComplete: 2 });
    expect(traceState(parsed[0]!)).toBe('open');
  });
});

describe('the three states', () => {
  it('calls a done requirement with an Evidence heading traced', () => {
    expect(traceState({ complete: true, evidence: ['4 contracts'], prose: [], title: 'x' })).toBe('traced');
  });

  it('calls one that names verification only in prose described, not traced', () => {
    /* The work was done; the record is harder to follow. Saying it was traced
     * would overstate, and saying it was untraced would be wrong. */
    expect(traceState({ complete: true, evidence: [], prose: ['Unit and browser tests cover it.'], title: 'x' })).toBe('described');
  });

  it('calls one that says nothing about verification untraced, which is the finding', () => {
    expect(traceState({ complete: true, evidence: [], prose: ['It works well now.'], title: 'A feature' })).toBe('untraced');
  });

  it('does not accept a bare claim of having tested as evidence of it', () => {
    /* "Thoroughly checked" is a claim. A contract is a thing to go and look
     * at, which is the difference the word list is drawn on. */
    expect(traceState({ complete: true, evidence: [], prose: ['Thoroughly checked by hand.'], title: 'x' })).toBe('untraced');
  });
});

describe('the report', () => {
  it('adds up: every requirement is in exactly one state', () => {
    const summary = traceabilitySummary(requirements);
    expect(summary.traced + summary.described + summary.untraced + summary.open).toBe(summary.total);
    expect(summary.traced + summary.described + summary.untraced).toBe(summary.complete);
  });

  it('lists every untraced requirement rather than only counting them', () => {
    const untraced = untracedRequirements(requirements);
    const report = renderTraceability(requirements);
    for (const requirement of untraced) expect(report, requirement.id).toContain(requirement.id);
  });

  it('says plainly that it does not judge whether the evidence is good', () => {
    expect(renderTraceability(requirements)).toContain('decides whether the evidence is good');
  });

  it('produces the same bytes every time', () => {
    expect(renderTraceability(requirements)).toBe(renderTraceability(requirements));
  });
});
