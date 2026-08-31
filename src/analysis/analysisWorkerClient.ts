import type { AnalysisOptions } from './fileAnalysis';
import type { AnalysisProgress } from './analysisProgress';
import type { FileAnalysis } from './types';

export interface AnalysisTask {
  requestId: string;
  promise: Promise<FileAnalysis>;
  cancel: (reason?: string) => void;
}

const ANALYSIS_TIMEOUT_MS = 20_000;

export function startAnalysisTask(bytes: Uint8Array, name: string, options: AnalysisOptions, onProgress?: (progress: AnalysisProgress) => void): AnalysisTask {
  const requestId = crypto.randomUUID();
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module', name: `acorn-analysis-${requestId}` });
  let settled = false;
  let rejectTask: (reason: Error) => void = () => undefined;
  const finish = () => { if (!settled) { settled = true; window.clearTimeout(timeout); worker.terminate(); } };
  const promise = new Promise<FileAnalysis>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<{ type: 'started' | 'progress' | 'result' | 'error'; requestId: string; analysis?: FileAnalysis; progress?: AnalysisProgress; message?: string }>) => {
      if (event.data.requestId !== requestId || settled || event.data.type === 'started') return;
      if (event.data.type === 'progress') {
        /* Progress from a request that has been superseded is dropped by the
         * identity check above, so a stale worker cannot move a bar that
         * belongs to the run after it. */
        if (event.data.progress) onProgress?.(event.data.progress);
        return;
      }
      if (event.data.type === 'result' && event.data.analysis) { finish(); resolve(event.data.analysis); }
      else { finish(); reject(new Error(event.data.message ?? 'Analysis worker failed without a diagnostic')); }
    };
    worker.onerror = (event) => { finish(); reject(new Error(event.message || 'Analysis worker could not start')); };
    const transfer = bytes.slice().buffer;
    worker.postMessage({ type: 'analyse', requestId, name, bytes: transfer, options }, [transfer]);
  });
  const timeout = window.setTimeout(() => {
    if (settled) return;
    finish(); rejectTask(new Error(`Analysis exceeded the ${ANALYSIS_TIMEOUT_MS / 1000}-second browser limit`));
  }, ANALYSIS_TIMEOUT_MS);
  return {
    requestId,
    promise,
    cancel: (reason = 'Analysis cancelled') => { if (settled) return; finish(); rejectTask(new DOMException(reason, 'AbortError')); },
  };
}
