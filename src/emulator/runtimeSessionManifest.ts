import { sha256Hex } from '../build/digest';

export interface RuntimeSessionManifestInput {
  id: string;
  createdAt: string;
  adapter: { id: 'jsbeeb' | 'arculator-wasm' | 'elkjs'; version: string };
  machine: { platformClass: string; machineId: string; label: string; variant: string; model: string; romSetId: string; enabledCapabilities: string[] };
  roms: Array<{ key: string; filename: string; size: number; sha256: string }>;
  boot: { tube: boolean; extraRoms: string[]; keyboardLayout: string; runtimeSpeed: number; fastBootMs: number };
  substitutions: string[];
  limitations: string[];
}

export interface RuntimeSessionManifest {
  readonly schema: '8bit-net.runtime-session';
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly adapter: Readonly<RuntimeSessionManifestInput['adapter']>;
  readonly machine: Readonly<Omit<RuntimeSessionManifestInput['machine'], 'enabledCapabilities'>> & { readonly enabledCapabilities: ReadonlyArray<string> };
  readonly roms: ReadonlyArray<Readonly<RuntimeSessionManifestInput['roms'][number]>>;
  readonly boot: Readonly<Omit<RuntimeSessionManifestInput['boot'], 'extraRoms'>> & { readonly extraRoms: ReadonlyArray<string> };
  readonly substitutions: ReadonlyArray<string>;
  readonly limitations: ReadonlyArray<string>;
  readonly fingerprint: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function createRuntimeSessionManifest(input: RuntimeSessionManifestInput): RuntimeSessionManifest {
  if (!input.id || !Number.isFinite(Date.parse(input.createdAt))) throw new Error('Runtime session identity and creation time are required');
  if (!input.adapter.version || !input.machine.machineId || !input.machine.model || !input.machine.romSetId) throw new Error('Runtime session profile provenance is incomplete');
  if (!input.roms.length) throw new Error('Runtime sessions require at least one bound ROM digest');
  if (input.roms.some((rom) => !rom.key || !rom.filename || !Number.isInteger(rom.size) || rom.size < 1 || !/^[0-9a-f]{64}$/i.test(rom.sha256))) throw new Error('Runtime session ROM provenance is invalid');
  const declared = {
    schema: '8bit-net.runtime-session' as const,
    version: 1 as const,
    id: input.id,
    createdAt: input.createdAt,
    adapter: { ...input.adapter },
    machine: { ...input.machine, enabledCapabilities: [...input.machine.enabledCapabilities].sort() },
    roms: input.roms.map((rom) => ({ ...rom })).sort((left, right) => left.key.localeCompare(right.key)),
    boot: { ...input.boot, extraRoms: [...input.boot.extraRoms].sort() },
    substitutions: [...input.substitutions],
    limitations: [...input.limitations],
  };
  const fingerprint = sha256Hex(new TextEncoder().encode(canonical(declared)));
  return Object.freeze({
    ...declared,
    adapter: Object.freeze(declared.adapter),
    machine: Object.freeze({ ...declared.machine, enabledCapabilities: Object.freeze(declared.machine.enabledCapabilities) }),
    roms: Object.freeze(declared.roms.map((rom) => Object.freeze(rom))),
    boot: Object.freeze({ ...declared.boot, extraRoms: Object.freeze(declared.boot.extraRoms) }),
    substitutions: Object.freeze(declared.substitutions),
    limitations: Object.freeze(declared.limitations),
    fingerprint,
  });
}

export function validateRuntimeSessionManifest(value: unknown): RuntimeSessionManifest {
  if (!value || typeof value !== 'object') throw new Error('Runtime session manifest is missing');
  const manifest = value as RuntimeSessionManifest;
  const rebuilt = createRuntimeSessionManifest({
    id: manifest.id, createdAt: manifest.createdAt, adapter: { ...manifest.adapter },
    machine: { ...manifest.machine, enabledCapabilities: [...manifest.machine.enabledCapabilities] },
    roms: manifest.roms.map((rom) => ({ ...rom })),
    boot: { ...manifest.boot, extraRoms: [...manifest.boot.extraRoms] },
    substitutions: [...manifest.substitutions], limitations: [...manifest.limitations],
  });
  if (rebuilt.fingerprint !== manifest.fingerprint) throw new Error('Runtime session manifest fingerprint does not match its declared content');
  return rebuilt;
}
