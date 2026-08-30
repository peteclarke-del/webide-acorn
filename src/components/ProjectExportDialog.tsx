import { useEffect, useRef, useState } from 'react';

import type { ProjectBundle } from '../project/projectBundle';

interface ProjectExportDialogProps {
  open: boolean;
  projectName: string;
  projectBookmarkCount: number;
  privateBookmarkCount: number;
  /** The bundle that would be written, so its contents can be reviewed first. */
  preview: ProjectBundle | null;
  onClose: () => void;
  onExport: (includePrivateBookmarks: boolean) => void;
}

export function ProjectExportDialog({ open, projectName, projectBookmarkCount, privateBookmarkCount, preview, onClose, onExport }: ProjectExportDialogProps) {
  const [includePrivate, setIncludePrivate] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setIncludePrivate(false);
    closeButton.current?.focus();
  }, [open]);

  if (!open) return null;
  return <div className="project-export-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="project-export-dialog" role="dialog" aria-modal="true" aria-labelledby="project-export-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      <header><div><span>PORTABLE PROJECT</span><h2 id="project-export-title">Export {projectName}</h2></div><button ref={closeButton} type="button" aria-label="Close project export" onClick={onClose}>×</button></header>
      <div className="project-export-body">
        <p>The bundle contains source files, target settings, build and test configuration, debugger intent and project-scoped bookmarks, with a digest for the project and for every file so the receiver can tell it arrived intact.</p>
        <dl><div><dt>Project bookmarks</dt><dd>{projectBookmarkCount}</dd></div><div><dt>Private bookmarks</dt><dd>{privateBookmarkCount}</dd></div></dl>
        {preview && (
          <div className="project-export-manifest">
            <section aria-label="What this bundle needs">
              <strong>Needs</strong>
              <ul>
                <li>{preview.dependencies.machine.machineId} · {preview.dependencies.machine.variant} · {preview.dependencies.machine.romId}</li>
                {preview.dependencies.toolchains.map((toolchain) => <li key={toolchain}>{toolchain}</li>)}
                {preview.dependencies.capabilities.length > 0 && <li>Capabilities: {preview.dependencies.capabilities.join(', ')}</li>}
              </ul>
              {preview.dependencies.missingSources.map((missing) => (
                <p className="project-export-problem" key={missing}>{missing}, which this bundle does not contain.</p>
              ))}
            </section>
            <section aria-label="What this bundle leaves out">
              <strong>Leaves out</strong>
              <ul>
                {preview.excluded.map((entry) => (
                  <li key={entry.what}>{entry.what}{entry.count === undefined ? '' : ` (${entry.count})`}: {entry.why}</li>
                ))}
              </ul>
            </section>
            {preview.possibleSecrets.length > 0 && (
              <section aria-label="Possible credentials in the source" className="project-export-secrets">
                <strong>{preview.possibleSecrets.length} possible credential{preview.possibleSecrets.length === 1 ? '' : 's'} in the source</strong>
                <ul>
                  {preview.possibleSecrets.map((secret) => (
                    <li key={`${secret.fileName}:${secret.line}`}><code>{secret.fileName}:{secret.line}</code> · {secret.kind}</li>
                  ))}
                </ul>
                <p>These are reported, not removed. Nothing is exported until you choose to; review them first.</p>
              </section>
            )}
          </div>
        )}
        <label className="project-export-private"><input type="checkbox" checked={includePrivate} disabled={!privateBookmarkCount} onChange={(event) => setIncludePrivate(event.target.checked)} /><span><strong>Include private bookmarks and notes</strong><small>Off by default. Enabling this writes private bookmark names, descriptions, locations and anchors into the downloaded file.</small></span></label>
        <aside aria-live="polite" className={includePrivate ? 'warning' : 'safe'}><strong>{includePrivate ? 'Private content will be included' : 'Private content will be excluded'}</strong><span>{privateBookmarkCount ? includePrivate ? `${privateBookmarkCount} private bookmark${privateBookmarkCount === 1 ? '' : 's'} will be portable and readable by anyone with the file.` : `${privateBookmarkCount} private bookmark${privateBookmarkCount === 1 ? '' : 's'} will remain only in this browser project.` : 'This project has no private bookmarks.'}</span></aside>
      </div>
      <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="button" onClick={() => onExport(includePrivate)}>Download bundle</button></footer>
    </section>
  </div>;
}
