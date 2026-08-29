import { describe, expect, it } from 'vitest';
import { previewMissingBasicLineNumber } from './basicQuickFix';

describe('BASIC missing line-number quick fix', () => {
  it('previews a collision-free number between surrounding declarations', () => {
    const preview = previewMissingBasicLineNumber('10 PRINT "A"\nPRINT "B"\n20 END', 2, { start: 10, increment: 10 });
    expect(preview).toMatchObject({ number: 15, changed: true, errors: [] });
    expect(preview.after).toBe('10 PRINT "A"\n15 PRINT "B"\n20 END');
  });

  it('refuses blank, already-numbered and no-gap rows without changing source', () => {
    expect(previewMissingBasicLineNumber('10 END', 1, { start: 10, increment: 10 }).errors[0]).toContain('already');
    expect(previewMissingBasicLineNumber('10 END\n\n20 END', 2, { start: 10, increment: 10 }).errors[0]).toContain('blank');
    expect(previewMissingBasicLineNumber('10 END\nPRINT\n11 END', 2, { start: 10, increment: 10 }).errors[0]).toContain('No free line number');
  });
});
