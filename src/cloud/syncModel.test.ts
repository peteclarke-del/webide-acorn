// @vitest-environment node

/* The state is derived rather than remembered, because a remembered flag is
 * wrong exactly when it matters: after a crash, a reload, or a second
 * workbench. These check each way it can be derived, and what is offered.
 */
import { describe, expect, it } from 'vitest';
import { MAX_QUEUED_COMMITS, compareRevisions, forkProjectId, quotaWarnings, isMergeableName, planMerge, queueCommit, syncActions, syncState, type QueuedCommit } from './syncModel';

const facts = (over: Partial<Parameters<typeof syncState>[0]> = {}) => ({
  storeHead: null, syncedAt: null, locallyChanged: false, reachable: true, ...over,
});

describe('deriving the state', () => {
  it('calls a project nobody has stored untracked, which is not a problem', () => {
    expect(syncState(facts())).toBe('untracked');
    expect(syncActions('untracked').detail).toMatch(/Copying leaves the local one exactly as it is/);
  });

  it('separates ahead, behind and in step by what the store head is against what was synchronised', () => {
    expect(syncState(facts({ storeHead: 'r1', syncedAt: 'r1' }))).toBe('in-step');
    expect(syncState(facts({ storeHead: 'r1', syncedAt: 'r1', locallyChanged: true }))).toBe('ahead');
    expect(syncState(facts({ storeHead: 'r2', syncedAt: 'r1' }))).toBe('behind');
  });

  it('calls it diverged only when both moved', () => {
    /* The one state where something has to be decided, so it must not be
     * reported for a case where nothing does. */
    expect(syncState(facts({ storeHead: 'r2', syncedAt: 'r1', locallyChanged: true }))).toBe('diverged');
    expect(syncActions('diverged').detail).toMatch(/Nothing is sent or overwritten until a merge is reviewed/);
  });

  it('treats a project that vanished from the store as diverged rather than untracked', () => {
    /* Having synchronised against something now absent is not the same as
     * never having stored it, and offering "copy it up" would overwrite
     * whatever replaced it. */
    expect(syncState(facts({ storeHead: null, syncedAt: 'r1' }))).toBe('diverged');
  });

  it('treats a store the workbench has never synchronised as behind when nothing is local', () => {
    expect(syncState(facts({ storeHead: 'r1', syncedAt: null }))).toBe('behind');
    expect(syncState(facts({ storeHead: 'r1', syncedAt: null, locallyChanged: true }))).toBe('diverged');
  });

  it('reports offline without pretending to know anything else', () => {
    expect(syncState(facts({ storeHead: 'r1', syncedAt: 'r1', locallyChanged: true, reachable: false }))).toBe('offline');
    expect(syncActions('offline').primary).toBeNull();
    expect(syncActions('offline').detail).toMatch(/Local work is unaffected/);
  });

  it('offers nothing to do when there is nothing to do', () => {
    expect(syncActions('in-step').primary).toBeNull();
  });
});

describe('the offline queue', () => {
  const commit = (over: Partial<QueuedCommit> = {}): QueuedCommit => ({
    id: 'q1', projectId: 'demo', files: { 'a.asm': 'one' }, parent: 'r1', note: '', queuedAt: 't', ...over,
  });

  it('supersedes an unsent change for the same project rather than stacking them', () => {
    /* The queue should say what still has to happen, not what was typed. */
    const first = queueCommit([], commit({ id: 'q1', files: { 'a.asm': 'one' } }));
    const second = queueCommit(first.queue, commit({ id: 'q2', files: { 'a.asm': 'two' }, parent: 'r9' }));
    expect(second.queue).toHaveLength(1);
    expect(second.queue[0]!.files['a.asm']).toBe('two');
    /* The earliest parent survives, because that is what the whole run was
     * written against. */
    expect(second.queue[0]!.parent).toBe('r1');
  });

  it('keeps changes to different projects separately', () => {
    const first = queueCommit([], commit({ projectId: 'one' }));
    const second = queueCommit(first.queue, commit({ projectId: 'two' }));
    expect(second.queue.map((entry) => entry.projectId)).toEqual(['one', 'two']);
  });

  it('refuses a full queue rather than dropping the oldest', () => {
    /* Dropping the oldest loses the work somebody has most forgotten about. */
    let queue: QueuedCommit[] = [];
    for (let index = 0; index < MAX_QUEUED_COMMITS; index += 1) {
      queue = queueCommit(queue, commit({ projectId: `p${index}` })).queue;
    }
    const full = queueCommit(queue, commit({ projectId: 'one-too-many' }));
    expect(full.queue).toHaveLength(MAX_QUEUED_COMMITS);
    expect(full.refusal).toMatch(/rather than letting the oldest be forgotten/);
  });
});

describe('planning a merge', () => {
  const base = { 'a.asm': 'one\ntwo\nthree', 'art.asset.json': '{"a":1}' };

  it('merges a file each side changed in a different place', () => {
    const plan = planMerge(base, { ...base, 'a.asm': 'ONE\ntwo\nthree' }, { ...base, 'a.asm': 'one\ntwo\nTHREE' });
    expect(plan.clean).toBe(true);
    expect(plan.files.find((file) => file.name === 'a.asm')!.content).toBe('ONE\ntwo\nTHREE');
  });

  it('reports a conflict where both changed the same line', () => {
    const plan = planMerge(base, { ...base, 'a.asm': 'ours\ntwo\nthree' }, { ...base, 'a.asm': 'theirs\ntwo\nthree' });
    expect(plan.clean).toBe(false);
    expect(plan.files.find((file) => file.name === 'a.asm')!.outcome).toBe('conflict');
    expect(plan.forkAdvice).toMatch(/fork and keep both versions/);
  });

  it('refuses to merge content that is not text, and chooses neither side', () => {
    /* A packed sprite merged as text is corrupt in a way nobody sees until it
     * runs. */
    expect(isMergeableName('sprite.asset.json')).toBe(true);
    expect(isMergeableName('disk.ssd')).toBe(false);
    const plan = planMerge({ 'disk.ssd': 'aaa' }, { 'disk.ssd': 'bbb' }, { 'disk.ssd': 'ccc' });
    const file = plan.files[0]!;
    expect(file.outcome).toBe('not-text');
    expect(plan.clean).toBe(false);
  });

  it('keeps a file only one side has', () => {
    const plan = planMerge(base, { ...base, 'new.asm': 'ours' }, base);
    expect(plan.files.find((file) => file.name === 'new.asm')).toMatchObject({ outcome: 'ours', content: 'ours' });
    expect(plan.clean).toBe(true);
  });

  it('advises a fork when the two versions share no ancestor to merge against', () => {
    /* Without a base there is no way to tell an addition from a deletion, so
     * merging would have to guess. */
    const plan = planMerge(null, { 'a.asm': 'ours' }, { 'a.asm': 'theirs' });
    expect(plan.clean).toBe(false);
    expect(plan.files).toEqual([]);
    expect(plan.forkAdvice).toMatch(/share no revision to merge against/);
  });
});

describe('comparing two revisions', () => {
  it('separates added, removed and changed, and counts lines only for text', () => {
    /* A byte count for a packed sprite looks like a measure of change and is
     * not; "3 lines added" to a disk image is worse than saying nothing. */
    const compared = compareRevisions(
      { 'a.asm': 'one\ntwo', 'gone.asm': 'x', 'art.ssd': 'aaa' },
      { 'a.asm': 'one\ntwo\nthree', 'new.asm': 'y', 'art.ssd': 'bbb' },
    );
    expect(compared.summary).toBe('1 added, 1 removed, 2 changed.');
    expect(compared.files.find((file) => file.name === 'a.asm')).toMatchObject({ change: 'changed', addedLines: 1, removedLines: 0 });
    expect(compared.files.find((file) => file.name === 'art.ssd')).toMatchObject({ change: 'changed', addedLines: null, removedLines: null });
    expect(compared.files.find((file) => file.name === 'new.asm')!.change).toBe('added');
    expect(compared.files.find((file) => file.name === 'gone.asm')!.change).toBe('removed');
  });

  it('says plainly when two revisions are the same', () => {
    expect(compareRevisions({ 'a.asm': 'x' }, { 'a.asm': 'x' }).summary).toBe('Nothing differs between these two revisions.');
  });

  it('counts a rewritten file as everything removed and everything added', () => {
    const compared = compareRevisions({ 'a.asm': 'one\ntwo' }, { 'a.asm': 'three\nfour' });
    expect(compared.files[0]).toMatchObject({ addedLines: 2, removedLines: 2 });
  });
});

describe('naming a fork', () => {
  it('says where it came from, because a fork nobody can trace is a mystery', () => {
    expect(forkProjectId('demo', [])).toBe('demo-fork');
  });

  it('does not collide with a fork that already exists', () => {
    expect(forkProjectId('demo', ['demo-fork'])).toBe('demo-fork-2');
    expect(forkProjectId('demo', ['demo-fork', 'demo-fork-2'])).toBe('demo-fork-3');
  });

  it('refuses rather than overwriting when there is no name left', () => {
    const taken = ['demo-fork', ...Array.from({ length: 98 }, (_, index) => `demo-fork-${index + 2}`)];
    expect(() => forkProjectId('demo', taken)).toThrow(/too many forks/);
  });
});

describe('warning before a quota is reached', () => {
  const limits = { ownerBytes: 1000, ownerProjects: 10 };

  it('says nothing while there is room', () => {
    /* A dashboard that warns constantly is one nobody reads. */
    expect(quotaWarnings({ bytes: 700, projects: 3 }, limits)).toEqual([]);
  });

  it('warns before the limit rather than after, and says what to do', () => {
    /* Being told a limit exists at the moment work is refused is the worst
     * time to learn it. */
    const warned = quotaWarnings({ bytes: 800, projects: 3 }, limits);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.message).toMatch(/80% full/);
    expect(warned[0]!.message).toMatch(/Deleting a project you have finished with will free what only it held/);
  });

  it('says plainly when nothing more can be written', () => {
    const warned = quotaWarnings({ bytes: 1000, projects: 10 }, limits);
    expect(warned.map((warning) => warning.measure)).toEqual(['bytes', 'projects']);
    expect(warned[0]!.message).toMatch(/The store is full/);
    expect(warned[1]!.message).toMatch(/Delete one before copying another up/);
  });

  it('ignores a limit the store did not report rather than inventing one', () => {
    /* Dividing by a limit that is not there would warn about everything. */
    expect(quotaWarnings({ bytes: 10_000, projects: 99 }, {})).toEqual([]);
  });
});
