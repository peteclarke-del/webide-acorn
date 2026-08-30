import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { developmentFirmwareFor, developmentFirmwareStorageKey } from '../rom/developmentFirmware';
import { planRomFolderImport } from '../rom/romFolderImport';
import { validateRom, type RomRequirement } from '../rom/romProfiles';
import { listRoms, removeRom, storeRom, storeRomBatch, type StoredRom } from '../rom/romStore';

interface DevelopmentFirmwareWorkspaceProps {
  machineId: string;
  enabledCapabilities: string[];
  onNotice: (message: string) => void;
}

export function DevelopmentFirmwareWorkspace({ machineId, enabledCapabilities, onNotice }: DevelopmentFirmwareWorkspaceProps) {
  const inventories = useMemo(() => developmentFirmwareFor(machineId, enabledCapabilities), [machineId, enabledCapabilities]);
  const [records, setRecords] = useState<StoredRom[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!inventories.length) { setRecords([]); return; }
    try {
      const found = await Promise.all(inventories.map((inventory) => listRoms(`inventory/${inventory.id}/`)));
      setRecords(found.flat()); setError(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Development firmware storage is unavailable'); }
  }, [inventories]);

  useEffect(() => { void refresh(); }, [refresh]);
  if (!inventories.length) return null;

  const supplied = new Map(records.map((record) => [record.key, record]));
  const importRom = async (inventoryId: string, requirement: RomRequirement, file: File) => {
    const operation = `${inventoryId}/${requirement.id}`; setBusy(operation);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); const validation = validateRom(requirement, bytes);
      if (!validation.valid) { setError(validation.errors.join(' ')); onNotice(`${requirement.label} was rejected`); return; }
      const record = await storeRom(developmentFirmwareStorageKey(inventoryId, requirement), file);
      setError(validation.warnings.join(' ') || undefined);
      onNotice(`${requirement.label} stored as development firmware · SHA-256 ${record.sha256.slice(0, 12)}…`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Development firmware import failed'); }
    finally { setBusy(undefined); }
  };

  const forgetRom = async (inventoryId: string, requirement: RomRequirement) => {
    await removeRom(developmentFirmwareStorageKey(inventoryId, requirement));
    onNotice(`${requirement.label} removed from browser firmware storage`); await refresh();
  };

  const importFolder = async (inventoryId: string, requirements: RomRequirement[], files: File[]) => {
    if (!files.length) return; setBusy(`${inventoryId}/folder`); setError(undefined);
    try {
      const plan = planRomFolderImport(requirements, files);
      if (plan.ambiguous.length) throw new Error(`Folder import found ambiguous files for ${plan.ambiguous.map((item) => item.requirement.label).join(', ')}.`);
      const alreadySupplied = new Set(records.map((record) => record.key));
      const missing = plan.missing.filter((requirement) => !alreadySupplied.has(developmentFirmwareStorageKey(inventoryId, requirement)));
      if (missing.length) throw new Error(`Folder import is missing ${missing.map((item) => `${item.label} (${item.emulatorPath})`).join(', ')}. No files were stored.`);
      const prepared: Array<{ key: string; filename: string; bytes: ArrayBuffer }> = [];
      for (const match of plan.matches) {
        const bytes = await match.file.arrayBuffer(); const validation = validateRom(match.requirement, new Uint8Array(bytes));
        if (!validation.valid) throw new Error(`${match.requirement.label}: ${validation.errors.join(' ')} No files were stored.`);
        prepared.push({ key: developmentFirmwareStorageKey(inventoryId, match.requirement), filename: match.file.webkitRelativePath || match.file.name, bytes });
      }
      if (!prepared.length) throw new Error('The selected folder contains no matching development firmware.');
      await storeRomBatch(prepared); onNotice(`${prepared.length} development firmware files imported atomically`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Development firmware folder import failed'); onNotice('Development firmware folder import was rejected'); }
    finally { setBusy(undefined); }
  };

  return <div className="development-firmware-inventory">
    {error && <div className="analysis-warning">{error}</div>}
    {inventories.map((inventory) => {
      const complete = inventory.requirements.every((requirement) => supplied.has(developmentFirmwareStorageKey(inventory.id, requirement)));
      return <section key={inventory.id} className="development-firmware-set">
        <div className="runtime-heading"><div><span className="eyebrow">DEVELOPMENT FIRMWARE INVENTORY · NOT A RUNTIME CLAIM</span><h2>{inventory.label}</h2></div><span className={`rom-readiness ${complete ? 'ready' : ''}`}>{complete ? 'INVENTORIED' : 'INCOMPLETE'}</span></div>
        <div className="rom-disclosure"><Icon name="lock" size={17} /><p>{inventory.runtimeStatus} These moving snapshots remain browser-local and excluded from projects and containers.</p><label className={busy === `${inventory.id}/folder` ? 'rom-folder-import busy' : 'rom-folder-import'}><input type="file" multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} disabled={!!busy} aria-label={`Import ${inventory.label} folder`} onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void importFolder(inventory.id, inventory.requirements, files); event.target.value = ''; }} /><Icon name="open" size={14} /> Import folder</label></div>
        <div className="rom-requirements">{inventory.requirements.map((requirement) => {
          const key = developmentFirmwareStorageKey(inventory.id, requirement); const record = supplied.get(key); const operation = `${inventory.id}/${requirement.id}`;
          return <section key={requirement.id} className={record ? 'supplied' : ''}><div className="rom-status-icon"><Icon name={record ? 'check' : 'chip'} size={19} /></div><div className="rom-copy"><strong>{requirement.label}<em>DEVELOPMENT</em></strong><span>{requirement.purpose.replace('-', ' ')} · {requirement.acceptedSizes.map((size) => `${size / 1024} KiB`).join(' or ')}</span><code>{requirement.emulatorPath}</code>{requirement.provenanceNote && <small>{requirement.provenanceNote}</small>}{record && <small>{record.filename} · {record.size.toLocaleString()} bytes · SHA-256 {record.sha256}</small>}</div><div className="rom-actions">{record ? <button type="button" onClick={() => void forgetRom(inventory.id, requirement)}>Remove</button> : <label className={busy === operation ? 'busy' : ''}><input type="file" accept=".rom,.bin,application/octet-stream" disabled={!!busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRom(inventory.id, requirement, file); event.target.value = ''; }} /><Icon name="open" size={14} /> {busy === operation ? 'Checking…' : 'Choose ROM'}</label>}</div></section>;
        })}</div>
      </section>;
    })}
  </div>;
}
