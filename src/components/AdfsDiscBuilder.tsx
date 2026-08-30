/* Building an ADFS E disc with more than one file on it.
 *
 * The ADFS writer started as a one-file path, because one file was what the ARM
 * build produced and getting that onto a disc RISC OS would run was the thing
 * worth proving. It is not what anyone ships: a program arrives with sprites, a
 * template, a text file of notes, and rebuilding a one-file image per file does
 * not produce a disc with all of them on it.
 *
 * What this cannot do is said on the panel rather than left to be discovered.
 * Every file lands in the root: the writer builds no subdirectories, so a real
 * application directory is still the HostFS path rather than this one. Nothing
 * is added to a disc that already exists either — this writes a new image, and
 * changing an image already open is the catalogue editor's job.
 */
import { useState } from 'react';
import { Icon } from './Icon';
import { adfsNameProblem } from '../media/adfsEdit';
import { createAdfsEDisc, type AdfsFileRequest, type CreatedAdfsEImage } from '../media/adfsImage';

/** The 800 KiB an ADFS E floppy holds, less what the maps and root occupy. */
const APPROXIMATE_CAPACITY = 800 * 1024 - 4096;

interface PendingFile extends AdfsFileRequest {
  /** Where the bytes came from, so the list says what it is showing. */
  origin: string;
}

interface AdfsDiscBuilderProps {
  /** The current ARM build, when there is one that could go on a disc. */
  artifact: { name: string; bytes: Uint8Array; entryPoint: number } | null;
  onCreated: (created: CreatedAdfsEImage, filename: string) => void;
  onNotice: (message: string) => void;
}

const filetypeOf = (value: string): number | null => {
  const trimmed = value.trim().replace(/^&/, '');
  if (!/^[0-9a-fA-F]{1,3}$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 16);
};

/* A host filename is not an ADFS name: it may be too long, and it may contain
 * characters the filing system reads as path syntax. Trimmed and substituted
 * rather than refused, because the person can see the result and correct it. */
function suggestedName(hostName: string): string {
  const stem = hostName.replace(/\.[^.]+$/, '') || hostName;
  const cleaned = [...stem].map((character) => /[A-Za-z0-9_+-]/.test(character) ? character : '_').join('');
  return cleaned.slice(0, 10) || 'File';
}

export function AdfsDiscBuilder({ artifact, onCreated, onNotice }: AdfsDiscBuilderProps) {
  const [title, setTitle] = useState('WEBIDE');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [pendingType, setPendingType] = useState('FFD');

  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  const nameProblem = files.map((file) => adfsNameProblem(file.name)).find(Boolean) ?? null;

  const add = async (chosen: File) => {
    const type = filetypeOf(pendingType);
    if (type === null) { onNotice('A RISC OS filetype is one to three hexadecimal digits, as in FFD.'); return; }
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const name = suggestedName(chosen.name);
      if (files.some((file) => file.name.toLocaleUpperCase('en-GB') === name.toLocaleUpperCase('en-GB'))) {
        onNotice(`This disc already has a file called ${name}. Rename that one first, since ADFS does not distinguish names by case.`);
        return;
      }
      setFiles((current) => [...current, { name, bytes, filetype: type, origin: chosen.name }]);
    } catch (error) {
      onNotice(`${chosen.name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const addArtifact = () => {
    if (!artifact) return;
    const name = suggestedName(artifact.name);
    if (files.some((file) => file.name.toLocaleUpperCase('en-GB') === name.toLocaleUpperCase('en-GB'))) {
      onNotice(`This disc already has a file called ${name}.`);
      return;
    }
    setFiles((current) => [...current, {
      name,
      bytes: artifact.bytes,
      filetype: 0xff8,
      executionAddress: artifact.entryPoint,
      origin: 'current ARM build',
    }]);
  };

  const rename = (index: number, name: string) => {
    setFiles((current) => current.map((file, position) => position === index ? { ...file, name } : file));
  };

  const create = () => {
    try {
      const created = createAdfsEDisc({ title, files: files.map(({ origin: _origin, ...file }) => file) });
      onCreated(created, `${title.toLowerCase()}.adf`);
      onNotice(`Wrote an 800 KiB ADFS E image holding ${files.length} file${files.length === 1 ? '' : 's'}, checked by reparsing it.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="media-subsection dfs-creator adfs-disc-builder" aria-label="Build a multi-file ADFS E disc">
      <h3>ADFS E disc</h3>
      <p>
        Writes a new 800 KiB ADFS E image holding the files listed here, then reads it back through the same parser
        this build uses on somebody else's disc before offering it. Every file lands in the root: the writer builds no
        subdirectories, so a real RISC OS application directory is still the HostFS path rather than this one.
      </p>
      <div className="media-fields">
        <label>
          <span>Disc title</span>
          <input aria-label="ADFS disc title" maxLength={10} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>Type</span>
          <input aria-label="RISC OS filetype for the next file added" maxLength={4} value={pendingType} onChange={(event) => setPendingType(event.target.value)} />
        </label>
        <label className="sideways-picker">
          <input
            type="file"
            aria-label="Add a file to the disc"
            onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void add(chosen); }}
          />
          <Icon name="open" size={14} /> Add a file
        </label>
        <button type="button" disabled={!artifact} onClick={addArtifact}>Add the current ARM build</button>
      </div>

      {files.length === 0
        ? <p className="honest-note">No files yet. A disc needs at least one, because an empty one has nothing to check against.</p>
        : (
          <table className="adfs-builder-table">
            <caption>{files.length} file{files.length === 1 ? '' : 's'} · {total.toLocaleString()} bytes of about {APPROXIMATE_CAPACITY.toLocaleString()}</caption>
            <thead><tr><th scope="col">Name on the disc</th><th scope="col">Type</th><th scope="col">Bytes</th><th scope="col">From</th><th scope="col" /></tr></thead>
            <tbody>
              {files.map((file, index) => (
                <tr key={`${file.origin}-${index}`}>
                  <td>
                    <input
                      aria-label={`Name on the disc for ${file.origin}`}
                      maxLength={10}
                      value={file.name}
                      onChange={(event) => rename(index, event.target.value)}
                    />
                  </td>
                  <td><code>&amp;{file.filetype.toString(16).toUpperCase().padStart(3, '0')}</code></td>
                  <td><code>{file.bytes.length.toLocaleString()}</code></td>
                  <td>{file.origin}</td>
                  <td>
                    <button type="button" aria-label={`Remove ${file.name} from the disc`} onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {nameProblem && <p className="dfs-warning" role="status">{nameProblem}</p>}
      <div className="media-fields">
        <button type="button" disabled={!files.length || !!nameProblem} onClick={create}>
          <Icon name="check" size={14} /> Create the disc
        </button>
      </div>
    </section>
  );
}
