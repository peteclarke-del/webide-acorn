import { describe, expect, it } from 'vitest';
import { appendCrashDiagnostic, EMPTY_FRAME_PERFORMANCE, observeFrame, type RuntimeCrashDiagnostic } from './runtimePerformanceModel';

describe('runtime performance model', () => {
  it('counts late and estimated dropped frames from observed active intervals', () => {
    const first = observeFrame(EMPTY_FRAME_PERFORMANCE, 20, 20);
    const second = observeFrame(first, 65, 20);
    expect(second).toMatchObject({ samples: 2, renderedFrames: 2, lateFrames: 1, droppedFrames: 2, maximumIntervalMs: 65 });
    expect(second.averageIntervalMs).toBe(42.5);
  });

  it('rejects invalid timing and bounds redacted crash history', () => {
    expect(() => observeFrame(EMPTY_FRAME_PERFORMANCE, -1, 20)).toThrow();
    let records: RuntimeCrashDiagnostic[] = Array.from({ length: 16 }, (_, index) => ({ sequence: index, timeMs: index, kind: 'error' as const, message: `old ${index}` }));
    records = appendCrashDiagnostic(records, { sequence: 17, timeMs: 17, kind: 'execution', message: 'x'.repeat(700) });
    expect(records).toHaveLength(16);
    expect(records[0]?.sequence).toBe(1);
    expect(records.at(-1)?.message).toHaveLength(500);
  });
});
