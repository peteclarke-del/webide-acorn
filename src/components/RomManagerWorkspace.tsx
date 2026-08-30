import { useCallback, useEffect, useState } from 'react';
import { adapterSupportFor, adapterSupportSummary } from '../rom/adapterSupport';
import { Icon } from './Icon';
import { requiredRomRequirements, romSetFor, romStorageKey, validateRom, type RomRequirement } from '../rom/romProfiles';
import { listRoms, removeRom, storeRom, storeRomBatch, type StoredRom } from '../rom/romStore';
import { planRomFolderImport } from '../rom/romFolderImport';
import { DevelopmentFirmwareWorkspace } from './DevelopmentFirmwareWorkspace';
import { ArchimedesFirmwareWorkspace } from './ArchimedesFirmwareWorkspace';

interface RomManagerWorkspaceProps {
  machineId: string;
  romId: string;
  onNotice: (message: string) => void;
  onReadyChange?: (ready: boolean) => void;
  enabledCapabilities?: string[];
}

export function RomManagerWorkspace({ machineId, romId, onNotice, onReadyChange, enabledCapabilities = [] }: RomManagerWorkspaceProps) {
  const definition = romSetFor(machineId, romId);
  const [records, setRecords] = useState<StoredRom[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!definition) { setRecords([]); return; }
    try { setRecords(await listRoms(`${definition.id}/`)); setError(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'ROM storage is unavailable'); }
  }, [definition]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!definition) return;
    const supplied = new Set(records.map((record) => record.key));
    onReadyChange?.(requiredRomRequirements(definition, enabledCapabilities).every((item) => supplied.has(romStorageKey(definition.id, item))));
  }, [definition, enabledCapabilities, records, onReadyChange]);

  const importRom = async (requirement: RomRequirement, file: File) => {
    if (!definition) return;
    setBusy(requirement.id);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validation = validateRom(requirement, bytes);
      if (!validation.valid) { setError(validation.errors.join(' ')); onNotice(`${requirement.label} was rejected`); return; }
      const record = await storeRom(romStorageKey(definition.id, requirement), file);
      setError(validation.warnings.join(' ') || undefined);
      onNotice(`${requirement.label} stored locally · SHA-256 ${record.sha256.slice(0, 12)}…`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ROM import failed'); }
    finally { setBusy(undefined); }
  };

  const forgetRom = async (requirement: RomRequirement) => {
    if (!definition) return;
    await removeRom(romStorageKey(definition.id, requirement));
    onNotice(`${requirement.label} removed from browser ROM storage`);
    await refresh();
  };

  const importFolder = async (files: File[]) => {
    if (!definition || !files.length) return;
    setBusy('folder'); setError(undefined);
    try {
      const plan = planRomFolderImport(definition.requirements, files);
      if (plan.ambiguous.length) throw new Error(`Folder import found more than one equally suitable file for ${plan.ambiguous.map((item) => item.requirement.label).join(', ')}. Keep one normalized copy of each ROM in the selected folder.`);
      const suppliedKeys = new Set(records.map((record) => record.key));
      const required = requiredRomRequirements(definition, enabledCapabilities);
      const missingRequired = plan.missing.filter((requirement) => required.includes(requirement) && !suppliedKeys.has(romStorageKey(definition.id, requirement)));
      if (missingRequired.length) throw new Error(`Folder import is missing ${missingRequired.map((item) => `${item.label} (${item.emulatorPath})`).join(', ')}. No files were stored.`);
      const prepared: Array<{ key: string; filename: string; bytes: ArrayBuffer }> = [];
      const warnings: string[] = [];
      for (const match of plan.matches) {
        const bytes = await match.file.arrayBuffer();
        const validation = validateRom(match.requirement, new Uint8Array(bytes));
        if (!validation.valid) throw new Error(`${match.requirement.label}: ${validation.errors.join(' ')} No files were stored.`);
        warnings.push(...validation.warnings.map((warning) => `${match.requirement.label}: ${warning}`));
        prepared.push({ key: romStorageKey(definition.id, match.requirement), filename: match.file.webkitRelativePath || match.file.name, bytes });
      }
      if (!prepared.length) throw new Error('The selected folder contains no files matching this emulator manifest.');
      await storeRomBatch(prepared);
      setError(warnings.join(' ') || undefined);
      onNotice(`${prepared.length} validated ROM${prepared.length === 1 ? '' : 's'} imported atomically for ${definition.label}`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ROM folder import failed');
      onNotice('ROM folder import was rejected');
    } finally { setBusy(undefined); }
  };

  if (!definition) {
    /* Say which of the two reasons applies. Telling someone to supply firmware
     * for a machine the pinned engine cannot model would waste their time. */
    const support = adapterSupportFor(machineId);
    return (
      <div className="rom-workspace">
        <div className="runtime-heading">
          <div><span className="eyebrow">FIRMWARE VAULT · ENGINE CAPABILITY GATE</span><h2>{support.state === 'no-engine-model' ? 'No emulator model for this machine' : 'No qualified emulator ROM manifest'}</h2></div>
          <span className="rom-readiness">{support.state === 'no-engine-model' ? 'CANNOT RUN HERE' : 'MANIFEST MISSING'}</span>
        </div>
        <div className="honest-empty runtime-empty" role="status">
          <p>{adapterSupportSummary(support)}</p>
          <p>{support.limitation}</p>
          <p>Another Acorn machine will not be substituted for it.</p>
        </div>
        <ArchimedesFirmwareWorkspace machineId={machineId} romId={romId} onNotice={onNotice} onReadyChange={onReadyChange} />
        <DevelopmentFirmwareWorkspace machineId={machineId} enabledCapabilities={enabledCapabilities} onNotice={onNotice} />
      </div>
    );
  }
  const support = adapterSupportFor(machineId);
  const supplied = new Map(records.map((record) => [record.key, record]));
  const ready = requiredRomRequirements(definition, enabledCapabilities).every((item) => supplied.has(romStorageKey(definition.id, item)));
  return (
    <div className="rom-workspace">
      <div className="runtime-heading"><div><span className="eyebrow">LOCAL FIRMWARE VAULT · NEVER EXPORTED WITH PROJECTS</span><h2>{definition.label}</h2></div><span className={`rom-readiness ${ready ? 'ready' : ''}`}>{ready ? 'ROM SET READY' : 'ROM SET INCOMPLETE'}</span></div>
      <div className="rom-adapter-support" role="status"><Icon name="chip" size={15} /><p><strong>{adapterSupportSummary(support)}</strong> {support.limitation}</p></div>
      <div className="rom-disclosure"><Icon name="lock" size={17} /><p>Supply ROM dumps you are legally entitled to use. Files remain in this browser’s IndexedDB, are served only to the local emulator path, and are excluded from project export. Size validation is not proof of authenticity or permission.</p><label className={busy === 'folder' ? 'rom-folder-import busy' : 'rom-folder-import'}><input type="file" multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} disabled={!!busy} aria-label="Import normalized ROM folder" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void importFolder(files); event.target.value = ''; }} /><Icon name="open" size={14} /> {busy === 'folder' ? 'Validating folder…' : 'Import normalized folder'}</label></div>
      {error && <div className="analysis-warning">{error}</div>}
      <div className="rom-requirements">{definition.requirements.map((requirement) => {
        const key = romStorageKey(definition.id, requirement); const record = supplied.get(key);
        return <section key={requirement.id} className={record ? 'supplied' : ''}><div className="rom-status-icon"><Icon name={record ? 'check' : 'chip'} size={19} /></div><div className="rom-copy"><strong>{requirement.label}{requirement.supportStatus === 'development' && <em>DEVELOPMENT</em>}</strong><span>{requirement.purpose.replace('-', ' ')} · {requirement.acceptedSizes.map((size) => `${size / 1024} KiB`).join(' or ')}{requirement.requiredByCapability ? ` · required when ${requirement.requiredByCapability} is enabled` : ''}{requirement.runtimeMount === 'sideways' ? ' · mounted in a real sideways ROM bank' : ''}</span><code>{requirement.emulatorPath}</code>{requirement.provenanceNote && <small>{requirement.provenanceNote}</small>}{record && <small>{record.filename} · {record.size.toLocaleString()} bytes · SHA-256 {record.sha256}</small>}</div><div className="rom-actions">{record ? <button type="button" onClick={() => void forgetRom(requirement)}>Remove</button> : <label className={busy === requirement.id ? 'busy' : ''}><input type="file" accept=".rom,.bin,application/octet-stream" disabled={!!busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRom(requirement, file); event.target.value = ''; }} /><Icon name="open" size={14} /> {busy === requirement.id ? 'Checking…' : 'Choose ROM'}</label>}</div></section>;
      })}</div>
      <div className="rom-adapter-facts"><div><span>Engine</span><strong>{definition.engine.id} {definition.engine.version}</strong></div><div><span>Adapter model</span><strong>{definition.adapterModel}</strong></div><div><span>Storage</span><strong>IndexedDB · origin private</strong></div><div><span>Emulator URL base</span><strong>/user-roms/{definition.id}/</strong></div><div><span>Project export</span><strong>ROM bytes excluded</strong></div></div>
    </div>
  );
}
