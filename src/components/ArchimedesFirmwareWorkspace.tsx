import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { filesFromArchimedesImport, prepareArchimedesFirmware, type FirmwareInput } from '../rom/archimedesFirmwareImport';
import { archimedesCmosKey, archimedesCombinedRomKey, archimedesFirmwarePrefix, archimedesRomProfile } from '../rom/archimedesRom';
import { listRoms, removeRoms, storeRomBatch, type StoredRom } from '../rom/romStore';

interface Props { machineId: string; romId: string; onNotice: (message: string) => void; onReadyChange?: (ready: boolean) => void }

export function ArchimedesFirmwareWorkspace({ machineId, romId, onNotice, onReadyChange }: Props) {
  const profile = useMemo(() => archimedesRomProfile(machineId, romId), [machineId, romId]);
  const [records, setRecords] = useState<StoredRom[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    if (!profile) { setRecords([]); return; }
    try { setRecords(await listRoms(`${archimedesFirmwarePrefix(profile)}/`)); setError(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Archimedes firmware storage is unavailable'); }
  }, [profile]);
  useEffect(() => { void refresh(); }, [refresh]);
  const recordKeys = useMemo(() => new Set(records.map((record) => record.key)), [records]);
  const complete = !!profile && recordKeys.has(archimedesCombinedRomKey(profile)) && recordKeys.has(archimedesCmosKey(profile)) && profile.laneFilenames.every((name) => recordKeys.has(`${archimedesFirmwarePrefix(profile)}/sources/${name}`));
  useEffect(() => { onReadyChange?.(complete); }, [complete, onReadyChange]);
  if (!profile) return null;

  const importFiles = async (files: File[]) => {
    setBusy(true); setError(undefined);
    try {
      const inputs: FirmwareInput[] = [];
      for (const file of files) inputs.push(...filesFromArchimedesImport(file.name, new Uint8Array(await file.arrayBuffer())));
      const prepared = prepareArchimedesFirmware(profile, inputs);
      const stored = await storeRomBatch(prepared.records);
      const derived = stored.find((record) => record.key === archimedesCombinedRomKey(profile))!;
      onNotice(`${profile.label} normalized from four physical lanes · SHA-256 ${derived.sha256.slice(0, 12)}…`); await refresh();
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Archimedes firmware import failed'; setError(message); onNotice(`Archimedes firmware rejected · ${message}`); }
    finally { setBusy(false); }
  };
  const removeSet = async () => { await removeRoms(records.map((record) => record.key)); onNotice(`${profile.label} removed from browser firmware storage`); await refresh(); };
  const byKey = new Map(records.map((record) => [record.key, record])); const combined = byKey.get(archimedesCombinedRomKey(profile)); const cmos = byKey.get(archimedesCmosKey(profile));
  return <section className="archimedes-firmware-set">
    <div className="runtime-heading"><div><span className="eyebrow">ARCHIMEDES PHYSICAL ROM VAULT · FOUR-LANE NORMALIZATION</span><h2>{profile.label}</h2></div><span className={`rom-readiness ${complete ? 'ready' : ''}`}>{complete ? 'FIRMWARE READY' : 'ROM SET INCOMPLETE'}</span></div>
    <div className="rom-disclosure"><Icon name="lock" size={17} /><p>Import the MAME machine ZIP directly, or select all four physical ROM chips and the 256-byte CMOS together. The source lanes are validated and byte-interleaved into the exact image consumed by Arculator; no firmware enters the container or project export.</p><label className={busy ? 'rom-folder-import busy' : 'rom-folder-import'}><input type="file" multiple accept=".zip,.rom,.bin,application/zip,application/octet-stream" disabled={busy} aria-label={`Import ${profile.label} firmware`} onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void importFiles(files); event.target.value = ''; }} /><Icon name="open" size={14} /> {busy ? 'Normalizing…' : 'Import ROM set'}</label>{records.length > 0 && <button type="button" className="firmware-remove-set" onClick={() => void removeSet()}>Remove set</button>}</div>
    {error && <div className="analysis-warning" role="alert">{error}</div>}
    <div className="archimedes-rom-lanes" role="list" aria-label="Archimedes physical ROM lanes">{profile.laneFilenames.map((name, lane) => { const record = byKey.get(`${archimedesFirmwarePrefix(profile)}/sources/${name}`); return <div role="listitem" className={record ? 'supplied' : ''} key={name}><strong>LANE {lane}</strong><code>{name}</code><span>{profile.laneSize / 1024} KiB</span>{record ? <small>SHA-256 {record.sha256}</small> : <small>Missing</small>}</div>; })}</div>
    <div className="rom-adapter-facts"><div><span>Derived image</span><strong>{combined ? `${combined.size / 1024} KiB · ${combined.sha256.slice(0, 12)}…` : 'Not generated'}</strong></div><div><span>CMOS</span><strong>{cmos ? `${cmos.size} bytes · validated` : profile.cmosFilename}</strong></div><div><span>Engine target</span><strong>Arculator WASM · {profile.arculatorRomSet}</strong></div><div><span>Runtime gate</span><strong>Awaiting qualified bridge</strong></div><div><span>Storage</span><strong>IndexedDB · origin private</strong></div></div>
  </section>;
}
