/// <reference lib="webworker" />
import { validateAnalysisAnnotations } from './analysisAnnotations';
import { analyseFile, type AnalysisOptions } from './fileAnalysis';

interface AnalysisWorkerRequest { type: 'analyse'; requestId: string; name: string; bytes: ArrayBuffer; options: AnalysisOptions }

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const request = event.data;
  if (request?.type !== 'analyse') return;
  self.postMessage({ type: 'started', requestId: request.requestId });
  try {
    /* Annotations cross a structured-clone boundary, so they are re-validated
     * here rather than trusted to have survived unchanged. */
    const options = request.options.annotations
      ? { ...request.options, annotations: validateAnalysisAnnotations(request.options.annotations) }
      : request.options;
    const analysis = analyseFile(new Uint8Array(request.bytes), request.name, options, (progress) => {
      self.postMessage({ type: 'progress', requestId: request.requestId, progress });
    });
    self.postMessage({ type: 'result', requestId: request.requestId, analysis });
  } catch (error) {
    self.postMessage({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};

export {};
