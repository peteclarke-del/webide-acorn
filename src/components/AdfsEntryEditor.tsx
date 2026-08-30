/* Changing one ADFS catalogue entry, in the image already open.
 *
 * Browsing an ADFS image worked and changing anything in it meant building a
 * new image from scratch, which loses everything else on the disc. This is the
 * small edit that was missing: a name, the load and execution addresses, and
 * the lock bit.
 *
 * Nothing here moves a file or changes its length, so no allocation happens and
 * the free-space map is never touched. That restraint is what makes the edit
 * safe to offer at all, and it is stated on the panel rather than left for
 * someone to discover by finding out what the buttons do not do.
 */
import { useState } from 'react';
import { Icon } from './Icon';
import { adfsNameProblem, editAdfsEntry, type AdfsEntryChange } from '../media/adfsEdit';
import { parseAdfsCatalogue, type AdfsCatalogue, type AdfsFileEntry } from '../media/adfsCatalogue';

interface AdfsEntryEditorProps {
  image: Uint8Array;
  entry: AdfsFileEntry;
  onApplied: (image: Uint8Array, catalogue: AdfsCatalogue) => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}

function parseAddress(value: string): number | 'invalid' {
  const trimmed = value.trim().replace(/^&/, '');
  if (!/^[0-9a-fA-F]{1,8}$/.test(trimmed)) return 'invalid';
  return Number.parseInt(trimmed, 16) >>> 0;
}

const asHex = (value: number) => `&${value.toString(16).toUpperCase().padStart(8, '0')}`;

export function AdfsEntryEditor({ image, entry, onApplied, onNotice, onClose }: AdfsEntryEditorProps) {
  const [name, setName] = useState(entry.name);
  const [load, setLoad] = useState(asHex(entry.loadAddress));
  const [execute, setExecute] = useState(asHex(entry.executionAddress));
  const [locked, setLocked] = useState(entry.locked);

  const nameProblem = name === entry.name ? null : adfsNameProblem(name);
  const loadValue = parseAddress(load);
  const executeValue = parseAddress(execute);
  const addressProblem = entry.directory
    ? null
    : loadValue === 'invalid' || executeValue === 'invalid'
      ? 'A load or execution address is up to eight hexadecimal digits, as in &FFFF0E00.'
      : null;
  const problem = nameProblem ?? addressProblem;

  const apply = () => {
    if (problem) { onNotice(problem); return; }
    /* Only what actually differs. Sending a field back unchanged would still
     * advance the directory's update sequence, which tells a machine its cached
     * copy is stale — and saying that when nothing changed is a small lie with
     * a real cost on the other side. */
    const change: AdfsEntryChange = {
      ...(name === entry.name ? {} : { name }),
      ...(locked === entry.locked ? {} : { locked }),
      ...(entry.directory || loadValue === 'invalid' || loadValue === entry.loadAddress ? {} : { loadAddress: loadValue }),
      ...(entry.directory || executeValue === 'invalid' || executeValue === entry.executionAddress ? {} : { executionAddress: executeValue }),
    };
    if (!Object.keys(change).length) { onNotice(`Nothing about ${entry.path} was changed.`); return; }
    try {
      const result = editAdfsEntry(image, entry.path, change);
      onApplied(result.image, parseAdfsCatalogue(result.image));
      const lost = result.preservedBytesOverwritten
        ? ` ${result.preservedBytesOverwritten} preserved byte${result.preservedBytesOverwritten === 1 ? '' : 's'} could not be kept.`
        : '';
      onNotice(`${entry.path} updated in the open image.${lost} Export the image to keep the change.`);
      onClose();
    } catch (error) {
      /* The editor re-parses before it returns, so a failure here means the
       * image was left exactly as it was rather than half-written. */
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="adfs-entry-editor" role="group" aria-label={`Edit ${entry.path}`}>
      <p className="binding-note">
        Changes the catalogue entry for {entry.path} in the image open in this browser. Nothing is moved and no length
        changes, so the free-space map is untouched; the image has to be exported to keep the change.
      </p>
      <div className="adfs-editor-fields">
        <label>
          <span>Name</span>
          <input aria-label={`Name of ${entry.path}`} value={name} maxLength={10} onChange={(event) => setName(event.target.value)} />
        </label>
        {!entry.directory && (
          <>
            <label>
              <span>Load</span>
              <input aria-label={`Load address of ${entry.path}`} value={load} onChange={(event) => setLoad(event.target.value)} />
            </label>
            <label>
              <span>Exec</span>
              <input aria-label={`Execution address of ${entry.path}`} value={execute} onChange={(event) => setExecute(event.target.value)} />
            </label>
          </>
        )}
        <label className="adfs-editor-lock">
          <input type="checkbox" aria-label={`Lock ${entry.path}`} checked={locked} onChange={(event) => setLocked(event.target.checked)} />
          <span>Locked</span>
        </label>
      </div>
      {problem && <p className="dfs-warning" role="status">{problem}</p>}
      <div className="adfs-editor-actions">
        <button type="button" disabled={!!problem} onClick={apply}><Icon name="check" size={14} /> Apply to the open image</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
