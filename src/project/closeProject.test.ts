import { describe, expect, it } from 'vitest';
import { closeOutcome, closeQuestion } from './closeProject';

describe('closing a project', () => {
  it('asks what to do with the stored copy when there is one', () => {
    const question = closeQuestion('harvest', [{ id: 'harvest', revisions: 3 }, { id: 'other', revisions: 1 }]);
    expect(question.asks).toBe(true);
    expect(question.stored?.revisions).toBe(3);
    expect(question.detail).toContain('3 revisions');
    expect(question.detail).toContain('removes this project from the browser either way');
  });

  it('asks nothing when the store holds no copy of it', () => {
    const question = closeQuestion('harvest', [{ id: 'other', revisions: 1 }]);
    expect(question.asks).toBe(false);
    expect(question.stored).toBeNull();
    expect(question.detail).toContain('holds no copy');
  });

  it('tells a store that could not be reached from one that is empty', () => {
    /* "There is no copy" and "nobody knows" are different things, and saying
     * the first when the second is true is a lie about where the work is. */
    const unreachable = closeQuestion('harvest', null);
    expect(unreachable.asks).toBe(false);
    expect(unreachable.detail).toContain('No project store answered');
    expect(closeQuestion('harvest', []).detail).toContain('holds no copy');
  });

  it('says what it did, including when the deletion was refused', () => {
    expect(closeOutcome('Harvest', 'keep-stored', null)).toContain('stored copy is untouched');
    expect(closeOutcome('Harvest', 'delete-stored', { revisions: 4 })).toBe('Closed Harvest and deleted 4 revisions from the store.');
    expect(closeOutcome('Harvest', 'delete-stored', { revisions: 1 })).toContain('1 revision from the store');
    expect(closeOutcome('Harvest', 'delete-stored', null, 'the store did not answer')).toContain('was not deleted: the store did not answer');
    expect(closeOutcome('Harvest', 'nothing-stored', null)).toBe('Closed Harvest.');
  });
});
