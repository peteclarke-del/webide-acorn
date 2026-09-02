import { encodeSourceText } from '../editor/sourceTextFormat';
import type { ProjectFile } from '../project/project';

/* Analysing something used to mean finding it on disk first, even when the
 * thing worth looking at was already open in the project: the program that was
 * just built, or a listing sitting in the file tree. These are the things the
 * project can offer the analyser without anybody opening a file dialog. */

export interface AnalysisCandidate {
  /* Namespaced so a build target and a file can never collide on identity. */
  id: string;
  name: string;
  origin: 'artifact' | 'file';
  detail: string;
  byteLength: number;
}

export interface CandidateArtifact {
  targetId: string;
  targetName: string;
  outputName: string;
  byteLength: number;
}

const LANGUAGE_LABEL: Record<string, string> = {
  'bbc-basic': 'BBC BASIC',
  '6502': '6502 assembly',
  arm: 'ARM assembly',
  c: 'C',
  text: 'text',
};

const bytes = (count: number) => `${count.toLocaleString()} bytes`;

export function projectFileBytes(file: ProjectFile): Uint8Array {
  return encodeSourceText(file.content, file.encoding ?? 'utf-8', file.lineEnding ?? 'lf');
}

export function analysisCandidates(files: readonly ProjectFile[], artifacts: readonly CandidateArtifact[]): AnalysisCandidate[] {
  /* Built output comes first: it is the reason most people open the analyser,
   * and it is the one thing in the list that is machine code for certain. */
  const built = artifacts.map((artifact) => ({
    id: `artifact:${artifact.targetId}`,
    name: artifact.outputName,
    origin: 'artifact' as const,
    detail: `built by ${artifact.targetName} · ${bytes(artifact.byteLength)}`,
    byteLength: artifact.byteLength,
  }));
  const authored = [...files]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((file) => {
      const length = projectFileBytes(file).length;
      const label = LANGUAGE_LABEL[file.language] ?? file.language;
      return {
        id: `file:${file.id}`,
        name: file.name,
        origin: 'file' as const,
        detail: `${file.kind === 'generated' ? `generated ${label}` : label} · ${bytes(length)}`,
        byteLength: length,
      };
    });
  return [...built, ...authored];
}

export function candidateReference(id: string): { origin: 'artifact' | 'file'; key: string } | null {
  const separator = id.indexOf(':');
  if (separator < 0) return null;
  const origin = id.slice(0, separator);
  const key = id.slice(separator + 1);
  if (!key || (origin !== 'artifact' && origin !== 'file')) return null;
  return { origin, key };
}
