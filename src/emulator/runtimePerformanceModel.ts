export interface FramePerformanceState {
  samples: number;
  renderedFrames: number;
  lateFrames: number;
  droppedFrames: number;
  lastIntervalMs: number;
  averageIntervalMs: number;
  maximumIntervalMs: number;
}

export const EMPTY_FRAME_PERFORMANCE: FramePerformanceState = {
  samples: 0, renderedFrames: 0, lateFrames: 0, droppedFrames: 0,
  lastIntervalMs: 0, averageIntervalMs: 0, maximumIntervalMs: 0,
};

export function observeFrame(previous: FramePerformanceState, intervalMs: number, targetFrameMs: number): FramePerformanceState {
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || !Number.isFinite(targetFrameMs) || targetFrameMs <= 0) throw new Error('Frame timing inputs must be finite and non-negative');
  const samples = previous.samples + 1;
  const missed = Math.max(0, Math.floor(intervalMs / targetFrameMs) - 1);
  return {
    samples,
    renderedFrames: previous.renderedFrames + 1,
    lateFrames: previous.lateFrames + (intervalMs > targetFrameMs * 1.5 ? 1 : 0),
    droppedFrames: previous.droppedFrames + missed,
    lastIntervalMs: intervalMs,
    averageIntervalMs: previous.averageIntervalMs + (intervalMs - previous.averageIntervalMs) / samples,
    maximumIntervalMs: Math.max(previous.maximumIntervalMs, intervalMs),
  };
}

export interface RuntimeCrashDiagnostic { sequence: number; timeMs: number; kind: 'error' | 'unhandled-rejection' | 'execution'; message: string }

export function appendCrashDiagnostic(records: RuntimeCrashDiagnostic[], record: RuntimeCrashDiagnostic, capacity = 16) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) throw new Error('Crash diagnostic capacity must be from 1 to 64');
  return [...records, { ...record, message: record.message.slice(0, 500) }].slice(-capacity);
}
