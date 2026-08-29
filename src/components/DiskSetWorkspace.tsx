/* Editing and producing a disk set.
 *
 * The point of this surface is that it tells the truth before it writes
 * anything: which build targets the set needs, which of them have a current
 * artifact, and whether each side actually fits. Nothing is produced from a
 * source that is missing, and a side that does not fit says by how much rather
 * than failing at the end of a long export.
 */
import { useMemo, useState } from 'react';
import {
  DFS_MAX_CATALOGUE_ENTRIES,
  buildDiskSet,
  diskSetBuildPlan,
  diskSetSideQuota,
  diskSetSummary,
  generatedBootText,
  validateDiskSet,
  type DiskSet,
  type DiskSetBootAction,
  type DiskSetDisc,
  type DiskSetEntry,
  type DiskSetResolvedEntry,
  type DiskSetSide,
} from '../media/diskSet';

export interface DiskSetSourceArtifact {
  targetId: string;
  targetName: string;
  outputName: string;
  bytes: Uint8Array;
  loadAddress: number;
  executionAddress: number;
  fingerprint: string;
}

export interface DiskSetWorkspaceProps {
  sets: DiskSet[];
  buildTargets: Array<{ id: string; name: string }>;
  projectFiles: Array<{ id: string; name: string; content: string }>;
  /** Retained artifacts, by build target. A target absent here has not been built. */
  artifacts: DiskSetSourceArtifact[];
  onChange: (sets: DiskSet[]) => void;
  onNotice: (message: string) => void;
  onDownload: (filename: string, bytes: Uint8Array) => void;
}

const BOOT_ACTIONS: Array<{ value: DiskSetBootAction; label: string }> = [
  { value: 'none', label: 'No boot' },
  { value: 'load', label: '*LOAD on Shift+Break' },
  { value: 'run', label: '*RUN on Shift+Break' },
  { value: 'exec', label: '*EXEC on Shift+Break' },
];

const identity = () => crypto.randomUUID();

function emptySide(title: string): DiskSetSide {
  return { title, entries: [], boot: { action: 'none' } };
}

function emptyDisc(index: number): DiskSetDisc {
  return { id: identity(), label: `Disc ${index + 1}`, format: 'dfs-ssd', sides: [emptySide('ACORN')] };
}

function emptySet(index: number): DiskSet {
  return validateDiskSet({
    schema: '8bit-net.disk-set', version: 1, id: identity(),
    name: index === 0 ? 'Release disks' : `Disk set ${index + 1}`,
    discs: [emptyDisc(0)],
  });
}

export function DiskSetWorkspace({ sets, buildTargets, projectFiles, artifacts, onChange, onNotice, onDownload }: DiskSetWorkspaceProps) {
  const [selectedSetId, setSelectedSetId] = useState<string | null>(sets[0]?.id ?? null);
  const selected = sets.find((set) => set.id === selectedSetId) ?? sets[0] ?? null;

  const artifactByTarget = useMemo(() => new Map(artifacts.map((artifact) => [artifact.targetId, artifact])), [artifacts]);

  /* Bytes for every entry that has a source available now. An entry missing
   * from this map is exactly what the quota and the build refuse on. */
  const resolvedEntries = useMemo(() => {
    const resolved = new Map<string, DiskSetResolvedEntry>();
    if (!selected) return resolved;
    const encoder = new TextEncoder();
    for (const disc of selected.discs) {
      for (const side of disc.sides) {
        for (const entry of side.entries) {
          if (entry.source.kind === 'build-target') {
            const artifact = artifactByTarget.get(entry.source.targetId);
            if (artifact) resolved.set(entry.id, { bytes: artifact.bytes, loadAddress: artifact.loadAddress, executionAddress: artifact.executionAddress });
          } else if (entry.source.kind === 'project-file') {
            const fileId = entry.source.fileId;
            const file = projectFiles.find((candidate) => candidate.id === fileId);
            if (file && file.content.length) resolved.set(entry.id, { bytes: encoder.encode(file.content), loadAddress: 0, executionAddress: 0 });
          } else {
            const bytes = encoder.encode(generatedBootText(side));
            resolved.set(entry.id, { bytes, loadAddress: 0, executionAddress: 0 });
          }
        }
      }
    }
    return resolved;
  }, [selected, artifactByTarget, projectFiles]);

  const sizes = useMemo(() => new Map([...resolvedEntries].map(([id, value]) => [id, value.bytes.length])), [resolvedEntries]);

  const plan = selected ? diskSetBuildPlan(selected) : [];
  const missingTargets = plan.filter((targetId) => !artifactByTarget.has(targetId));

  const replaceSet = (next: DiskSet) => onChange(sets.map((set) => set.id === next.id ? next : set));

  const edit = (mutate: (draft: {
    schema: DiskSet['schema']; version: DiskSet['version']; id: string; name: string;
    discs: Array<{ id: string; label: string; format: DiskSetDisc['format']; sides: Array<{ title: string; entries: DiskSetEntry[]; boot: DiskSetSide['boot'] }> }>;
  }) => void) => {
    if (!selected) return;
    const draft = JSON.parse(JSON.stringify(selected)) as Parameters<typeof mutate>[0];
    mutate(draft);
    try { replaceSet(validateDiskSet(draft)); }
    catch (error) { onNotice(`Disk set refused · ${error instanceof Error ? error.message : String(error)}`); }
  };

  const addSet = () => {
    const next = emptySet(sets.length);
    onChange([...sets, next]);
    setSelectedSetId(next.id);
  };

  const removeSet = () => {
    if (!selected) return;
    onChange(sets.filter((set) => set.id !== selected.id));
    setSelectedSetId(null);
    onNotice(`${selected.name} removed. Its images, if any were exported, are untouched.`);
  };

  const build = () => {
    if (!selected) return;
    try {
      const built = buildDiskSet(selected, resolvedEntries);
      for (const disc of built.discs) onDownload(disc.filename, disc.image);
      onNotice(`${selected.name} written · ${built.discs.length} image${built.discs.length === 1 ? '' : 's'} · ${built.totalBytes.toLocaleString()} bytes · every catalogue reparsed and byte-compared`);
    } catch (error) {
      onNotice(`Disk set not written · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (!selected) {
    return (
      <section className="disk-set-workspace" aria-label="Disk sets">
        <div className="panel-heading"><strong>Disk sets</strong><small>No set defined</small></div>
        <p className="honest-empty">A disk set records which build artifacts and project files go on which image, in what order, and how the machine starts from them. Nothing is written until every named source exists and every side fits.</p>
        <button type="button" className="primary-action compact" onClick={addSet}>New disk set</button>
      </section>
    );
  }

  return (
    <section className="disk-set-workspace" aria-label="Disk sets">
      <div className="panel-heading">
        <strong>Disk sets</strong>
        <small>{diskSetSummary(selected)}</small>
      </div>
      <div className="disk-set-actions">
        <label>
          <span className="visually-hidden">Disk set</span>
          <select value={selected.id} onChange={(event) => setSelectedSetId(event.target.value)}>
            {sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
          </select>
        </label>
        <label className="disk-set-name">
          <span className="visually-hidden">Disk set name</span>
          <input value={selected.name} aria-label="Disk set name" onChange={(event) => edit((draft) => { draft.name = event.target.value || 'Disk set'; })} />
        </label>
        <button type="button" onClick={addSet}>New set</button>
        <button type="button" onClick={() => edit((draft) => { draft.discs.push(emptyDisc(draft.discs.length)); })}>Add disc</button>
        <button type="button" onClick={removeSet}>Remove set</button>
        <button type="button" className="primary-action compact" disabled={!!missingTargets.length} title={missingTargets.length ? `Build ${missingTargets.join(', ')} first` : 'Write every image in this set'} onClick={build}>Write disk set</button>
      </div>

      {/* A named region rather than a live one: this is standing content, and a
        * second live region would compete with the workbench notice line. */}
      <div className="disk-set-plan" role="group" aria-label="Dependency build">
        <strong>Dependency build</strong>
        {plan.length === 0 ? <span>This set names no build target.</span> : (
          <ul>
            {plan.map((targetId) => {
              const target = buildTargets.find((candidate) => candidate.id === targetId);
              const artifact = artifactByTarget.get(targetId);
              return (
                <li key={targetId} className={artifact ? 'ready' : 'missing'}>
                  <strong>{target?.name ?? targetId}</strong>
                  <span>{artifact ? `${artifact.outputName} · ${artifact.bytes.length.toLocaleString()} bytes · ${artifact.fingerprint.slice(0, 12)}` : 'not built in this session'}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected.discs.map((disc, discIndex) => (
        <article className="disk-set-disc" key={disc.id}>
          <header>
            <label>
              <span className="visually-hidden">Disc label</span>
              <input value={disc.label} aria-label={`Disc ${discIndex + 1} label`} onChange={(event) => edit((draft) => { draft.discs[discIndex]!.label = event.target.value || `Disc ${discIndex + 1}`; })} />
            </label>
            <label>
              <span>Format</span>
              <select
                value={disc.format}
                aria-label={`Disc ${discIndex + 1} format`}
                onChange={(event) => edit((draft) => {
                  const target = draft.discs[discIndex]!;
                  target.format = event.target.value as DiskSetDisc['format'];
                  if (target.format === 'dfs-dsd' && target.sides.length === 1) target.sides.push(emptySide('SIDE2'));
                  if (target.format === 'dfs-ssd' && target.sides.length === 2) target.sides = [target.sides[0]!];
                })}
              >
                <option value="dfs-ssd">Single-sided DFS (200 KiB)</option>
                <option value="dfs-dsd">Double-sided DFS (400 KiB)</option>
              </select>
            </label>
            <button type="button" disabled={selected.discs.length === 1} onClick={() => edit((draft) => { draft.discs.splice(discIndex, 1); })}>Remove disc</button>
          </header>

          {disc.sides.map((side, sideIndex) => {
            const quota = diskSetSideQuota(side, sizes);
            return (
              <section className="disk-set-side" key={`${disc.id}-${sideIndex}`} aria-label={`${disc.label} side ${sideIndex}`}>
                <div className="disk-set-side-heading">
                  <label>
                    <span>Title</span>
                    <input value={side.title} maxLength={12} aria-label={`${disc.label} side ${sideIndex} title`} onChange={(event) => edit((draft) => { draft.discs[discIndex]!.sides[sideIndex]!.title = event.target.value || 'ACORN'; })} />
                  </label>
                  <label>
                    <span>Boot</span>
                    <select
                      value={side.boot.action}
                      aria-label={`${disc.label} side ${sideIndex} boot action`}
                      onChange={(event) => edit((draft) => {
                        const target = draft.discs[discIndex]!.sides[sideIndex]!;
                        const action = event.target.value as DiskSetBootAction;
                        target.boot = action === 'none' ? { action } : { action, entryId: target.boot.entryId ?? target.entries[0]?.id };
                      })}
                    >
                      {BOOT_ACTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                    </select>
                  </label>
                  {side.boot.action !== 'none' && (
                    <label>
                      <span>Boot file</span>
                      <select
                        value={side.boot.entryId ?? ''}
                        aria-label={`${disc.label} side ${sideIndex} boot file`}
                        onChange={(event) => edit((draft) => { draft.discs[discIndex]!.sides[sideIndex]!.boot = { action: side.boot.action, entryId: event.target.value }; })}
                      >
                        {side.entries.map((item) => <option key={item.id} value={item.id}>{item.directory ?? '$'}.{item.name}</option>)}
                      </select>
                    </label>
                  )}
                  <span className={quota.fits ? 'disk-set-quota fits' : 'disk-set-quota'}>
                    {quota.usedSectors.toLocaleString()}/{quota.sectorCapacity.toLocaleString()} sectors · {quota.entries}/{quota.entryCapacity} files
                  </span>
                </div>
                {quota.reasons.map((reason) => <p className="disk-set-warning" key={reason}>{reason}</p>)}

                <div className="disk-set-entries" role="table" aria-label={`${disc.label} side ${sideIndex} files`}>
                  <div className="disk-set-entry head" role="row"><span role="columnheader">Dir</span><span role="columnheader">Name</span><span role="columnheader">Source</span><span role="columnheader">Bytes</span><span role="columnheader">Order</span></div>
                  {side.entries.map((item, entryIndex) => (
                    <div className="disk-set-entry" role="row" key={item.id}>
                      <input role="cell" className="disk-set-directory" maxLength={1} value={item.directory ?? '$'} aria-label={`${item.name} directory`} onChange={(event) => edit((draft) => { draft.discs[discIndex]!.sides[sideIndex]!.entries[entryIndex]!.directory = event.target.value || '$'; })} />
                      <input role="cell" maxLength={7} value={item.name} aria-label={`File ${entryIndex + 1} name`} onChange={(event) => edit((draft) => { draft.discs[discIndex]!.sides[sideIndex]!.entries[entryIndex]!.name = event.target.value.toUpperCase() || 'FILE'; })} />
                      <select
                        role="cell"
                        aria-label={`${item.name} source`}
                        value={item.source.kind === 'build-target' ? `target:${item.source.targetId}` : item.source.kind === 'project-file' ? `file:${item.source.fileId}` : 'boot'}
                        onChange={(event) => edit((draft) => {
                          const value = event.target.value;
                          const target = draft.discs[discIndex]!.sides[sideIndex]!.entries[entryIndex]!;
                          target.source = value === 'boot' ? { kind: 'generated-boot' }
                            : value.startsWith('target:') ? { kind: 'build-target', targetId: value.slice(7) }
                            : { kind: 'project-file', fileId: value.slice(5) };
                        })}
                      >
                        <optgroup label="Build targets">
                          {buildTargets.map((target) => <option key={target.id} value={`target:${target.id}`}>{target.name}</option>)}
                        </optgroup>
                        <optgroup label="Project files">
                          {projectFiles.map((file) => <option key={file.id} value={`file:${file.id}`}>{file.name}</option>)}
                        </optgroup>
                        <optgroup label="Generated">
                          <option value="boot">!BOOT running this side</option>
                        </optgroup>
                      </select>
                      <span role="cell" className={sizes.has(item.id) ? '' : 'disk-set-unresolved'}>{sizes.has(item.id) ? `${sizes.get(item.id)!.toLocaleString()}` : 'not built'}</span>
                      <span role="cell" className="disk-set-order">
                        <button type="button" aria-label={`Move ${item.name} earlier`} disabled={entryIndex === 0} onClick={() => edit((draft) => { const entries = draft.discs[discIndex]!.sides[sideIndex]!.entries; [entries[entryIndex - 1], entries[entryIndex]] = [entries[entryIndex]!, entries[entryIndex - 1]!]; })}>↑</button>
                        <button type="button" aria-label={`Move ${item.name} later`} disabled={entryIndex === side.entries.length - 1} onClick={() => edit((draft) => { const entries = draft.discs[discIndex]!.sides[sideIndex]!.entries; [entries[entryIndex], entries[entryIndex + 1]] = [entries[entryIndex + 1]!, entries[entryIndex]!]; })}>↓</button>
                        <button type="button" aria-label={`Remove ${item.name}`} onClick={() => edit((draft) => { const target = draft.discs[discIndex]!.sides[sideIndex]!; target.entries.splice(entryIndex, 1); if (target.boot.entryId === item.id) target.boot = { action: 'none' }; })}>✕</button>
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={side.entries.length >= DFS_MAX_CATALOGUE_ENTRIES || !buildTargets.length}
                  title={side.entries.length >= DFS_MAX_CATALOGUE_ENTRIES ? 'A DFS catalogue names at most 31 files' : 'Add a file to this side'}
                  onClick={() => edit((draft) => {
                    const target = draft.discs[discIndex]!.sides[sideIndex]!;
                    const first = buildTargets[0]!;
                    const base = (first.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'FILE').slice(0, 7);
                    let name = base;
                    let suffix = 1;
                    while (target.entries.some((existing) => existing.name === name)) name = `${base.slice(0, 6)}${suffix++}`;
                    target.entries.push({ id: identity(), name, directory: '$', source: { kind: 'build-target', targetId: first.id } });
                  })}
                >
                  Add file
                </button>
              </section>
            );
          })}
        </article>
      ))}
    </section>
  );
}
