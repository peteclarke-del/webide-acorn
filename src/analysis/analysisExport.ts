import { isEmptyAnnotations, type AnalysisAnnotations } from './analysisAnnotations';
import type { AnalysisProcessor, LoadedFile } from './types';

export const ANALYSIS_FORMAT = '8bit-net-dev-acorn-analysis-1';

function byteHex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into this realm's ArrayBuffer. Besides avoiding shared/resizable
  // buffers, this keeps the function reliable in browser test environments
  // where a Uint8Array may originate in another JavaScript realm.
  const source = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(source).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest), byteHex).join('');
}

export async function createAnalysisDocument(
  file: LoadedFile,
  processor: AnalysisProcessor,
  userLabels: Record<number, string>,
  /* Everything the reader recorded, so the exported document is enough to
   * reproduce this exact listing rather than only to read it. */
  annotations?: AnalysisAnnotations,
) {
  const sha256 = await sha256Hex(file.bytes);
  return {
    format: ANALYSIS_FORMAT,
    analyser: { id: '8bit-net-dev-browser', version: '0.1.0' },
    source: {
      name: file.name,
      byteLength: file.bytes.length,
      sha256,
      metadata: file.metadata,
    },
    configuration: file.analysis.kind === 'machine-code'
      ? { processor, origin: file.analysis.origin, entryPoint: file.analysis.entryPoint }
      : { classification: file.analysis.kind },
    userLabels,
    ...(annotations && !isEmptyAnnotations(annotations) ? { annotations } : {}),
    analysis: file.analysis,
  };
}
