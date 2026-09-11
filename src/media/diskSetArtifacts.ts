/*
 * What a build's artifact looks like on a disc.
 *
 * On a machine with a second processor the filing system reads a file's
 * addresses to decide which side of the Tube it belongs on: &FFFF in the top
 * half says the host. A host program without it would be loaded into the
 * parasite and run there. A BASIC program's addresses are conventional,
 * since CHAIN puts it at PAGE wherever that is.
 */
import { isMachineCodeArtifact } from '../build/artifactTypes';

export interface DiskSetSourceArtifact {
  targetId: string;
  targetName: string;
  outputName: string;
  bytes: Uint8Array;
  loadAddress: number;
  executionAddress: number;
  fingerprint: string;
  /** A BASIC program is CHAINed by a generated boot file rather than run. */
  kind: 'machine-code' | 'bbc-basic';
}

export interface RetainedForDisc {
  targetId: string;
  targetName: string;
  artifact: { kind: string; bytes: Uint8Array; origin?: number; entryPoint?: number; provenance?: { fingerprint?: string; target?: { outputName?: string } } };
}

export const HOST_SIDE_OF_TUBE = 0x30000;
export const BASIC_LOAD_ADDRESS = 0x1900;
export const BASIC_EXECUTION_ADDRESS = 0x8023;

export function diskSetArtifactFor(
  retained: RetainedForDisc,
  buildTargets: ReadonlyArray<{ id: string; processor?: string }>,
  enabledCapabilities: readonly string[],
): DiskSetSourceArtifact | null {
  const target = buildTargets.find((candidate) => candidate.id === retained.targetId);
  const hostSide = enabledCapabilities.includes('tube') && target?.processor !== 'parasite' ? HOST_SIDE_OF_TUBE : 0;
  const common = {
    targetId: retained.targetId,
    targetName: retained.targetName,
    outputName: retained.artifact.provenance?.target?.outputName ?? retained.targetName,
    bytes: retained.artifact.bytes,
    fingerprint: retained.artifact.provenance?.fingerprint ?? '',
  };
  if (retained.artifact.kind === 'bbc-basic-program') return { ...common, loadAddress: hostSide | BASIC_LOAD_ADDRESS, executionAddress: hostSide | BASIC_EXECUTION_ADDRESS, kind: 'bbc-basic' };
  if (!isMachineCodeArtifact(retained.artifact)) return null;
  return { ...common, loadAddress: hostSide | (retained.artifact.origin ?? 0), executionAddress: hostSide | (retained.artifact.entryPoint ?? 0), kind: 'machine-code' };
}
