import { sha256Hex } from '../build/digest';

export interface ProgramLoadDraft {
  source: 'build' | 'host-file';
  mode: 'run' | 'debug' | 'test' | 'load';
  processor: '6502' | '65c02' | 'arm2';
  name: string;
  expectedSha256: string;
  format?: 'machine-code' | 'bbc-basic-program' | 'atom-basic-text';
  placement?: 'fixed' | 'interpreter-page' | 'keyboard-queue';
  build?: { targetId: string; targetName: string; fingerprint: string; toolchainId: string; toolchainVersion: string };
  host?: { filename: string; container: string };
}

export interface ProgramLoadManifest extends ProgramLoadDraft {
  schema: '8bit-net.program-load';
  version: 1;
  sessionFingerprint: string;
  origin: number;
  entryPoint: number;
  bytes: number;
  outputSha256: string;
  fingerprint: string;
}

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}` : JSON.stringify(value);

export function bindProgramLoadManifest(draft: ProgramLoadDraft, sessionFingerprint: string, bytes: Uint8Array, origin: number, entryPoint: number): ProgramLoadManifest {
  if (!/^[0-9a-f]{64}$/i.test(sessionFingerprint) || !/^[0-9a-f]{64}$/i.test(draft.expectedSha256)) throw new Error('Program load requires SHA-256 session and output provenance');
  if (!draft.name || !Number.isInteger(origin) || !Number.isInteger(entryPoint) || bytes.length < 1) throw new Error('Program load provenance is incomplete');
  if (draft.source === 'build' && (!draft.build?.targetId || !draft.build.fingerprint || !draft.build.toolchainVersion)) throw new Error('Build-backed program load provenance is incomplete');
  if (draft.source === 'host-file' && !draft.host?.filename) throw new Error('Host-file program load provenance is incomplete');
  if (draft.format !== undefined && !['machine-code', 'bbc-basic-program', 'atom-basic-text'].includes(draft.format)) throw new Error('Program load format is invalid');
  if (draft.placement !== undefined && !['fixed', 'interpreter-page', 'keyboard-queue'].includes(draft.placement)) throw new Error('Program placement policy is invalid');
  if ((draft.format === 'bbc-basic-program' && draft.placement !== 'interpreter-page') || (draft.format === 'atom-basic-text' && draft.placement !== 'keyboard-queue')) throw new Error('BASIC program format and placement policy do not match');
  const outputSha256 = sha256Hex(bytes);
  if (outputSha256 !== draft.expectedSha256) throw new Error('Program bytes do not match the declared build or host-file SHA-256');
  const declared = { schema: '8bit-net.program-load' as const, version: 1 as const, ...draft, sessionFingerprint, origin, entryPoint, bytes: bytes.length, outputSha256 };
  return Object.freeze({ ...declared, ...(declared.build ? { build: Object.freeze({ ...declared.build }) } : {}), ...(declared.host ? { host: Object.freeze({ ...declared.host }) } : {}), fingerprint: sha256Hex(new TextEncoder().encode(canonical(declared))) });
}

export function validateProgramLoadManifest(manifest: unknown, sessionFingerprint: string, bytes: Uint8Array, origin: number, entryPoint: number): ProgramLoadManifest {
  if (!manifest || typeof manifest !== 'object') throw new Error('Program load manifest is missing');
  const value = manifest as ProgramLoadManifest;
  const rebuilt = bindProgramLoadManifest({ source: value.source, mode: value.mode, processor: value.processor, name: value.name, expectedSha256: value.expectedSha256, ...(value.format ? { format: value.format } : {}), ...(value.placement ? { placement: value.placement } : {}), ...(value.build ? { build: { ...value.build } } : {}), ...(value.host ? { host: { ...value.host } } : {}) }, sessionFingerprint, bytes, origin, entryPoint);
  if (value.schema !== rebuilt.schema || value.version !== rebuilt.version || value.sessionFingerprint !== sessionFingerprint || value.fingerprint !== rebuilt.fingerprint) throw new Error('Program load manifest fingerprint or runtime-session binding is invalid');
  return rebuilt;
}
