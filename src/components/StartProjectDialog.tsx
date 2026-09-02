import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { loadSampleProjects, sampleLocalProject, type SampleProject } from '../samples/sampleProjects';
import { overrideTargetEntry, planCodebaseImport, projectFromCodebaseImport, type CodebaseFileInput, type CodebaseImportPlan } from '../project/codebaseImport';
import { directorySupport, pickDirectory, readDirectory, type FileSystemDirectoryHandleLike } from '../project/directoryAccess';
import { archiveRefusalSummary, readZipArchive } from '../project/archiveImport';
import { projectFromTemplate, templatesForMachine } from '../project/templateCatalogue';
import type { LocalProject } from '../project/project';
import { ProjectStoreClient, type StoredProject, type StoredRevision } from '../cloud/projectStoreClient';
import { projectFromStoredFiles } from '../cloud/storedProject';

interface StartProjectDialogProps {
  /** The folder handle is passed on only when the project came from one that
   * this browser can write back to; otherwise saving stays a download. */
  onOpenProject: (project: LocalProject, description: string, folder?: FileSystemDirectoryHandleLike | null) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
  /** The machine currently selected, so templates are offered against it. */
  machineId: string;
  /** Supplied by tests; the real dialog talks to the store this build ships. */
  storeClient?: ProjectStoreClient;
  /** Which source to show first, when something opened the dialog for one. */
  initialTab?: 'samples' | 'templates' | 'folder' | 'store';
}

type Tab = 'samples' | 'templates' | 'folder' | 'store';

const EXCLUSION_LABELS: Record<string, string> = {
  'ignored-directory': 'Skipped folder',
  'unsupported-file-type': 'Not an editable source type',
  'not-text': 'Did not decode as text',
  'file-too-large': 'Above the per-file limit',
  'project-size-limit': 'Above the project total',
  'file-count-limit': 'Above the file count limit',
  'empty-name': 'No filename',
};

export function StartProjectDialog({ onOpenProject, onClose, onNotice, machineId, storeClient, initialTab }: StartProjectDialogProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'samples');
  /* The project store, which is where work lives when it is meant to outlast
   * this browser. Everything about it is reported rather than assumed: a store
   * that is not running says so, and a revision with no project manifest says
   * that too rather than being opened as a guess. */
  const store = useMemo(() => storeClient ?? new ProjectStoreClient(), [storeClient]);
  const [stored, setStored] = useState<StoredProject[]>([]);
  const [storeUnreachable, setStoreUnreachable] = useState<string>();
  const [storeBusy, setStoreBusy] = useState(false);
  const [storeRevisions, setStoreRevisions] = useState<Record<string, StoredRevision[]>>({});
  const [samples, setSamples] = useState<SampleProject[]>();
  const [sampleError, setSampleError] = useState<string>();
  const [plan, setPlan] = useState<CodebaseImportPlan>();
  const [contents, setContents] = useState<Map<string, string>>();
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [selectedMaps, setSelectedMaps] = useState<Record<string, string>>({});
  const [projectName, setProjectName] = useState('');
  const [reading, setReading] = useState(false);
  /* Anything the folder walk itself could not bring in, kept apart from the
   * planner's own exclusions so a person can see which stage refused what. */
  const [folderNotes, setFolderNotes] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadSampleProjects()
      .then((loaded) => { if (!cancelled) setSamples(loaded); })
      .catch((error) => { if (!cancelled) setSampleError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  const openSample = (sample: SampleProject) => {
    try {
      onOpenProject(sampleLocalProject(sample), `Opened the ${sample.name} sample`);
    } catch (error) {
      onNotice(`${sample.name} could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /* What this browser can actually do with a folder, asked once. */
  const folderAccess = useMemo(() => directorySupport(), []);
  const [connectedFolder, setConnectedFolder] = useState<FileSystemDirectoryHandleLike | null>(null);

  const openConnectedFolder = async () => {
    setReading(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const contents = await readDirectory(handle);
      if (!contents.entries.length) { onNotice(`${handle.name} contains no readable source files`); return; }
      setConnectedFolder(handle);
      applyPlan(contents.entries.map((entry) => ({ path: entry.path, content: entry.content })), handle.name, [
        ...contents.skipped.map((entry) => `${entry.path}: ${entry.reason}`),
        ...(contents.truncated ? ['The folder was larger than this workbench reads in one go, so it was cut short.'] : []),
      ]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setReading(false);
    }
  };

  /* Both folder routes end here, so a project imported through the picker and
   * one imported through the directory input are planned identically. */
  const applyPlan = (inputs: CodebaseFileInput[], root: string, notes: string[]) => {
    const nextPlan = planCodebaseImport(inputs, root);
    const byPath = new Map(inputs.map((input) => [input.path, input.content]));
    setPlan(nextPlan);
    setContents(new Map(nextPlan.files.map((file) => [file.name, byPath.get(file.path) ?? ''])));
    setSelectedAssets([]);
    setSelectedMaps({});
    setProjectName(nextPlan.name);
    setFolderNotes(notes);
  };

  /* Templates are offered against the machine that is selected right now, so
   * the list changes with the configuration rather than being a fixed menu. */
  const templates = useMemo(() => templatesForMachine(machineId), [machineId]);

  const openTemplate = (id: string) => {
    const template = templates.available.find((candidate) => candidate.id === id);
    if (!template) { onNotice('That template is not available for this machine.'); return; }
    try {
      onOpenProject(projectFromTemplate(template), `Started ${template.name}`, null);
    } catch (error) {
      onNotice(`${template.name} could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /* An archive is the third way source arrives, and the one that needs the most
   * checking: everything in it is a claim by whoever built it. What the reader
   * refused is shown beside the plan rather than being dropped. */
  const readArchive = async (file: File) => {
    setReading(true);
    setConnectedFolder(null);
    try {
      const result = await readZipArchive(await file.arrayBuffer());
      if (!result.entries.length) {
        onNotice(`${file.name} holds no importable source files${result.refused.length ? `: ${archiveRefusalSummary(result.refused)[0]}` : ''}`);
        return;
      }
      const root = file.name.replace(/\.zip$/i, '') || 'Imported project';
      applyPlan(result.entries.map((entry) => ({ path: entry.path, content: entry.content })), root, [
        ...archiveRefusalSummary(result.refused),
        ...(result.truncated ? ['The archive was larger than this workbench reads in one go, so it was cut short.'] : []),
      ]);
    } catch (error) {
      onNotice(`${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReading(false);
    }
  };

  const readFolder = async (files: File[]) => {
    setReading(true);
    setConnectedFolder(null);
    try {
      const inputs: CodebaseFileInput[] = [];
      for (const file of files) {
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        /* Text is read for every candidate; the planner decides what survives. */
        inputs.push({ path, content: await file.text() });
      }
      applyPlan(inputs, inputs[0]?.path.split('/')[0] ?? 'Imported project', []);
    } catch (error) {
      onNotice(`That folder could not be read: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReading(false);
    }
  };

  /* The inference is a proposal, not a verdict. A refusal is reported rather
   * than leaving the control looking as though it had taken effect. */
  const setEntry = (targetId: string, entryName: string) => {
    if (!plan) return;
    try {
      setPlan(overrideTargetEntry(plan, targetId, entryName));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const createFromFolder = () => {
    if (!plan || !contents) return;
    try {
      const derivedMaps = Object.entries(selectedMaps).flatMap(([id, shape]) => {
        const [width, height] = shape.split('x').map(Number);
        return Number.isInteger(width) && Number.isInteger(height) ? [{ id, width: width!, height: height! }] : [];
      });
      const project = projectFromCodebaseImport(plan, contents, { derivedAssetIds: selectedAssets, derivedMaps, projectName });
      const from = connectedFolder ? `, connected to ${connectedFolder.name}` : '';
      onOpenProject(project, `Created ${project.name} from ${plan.files.length} imported file${plan.files.length === 1 ? '' : 's'}${from}`, connectedFolder);
    } catch (error) {
      onNotice(`The imported project could not be created: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, number>();
    for (const exclusion of plan?.exclusions ?? []) groups.set(exclusion.reason, (groups.get(exclusion.reason) ?? 0) + 1);
    return [...groups.entries()].sort((left, right) => right[1] - left[1]);
  }, [plan]);

  /* Asked for once when the tab is opened, so a dialog that is never taken to
   * the store makes no request to it. */
  useEffect(() => {
    if (tab !== 'store') return;
    let cancelled = false;
    void (async () => {
      const listed = await store.projects();
      if (cancelled) return;
      if (!listed.ok) { setStoreUnreachable(listed.reason); setStored([]); return; }
      setStoreUnreachable(undefined);
      setStored(listed.value);
    })();
    return () => { cancelled = true; };
  }, [tab, store]);

  const showRevisions = async (projectId: string) => {
    setStoreBusy(true);
    const listed = await store.revisions(projectId);
    setStoreBusy(false);
    if (!listed.ok) { onNotice(`The store could not list revisions of ${projectId}: ${listed.reason}`); return; }
    setStoreRevisions((current) => ({ ...current, [projectId]: listed.value }));
  };

  const openStored = async (projectId: string, revisionId: string) => {
    setStoreBusy(true);
    const read = await store.read(projectId, revisionId);
    setStoreBusy(false);
    if (!read.ok) { onNotice(`The store could not read ${projectId} ${revisionId}: ${read.reason}`); return; }
    /* The client has already decoded the contents; decoding again here would
     * turn every file into whatever base64 of base64 happens to be. */
    const opened = projectFromStoredFiles(read.value);
    if (!opened.project) { onNotice(opened.detail); return; }
    /* No folder handle: this came from the store, not from a folder on disk,
     * and saying otherwise would offer a write-back that could not happen. */
    onOpenProject(opened.project, `${opened.detail} From the project store, revision ${revisionId}.`, null);
  };

  return (
    <div className="modal-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="start-project-dialog panel-surface" role="dialog" aria-modal="true" aria-label="Start a project">
        <header>
          <h2><Icon name="layers" size={17} /> Start a project</h2>
          <button type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={15} /></button>
        </header>
        <div className="start-project-tabs" role="tablist" aria-label="Project sources">
          <button type="button" role="tab" id="start-tab-samples" aria-selected={tab === 'samples'} aria-controls="start-panel-samples" className={tab === 'samples' ? 'active' : undefined} onClick={() => setTab('samples')}>Sample projects</button>
          <button type="button" role="tab" id="start-tab-templates" aria-selected={tab === 'templates'} aria-controls="start-panel-templates" className={tab === 'templates' ? 'active' : undefined} onClick={() => setTab('templates')}>Templates</button>
          <button type="button" role="tab" id="start-tab-folder" aria-selected={tab === 'folder'} aria-controls="start-panel-folder" className={tab === 'folder' ? 'active' : undefined} onClick={() => setTab('folder')}>From an existing codebase</button>
          <button type="button" role="tab" id="start-tab-store" aria-selected={tab === 'store'} aria-controls="start-panel-store" className={tab === 'store' ? 'active' : undefined} onClick={() => setTab('store')}>From the project store</button>
        </div>

        {tab === 'samples' && (
          <div className="start-project-panel" role="tabpanel" id="start-panel-samples" aria-labelledby="start-tab-samples">
            <p>
              Each sample opens as an ordinary browser-local project with its own sources, assets, build targets
              and, where it has them, real-machine test plans. Nothing is read-only and nothing is hidden.
            </p>
            {sampleError && <p className="binding-warning">The sample catalogue failed to load: {sampleError}</p>}
            {!samples && !sampleError && <p className="honest-empty">Loading the sample catalogue…</p>}
            <ul className="sample-list">
              {(samples ?? []).map((sample) => (
                <li key={sample.id}>
                  <div className="sample-heading">
                    <h3>{sample.name}</h3>
                    <span className="sample-meta">{sample.language} · {sample.machine}</span>
                  </div>
                  <p>{sample.summary}</p>
                  <ul className="sample-highlights">
                    {sample.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                  </ul>
                  {sample.requiresRoms && (
                    <p className="binding-note">
                      Building this sample needs no firmware. Running or testing it on the real machine needs the
                      ROM images you supply yourself in Settings.
                    </p>
                  )}
                  <button type="button" onClick={() => openSample(sample)}>Open {sample.name}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'templates' && (
          <div className="start-project-panel" role="tabpanel" id="start-panel-templates" aria-labelledby="start-tab-templates">
            <p>
              A template is a small, complete, buildable starting point rather than a finished program. Only the
              templates this machine can actually run are offered; anything that needs hardware it does not have is
              listed below with the reason, rather than being offered and then failing at build time.
            </p>
            {templates.available.length ? (
              <ul className="template-list">
                {templates.available.map((template) => (
                  <li key={template.id}>
                    <div className="template-head">
                      <strong>{template.name}</strong>
                      <small>{template.language} · {template.toolchainId}</small>
                    </div>
                    <p>{template.summary}</p>
                    <ul className="template-highlights">{template.highlights.map((claim) => <li key={claim}>{claim}</li>)}</ul>
                    <p className="binding-note">{template.provenance.author}, {template.provenance.licence}. {template.provenance.note}</p>
                    <button type="button" onClick={() => openTemplate(template.id)}>Start from this template</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="folder-access-note">No template ships for this machine yet.</p>
            )}
            {templates.unavailable.length > 0 && (
              <details className="import-exclusions">
                <summary>{templates.unavailable.length} template{templates.unavailable.length === 1 ? '' : 's'} this machine cannot run</summary>
                <ul>{templates.unavailable.map((entry) => <li key={entry.template.id}>{entry.template.name}: {entry.problems.join(' ')}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        {tab === 'folder' && (
          <div className="start-project-panel" role="tabpanel" id="start-panel-folder" aria-labelledby="start-tab-folder">
            <p>
              Choose a folder of existing Acorn source. The whole plan is shown before anything is created: what
              will be imported, what will be left out and why, any filename that had to change, the build targets
              that were inferred, and the editable assets that can be recovered from data already in the source.
              Files are read in this browser and are never uploaded.
            </p>
            {folderAccess.available ? (
              <button
                type="button"
                className="folder-picker connected"
                disabled={reading}
                onClick={() => void openConnectedFolder()}
              >
                <Icon name="open" size={14} /> {reading ? 'Reading folder…' : 'Open a folder this browser can write back to'}
              </button>
            ) : (
              <p className="folder-access-note">{folderAccess.reason}</p>
            )}
            <label className="folder-picker">
              <input
                type="file"
                multiple
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                aria-label="Choose a source folder"
                disabled={reading}
                onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void readFolder(files); }}
              />
              <Icon name="open" size={14} /> {reading ? 'Reading folder…' : folderAccess.available ? 'Choose a folder to copy in' : 'Choose folder'}
            </label>
            <label className="folder-picker">
              <input
                type="file"
                accept=".zip,application/zip"
                aria-label="Choose a zip archive"
                disabled={reading}
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readArchive(file); }}
              />
              <Icon name="open" size={14} /> {reading ? 'Reading archive…' : 'Choose a zip archive'}
            </label>
            <p className="folder-access-note">
              An archive is read in this browser and checked before anything is imported: a name that would unpack
              outside the project, a symbolic link, an encrypted entry, an entry that expands past the size limit, and
              one whose bytes do not match the checksum the archive records are each reported rather than imported.
            </p>
            {connectedFolder && <p className="folder-access-note connected" role="status">Connected to {connectedFolder.name}. Saving will write the project's files back into that folder.</p>}

            {plan && (
              <div className="import-plan">
                {folderNotes.length > 0 && (
                  <details className="import-exclusions">
                    <summary>{folderNotes.length} item{folderNotes.length === 1 ? '' : 's'} were refused before the plan was made</summary>
                    <ul>{folderNotes.map((note) => <li key={note}>{note}</li>)}</ul>
                  </details>
                )}
                <label className="import-name">
                  <span>Project name</span>
                  <input value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-label="Imported project name" />
                </label>

                <div className="import-summary" role="status">
                  {plan.files.length} file{plan.files.length === 1 ? '' : 's'} · {plan.totalBytes.toLocaleString()} bytes ·
                  {' '}{plan.targets.length} proposed build target{plan.targets.length === 1 ? '' : 's'} ·
                  {' '}{plan.exclusions.length} excluded
                </div>

                {plan.warnings.map((warning) => <p className="binding-warning" key={warning}>{warning}</p>)}

                <details open>
                  <summary>Files to import ({plan.files.length})</summary>
                  <table className="import-table">
                    <thead><tr><th scope="col">Project file</th><th scope="col">From</th><th scope="col">Language</th><th scope="col">Bytes</th></tr></thead>
                    <tbody>
                      {plan.files.map((file) => (
                        <tr key={file.name}>
                          <th scope="row">{file.name}{file.renamedFrom && <small className="binding-warning"> renamed from {file.renamedFrom}</small>}</th>
                          <td><code>{file.path}</code></td>
                          <td>{file.language}</td>
                          <td>{file.bytes.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>

                {!!plan.targets.length && (
                  <details open>
                    <summary>Proposed build targets ({plan.targets.length})</summary>
                    <p className="binding-note">
                      The entry file is inferred from what each file contains. Where the inference is wrong, choose the
                      right one here: only files of that target's own language are offered, and the target's name and
                      output follow the file you pick.
                    </p>
                    <ul className="import-targets">
                      {plan.targets.map((target) => (
                        <li key={target.id}>
                          <strong>{target.name}</strong> · {target.toolchainId} · <code>{target.outputName}</code>
                          <label className="import-entry">
                            <span>Entry file</span>
                            <select
                              value={target.entryName}
                              aria-label={`Entry file for ${target.language} build`}
                              onChange={(event) => setEntry(target.id, event.target.value)}
                            >
                              {target.candidates.map((candidate) => (
                                <option key={candidate.name} value={candidate.name}>{candidate.name}</option>
                              ))}
                            </select>
                          </label>
                          <small className="binding-note">{target.reason}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {!!plan.derivedAssets.length && (
                  <details>
                    <summary>Editable assets that can be recovered ({plan.derivedAssets.length})</summary>
                    <p className="binding-note">
                      Each of these regenerates the original assembler bytes exactly. Creating one adds a new
                      editable document; it does not change or remove the data already in your source.
                    </p>
                    <ul className="import-assets">
                      {plan.derivedAssets.map((asset) => (
                        <li key={asset.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={selectedAssets.includes(asset.id)}
                              onChange={(event) => setSelectedAssets((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))}
                            />
                            <span>
                              <strong>{asset.fileName}</strong> · {asset.width}×{asset.height} · {asset.byteLength} bytes
                              <small className="binding-note">From <code>.{asset.sourceLabel}</code> in {asset.sourceFile} line {asset.sourceLine}, read as {asset.packing}.</small>
                              {asset.alsoLooksLikeMapData && <small className="binding-warning">This run also has the small value alphabet of tile-map data, so check the reading before you rely on it.</small>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {!!plan.mapCandidates.length && (
                  <details>
                    <summary>Tile maps that can be recovered ({plan.mapCandidates.length})</summary>
                    <p className="binding-note">
                      Choose the grid shape the data actually uses and the layout is recovered exactly into an
                      editable map. Every value found becomes a declared tile index with no artwork chosen, because
                      the layout can be recovered from the data and the pictures cannot.
                    </p>
                    <ul className="import-maps">
                      {plan.mapCandidates.map((candidate) => (
                        <li key={candidate.id}>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Promote ${candidate.sourceLabel} to an editable map`}
                              checked={selectedMaps[candidate.id] !== undefined}
                              onChange={(event) => setSelectedMaps((current) => {
                                const next = { ...current };
                                if (event.target.checked) next[candidate.id] = `${candidate.shapes[0]!.width}x${candidate.shapes[0]!.height}`;
                                else delete next[candidate.id];
                                return next;
                              })}
                            />
                            <span>
                              <strong>.{candidate.sourceLabel}</strong> in {candidate.sourceFile} line {candidate.sourceLine} ·
                              {' '}{candidate.byteLength} bytes · {candidate.distinctValues} distinct values
                            </span>
                          </label>
                          <label className="import-map-shape">
                            <span>Grid</span>
                            <select
                              aria-label={`Grid shape for ${candidate.sourceLabel}`}
                              disabled={selectedMaps[candidate.id] === undefined}
                              value={selectedMaps[candidate.id] ?? `${candidate.shapes[0]!.width}x${candidate.shapes[0]!.height}`}
                              onChange={(event) => setSelectedMaps((current) => ({ ...current, [candidate.id]: event.target.value }))}
                            >
                              {candidate.shapes.map((shape) => <option key={`${shape.width}x${shape.height}`} value={`${shape.width}x${shape.height}`}>{shape.width}×{shape.height}</option>)}
                            </select>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {!!plan.exclusions.length && (
                  <details>
                    <summary>Left out ({plan.exclusions.length})</summary>
                    <ul className="import-exclusions">
                      {grouped.map(([reason, count]) => <li key={reason}><strong>{EXCLUSION_LABELS[reason] ?? reason}</strong> · {count}</li>)}
                    </ul>
                    <ul className="import-exclusions">
                      {plan.exclusions.slice(0, 40).map((exclusion) => (
                        <li key={exclusion.path}><code>{exclusion.path}</code> · {exclusion.detail}</li>
                      ))}
                    </ul>
                    {plan.exclusions.length > 40 && <p className="binding-note">{plan.exclusions.length - 40} further entries are not listed.</p>}
                  </details>
                )}

                <div className="import-actions">
                  <button type="button" onClick={createFromFolder} disabled={!plan.files.length}>
                    Create project from {plan.files.length} file{plan.files.length === 1 ? '' : 's'}
                  </button>
                  <button type="button" onClick={() => { setPlan(undefined); setContents(undefined); setConnectedFolder(null); setFolderNotes([]); }}>Choose a different folder</button>
                </div>
                <p className="binding-note">
                  Creating the project replaces the current browser-local project. Export the current project first
                  if you still need it.
                </p>
              </div>
            )}
          </div>
        )}
        {tab === 'store' && (
          <div className="start-project-panel" role="tabpanel" id="start-panel-store" aria-labelledby="start-tab-store">
            <p>
              Projects the store holds. The store lives on the volume the deployment mounts, not in this
              browser, so what is here survives clearing the browser and opening the workbench somewhere else.
            </p>
            {storeUnreachable && (
              <p className="binding-warning" role="status">
                No project store is running, so nothing can be opened from one. {storeUnreachable}
              </p>
            )}
            {!storeUnreachable && !stored.length && (
              <p className="honest-empty">The store is running and holds no projects yet. Save one from Settings, or from the command palette.</p>
            )}
            <ul className="sample-list">
              {stored.map((project) => (
                <li key={project.id}>
                  <div className="sample-heading">
                    <h3>{project.id}</h3>
                    <span className="sample-meta">{project.revisions} revision{project.revisions === 1 ? '' : 's'}</span>
                  </div>
                  {!storeRevisions[project.id] ? (
                    <button type="button" disabled={storeBusy} onClick={() => void showRevisions(project.id)}>
                      Show revisions
                    </button>
                  ) : (
                    <ul className="sample-highlights">
                      {storeRevisions[project.id]!.map((revision) => (
                        <li key={revision.id}>
                          <span>{revision.writtenAt} · {revision.files} file{revision.files === 1 ? '' : 's'}{revision.note ? ` · ${revision.note}` : ''}</span>
                          <button type="button" disabled={storeBusy} onClick={() => void openStored(project.id, revision.id)}>
                            Open this revision
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
