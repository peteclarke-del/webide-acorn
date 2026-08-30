import { sha256Hex } from '../build/digest';
import type { ProgramLoadManifest } from './programLoadManifest';
import type { RuntimeSessionManifest } from './runtimeSessionManifest';

export interface RuntimeRunRecord {
  schema: '8bit-net.runtime-run';
  version: 1;
  exportedAt: string;
  session: RuntimeSessionManifest;
  program: ProgramLoadManifest;
  fingerprint: string;
}

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}` : JSON.stringify(value);

export function createRuntimeRunRecord(session: RuntimeSessionManifest, program: ProgramLoadManifest, exportedAt = new Date().toISOString()): RuntimeRunRecord {
  if (program.sessionFingerprint !== session.fingerprint) throw new Error('Program and runtime-session fingerprints do not belong to the same run');
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error('Run-record export time must be an ISO date');
  const declared = { schema: '8bit-net.runtime-run' as const, version: 1 as const, exportedAt, session, program };
  return Object.freeze({ ...declared, fingerprint: sha256Hex(new TextEncoder().encode(canonical(declared))) });
}

