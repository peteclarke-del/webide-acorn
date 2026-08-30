import { describe, expect, it } from 'vitest';
import { sourceLineDiff } from './sourceDiff';

describe('source line diff', () => {
  it('produces an exact line sequence for insertions and removals', () => {
    const result = sourceLineDiff('one\ntwo\nthree', 'zero\none\nthree\nfour');
    expect(result).toMatchObject({ added: 2, removed: 1, exact: true });
    expect(result.rows.map((row) => [row.kind, row.beforeLine, row.afterLine, row.text])).toEqual([
      ['added', undefined, 1, 'zero'],
      ['unchanged', 1, 2, 'one'],
      ['removed', 2, undefined, 'two'],
      ['unchanged', 3, 3, 'three'],
      ['added', undefined, 4, 'four'],
    ]);
  });

  it('uses a bounded aligned comparison for very large line matrices', () => {
    const left = Array.from({ length: 501 }, (_, index) => `old ${index}`).join('\n');
    const right = Array.from({ length: 501 }, (_, index) => `new ${index}`).join('\n');
    const result = sourceLineDiff(left, right);
    expect(result.exact).toBe(false);
    expect(result.rows).toHaveLength(1002);
  });
});
