import { useState } from 'react';
import { Icon } from './Icon';
import {
  LUN_SIZE_CHOICES,
  createBlankLunImage,
  describeLunImage,
  lunNumberFromFilename,
  lunSizeLabel,
  type LunImageReport,
} from '../media/beebScsiLun';
import { SCSI_LUN_COUNT } from '../emulator/beebScsi';

/*
 * Putting LUN images on the BeebSCSI card.
 *
 * A LUN is not a floppy: nothing is inserted into a drive, a file is put on the
 * board's micro SD card and ADFS finds it there. So this is its own section
 * rather than another drive in the disk mount control, and the words follow the
 * board's own: an image is on the card, and ADFS starts and stops the LUN.
 *
 * ADFS reaches four LUNs and VFS reaches eight. Eight are offered because the
 * drive answers for eight, and a Model B with ADFS will simply never ask past
 * the fourth.
 */

export interface MountedLun {
  lun: number;
  name: string;
  size: number;
  revision?: number;
}

export interface BeebScsiWorkspaceProps {
  /** False when the profile has no BeebSCSI fitted, which is most of them. */
  fitted: boolean;
  /** False until the machine is running, because nothing can be acknowledged before then. */
  connected: boolean;
  mounted: readonly MountedLun[];
  onCommand: (message: Record<string, unknown>) => void;
  onNotice: (message: string) => void;
}

export function BeebScsiWorkspace({ fitted, connected, mounted, onCommand, onNotice }: BeebScsiWorkspaceProps) {
  const [lun, setLun] = useState(0);
  const [imageFile, setImageFile] = useState<File>();
  const [descriptorFile, setDescriptorFile] = useState<File>();
  const [report, setReport] = useState<LunImageReport>();
  const [sizeId, setSizeId] = useState(LUN_SIZE_CHOICES[3]!.id);
  const [status, setStatus] = useState('Put a LUN image on the card, or create a blank one for ADFS to format.');

  if (!fitted) return null;

  const chooseImage = async (file: File | undefined) => {
    setImageFile(file);
    setReport(undefined);
    if (!file) { setStatus('Put a LUN image on the card, or create a blank one for ADFS to format.'); return; }
    const suggested = lunNumberFromFilename(file.name);
    if (suggested !== null) setLun(suggested);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const descriptor = descriptorFile ? new Uint8Array(await descriptorFile.arrayBuffer()) : undefined;
      const described = describeLunImage(data, descriptor);
      setReport(described);
      setStatus(`${file.name} · ${described.geometry.cylinders} cylinders · ${described.geometry.heads} heads · ${described.geometry.sectors.toLocaleString()} sectors · ${data.length.toLocaleString()} bytes held`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const mountImage = async () => {
    if (!imageFile) return;
    try {
      const data = new Uint8Array(await imageFile.arrayBuffer());
      const descriptor = descriptorFile ? new Uint8Array(await descriptorFile.arrayBuffer()) : undefined;
      onCommand({ type: 'load-scsi-lun', name: imageFile.name, lun, bytes: Array.from(data), ...(descriptor ? { descriptor: Array.from(descriptor) } : {}) });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const createBlank = () => {
    const choice = LUN_SIZE_CHOICES.find((entry) => entry.id === sizeId);
    if (!choice) return;
    try {
      const blank = createBlankLunImage(choice.tracks);
      const name = `scsi${lun}.dat`;
      onCommand({ type: 'load-scsi-lun', name, lun, bytes: [], descriptor: Array.from(blank.descriptor) });
      setReport(describeLunImage(blank.data, blank.descriptor));
      setStatus(`${name} · ${lunSizeLabel(choice.tracks)} · ${blank.geometry.cylinders} cylinders · ${blank.geometry.heads} heads · format it with Superform before ADFS will use it`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return <section className="media-subsection beebscsi-card" aria-label="BeebSCSI card">
    <h3>BeebSCSI card</h3>
    <p>
      LUN images live on the board's card rather than in a drive, and ADFS starts one when it first reads it.
      A <code>.dat</code> without its <code>.dsc</code> gets the descriptor the board would build for it, from the size of the image.
      ADFS reaches LUNs 0 to 3; VFS reaches all eight.
    </p>
    <div className="media-fields">
      <label><span>LUN</span>
        <select aria-label="LUN number" value={lun} onChange={(event) => setLun(Number(event.target.value))}>
          {Array.from({ length: SCSI_LUN_COUNT }, (unused, index) => <option key={index} value={index}>LUN {index}{index > 3 ? ' · VFS only' : ''}</option>)}
        </select>
      </label>
      <label><span>Image</span>
        <input aria-label="LUN image file" type="file" accept=".dat,application/octet-stream" onChange={(event) => void chooseImage(event.target.files?.[0])} />
      </label>
      <label><span>Descriptor</span>
        <input aria-label="LUN descriptor file" type="file" accept=".dsc,application/octet-stream" onChange={(event) => { setDescriptorFile(event.target.files?.[0]); void chooseImage(imageFile); }} />
      </label>
      <button type="button" disabled={!imageFile || !connected} onClick={() => void mountImage()}><Icon name="open" size={14} /> Put on card</button>
    </div>
    <div className="media-fields">
      <label><span>Blank LUN</span>
        <select aria-label="Blank LUN size" value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
          {LUN_SIZE_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{lunSizeLabel(choice.tracks)}</option>)}
        </select>
      </label>
      <button type="button" disabled={!connected} onClick={createBlank}>Create blank LUN</button>
    </div>
    <div className="dfs-preview" aria-live="polite">
      <div className="dfs-preview-status">{status}</div>
      {report && <>
        <div className="dfs-facts">
          <span>Cylinders <strong>{report.geometry.cylinders}</strong></span>
          <span>Heads <strong>{report.geometry.heads}</strong></span>
          <span>Sectors <strong>{report.geometry.sectors.toLocaleString()}</strong></span>
          <span>Capacity <strong>{report.geometry.bytes.toLocaleString()} bytes</strong></span>
        </div>
        {report.warnings.map((warning) => <div className="dfs-warning" key={warning}>{warning}</div>)}
      </>}
      {!connected && <p className="honest-note">Start the machine before putting an image on the card; nothing can acknowledge it until then.</p>}
    </div>
    <div className="mounted-media-list">
      {mounted.length
        ? mounted.map((item) => <div className="mounted-media" key={`lun-${item.lun}`}>
            <Icon name="check" size={20} />
            <div>
              <strong>{item.name}{item.revision ? ' · GUEST MODIFIED' : ''}</strong>
              <span>LUN {item.lun}{item.revision ? ` · write revision ${item.revision}` : ''} · {item.size.toLocaleString()} bytes held</span>
              <small>On the card the fitted BeebSCSI board reads</small>
            </div>
            <button type="button" title={`Download the current bytes of LUN ${item.lun}`} onClick={() => onCommand({ type: 'export-scsi-lun', lun: item.lun })}>Export current</button>
            <button type="button" title={`Take the image for LUN ${item.lun} off the card`} onClick={() => onCommand({ type: 'eject-scsi-lun', lun: item.lun })}>Take off card</button>
          </div>)
        : <div className="honest-empty">The card holds no LUN images in this session.</div>}
    </div>
  </section>;
}
