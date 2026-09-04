import { useEffect, useMemo, useRef, useState } from 'react';
import { projectDocuments } from '../project/projectDocuments';
import type { ProjectFile } from '../project/project';
import { Icon } from './Icon';
import {
  CHANNEL_MODES, closestPeriodForRate, createVidcSampleDocument, generateVidcSampleOutput,
  MEMC_SOUND_DMA_LIMIT, parseVidcSampleDocument, pcmFrames, readWavPcm16, resampleForDocument,
  serializeVidcSampleDocument, setChannelMode, setSamplePcm, setStereoImage, synthesiseTone,
  trimSample, type VidcSampleDocument, type Waveform,
} from '../assets/vidcSampleDocument';
import {
  channelSampleRateHz, machinesWithMeasuredVidcPart, SFR_MAX_PERIOD_US, SFR_MIN_PERIOD_US,
  STEREO_IMAGE_VALUES, vidcPartForMachine, type VidcChannelMode,
} from '../assets/vidcSample';

interface SampleWorkspaceProps {
  /** Everything the project holds, so a sample already in it can be opened. */
  projectFiles?: readonly ProjectFile[];
  /** The machine the workbench is set to, which fixes the byte order. */
  machineId: string;
  machineLabel: string;
  onAddSource: (name: string, content: string) => void;
  onNotice: (message: string) => void;
}

const STORAGE_KEY = '8bit-net-dev:vidc-sample';
const WAVEFORMS: Waveform[] = ['sine', 'square', 'sawtooth', 'triangle'];

/** A coarse outline of the sample, at one column per pixel of the drawn width. */
function outline(samples: Int16Array, channelMode: number, columns: number): Array<{ high: number; low: number }> {
  const frames = Math.floor(samples.length / channelMode);
  const perColumn = Math.max(1, Math.ceil(frames / columns));
  const points: Array<{ high: number; low: number }> = [];
  for (let start = 0; start < frames; start += perColumn) {
    let high = 0;
    let low = 0;
    for (let frame = start; frame < Math.min(frames, start + perColumn); frame += 1) {
      const value = samples[frame * channelMode]! / 32768;
      if (value > high) high = value;
      if (value < low) low = value;
    }
    points.push({ high, low });
  }
  return points;
}

export function SampleWorkspace({ machineId, machineLabel, projectFiles = [], onAddSource, onNotice }: SampleWorkspaceProps) {
  /* A sample document the project already holds. Sending somebody to a file
   * dialog to fetch what the product is sitting on is busy work, and after an
   * import it is the only thing they want. */
  const openable = useMemo(() => projectDocuments(projectFiles, ['sample']), [projectFiles]);
  /* The byte order follows the machine and is never defaulted, so a machine
   * that has not been measured is refused here rather than encoded for a
   * guess. */
  const supported = useMemo(() => {
    try {
      return { part: vidcPartForMachine(machineId), refusal: null as string | null };
    } catch (error) {
      return { part: null, refusal: error instanceof Error ? error.message : String(error) };
    }
  }, [machineId]);

  const recovered = useMemo(() => {
    if (!supported.part) return null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const document = parseVidcSampleDocument(saved);
        if (document.machineId === machineId) return document;
      }
    } catch { /* an invalid recovery starts a new validated document */ }
    return createVidcSampleDocument('untitled-sample', machineId);
  }, [machineId, supported.part]);

  const [history, setHistory] = useState<{ past: VidcSampleDocument[]; present: VidcSampleDocument } | null>(
    recovered ? { past: [], present: recovered } : null,
  );
  const [tone, setTone] = useState({ hertz: 440, milliseconds: 250, waveform: 'sine' as Waveform });
  const [trim, setTrim] = useState({ from: 0, to: 0 });
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (recovered) setHistory((current) => (current && current.present.machineId === machineId ? current : { past: [], present: recovered }));
  }, [recovered, machineId]);

  const document = history?.present ?? null;

  useEffect(() => {
    if (!document) return;
    try { localStorage.setItem(STORAGE_KEY, serializeVidcSampleDocument(document)); }
    catch { /* the storage panel reports quota */ }
  }, [document]);

  if (supported.refusal || !document) {
    return (
      <section className="sample-workspace" aria-label="Sample editor">
        <h2><Icon name="music" size={13} /> Archimedes samples</h2>
        <p role="status" className="binding-warning">{supported.refusal}</p>
        <p className="binding-note">
          A sample can be edited for {machinesWithMeasuredVidcPart().join(', ')}. This workbench is set to {machineLabel}.
          The byte order is not taken from the machine's family, because doing that is what was wrong about VIDC1a:
          the A310 was measured behaving as VIDC2 where its part's lineage said VIDC1, and a sample encoded for the
          wrong one is noise rather than a quiet inaccuracy.
        </p>
      </section>
    );
  }

  const output = generateVidcSampleOutput(document);
  const samples = pcmFrames(document);
  const frames = samples.length / document.channelMode;
  const stem = document.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'sample';
  const points = outline(samples, document.channelMode, 480);

  const guard = (operation: () => VidcSampleDocument, message?: string) => {
    try {
      const next = operation();
      setHistory((current) => (current ? { past: [...current.past, current.present].slice(-100), present: next } : current));
      if (message) onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  async function importWave(chosen: File): Promise<void> {
    try {
      const read = readWavPcm16(new Uint8Array(await chosen.arrayBuffer()));
      /* The period is chosen from the file's own rate first, so the nearest
       * neighbour resampling that follows has as little to do as possible. */
      const period = closestPeriodForRate(read.sampleRateHz, document!.channelMode);
      const retimed = parseVidcSampleDocument({ ...document!, periodMicroseconds: period });
      const next = setSamplePcm(retimed, resampleForDocument(retimed, read));
      setHistory((current) => (current ? { past: [...current.past, current.present].slice(-100), present: next } : current));
      const played = channelSampleRateHz(period, next.channelMode);
      onNotice(
        `Read ${read.samples.length / read.channels} frames of ${read.channels}-channel ${read.sampleRateHz} Hz audio and resampled it to ${played.toFixed(0)} Hz by nearest neighbour, which is the closest rate a ${period} µs period gives.`,
      );
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  }

  return (
    <section className="sample-workspace" aria-label="Sample editor">
      <header className="sample-toolbar">
        {!!openable.length && (
          <label className="project-source-picker"><span>From this project</span>
            <select aria-label="Open a sample from this project" value="" onChange={(event) => {
              const held = projectFiles.find((file) => file.id === event.target.value);
              if (!held) return;
              guard(() => parseVidcSampleDocument(held.content), `${held.name} opened from this project`);
            }}>
              <option value="">Choose a sample…</option>
              {openable.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.detail ? ` · ${entry.detail}` : ''}</option>)}
            </select>
          </label>
        )}
        <label><span>Name</span><input aria-label="Sample name" value={document.name} onChange={(event) => guard(() => parseVidcSampleDocument({ ...document, name: event.target.value || 'untitled-sample' }))} /></label>
        <label>
          <span>Period (µs)</span>
          <input
            aria-label="Sound frequency register period in microseconds" type="number"
            min={SFR_MIN_PERIOD_US} max={SFR_MAX_PERIOD_US} value={document.periodMicroseconds}
            onChange={(event) => guard(() => parseVidcSampleDocument({ ...document, periodMicroseconds: Number(event.target.value) || document.periodMicroseconds }))}
          />
        </label>
        <label>
          <span>Channels</span>
          <select aria-label="Channel mode" value={document.channelMode} onChange={(event) => guard(() => setChannelMode(document, Number(event.target.value) as VidcChannelMode))}>
            {CHANNEL_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <label>
          <span>Buffer address</span>
          <input
            aria-label="Physical buffer address" type="number" min={0} max={MEMC_SOUND_DMA_LIMIT} step={16}
            value={document.bufferAddress}
            onChange={(event) => guard(() => parseVidcSampleDocument({ ...document, bufferAddress: Number(event.target.value) }))}
          />
        </label>
        <button type="button" disabled={!history?.past.length} onClick={() => setHistory((current) => current && current.past.length ? { past: current.past.slice(0, -1), present: current.past[current.past.length - 1]! } : current)}>Undo</button>
      </header>

      <div className="sample-body">
        <section aria-label="Sample">
          <h2>Sample</h2>
          <p className="binding-note">
            {frames} frames on {document.channelMode} channel{document.channelMode === 1 ? '' : 's'} ·{' '}
            {channelSampleRateHz(document.periodMicroseconds, document.channelMode).toFixed(0)} Hz per channel ·{' '}
            {(1_000_000 / document.periodMicroseconds).toFixed(0)} bytes per second. Nothing is played here: this build
            has no browser playback that would sound like the machine, so build the sample and run it to hear it.
          </p>
          <svg className="sample-outline" viewBox={`0 0 ${Math.max(points.length, 1)} 100`} preserveAspectRatio="none" role="img" aria-label={`Waveform outline of ${frames} frames`}>
            <line x1={0} y1={50} x2={Math.max(points.length, 1)} y2={50} className="sample-axis" />
            {points.map((point, index) => (
              <line key={index} x1={index + 0.5} y1={50 - point.high * 48} x2={index + 0.5} y2={50 - point.low * 48} className="sample-column" />
            ))}
          </svg>

          <div className="sample-actions">
            <label><span>Tone (Hz)</span><input aria-label="Tone frequency in hertz" type="number" min={1} value={tone.hertz} onChange={(event) => setTone({ ...tone, hertz: Number(event.target.value) })} /></label>
            <label><span>Length (ms)</span><input aria-label="Tone length in milliseconds" type="number" min={1} value={tone.milliseconds} onChange={(event) => setTone({ ...tone, milliseconds: Number(event.target.value) })} /></label>
            <label>
              <span>Waveform</span>
              <select aria-label="Tone waveform" value={tone.waveform} onChange={(event) => setTone({ ...tone, waveform: event.target.value as Waveform })}>
                {WAVEFORMS.map((waveform) => <option key={waveform} value={waveform}>{waveform}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => guard(() => synthesiseTone(document, tone), 'Generated a tone at the rate this document is played at.')}>Generate tone</button>
            <button type="button" onClick={() => file.current?.click()}>Import WAVE…</button>
            <input
              ref={file} type="file" accept=".wav,audio/wav,audio/x-wav" aria-label="Import a WAVE file" className="visually-hidden"
              onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void importWave(chosen); }}
            />
          </div>

          <div className="sample-actions">
            <label><span>Trim from</span><input aria-label="Trim from frame" type="number" min={0} max={frames} value={trim.from} onChange={(event) => setTrim({ ...trim, from: Number(event.target.value) })} /></label>
            <label><span>Trim to</span><input aria-label="Trim to frame" type="number" min={0} max={frames} value={trim.to} onChange={(event) => setTrim({ ...trim, to: Number(event.target.value) })} /></label>
            <button type="button" onClick={() => guard(() => trimSample(document, trim.from, trim.to || frames), 'Trimmed the sample.')}>Trim</button>
          </div>
        </section>

        <section aria-label="Stereo placement">
          <h2>Stereo placement</h2>
          <p className="binding-note">
            Sound DMA reads sixteen bytes at a time and byte <em>n</em> is played through stereo image register
            <em> n</em> modulo eight, so every register a channel owns has to hold the same value. Image 0 is
            <em> undefined</em> in the datasheet — not centre and not silence — so it cannot be chosen here.
          </p>
          <table className="sample-stereo">
            <thead><tr><th scope="col">Channel</th><th scope="col">Placement</th><th scope="col">Registers</th></tr></thead>
            <tbody>
              {output.manifest.stereoRegisters.map(({ channel, image, registers }) => (
                <tr key={channel}>
                  <th scope="row">{channel}</th>
                  <td>
                    <select aria-label={`Channel ${channel} stereo image`} value={image} onChange={(event) => guard(() => setStereoImage(document, channel, Number(event.target.value)))}>
                      {STEREO_IMAGE_VALUES.filter((entry) => entry.value !== 0).map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>{registers.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-label="Generated output">
          <h2><Icon name="music" size={13} /> Generated output</h2>
          <dl className="sample-manifest">
            <div><dt>Byte order</dt><dd>{output.manifest.part.toUpperCase()}</dd></div>
            <div><dt>Buffer bytes</dt><dd>{output.manifest.byteLength}</dd></div>
            <div><dt>Silence padding</dt><dd>{output.manifest.paddingBytes}</dd></div>
            <div><dt>Clipped samples</dt><dd>{output.manifest.clippedSamples}</dd></div>
            <div><dt>Worst error</dt><dd>{(output.manifest.worstError * 100).toFixed(2)}%</dd></div>
            <div><dt>SHA-256</dt><dd><code>{output.manifest.sha256.slice(0, 16)}…</code></dd></div>
          </dl>
          <p role="status" className="binding-warning">{output.manifest.partReason}</p>
          <ul className="sample-assumptions">
            {output.manifest.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
          <pre aria-label="Generated sample data and player">{output.assembly}</pre>
          <div className="sample-actions">
            <button type="button" onClick={() => onAddSource(`${stem}.s`, `${output.assembly}\n`)}>Add generated source</button>
          </div>
        </section>
      </div>
    </section>
  );
}
