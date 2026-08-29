import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAnalysisTask } from './analysisWorkerClient';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted?: { message: Record<string, unknown>; transfer: Transferable[] };
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: Record<string, unknown>, transfer: Transferable[]) { this.posted = { message, transfer }; }
  terminate() { this.terminated = true; }
  emit(data: Record<string, unknown>) { this.onmessage?.({ data } as MessageEvent); }
}

const options = { origin: 0x1900, entryPoint: 0x1900, processor: '6502' as const };

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('analysis worker lifecycle', () => {
  it('copies bounded input into a module worker and resolves only its matching result', async () => {
    const original = Uint8Array.from([0x60]);
    const task = startAnalysisTask(original, 'CODE', options);
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted?.message).toMatchObject({ type: 'analyse', requestId: task.requestId, name: 'CODE', options });
    expect(worker.posted?.transfer).toHaveLength(1);
    expect(original).toEqual(Uint8Array.of(0x60));
    worker.emit({ type: 'result', requestId: 'stale-request', analysis: { kind: 'text', text: 'wrong', lineCount: 1 } });
    expect(worker.terminated).toBe(false);
    const analysis = { kind: 'text' as const, text: 'ok', lineCount: 1 };
    worker.emit({ type: 'result', requestId: task.requestId, analysis });
    await expect(task.promise).resolves.toEqual(analysis);
    expect(worker.terminated).toBe(true);
  });

  it('terminates and rejects an explicitly cancelled task', async () => {
    const task = startAnalysisTask(Uint8Array.of(0x60), 'CODE', options);
    const worker = FakeWorker.instances[0]!;
    task.cancel('Changed file');
    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError', message: 'Changed file' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates a worker that exceeds the hard analysis ceiling', async () => {
    vi.useFakeTimers();
    const task = startAnalysisTask(Uint8Array.of(0x60), 'CODE', options);
    const worker = FakeWorker.instances[0]!;
    const rejection = expect(task.promise).rejects.toThrow('20-second browser limit');
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    expect(worker.terminated).toBe(true);
  });
});
