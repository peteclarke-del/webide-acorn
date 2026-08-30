/* What the product does when something goes wrong underneath it.
 *
 * Every failure here is one the happy path never reaches and that a person
 * therefore meets for the first time when it is already going badly: a worker
 * that dies, a result that arrives after it stopped being wanted, the same
 * event delivered twice, a service that is not there, storage that fills up
 * mid-write. None of them is rare in practice and none of them is visible in
 * ordinary testing.
 *
 * The property being asserted is the same in every case, and it is not "it
 * recovers". It is that the product says what happened and leaves nothing half
 * applied. A silent failure and a partial write are both worse than an error,
 * because both look like success.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAnalysisTask } from '../analysis/analysisWorkerClient';
import { executeBuildAll } from '../build/buildAll';
import { createBuildTarget } from '../build/buildTarget';
import { newProject, parseProject } from '../project/project';
import { PROJECT_STORAGE_KEY, loadProjectSnapshot, saveProjectSnapshot } from '../project/autosave';
import { VersionedLanguageSession, StaleLanguageResponseError, type LanguageRequestRevision } from '../language/languageService';
import type { ProjectFile } from '../project/project';

/* A worker whose behaviour each test decides, standing in for one that has
 * died, answered late, or answered twice. */
class ScriptedWorker {
  static instances: ScriptedWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() { ScriptedWorker.instances.push(this); }
  postMessage(message: unknown) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  deliver(data: Record<string, unknown>) { this.onmessage?.({ data } as MessageEvent); }
  crash(message: string) { this.onerror?.({ message }); }
}

afterEach(() => { ScriptedWorker.instances = []; vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

function withScriptedWorker() {
  vi.stubGlobal('Worker', ScriptedWorker as unknown as typeof Worker);
  const task = startAnalysisTask(new Uint8Array([0x60]), 'main.bin', {} as never);
  const worker = ScriptedWorker.instances.at(-1)!;
  return { task, worker };
}

describe('a worker that dies', () => {
  it('rejects with what the browser said rather than hanging on a promise nobody will settle', async () => {
    const { task, worker } = withScriptedWorker();
    worker.crash('script failed to load');
    await expect(task.promise).rejects.toThrow('script failed to load');
    expect(worker.terminated).toBe(true);
  });

  it('still says something when the browser reports no message at all', async () => {
    /* A crash with an empty message is the common case for a module worker
     * that failed to parse, and an empty error message tells nobody anything. */
    const { task, worker } = withScriptedWorker();
    worker.crash('');
    await expect(task.promise).rejects.toThrow(/could not start/i);
  });

  it('reports a worker that answers with a failure and no diagnostic', async () => {
    const { task, worker } = withScriptedWorker();
    const requestId = (worker.posted[0] as { requestId: string }).requestId;
    worker.deliver({ type: 'error', requestId });
    await expect(task.promise).rejects.toThrow(/without a diagnostic/i);
  });
});

describe('a result that arrives when it is no longer wanted', () => {
  it('ignores a result carrying an identifier from an earlier request', async () => {
    /* The failure this prevents is the worst kind: an answer that is real, and
     * about the wrong question. */
    const { task, worker } = withScriptedWorker();
    const requestId = (worker.posted[0] as { requestId: string }).requestId;
    worker.deliver({ type: 'result', requestId: 'an-older-request', analysis: { name: 'stale' } });
    worker.deliver({ type: 'result', requestId, analysis: { name: 'current' } });
    await expect(task.promise).resolves.toMatchObject({ name: 'current' });
  });

  it('settles once when the same result is delivered twice', async () => {
    const { task, worker } = withScriptedWorker();
    const requestId = (worker.posted[0] as { requestId: string }).requestId;
    worker.deliver({ type: 'result', requestId, analysis: { name: 'first' } });
    worker.deliver({ type: 'error', requestId, message: 'a contradictory second delivery' });
    await expect(task.promise).resolves.toMatchObject({ name: 'first' });
  });

  it('ignores anything that arrives after the task was cancelled', async () => {
    const { task, worker } = withScriptedWorker();
    const requestId = (worker.posted[0] as { requestId: string }).requestId;
    task.cancel('the file was closed');
    worker.deliver({ type: 'result', requestId, analysis: { name: 'too late' } });
    await expect(task.promise).rejects.toThrow('the file was closed');
    expect(worker.terminated).toBe(true);
  });
});

describe('a language answer that is no longer about the current document', () => {
  const file = (content: string): ProjectFile => ({
    id: 'main', name: 'main.asm', content, language: '6502', modified: false,
  } as ProjectFile);

  it('refuses a response computed for text that has since changed', async () => {
    /* Completion is asynchronous and the document keeps changing under it.
     * Presenting an answer computed for text that no longer exists is how a
     * person is offered a symbol from a file they have already edited away. */
    const session = new VersionedLanguageSession();
    session.open(file('.start'));
    let captured: LanguageRequestRevision | undefined;
    const answer = await session.requestVersioned(file('.start'), (_signal, revision) => {
      captured = revision;
      return ['a candidate'];
    });
    expect(session.isCurrent(answer.revision)).toBe(true);

    /* The document changes while the caller is still holding the answer. */
    session.open(file('.start\n  RTS'));
    expect(session.isCurrent(captured!)).toBe(false);
  });

  it('abandons a request the moment a newer one supersedes it on the same channel', async () => {
    const session = new VersionedLanguageSession();
    session.open(file('.start'));
    let aborted = false;
    const first = session.requestVersioned(file('.start'), (signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; resolve(['abandoned']); });
    }));
    const second = await session.requestVersioned(file('.start'), () => ['current']);
    await first.catch(() => undefined);
    expect(aborted).toBe(true);
    expect(second.value).toEqual(['current']);
  });

  it('reports a stale response as stale rather than as an ordinary failure', () => {
    /* The distinction matters: a caller retries a stale answer and reports a
     * failure, and doing the wrong one of those is how a completion list
     * either disappears or shows an error nobody caused. */
    const error = new StaleLanguageResponseError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StaleLanguageResponseError');
    expect(error.message).toMatch(/older document version/i);
  });
});

describe('a service that is not there', () => {
  it('reports a native build that could not reach its adapter, and produces no artifact', async () => {
    /* An outage must not look like a build that produced nothing. */
    const base = newProject();
    const target = { ...createBuildTarget(base.files[0]!), id: 'native', name: 'native build' };
    const records = await executeBuildAll([target], async () => { throw new Error('the native builder is unreachable'); });
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe('failed');
    expect(records[0]!.message).toContain('unreachable');
  });

  it('stops dependent work rather than building against something that failed', async () => {
    const base = newProject();
    const first = { ...createBuildTarget(base.files[0]!), id: 'first', name: 'first' };
    const second = { ...createBuildTarget(base.files[0]!), id: 'second', name: 'second', dependencyTargetIds: ['first'] };
    const records = await executeBuildAll([first, second], async (candidate) => {
      if (candidate.id === 'first') throw new Error('the native builder is unreachable');
      throw new Error('the dependent target must never have been started');
    });
    const dependent = records.find((record) => record.targetId === 'second')!;
    expect(dependent.status).not.toBe('succeeded');
    expect(dependent.message).not.toContain('must never have been started');
  });
});

describe('storage that fills up while it is being written', () => {
  it('leaves the last good save in place rather than half of a new one', () => {
    const good = saveProjectSnapshot({ ...newProject(), name: 'Last good' });
    expect(good.ok).toBe(true);
    const kept = localStorage.getItem(PROJECT_STORAGE_KEY);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === PROJECT_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
    });
    const outcome = saveProjectSnapshot({ ...newProject(), name: 'Never stored' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.recoverable).toBe(true);
    expect(outcome.reason).toMatch(/storage is full/i);
    vi.restoreAllMocks();
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(kept);
  });

  it('keeps a project it cannot read rather than replacing it with an empty one', () => {
    /* The difference between "your work is unreadable" and "your work is gone"
     * is the whole of this behaviour, and only one of them is true. */
    localStorage.setItem(PROJECT_STORAGE_KEY, '{ not json at all');
    const result = loadProjectSnapshot();
    expect(result.status).toBe('unreadable');
    expect(result.reason).toMatch(/kept aside/i);
    expect(localStorage.getItem('8bit-net-dev:local-project-unreadable')).toBe('{ not json at all');
  });

  it('says storage is unavailable rather than silently not saving', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage is disabled'); });
    const outcome = saveProjectSnapshot(newProject());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('storage is disabled');
  });
});

describe('a document that is damaged rather than absent', () => {
  it('refuses a project whose files are not what a project holds, naming the problem', () => {
    const base = newProject();
    expect(() => parseProject(JSON.stringify({ ...base, files: [{ name: 'main.asm' }] })))
      .toThrow(/invalid source file record/i);
    expect(() => parseProject(JSON.stringify({ ...base, files: [{ name: '', content: '' }] })))
      .toThrow(/non-empty and unique/i);
  });

  it('refuses two files that would collide once the project is flat', () => {
    const base = newProject();
    const file = { ...base.files[0]!, id: 'a', name: 'main.asm', content: '' };
    expect(() => parseProject(JSON.stringify({ ...base, files: [file, { ...file, id: 'b' }] })))
      .toThrow(/non-empty and unique/i);
  });
});
