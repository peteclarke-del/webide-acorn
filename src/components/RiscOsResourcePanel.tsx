/* The rest of a RISC OS application: its !Boot, its icon, its resources.
 *
 * Packaging produced exactly !Run and RunImage, which is the smallest thing
 * FileSwitch will launch and not an application anybody would ship. This is
 * where the rest goes, and where the two ways of getting the whole thing to a
 * machine live: an ADFS disc for a machine with no HostFS, and an archive whose
 * names carry the filetypes so they survive a trip through a computer that
 * knows nothing about RISC OS.
 *
 * Types are chosen rather than guessed, except where RISC OS decides: !Run and
 * !Boot are Obey files and !Sprites is a sprite file, and the packager refuses
 * anything else for those names rather than producing an application the Filer
 * would quietly fail to display.
 */
import { useState } from 'react';
import { Icon } from './Icon';
import {
  addApplicationResource,
  createApplicationArchive,
  createApplicationDisc,
  removeApplicationResource,
  RISC_OS_FILETYPE_ABSOLUTE,
  RISC_OS_FILETYPE_DATA,
  RISC_OS_FILETYPE_OBEY,
  RISC_OS_FILETYPE_SPRITE,
  RISC_OS_FILETYPE_TEXT,
  type RiscOsApplicationPackage,
} from '../media/riscOsApplication';
import type { CreatedAdfsEImage } from '../media/adfsImage';

/* Named because a hexadecimal number on its own tells nobody what it is for. */
const OFFERED_TYPES: Array<{ value: number; label: string }> = [
  { value: RISC_OS_FILETYPE_TEXT, label: 'Text (&FFF)' },
  { value: RISC_OS_FILETYPE_DATA, label: 'Data (&FFD)' },
  { value: RISC_OS_FILETYPE_OBEY, label: 'Obey (&FEB)' },
  { value: RISC_OS_FILETYPE_SPRITE, label: 'Sprite (&FF9)' },
  { value: RISC_OS_FILETYPE_ABSOLUTE, label: 'Absolute (&FF8)' },
];

interface RiscOsResourcePanelProps {
  application: RiscOsApplicationPackage;
  onChange: (application: RiscOsApplicationPackage) => void;
  onNotice: (message: string) => void;
  onDisc: (created: CreatedAdfsEImage, filename: string) => void;
  onDownload: (bytes: Uint8Array, filename: string) => void;
}

export function RiscOsResourcePanel({ application, onChange, onNotice, onDisc, onDownload }: RiscOsResourcePanelProps) {
  const [destination, setDestination] = useState('');
  const [filetype, setFiletype] = useState(RISC_OS_FILETYPE_TEXT);

  const total = application.files.reduce((sum, file) => sum + file.bytes.length, 0);

  const add = async (chosen: File) => {
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const path = destination.trim() || chosen.name.replace(/\.[^.]+$/, '') || chosen.name;
      onChange(addApplicationResource(application, path, bytes, filetype));
      onNotice(`${path} added to ${application.rootDirectory}`);
      setDestination('');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = (path: string) => {
    try {
      onChange(removeApplicationResource(application, path));
      onNotice(`${path} removed`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const writeDisc = () => {
    try {
      const created = createApplicationDisc(application);
      onDisc(created, `${application.applicationName.toLowerCase()}.adf`);
      onNotice(`Wrote ${application.rootDirectory} onto an 800 KiB ADFS E image, checked by reparsing it.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const writeArchive = () => {
    try {
      onDownload(createApplicationArchive(application), `${application.applicationName.toLowerCase()}.zip`);
      onNotice(`Archived ${application.rootDirectory} with its filetypes in the names.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="media-subsection dfs-creator riscos-resources" aria-label="RISC OS application resources">
      <h3>{application.rootDirectory} contents</h3>
      <p>
        Everything in the application directory. RISC OS decides the type of <code>!Run</code>, <code>!Boot</code> and
        <code> !Sprites</code>, so those are refused with any other type rather than producing an application the Filer
        would quietly fail to display. A path may name subdirectories, which are created by being mentioned.
      </p>

      <div className="media-fields">
        <label>
          <span>Path inside {application.rootDirectory}</span>
          <input
            aria-label="Path inside the application directory"
            placeholder="Resources/Messages"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          />
        </label>
        <label>
          <span>Type</span>
          <select aria-label="RISC OS filetype for the resource" value={filetype} onChange={(event) => setFiletype(Number(event.target.value))}>
            {OFFERED_TYPES.map((offered) => <option key={offered.value} value={offered.value}>{offered.label}</option>)}
          </select>
        </label>
        <label className="sideways-picker">
          <input
            type="file"
            aria-label="Choose a file to add to the application"
            onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void add(chosen); }}
          />
          <Icon name="open" size={14} /> Add a resource
        </label>
      </div>

      <table className="riscos-resource-table">
        <caption>{application.files.length} files · {total.toLocaleString()} bytes</caption>
        <thead><tr><th scope="col">Path</th><th scope="col">Type</th><th scope="col">Bytes</th><th scope="col" /></tr></thead>
        <tbody>
          {application.files.map((file) => {
            const fixed = file.path === `${application.rootDirectory}/!Run` || file.path === `${application.rootDirectory}/RunImage`;
            return (
              <tr key={file.path}>
                <th scope="row">{file.path}</th>
                <td><code>&amp;{file.filetype.toString(16).toUpperCase().padStart(3, '0')}</code></td>
                <td><code>{file.bytes.length.toLocaleString()}</code></td>
                <td>
                  {fixed
                    ? <small>required</small>
                    : <button type="button" aria-label={`Remove ${file.path}`} onClick={() => remove(file.path)}>Remove</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="media-fields">
        <button type="button" onClick={writeDisc}><Icon name="check" size={14} /> Write an ADFS E transfer disc</button>
        <button type="button" onClick={writeArchive}><Icon name="download" size={14} /> Download as an archive</button>
      </div>
      <p className="media-limit">
        The disc holds the whole application directory and is read back through this build's own ADFS parser before it
        is offered. The archive stores each file under its <code>,xxx</code> name, which is how the filetypes survive a
        machine that knows nothing about RISC OS metadata.
      </p>
    </section>
  );
}
