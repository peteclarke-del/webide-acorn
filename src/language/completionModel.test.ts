import { describe, expect, it } from 'vitest';
import { commitCharactersFor, completionContextAt, fuzzyMatch, rankCompletionItems } from './completionModel';
import type { LanguageItem } from './languageService';
import { languageTargetRevision } from './languageTarget';

const candidate = (token: string, source: LanguageItem['source']): LanguageItem => ({ token, kind: source?.kind === 'project' ? 'symbol' : 'command', detail: token, languages: ['bbc-basic'], source });

describe('completion interaction model', () => {
  it('replaces complete BASIC variable and snippet identifiers including suffixes and underscores', () => {
    expect(completionContextAt('10 FOR_', 7, 'bbc-basic')).toMatchObject({ prefix: 'FOR_', start: 3, end: 7 });
    expect(completionContextAt('20 PRINT score%', 15, 'bbc-basic')).toMatchObject({ prefix: 'score%', start: 9, end: 15 });
  });

  it('derives bounded replacement ranges and suppresses automatic BASIC completion in strings and comments', () => {
    expect(completionContextAt('10 PRI', 6, 'bbc-basic')).toEqual({ prefix: 'PRI', start: 3, end: 6, automatic: true });
    expect(completionContextAt('10 PRINT "PRI', 13, 'bbc-basic').automatic).toBe(false);
    expect(completionContextAt('10 REM PRI', 10, 'bbc-basic').automatic).toBe(false);
    expect(completionContextAt('10 PRINT "REM" : PRI', 20, 'bbc-basic').automatic).toBe(true);
    expect(completionContextAt('10aPRI', 6, 'bbc-basic', true)).toEqual({ prefix: 'PRI', start: 3, end: 6, automatic: true });
  });

  it('supports INCLUDE paths while suppressing ordinary assembly comments', () => {
    expect(completionContextAt(' INCLUDE "util', 14, '6502')).toEqual({ prefix: 'util', start: 10, end: 14, automatic: true });
    expect(completionContextAt(' INCLUDEASSET "hero', 19, '6502')).toEqual({ prefix: 'hero', start: 15, end: 19, automatic: true });
    expect(completionContextAt(' LDA #0 ; PR', 12, '6502').automatic).toBe(false);
    expect(completionContextAt(' EQUS ";" : LD', 14, '6502').automatic).toBe(true);
  });

  it('derives numeric BASIC targets and C include replacement ranges', () => {
    expect(completionContextAt('10 GOTO 10', 10, 'bbc-basic')).toEqual({ prefix: '10', start: 8, end: 10, automatic: true });
    expect(completionContextAt('#include "aco', 13, 'c')).toEqual({ prefix: 'aco', start: 10, end: 13, automatic: true });
    expect(completionContextAt('#include <peek', 14, 'c')).toEqual({ prefix: 'peek', start: 10, end: 14, automatic: true });
  });

  it('ranks exact and same-file project symbols first and marks ambiguous declarations', () => {
    const results = rankCompletionItems([
      candidate('PRINT', { kind: 'builtin', label: 'reference', version: '1' }),
      candidate('PROCdraw', { kind: 'project', label: 'other.bas', version: '2', fileId: 'other' }),
      candidate('PROCdraw', { kind: 'project', label: 'main.bas', version: '2', fileId: 'main' }),
    ], 'PROC', 'main');
    expect(results.map((result) => result.item.source?.fileId)).toEqual(['main', 'other']);
    expect(results.every((result) => result.ambiguousCount === 2)).toBe(true);
  });

  it('invalidates language results when exact generated build symbols change', () => {
    const target = { processor: '6502' as const, machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: true, enabledCapabilities: [], generatedSymbols: [{ name: 'draw', value: 0x1900 }] };
    expect(languageTargetRevision(target)).not.toBe(languageTargetRevision({ ...target, generatedSymbols: [{ name: 'draw', value: 0x1901 }] }));
  });
});

describe('finding a candidate by the characters in it, not only the ones it starts with', () => {
  it('matches characters in order, allowing gaps', () => {
    /* Typing every character of `draw_sprite` to reach it is not how anyone
     * works, and until now was the only way. */
    expect(fuzzyMatch('dsp', 'draw_sprite')).not.toBeNull();
    expect(fuzzyMatch('dsp', 'draw_sprite')!.positions).toEqual([0, 5, 6]);
    expect(fuzzyMatch('xyz', 'draw_sprite')).toBeNull();
    expect(fuzzyMatch('ward', 'draw_sprite')).toBeNull();
  });

  it('is worth more at a word boundary than in the middle of a word', () => {
    const boundary = fuzzyMatch('ds', 'draw_sprite')!.score;
    const middle = fuzzyMatch('ra', 'draw_sprite')!.score;
    expect(boundary).toBeGreaterThan(middle);
  });

  it('reads a capital in a camel-cased name as a boundary too', () => {
    expect(fuzzyMatch('ds', 'drawSprite')!.score).toBeGreaterThan(fuzzyMatch('ra', 'drawSprite')!.score);
  });

  it('prefers a tight match over a scattered one, and a shorter candidate over a longer', () => {
    expect(fuzzyMatch('dr', 'draw')!.score).toBeGreaterThan(fuzzyMatch('dr', 'd_e_f_r')!.score);
    expect(fuzzyMatch('dr', 'draw')!.score).toBeGreaterThan(fuzzyMatch('dr', 'draw_sprite_at_position')!.score);
  });

  it('matches whatever the case, and rewards the case that was typed', () => {
    expect(fuzzyMatch('LDA', 'lda')).not.toBeNull();
    expect(fuzzyMatch('lda', 'lda')!.score).toBeGreaterThan(fuzzyMatch('LDA', 'lda')!.score);
  });

  it('treats an empty query as matching everything at no advantage', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });
});

describe('where scattered matches sit in the list', () => {
  const item = (token: string): LanguageItem => ({ token, kind: 'symbol', detail: '', languages: ['6502'] }) as LanguageItem;

  it('never puts a scattered match above something that starts with what was typed', () => {
    /* Someone who typed the start of a name expects that name. A cleverer
     * ranking that put something else above it is worse than none. */
    const ranked = rankCompletionItems([item('do_something_pretty'), item('drop'), item('draw')], 'dr', 'main');
    expect(ranked.map((entry) => entry.item.token)).toEqual(['draw', 'drop', 'do_something_pretty']);
    expect(ranked.slice(0, 2).every((entry) => !entry.scattered)).toBe(true);
    expect(ranked[2]!.scattered).toBe(true);
  });

  it('holds scattered matching back until two characters have been typed', () => {
    /* With one character every token containing that letter would qualify,
     * which is a list nobody can read. */
    expect(rankCompletionItems([item('do_something_pretty')], 'p', 'main').map((entry) => entry.item.token)).toEqual([]);
    expect(rankCompletionItems([item('do_something_pretty')], 'pt', 'main').map((entry) => entry.item.token)).toEqual(['do_something_pretty']);
  });

  it('reports where the characters landed, so the list can show why a candidate is in it', () => {
    const [scattered] = rankCompletionItems([item('draw_sprite')], 'dsp', 'main');
    expect(scattered).toMatchObject({ scattered: true, matched: [0, 5, 6] });
    const [prefixed] = rankCompletionItems([item('draw_sprite')], 'dra', 'main');
    expect(prefixed).toMatchObject({ scattered: false, matched: [0, 1, 2] });
  });

  it('offers nothing at all when the characters are not there in order', () => {
    expect(rankCompletionItems([item('draw_sprite')], 'zzz', 'main')).toEqual([]);
  });
});

describe('the characters that accept a candidate', () => {
  const item = (kind: LanguageItem['kind'], overrides: Partial<LanguageItem> = {}): LanguageItem =>
    ({ token: 't', kind, detail: '', languages: ['6502'], ...overrides }) as LanguageItem;

  it('always accepts on Enter and Tab', () => {
    for (const kind of ['symbol', 'opcode', 'function', 'line'] as const) {
      expect(commitCharactersFor(item(kind))).toEqual(expect.arrayContaining(['Enter', 'Tab']));
    }
  });

  it('accepts a callable on an opening bracket', () => {
    expect(commitCharactersFor(item('function'))).toContain('(');
    expect(commitCharactersFor(item('macro', { parameters: ['x'] }))).toContain('(');
    /* A macro with no parameters is not called with brackets. */
    expect(commitCharactersFor(item('macro'))).not.toContain('(');
  });

  it('accepts an assembly symbol on the punctuation that ends an operand', () => {
    expect(commitCharactersFor(item('symbol'))).toEqual(expect.arrayContaining([',', ')']));
    expect(commitCharactersFor(item('constant'))).toContain(',');
    /* Not in BASIC or C, where a comma follows plenty of half-typed things. */
    expect(commitCharactersFor(item('variable', { languages: ['bbc-basic'] }))).not.toContain(',');
  });

  it('commits on nothing that occurs inside a real token', () => {
    /* A commit character that fires when someone meant to type the character
     * silently rewrites what they wrote, which is worse than not having one. */
    for (const kind of ['symbol', 'function', 'opcode', 'constant'] as const) {
      const characters = commitCharactersFor(item(kind));
      for (const forbidden of ['.', ' ', '_', 'a', '0', '-']) expect(characters, `${kind} ${forbidden}`).not.toContain(forbidden);
    }
  });
});
