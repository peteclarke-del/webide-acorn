import type { BuildProvenance } from './buildTarget';
import type { BuildDiagnostic, RetainedArtifactDocument, SourceLocation } from './assembler6502';

export interface ArmArtifact {
  kind: 'arm-binary';
  bytes: Uint8Array;
  origin: number;
  entryPoint: number;
  processor: 'arm2';
  endianness: 'little';
  containerFormat: 'raw';
  /** Null is deliberate: the first adapter does not claim RISC OS file typing. */
  riscOsFiletype: null;
  symbols: Record<string, number>;
  sourceMap: Record<number, number>;
  sourceLocations: Record<number, SourceLocation>;
  entryFileId: string;
  dependencies: string[];
  sourceFiles: Record<string, { name: string; content: string }>;
  diagnostics: BuildDiagnostic[];
  listing: string[];
  retainedDocuments?: RetainedArtifactDocument[];
  provenance?: BuildProvenance;
}

export type MachineCodeArtifact = import('./assembler6502').AssemblyArtifact | ArmArtifact;

export function isMachineCodeArtifact(artifact: { kind: string }): artifact is MachineCodeArtifact {
  return artifact.kind === '6502-binary' || artifact.kind === 'arm-binary';
}
