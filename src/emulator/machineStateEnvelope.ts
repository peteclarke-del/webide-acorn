import { sha256Hex } from '../build/digest';
import type { RuntimeSessionManifest } from './runtimeSessionManifest';

export const MACHINE_STATE_LIMIT = 12 * 1024 * 1024;

export interface MachineStateEnvelope {
  schema: '8bit-net.machine-state';
  version: 1;
  capturedAt: string;
  adapter: { id: 'jsbeeb'; version: string };
  machine: { model: string; romSetId: string; tube: boolean; extraRoms: string[] };
  roms: Array<{ key: string; size: number; sha256: string }>;
  payload: { encoding: 'jsbeeb-snapshot-json'; bytes: number; sha256: string; json: string };
}

const normalizedRoms = (manifest: RuntimeSessionManifest) => manifest.roms.map(({ key, size, sha256 }) => ({ key, size, sha256 })).sort((left, right) => left.key.localeCompare(right.key));

export function createMachineStateEnvelope(payloadJson: string, model: string, manifest: RuntimeSessionManifest): string {
  if (!payloadJson || payloadJson.length > MACHINE_STATE_LIMIT) throw new Error('Machine-state payload exceeds the 12 MiB limit');
  JSON.parse(payloadJson);
  const bytes = new TextEncoder().encode(payloadJson);
  const envelope: MachineStateEnvelope = {
    schema: '8bit-net.machine-state', version: 1, capturedAt: new Date().toISOString(),
    adapter: { id: 'jsbeeb', version: manifest.adapter.version },
    machine: { model, romSetId: manifest.machine.romSetId, tube: manifest.boot.tube, extraRoms: [...manifest.boot.extraRoms].sort() },
    roms: normalizedRoms(manifest),
    payload: { encoding: 'jsbeeb-snapshot-json', bytes: bytes.length, sha256: sha256Hex(bytes), json: payloadJson },
  };
  const json = JSON.stringify(envelope);
  if (json.length > MACHINE_STATE_LIMIT) throw new Error('Versioned machine-state file exceeds the 12 MiB limit');
  return json;
}

export function openMachineStateEnvelope(json: string, model: string, manifest: RuntimeSessionManifest): { envelope: MachineStateEnvelope; payloadJson: string } {
  if (!json || json.length > MACHINE_STATE_LIMIT) throw new Error('State files are limited to 12 MiB');
  const value = JSON.parse(json) as Partial<MachineStateEnvelope>;
  if (value.schema !== '8bit-net.machine-state' || value.version !== 1) throw new Error('State file is not a supported 8BIT-NET machine-state envelope version');
  if (value.adapter?.id !== 'jsbeeb' || value.adapter.version !== manifest.adapter.version) throw new Error('State adapter revision is incompatible with the live jsbeeb adapter');
  if (value.machine?.model !== model || value.machine.romSetId !== manifest.machine.romSetId || value.machine.tube !== manifest.boot.tube || JSON.stringify(value.machine.extraRoms ?? []) !== JSON.stringify([...manifest.boot.extraRoms].sort())) throw new Error('State machine, ROM-set, Tube or sideways-ROM configuration is incompatible');
  const expectedRoms = normalizedRoms(manifest);
  if (JSON.stringify(value.roms ?? []) !== JSON.stringify(expectedRoms)) throw new Error('State ROM SHA-256 manifest is incompatible with the live session');
  const payload = value.payload;
  if (!payload || payload.encoding !== 'jsbeeb-snapshot-json' || typeof payload.json !== 'string') throw new Error('State snapshot payload is invalid');
  const bytes = new TextEncoder().encode(payload.json);
  if (payload.bytes !== bytes.length || payload.sha256 !== sha256Hex(bytes)) throw new Error('State snapshot payload failed its byte-count or SHA-256 integrity check');
  return { envelope: value as MachineStateEnvelope, payloadJson: payload.json };
}
