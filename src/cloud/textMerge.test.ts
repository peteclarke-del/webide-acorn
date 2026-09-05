// @vitest-environment node

/* The dangerous outcome is not a conflict, it is a clean-looking wrong merge.
 * These check that a region only one side touched is taken, and a region both
 * touched differently is reported rather than chosen between. */
import { describe, expect, it } from 'vitest';
import { mergeText } from './textMerge';

const base = ['.start', ' LDA #0', ' STA &70', ' RTS'].join('\n');

describe('when there is nothing to decide', () => {
  it('takes the side that changed when only one did', () => {
    const ours = base.replace(' LDA #0', ' LDA #1');
    expect(mergeText(base, ours, base)).toEqual({ merged: ours, conflicts: [], clean: true });
    expect(mergeText(base, base, ours)).toEqual({ merged: ours, conflicts: [], clean: true });
  });

  it('takes one copy when both made the same change', () => {
    const same = base.replace(' RTS', ' JMP done');
    expect(mergeText(base, same, same).clean).toBe(true);
    expect(mergeText(base, same, same).merged).toBe(same);
  });

  it('combines edits in different places without a conflict', () => {
    /* The case a merge exists for: two people working on one file and not on
     * each other's lines. */
    const ours = base.replace(' LDA #0', ' LDA #1');
    const theirs = base.replace(' RTS', ' NOP\n RTS');
    const merged = mergeText(base, ours, theirs);
    expect(merged.clean).toBe(true);
    expect(merged.merged).toContain(' LDA #1');
    expect(merged.merged).toContain(' NOP');
  });

  it('keeps additions from both sides at different ends of a file', () => {
    const ours = `; ours\n${base}`;
    const theirs = `${base}\n; theirs`;
    const merged = mergeText(base, ours, theirs);
    expect(merged.clean).toBe(true);
    expect(merged.merged.startsWith('; ours')).toBe(true);
    expect(merged.merged.endsWith('; theirs')).toBe(true);
  });
});

describe('when both sides changed the same thing', () => {
  it('reports a conflict rather than choosing which edit mattered', () => {
    const ours = base.replace(' LDA #0', ' LDA #1');
    const theirs = base.replace(' LDA #0', ' LDA #2');
    const merged = mergeText(base, ours, theirs);
    expect(merged.clean).toBe(false);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]!.ours).toEqual([' LDA #1']);
    expect(merged.conflicts[0]!.theirs).toEqual([' LDA #2']);
  });

  it('keeps both versions in the output, marked, rather than discarding one', () => {
    /* A merge that dropped a side would lose work silently; a person has to be
     * able to see what was in conflict. */
    const merged = mergeText(base, base.replace(' RTS', ' BRK'), base.replace(' RTS', ' NOP'));
    expect(merged.merged).toContain('<<<<<<< yours');
    expect(merged.merged).toContain(' BRK');
    expect(merged.merged).toContain('=======');
    expect(merged.merged).toContain(' NOP');
    expect(merged.merged).toContain('>>>>>>> the store');
  });

  it('says where in the merged text each conflict begins', () => {
    const ours = ['; ours', ...base.split('\n')].join('\n').replace(' RTS', ' BRK');
    const theirs = ['; ours', ...base.split('\n')].join('\n').replace(' RTS', ' NOP');
    const merged = mergeText(base, ours, theirs);
    expect(merged.conflicts[0]!.line).toBeGreaterThan(1);
  });

  it('reports a deletion against an edit as a conflict rather than resurrecting or dropping the line', () => {
    const ours = base.split('\n').filter((line) => line !== ' STA &70').join('\n');
    const theirs = base.replace(' STA &70', ' STA &71');
    expect(mergeText(base, ours, theirs).clean).toBe(false);
  });
});

describe('the shapes that are easy to get wrong', () => {
  it('leaves a trailing newline exactly as it was', () => {
    /* Losing or inventing one changes the file for no reason anybody asked
     * for, and shows up as a spurious difference in every later merge. */
    const withNewline = `${base}\n`;
    expect(mergeText(withNewline, withNewline, withNewline).merged).toBe(withNewline);
    expect(mergeText(withNewline, `${base}\n; ours\n`, withNewline).merged.endsWith('\n')).toBe(true);
  });

  it('merges into an empty file and out of one', () => {
    expect(mergeText('', 'ours', '').merged).toBe('ours');
    expect(mergeText('was here', '', 'was here').merged).toBe('');
  });

  it('does not need a diff when the two sides already agree', () => {
    expect(mergeText('anything', 'same', 'same')).toEqual({ merged: 'same', conflicts: [], clean: true });
  });
});
