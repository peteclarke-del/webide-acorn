// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { inlayHintLabel, inlayHintRail } from './inlayHintRail';
import type { SourceTypeHint } from '../language/projectLanguageService';

const hint = (over: Partial<SourceTypeHint> = {}): SourceTypeHint => ({
  token: 'count', line: 3, column: 5, type: 'unsigned int', storage: '2 bytes',
  detail: 'declared here', role: 'variable', ...over,
});

describe('deciding whether hints can be decorated at all', () => {
  it('draws nothing and says nothing when the decoration is switched off', () => {
    /* Off is a choice, not a fault, so it carries no reason to explain. */
    const rail = inlayHintRail([hint()], { enabled: false, wordWrap: false });
    expect(rail).toEqual({ available: false, unavailableReason: null, rows: [] });
  });

  it('refuses to decorate under word wrap, and says why', () => {
    /* A wrapped line takes several rows, so a rail beside it would sit against
     * the wrong lines — a decoration that is confidently wrong. */
    const rail = inlayHintRail([hint()], { enabled: true, wordWrap: true });
    expect(rail.available).toBe(false);
    expect(rail.unavailableReason).toMatch(/sit against the wrong lines/);
    expect(rail.rows).toEqual([]);
  });

  it('says when the scan is paused rather than reporting that nothing has a type', () => {
    const rail = inlayHintRail([], { enabled: true, wordWrap: false, paused: true });
    expect(rail.unavailableReason).toMatch(/Large source mode has paused the type scan/);
  });

  it('says when nothing has an authoritative type, which is not the same as being paused', () => {
    const rail = inlayHintRail([], { enabled: true, wordWrap: false });
    expect(rail.unavailableReason).toMatch(/No authoritative type is known/);
  });
});

describe('what a rail row shows', () => {
  it('gives one row per line, in line order', () => {
    const rail = inlayHintRail([hint({ line: 9 }), hint({ line: 2 })], { enabled: true, wordWrap: false });
    expect(rail.available).toBe(true);
    expect(rail.rows.map((row) => row.line)).toEqual([2, 9]);
  });

  it('says how many hints a line carries rather than dropping the rest', () => {
    /* One row has room for one type; showing only the first without saying so
     * would make a line with three types look as though it had one. */
    const rail = inlayHintRail([
      hint({ line: 4, column: 20, token: 'b', type: 'char' }),
      hint({ line: 4, column: 3, token: 'a', type: 'int' }),
      hint({ line: 4, column: 40, token: 'c', type: 'long' }),
    ], { enabled: true, wordWrap: false });
    expect(rail.rows).toHaveLength(1);
    expect(rail.rows[0]!.count).toBe(3);
    /* The leftmost is the one shown, since that is the one read first. */
    expect(rail.rows[0]!.label).toBe('int 2 bytes +2');
    expect(rail.rows[0]!.detail).toContain('a: int');
    expect(rail.rows[0]!.detail).toContain('c: long');
  });

  it('carries everything the panel knows into the detail, so the rail is not a lesser answer', () => {
    const rail = inlayHintRail([hint({
      type: 'unsigned char', storage: '1 byte', signedness: 'unsigned',
      addressSpace: 'near', returns: 'void', parameters: ['int x'], callingConvention: 'cdecl',
    })], { enabled: true, wordWrap: false });
    const detail = rail.rows[0]!.detail;
    for (const part of ['count: unsigned char', '1 byte', 'unsigned', 'near', 'returns void', 'parameters int x', 'cdecl']) {
      expect(detail).toContain(part);
    }
  });

  it('does not repeat the type when the storage says the same thing', () => {
    expect(inlayHintLabel(hint({ type: 'int', storage: 'int' }))).toBe('int');
    expect(inlayHintLabel(hint({ type: 'int', storage: '2 bytes' }))).toBe('int 2 bytes');
  });

  it('says a function takes no parameters rather than omitting the fact', () => {
    const rail = inlayHintRail([hint({ role: 'return', parameters: [] })], { enabled: true, wordWrap: false });
    expect(rail.rows[0]!.detail).toContain('parameters none');
  });
});
