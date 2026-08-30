import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject, PROJECT_FORMAT } from './project';
import {
  PROJECT_STORAGE_KEY,
  QUARANTINE_STORAGE_KEY,
  clearQuarantinedSnapshot,
  loadProjectSnapshot,
  quarantinedSnapshot,
  saveProjectSnapshot,
  saveStateSummary,
  storageUsage,
} from './autosave';

const NOW = 1_800_000_000_000;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('saving the working project', () => {
  it('reports the bytes written and when', () => {
    const outcome = saveProjectSnapshot(newProject(), NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.at).toBe(NOW);
    expect(outcome.bytes).toBeGreaterThan(100);
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toContain(PROJECT_FORMAT);
  });

  it('says storage is full rather than failing silently, and leaves the last good save alone', () => {
    const good = saveProjectSnapshot(newProject(), NOW);
    expect(good.ok).toBe(true);
    const previous = localStorage.getItem(PROJECT_STORAGE_KEY);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('exceeded', 'QuotaExceededError');
    });
    const outcome = saveProjectSnapshot({ ...newProject(), name: 'Too big' }, NOW);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.recoverable).toBe(true);
    expect(outcome.reason).toContain('Browser storage is full');
    expect(outcome.reason).toContain('last successful save is still there');

    vi.restoreAllMocks();
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(previous);
  });

  it('reports any other storage failure with its own message', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage is read-only'); });
    const outcome = saveProjectSnapshot(newProject(), NOW);
    expect(outcome).toMatchObject({ ok: false, recoverable: false });
    if (outcome.ok) return;
    expect(outcome.reason).toContain('storage is read-only');
  });

  it('summarises the save state in the user\'s terms', () => {
    expect(saveStateSummary(null)).toBe('Not yet saved in this browser');
    expect(saveStateSummary({ ok: true, bytes: 2048, at: NOW }, NOW)).toBe('Saved in this browser just now · 2.0 KiB');
    expect(saveStateSummary({ ok: true, bytes: 2048, at: NOW - 30_000 }, NOW)).toContain('30 seconds ago');
    expect(saveStateSummary({ ok: true, bytes: 2048, at: NOW - 120_000 }, NOW)).toContain('2 minutes ago');
    expect(saveStateSummary({ ok: false, reason: 'Browser storage is full', recoverable: true })).toBe('Browser storage is full');
  });
});

describe('restoring the working project', () => {
  it('restores a saved project', () => {
    const project = { ...newProject(), name: 'Restored' };
    saveProjectSnapshot(project, NOW);
    const result = loadProjectSnapshot();
    expect(result.status).toBe('restored');
    expect(result.project.name).toBe('Restored');
    expect(result.reason).toBeUndefined();
  });

  it('starts a new project when nothing was saved, without claiming anything went wrong', () => {
    const result = loadProjectSnapshot();
    expect(result.status).toBe('empty');
    expect(result.reason).toBeUndefined();
  });

  it('keeps a snapshot it cannot read rather than replacing it, and says so', () => {
    localStorage.setItem(PROJECT_STORAGE_KEY, '{"format":"8bit-net-dev-project-20","name":');
    const result = loadProjectSnapshot();
    expect(result.status).toBe('unreadable');
    expect(result.quarantinedBytes).toBe(43);
    expect(result.reason).toContain('could not be read');
    expect(result.reason).toContain('kept aside and can be downloaded');
    /* The bytes are still there, which is the whole point. */
    expect(quarantinedSnapshot()).toBe('{"format":"8bit-net-dev-project-20","name":');
    expect(localStorage.getItem(QUARANTINE_STORAGE_KEY)).not.toBeNull();
  });

  it('keeps a snapshot whose contents parse as JSON but are not a project', () => {
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ format: 'something-else', name: 'x', files: [] }));
    const result = loadProjectSnapshot();
    expect(result.status).toBe('unreadable');
    expect(quarantinedSnapshot()).toContain('something-else');
  });

  it('lets the preserved snapshot be cleared once it has been dealt with', () => {
    localStorage.setItem(QUARANTINE_STORAGE_KEY, 'kept');
    clearQuarantinedSnapshot();
    expect(quarantinedSnapshot()).toBeNull();
  });

  it('says storage is unavailable rather than pretending nothing was saved', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked by policy'); });
    const result = loadProjectSnapshot();
    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('blocked by policy');
  });

  it('reports unavailable storage on save too, rather than reporting success', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    const outcome = saveProjectSnapshot(newProject(), NOW);
    expect(outcome.ok).toBe(false);
  });
});


describe('a save that the browser accepts and does not keep', () => {
  /* The one failure that costs someone their work is a save reported as
   * successful that did not happen. A browser can accept a write and store
   * nothing — a private window at its limit, or storage partitioned by an
   * extension — without throwing anything for the quota branch to catch. */
  it('reports a write the browser did not keep, and leaves the last good save in place', () => {
    const good = saveProjectSnapshot({ ...newProject(), name: 'Last good' }, NOW);
    expect(good.ok).toBe(true);
    const kept = localStorage.getItem(PROJECT_STORAGE_KEY)!;

    /* Accept the call and store nothing: exactly what those browsers do. The
     * key already holds the last good save, so reading it back returns that. */
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key !== PROJECT_STORAGE_KEY) realSet.call(this, key, value);
    });

    const outcome = saveProjectSnapshot({ ...newProject(), name: 'Never stored' }, NOW);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.recoverable).toBe(true);
    expect(outcome.reason).toContain('bytes written');

    vi.restoreAllMocks();
    /* The last good save is still there, which is what the message claims. */
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(kept);
  });

  it('says plainly when nothing at all was stored, on a first save with nothing to fall back to', () => {
    /* No previous save: the key is empty before and after, so the rollback
     * removes it and the message is about there being nothing stored. */
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key !== PROJECT_STORAGE_KEY) realSet.call(this, key, value);
    });
    const outcome = saveProjectSnapshot(newProject(), NOW);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('accepted the save and then stored nothing');
    vi.restoreAllMocks();
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBeNull();
  });

  it('reports a truncated write with both byte counts and undoes it', () => {
    const good = saveProjectSnapshot({ ...newProject(), name: 'Last good' }, NOW);
    expect(good.ok).toBe(true);
    const kept = localStorage.getItem(PROJECT_STORAGE_KEY)!;

    const realSet = Storage.prototype.setItem;
    let truncating = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === PROJECT_STORAGE_KEY && truncating) { truncating = false; realSet.call(this, key, value.slice(0, 40)); return; }
      realSet.call(this, key, value);
    });

    const outcome = saveProjectSnapshot({ ...newProject(), name: 'Half written' }, NOW);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/stored 40 of the [\d,]+ bytes written/);
    /* The rollback ran through the same spy, which is no longer truncating. */
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(kept);
  });
});

describe('what this site is holding in browser storage', () => {
  it('measures what is stored rather than guessing a limit the browser does not expose', () => {
    localStorage.setItem('unrelated', 'x'.repeat(100));
    saveProjectSnapshot(newProject(), NOW);
    const usage = storageUsage()!;
    expect(usage.keys).toBe(2);
    expect(usage.projectBytes).toBe(localStorage.getItem(PROJECT_STORAGE_KEY)!.length);
    expect(usage.bytes).toBeGreaterThan(usage.projectBytes + 100);
    /* No limit is reported, because there is no honest figure for one. */
    expect(Object.keys(usage).sort()).toEqual(['bytes', 'keys', 'projectBytes']);
  });

  it('reports nothing rather than zero when storage cannot be read at all', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => { throw new Error('blocked'); });
    localStorage.setItem('anything', 'x');
    expect(storageUsage()).toBeNull();
  });

  it('names what is stored in the message about a full quota', () => {
    localStorage.setItem('unrelated', 'x'.repeat(2048));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === PROJECT_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
    });
    const outcome = saveProjectSnapshot(newProject(), NOW);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/this site is holding \d+ KiB across \d+ items?/);
  });
});
