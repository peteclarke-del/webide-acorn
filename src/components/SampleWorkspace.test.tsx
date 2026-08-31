import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SampleWorkspace } from './SampleWorkspace';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function open(machineId = 'archimedes-a300', machineLabel = 'Archimedes A310') {
  const props = { machineId, machineLabel, onAddSource: vi.fn(), onNotice: vi.fn() };
  render(<SampleWorkspace {...props} />);
  return props;
}

describe('what the editor will and will not do', () => {
  it('refuses a machine whose byte order has not been measured, and says what has', () => {
    /* Encoding for a guess produces noise, which is the one failure a person
     * cannot tell from a bug in the encoder. */
    open('bbc-b', 'BBC Model B');
    expect(screen.getByRole('status')).toHaveTextContent(/No VIDC byte order has been established for bbc-b/);
    expect(screen.getByText(/A sample can be edited for archimedes-a300/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Sample name')).not.toBeInTheDocument();
  });

  it('says plainly that nothing is played in the browser', () => {
    open();
    expect(screen.getByText(/no browser playback that would sound like the machine/)).toBeInTheDocument();
  });

  it('carries the reason for the byte order to whoever is looking at the output', () => {
    open();
    const reasons = screen.getAllByRole('status').map((element) => element.textContent ?? '');
    expect(reasons.join(' ')).toMatch(/Measured on the qualified A310 core/);
  });

  it('lists what the generated player assumes rather than assuming it quietly', () => {
    open();
    /* Scoped to the list: they are also in the generated source, and both
     * places matter — this asserts the one a person sees without reading it. */
    expect(screen.getByText(/Sound DMA is already enabled/, { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByText(/The buffer address is physical/, { selector: 'li' })).toBeInTheDocument();
  });
});

describe('editing a sample', () => {
  it('generates a tone at the rate the document is played at', () => {
    const props = open();
    fireEvent.change(screen.getByLabelText('Tone frequency in hertz'), { target: { value: '440' } });
    fireEvent.change(screen.getByLabelText('Tone length in milliseconds'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tone' }));

    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/at the rate this document is played at/));
    /* 62 µs on one channel is 16,129 Hz, so ten milliseconds is 161 frames. */
    expect(screen.getByText(/161 frames on 1 channel/, { selector: 'p' })).toBeInTheDocument();
  });

  it('reports a refusal instead of changing the document', () => {
    const props = open();
    fireEvent.change(screen.getByLabelText('Tone frequency in hertz'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tone' }));
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/between 0 and 8065 Hz/));
    expect(screen.getByText(/16 frames on 1 channel/, { selector: 'p' })).toBeInTheDocument();
  });

  it('shows every stereo register a channel owns, and never offers the undefined one', () => {
    open();
    fireEvent.change(screen.getByLabelText('Channel mode'), { target: { value: '4' } });
    const stereo = screen.getByRole('table');
    expect(within(stereo).getAllByRole('row')).toHaveLength(5);
    expect(within(stereo).getByText('0, 4')).toBeInTheDocument();
    expect(within(stereo).getByText('3, 7')).toBeInTheDocument();

    const placement = screen.getByLabelText('Channel 0 stereo image');
    expect(within(placement).queryByText('undefined')).not.toBeInTheDocument();
    expect(within(placement).getByText('centre')).toBeInTheDocument();
  });

  it('refuses a buffer address sound DMA cannot reach', () => {
    const props = open();
    fireEvent.change(screen.getByLabelText('Physical buffer address'), { target: { value: '524288' } });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/reaches the first 524288 bytes of physical memory/));
  });

  it('undoes the last change and no further', () => {
    open();
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate tone' }));
    expect(screen.getByText(/4032 frames on 1 channel/, { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(undo);
    expect(screen.getByText(/16 frames on 1 channel/, { selector: 'p' })).toBeInTheDocument();
    expect(undo).toBeDisabled();
  });
});

describe('importing a file', () => {
  function wave(rate: number, samples: number[]): File {
    const data = new Uint8Array(samples.length * 2);
    samples.forEach((value, index) => { data[index * 2] = value & 0xff; data[index * 2 + 1] = (value >> 8) & 0xff; });
    const bytes = new Uint8Array(44 + data.length);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + data.length, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, data.length, true);
    bytes.set(data, 44);
    const file = new File([bytes], 'tone.wav', { type: 'audio/wav' });
    /* jsdom's File has no arrayBuffer in every version, and the component reads
     * the bytes rather than the object. */
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    return file;
  }

  it('chooses the period closest to the file and says what it resampled to', async () => {
    const props = open();
    const input = screen.getByLabelText('Import a WAVE file');
    fireEvent.change(input, { target: { files: [wave(8000, [0, 1000, -1000, 500])] } });

    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Read 4 frames of 1-channel 8000 Hz audio/)));
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/nearest neighbour/));
    /* 125 µs is the closest period to 8,000 Hz, and choosing it first is what
     * keeps the resampling from having anything to do. */
    expect(screen.getByLabelText('Sound frequency register period in microseconds')).toHaveValue(125);
    expect(screen.getByText(/4 frames on 1 channel/, { selector: 'p' })).toBeInTheDocument();
  });

  it('refuses a file it cannot read, saying what the file is', async () => {
    const props = open();
    const notAWave = new File([new Uint8Array(16)], 'song.mp3');
    Object.defineProperty(notAWave, 'arrayBuffer', { value: async () => new ArrayBuffer(16) });
    fireEvent.change(screen.getByLabelText('Import a WAVE file'), { target: { files: [notAWave] } });

    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/does not begin with RIFF and WAVE/)));
  });
});

describe('handing the result to the project', () => {
  it('adds ARM source carrying the sample, the player and the byte order', () => {
    const props = open();
    fireEvent.change(screen.getByLabelText('Sample name'), { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add generated source' }));

    expect(props.onAddSource).toHaveBeenCalledTimes(1);
    const [name, content] = props.onAddSource.mock.calls[0] as [string, string];
    expect(name).toBe('ping.s');
    expect(content).toContain('.sample_ping_play');
    expect(content).toContain('Encoded in the VIDC2 byte order');
    expect(content).toContain('LDR R1, =&03400000');
    expect(content).toMatch(/DCB &[0-9A-F]{2}/);
  });
});
