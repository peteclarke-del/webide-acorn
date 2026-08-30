/* Where each setting's value is coming from, and what to do about it.
 *
 * The value in effect is often not the one a person last chose: a project can
 * carry its own, and a stored value that no longer validates falls through to
 * the default. Both are shown here rather than left to be inferred from
 * behaviour, and a rejected value says why it was ignored.
 */
import { useMemo, useState } from 'react';
import {
  SETTING_DESCRIPTORS,
  exportSettings,
  importSettings,
  resetSettings,
  resolveSetting,
  settingsSummary,
} from '../settings/settings';

export interface SettingsLayersPanelProps {
  /** Settings the open project carries, keyed by identifier. */
  projectSettings: Readonly<Record<string, unknown>>;
  onProjectSettingsChange: (next: Record<string, unknown>) => void;
  onNotice: (message: string) => void;
  onDownload: (filename: string, text: string) => void;
}

const LAYER_LABEL: Record<'default' | 'user' | 'project', string> = {
  default: 'Built in',
  user: 'This browser',
  project: 'This project',
};

/* Reads as a sentence, which "the This browser value" does not. */
const LAYER_PHRASE: Record<'user' | 'project', string> = {
  user: 'stored in this browser',
  project: 'carried by this project',
};

function describe(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled';
  if (Array.isArray(value)) return `${value.length} entr${value.length === 1 ? 'y' : 'ies'}`;
  if (value && typeof value === 'object') return 'configured';
  return String(value);
}

export function SettingsLayersPanel({ projectSettings, onProjectSettingsChange, onNotice, onDownload }: SettingsLayersPanelProps) {
  const [revision, setRevision] = useState(0);
  const rows = useMemo(() => SETTING_DESCRIPTORS.map((descriptor) => ({
    descriptor,
    resolved: resolveSetting<unknown>(descriptor.id, { project: projectSettings }),
  })),
  /* `revision` forces a re-read after any write, since the values live in
   * browser storage rather than in React state. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [projectSettings, revision]);

  const changed = () => setRevision((value) => value + 1);

  const download = () => {
    const document = exportSettings(new Date().toISOString());
    onDownload('8bit-net-settings.json', JSON.stringify(document, null, 2));
    onNotice(`Settings exported · ${settingsSummary(document)}`);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) { onNotice('Settings documents are limited to 256 KiB'); return; }
    try {
      const report = importSettings(JSON.parse(await file.text()));
      changed();
      const parts = [`${report.applied.length} applied`];
      if (report.preserved.length) parts.push(`${report.preserved.length} unrecognised entr${report.preserved.length === 1 ? 'y' : 'ies'} preserved`);
      if (report.rejected.length) parts.push(`${report.rejected.length} refused: ${report.rejected.map((item) => `${item.id} ${item.reason}`).join('; ')}`);
      onNotice(`Settings imported · ${parts.join(' · ')}`);
    } catch (error) {
      onNotice(`Settings not imported · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const reset = () => {
    const cleared = resetSettings();
    changed();
    onNotice(cleared.length
      ? `${cleared.length} setting${cleared.length === 1 ? '' : 's'} returned to the built-in default · ${cleared.join(', ')}`
      : 'Nothing to reset; every setting is already at its built-in default');
  };

  const pinToProject = (id: string, value: unknown) => {
    onProjectSettingsChange({ ...projectSettings, [id]: value });
    onNotice(`${id} now travels with this project`);
  };

  const releaseFromProject = (id: string) => {
    const next = { ...projectSettings };
    delete next[id];
    onProjectSettingsChange(next);
    onNotice(`${id} no longer travels with this project`);
  };

  return (
    <section className="settings-layers" aria-label="Settings layers">
      <div className="panel-heading">
        <strong>Settings</strong>
        <small>Built in, then this browser, then this project</small>
      </div>
      <div className="settings-layer-actions">
        <button type="button" onClick={download}>Export settings</button>
        <label className="settings-import">
          <span>Import settings</span>
          <input type="file" accept="application/json,.json" aria-label="Choose a settings document" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        <button type="button" onClick={reset}>Reset to built-in defaults</button>
      </div>
      <p className="settings-layer-note">
        A stored value that no longer matches its schema is ignored rather than corrected, and the reason is shown against
        the setting. Exporting carries settings only: projects, firmware, test history and asset drafts are never included.
      </p>
      <div className="settings-layer-table" role="table" aria-label="Setting values and where they come from">
        <div className="settings-layer-row head" role="row">
          <span role="columnheader">Setting</span>
          <span role="columnheader">In effect</span>
          <span role="columnheader">From</span>
          <span role="columnheader">Project</span>
        </div>
        {rows.map(({ descriptor, resolved }) => (
          <div className="settings-layer-row" role="row" key={descriptor.id}>
            <span role="cell">
              <strong>{descriptor.label}</strong>
              <small>{descriptor.description}</small>
              {resolved.rejected.map((rejection) => (
                <small className="settings-layer-rejected" key={rejection.layer}>
                  The value {LAYER_PHRASE[rejection.layer]} was ignored: {rejection.reason}.
                </small>
              ))}
            </span>
            <code role="cell">{describe(resolved.value)}</code>
            <span role="cell" className={`settings-layer-origin origin-${resolved.layer}`}>{LAYER_LABEL[resolved.layer]}</span>
            <span role="cell">
              {descriptor.scope === 'user-and-project' ? (
                descriptor.id in projectSettings
                  ? <button type="button" onClick={() => releaseFromProject(descriptor.id)}>Stop carrying</button>
                  : <button type="button" onClick={() => pinToProject(descriptor.id, resolved.value)}>Carry with project</button>
              ) : <small>Browser only</small>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
