/// <reference lib="webworker" />
import { BuildExecutionError, executeBuild, type BuildRequest, type BuildResponse, type BuildResultMetadata } from './buildService';

interface WorkerRequest { requestId: number; request: BuildRequest }
interface WorkerSuccess { requestId: number; ok: true; response: BuildResponse }
interface WorkerFailure { requestId: number; ok: false; error: string; result?: BuildResultMetadata }

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const response = executeBuild(event.data.request);
    self.postMessage({ requestId: event.data.requestId, ok: true, response } satisfies WorkerSuccess);
  } catch (error) {
    self.postMessage({ requestId: event.data.requestId, ok: false, error: error instanceof Error ? error.message : String(error), ...(error instanceof BuildExecutionError ? { result: error.result } : {}) } satisfies WorkerFailure);
  }
};

export type BuildWorkerMessage = WorkerSuccess | WorkerFailure;
