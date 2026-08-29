// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { conditionState, definedNames, guardState, guardSummary, guardsByLine } from './cPreprocessor';

const defines = (...names: string[]) => definedNames(names);

/** The state of every line, so a test states the whole file at once. */
function states(content: string, target: ReadonlySet<string>): string[] {
  return guardsByLine(content).map((guards) => guardState(guards, target));
}

describe('reading the conditional structure of a file', () => {
  const source = [
    '#define ALWAYS 1',            // 1
    '#ifdef DEBUG',                // 2
    '#define TRACE 1',             // 3
    '#else',                       // 4
    '#define TRACE 0',             // 5
    '#endif',                      // 6
    '#define ALSO_ALWAYS 2',       // 7
  ].join('\n');

  it('guards only the lines inside a conditional, and none of the directives that bound it', () => {
    /* A directive belongs to the scope that encloses it, not to the arm it
     * opens or closes: otherwise `#else` would report itself as compiled out
     * of the build that is in fact taking its branch. */
    const guards = guardsByLine(source);
    expect(guards[0]).toEqual([]);
    expect(guards[1]).toEqual([]);
    expect(guards[2]!.map((guard) => guard.condition)).toEqual(['defined(DEBUG)']);
    expect(guards[3]).toEqual([]);
    expect(guards[4]!.map((guard) => guard.negated)).toEqual([true]);
    expect(guards[5]).toEqual([]);
    expect(guards[6]).toEqual([]);
  });

  it('takes the branch the target defines and refuses the other', () => {
    expect(states(source, defines('DEBUG'))).toEqual(['active', 'active', 'active', 'active', 'inactive', 'active', 'active']);
    expect(states(source, defines())).toEqual(['active', 'active', 'inactive', 'active', 'active', 'active', 'active']);
  });

  it('reads #ifndef as the negation of #ifdef', () => {
    const guarded = '#ifndef HEADER_H\n#define HEADER_H\n#endif';
    expect(states(guarded, defines())[1]).toBe('active');
    expect(states(guarded, defines('HEADER_H'))[1]).toBe('inactive');
  });

  it('follows nesting, so an inner branch inside a dead outer one is dead', () => {
    const nested = [
      '#ifdef OUTER',
      '#ifdef INNER',
      '#define BOTH 1',
      '#endif',
      '#endif',
    ].join('\n');
    expect(states(nested, defines('OUTER', 'INNER'))[2]).toBe('active');
    expect(states(nested, defines('INNER'))[2]).toBe('inactive');
    expect(states(nested, defines('OUTER'))[2]).toBe('inactive');
  });

  it('reads an #elif arm as its own condition', () => {
    const chain = [
      '#ifdef BBC',
      '#define TARGET 1',
      '#elif defined(ARCHIMEDES)',
      '#define TARGET 2',
      '#else',
      '#define TARGET 0',
      '#endif',
    ].join('\n');
    expect(states(chain, defines('ARCHIMEDES'))[3]).toBe('active');
    expect(states(chain, defines('BBC'))[1]).toBe('active');
    expect(states(chain, defines())[5]).toBe('active');
  });

  it('is not confused by a directive written with spaces after the hash', () => {
    expect(guardsByLine('#  ifdef DEBUG\nint x;\n#  endif')[1]!.map((guard) => guard.condition)).toEqual(['defined(DEBUG)']);
  });

  it('ignores a comment on the directive line', () => {
    expect(guardsByLine('#ifdef DEBUG /* only in debug */\nint x;')[1]![0]!.condition).toBe('defined(DEBUG)');
  });
});

describe('deciding a condition, and admitting when it cannot be decided', () => {
  it('decides the forms that can be decided without evaluating C', () => {
    expect(conditionState('defined(DEBUG)', defines('DEBUG'))).toBe('active');
    expect(conditionState('defined DEBUG', defines('DEBUG'))).toBe('active');
    expect(conditionState('DEBUG', defines())).toBe('inactive');
    expect(conditionState('!defined(DEBUG)', defines())).toBe('active');
    expect(conditionState('defined(A) && defined(B)', defines('A', 'B'))).toBe('active');
    expect(conditionState('defined(A) && defined(B)', defines('A'))).toBe('inactive');
    expect(conditionState('defined(A) || defined(B)', defines('B'))).toBe('active');
    expect(conditionState('(defined(A))', defines('A'))).toBe('active');
  });

  it('reads the #if 0 idiom that comments a block out, and #if 1', () => {
    expect(conditionState('0', defines())).toBe('inactive');
    expect(conditionState('1', defines())).toBe('active');
  });

  it('says it does not know rather than guessing, which is the whole point', () => {
    /* Deciding these needs the value of a macro and an expression evaluator.
     * Guessing would put a symbol in front of someone with a confidence this
     * product has not earned. */
    for (const condition of ['VERSION > 2', 'SIZE == 8', '__GNUC__ >= 4', 'A + B', '']) {
      expect(conditionState(condition, defines()), condition).toBe('unknown');
    }
  });

  it('still settles an expression when one decided operand is enough', () => {
    /* `false && anything` is false, and `true || anything` is true, whatever
     * the other operand turns out to be. */
    expect(conditionState('defined(MISSING) && VERSION > 2', defines())).toBe('inactive');
    expect(conditionState('defined(PRESENT) || VERSION > 2', defines('PRESENT'))).toBe('active');
    expect(conditionState('defined(PRESENT) && VERSION > 2', defines('PRESENT'))).toBe('unknown');
  });

  it('carries an unknown through a whole guard stack without collapsing it', () => {
    const source = '#ifdef BBC\n#if VERSION > 2\nint late;\n#endif\n#endif';
    expect(states(source, defines('BBC'))[2]).toBe('unknown');
    /* A dead outer guard settles it regardless of the inner unknown. */
    expect(states(source, defines())[2]).toBe('inactive');
  });
});

describe('what a person is told about a guarded line', () => {
  it('says nothing at all about an unconditional line', () => {
    expect(guardSummary([], 'active')).toBeNull();
  });

  it('names the condition in each of the three states', () => {
    const guards = guardsByLine('#ifdef DEBUG\nint x;')[1]!;
    expect(guardSummary(guards, 'active')).toBe('Compiled for this build target, under defined(DEBUG).');
    expect(guardSummary(guards, 'inactive')).toBe('Not compiled for this build target: it is inside defined(DEBUG).');
    expect(guardSummary(guards, 'unknown')).toContain('which this build target does not settle');
  });

  it('reads an #else arm back as a negation', () => {
    const guards = guardsByLine('#ifdef DEBUG\nint a;\n#else\nint b;')[3]!;
    expect(guardSummary(guards, 'inactive')).toContain('not defined(DEBUG)');
  });
});

describe('the names a build target defines', () => {
  it('takes the name from a NAME=value define, and drops an empty one', () => {
    const names = definedNames(['DEBUG', 'VERSION=3', ' SPACED = 1 ', '']);
    expect([...names].sort()).toEqual(['DEBUG', 'SPACED', 'VERSION']);
  });
});
