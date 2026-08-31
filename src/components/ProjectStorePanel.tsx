/*
 * Keeping a project on the server, and being plain about what that is.
 *
 * Local mode is the product. This is an addition somebody may use, and the
 * panel is written so that not using it costs nothing and using it loses
 * nothing: copying a project to the store leaves the local one exactly as it
 * was, and taking a revision back is offered as source to open rather than
 * applied over what somebody is working on.
 *
 * The identity comes from the server's own answer. There is one, nothing
 * proves it, and saying so is the difference between "your projects are
 * backed up" and "these are on a machine you already control".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import {
  ProjectStoreClient,
  type StoreIdentity,
  type StoreUsage,
  type StoredProject,
  type StoredRevision,
} from '../cloud/projectStoreClient';

interface ProjectStorePanelProps {
  /** The project as it is now: filename to content. */
  files: Array<{ name: string; content: string }>;
  projectName: string;
  onNotice: (message: string) => void;
  /** Offered a revision's files to open. Never called without being asked. */
  onOpenFiles?: (files: Array<{ name: string; content: string }>) => void;
  client?: ProjectStoreClient;
}

/** A project name as the store will accept it, or the reason it will not. */
export function storeProjectId(name: string): { id: string; adjusted: boolean } {
  const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return { id, adjusted: id !== name };
}

export function ProjectStorePanel({ files, projectName, onNotice, onOpenFiles, client }: ProjectStorePanelProps) {
  const store = useMemo(() => client ?? new ProjectStoreClient(), [client]);
  const [identity, setIdentity] = useState<StoreIdentity>();
  const [usage, setUsage] = useState<StoreUsage>();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [revisions, setRevisions] = useState<StoredRevision[]>([]);
  const [selected, setSelected] = useState<string>();
  const [unreachable, setUnreachable] = useState<string>();
  const [busy, setBusy] = useState(false);

  const { id: projectId, adjusted } = storeProjectId(projectName);

  const refresh = useCallback(async () => {
    const described = await store.describe();
    if (!described.ok) {
      setIdentity(undefined);
      setUnreachable(described.reason);
      return;
    }
    setUnreachable(undefined);
    setIdentity(described.value.identity);
    setUsage(described.value.usage);
    const listed = await store.projects();
    if (listed.ok) setProjects(listed.value);
  }, [store]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openRevisions = async (id: string) => {
    setSelected(id);
    const listed = await store.revisions(id);
    if (listed.ok) setRevisions(listed.value);
    else { setRevisions([]); onNotice(listed.reason); }
  };

  const copyUp = async () => {
    if (!projectId) { onNotice('This project has no name the store can use. Rename it using letters, digits or hyphens.'); return; }
    setBusy(true);
    try {
      const listed = await store.revisions(projectId);
      /* Written against the head the store reports, so two workbenches editing
       * the same project collide here rather than one silently overwriting the
       * other. */
      const head = listed.ok && listed.value.length ? listed.value[listed.value.length - 1]!.id : null;
      const payload: Record<string, string> = {};
      for (const file of files) payload[file.name] = file.content;
      const written = await store.commit(projectId, payload, head, `Copied from the workbench as ${projectName}`);
      if (!written.ok) { onNotice(written.reason); return; }
      onNotice(`Copied ${files.length} file${files.length === 1 ? '' : 's'} to the store as revision ${written.value.id}. The local project is unchanged.`);
      await refresh();
      await openRevisions(projectId);
    } finally { setBusy(false); }
  };

  const copyDown = async (revisionId: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const read = await store.read(selected, revisionId);
      if (!read.ok) { onNotice(read.reason); return; }
      const opened = Object.entries(read.value).map(([name, content]) => ({ name, content }));
      onOpenFiles?.(opened);
      onNotice(`${opened.length} file${opened.length === 1 ? '' : 's'} from revision ${revisionId} were offered to open. Nothing in the project was replaced.`);
    } finally { setBusy(false); }
  };

  return (
    <section className="project-store-panel panel-surface" aria-label="Project store">
      <div className="panel-heading">
        <div><span className="eyebrow">KEEPING WORK BEYOND THIS BROWSER</span><h2>Project store</h2></div>
        <small>{identity ? `${usage?.projects ?? 0} project${(usage?.projects ?? 0) === 1 ? '' : 's'}` : 'local only'}</small>
      </div>

      {unreachable ? (
        <p className="binding-note" role="status">
          No project store is running, so everything stays in this browser. {unreachable}
        </p>
      ) : (
        <>
          <p className={identity?.authenticated ? 'binding-note' : 'dfs-warning'} role="status">
            {identity ? identity.detail : 'Asking the store who it thinks you are.'}
          </p>
          <dl className="project-store-usage">
            <div><dt>Projects</dt><dd>{usage?.projects ?? 0}</dd></div>
            <div><dt>Revisions</dt><dd>{usage?.revisions ?? 0}</dd></div>
            <div><dt>Bytes</dt><dd>{(usage?.bytes ?? 0).toLocaleString()}</dd></div>
          </dl>

          <p className="binding-note">
            Copying puts a revision in the store and changes nothing here. Taking one back offers its
            files to open; it never writes over what you are working on.
          </p>
          {adjusted && projectId && <p className="binding-note">This project will be stored as <code>{projectId}</code>, because a store name is lower-case letters, digits and hyphens.</p>}
          <button type="button" disabled={busy || !projectId} onClick={() => void copyUp()}>
            <Icon name="cloud" size={13} /> Copy this project to the store
          </button>

          <h3>Stored projects</h3>
          {projects.length ? (
            <ul className="project-store-projects">
              {projects.map((project) => (
                <li key={project.id}>
                  <button type="button" aria-label={`Show revisions of ${project.id}`} onClick={() => void openRevisions(project.id)}>
                    <strong>{project.id}</strong><small>{project.revisions} revision{project.revisions === 1 ? '' : 's'}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="binding-note">Nothing is stored yet.</p>}

          {selected && (
            <>
              <h3>Revisions of {selected}</h3>
              {revisions.length ? (
                <ul className="project-store-revisions">
                  {[...revisions].reverse().map((revision) => (
                    <li key={revision.id}>
                      <span><strong>{revision.id}</strong><small>{revision.writtenAt} · {revision.files} file{revision.files === 1 ? '' : 's'}{revision.note ? ` · ${revision.note}` : ''}</small></span>
                      <button type="button" disabled={busy} aria-label={`Open the files of revision ${revision.id}`} onClick={() => void copyDown(revision.id)}>Open its files</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="binding-note">That project has no revisions.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
