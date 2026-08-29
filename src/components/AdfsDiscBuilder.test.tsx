import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AdfsDiscBuilder } from './AdfsDiscBuilder';
import { extractAdfsFile, parseAdfsCatalogue } from '../media/adfsCatalogue';

afterEach(cleanup);

const artifact = { name: 'DiscDemo', bytes: new Uint8Array(1024).fill(0xe1), entryPoint: 0x8000 };

function open(withArtifact = true) {
  const props = { artifact: withArtifact ? artifact : null, onCreated: vi.fn(), onNotice: vi.fn() };
  render(<AdfsDiscBuilder {...props} />);
  return props;
}

const addHostFile = async (name: string, bytes: Uint8Array) => {
  const input = screen.getByLabelText('Add a file to the disc') as HTMLInputElement;
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  /* jsdom's File has no arrayBuffer in every version, so the bytes are supplied
   * the way the component will actually read them. */
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
};

describe('building a multi-file ADFS disc', () => {
  it('says what it cannot do before anyone finds out by trying', () => {
    open();
    expect(screen.getByText(/the writer builds no\s+subdirectories/)).toBeInTheDocument();
    expect(screen.getByText(/A disc needs at least one/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create the disc/ })).toBeDisabled();
  });

  it('writes a disc holding the build and a host file, and both read back exactly', async () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: /Add the current ARM build/ }));
    await waitFor(() => expect(screen.getByText('current ARM build')).toBeInTheDocument());
    const notes = new TextEncoder().encode('read me');
    await addHostFile('Notes.txt', notes);

    fireEvent.click(screen.getByRole('button', { name: /Create the disc/ }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(1));
    const [created, filename] = props.onCreated.mock.calls[0]!;
    expect(filename).toBe('webide.adf');
    const catalogue = parseAdfsCatalogue(created.image);
    expect(catalogue.warnings).toEqual([]);
    expect(catalogue.entries.map((entry) => entry.name).sort()).toEqual(['DiscDemo', 'Notes']);
    const stored = catalogue.entries.find((entry) => entry.name === 'Notes')!;
    expect(Array.from(extractAdfsFile(created.image, stored))).toEqual(Array.from(notes));
  });

  it('refuses a second file whose name ADFS would not tell apart from the first', async () => {
    const props = open(false);
    await addHostFile('Notes.txt', new Uint8Array([1, 2, 3]));
    const input = screen.getByLabelText('Add a file to the disc') as HTMLInputElement;
    const clash = new File([new Uint8Array([4])], 'NOTES.dat');
    Object.defineProperty(clash, 'arrayBuffer', { value: async () => new Uint8Array([4]).buffer });
    fireEvent.change(input, { target: { files: [clash] } });
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/does not distinguish names by case/)));
  });

  it('refuses a filetype that is not one, saying what one looks like', async () => {
    const props = open(false);
    fireEvent.change(screen.getByLabelText(/RISC OS filetype for the next file/), { target: { value: 'zzzz' } });
    const input = screen.getByLabelText('Add a file to the disc') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'A.dat');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/one to three hexadecimal digits/)));
  });

  it('reports a name the disc cannot hold and will not write until it is fixed', async () => {
    open(false);
    await addHostFile('Notes.txt', new Uint8Array([1]));
    fireEvent.change(screen.getByLabelText(/Name on the disc for Notes.txt/), { target: { value: 'A.B' } });
    expect(screen.getByRole('status')).toHaveTextContent(/path or wildcard character/);
    expect(screen.getByRole('button', { name: /Create the disc/ })).toBeDisabled();
  });

  it('offers no build to add when there is not a current one', () => {
    open(false);
    expect(screen.getByRole('button', { name: /Add the current ARM build/ })).toBeDisabled();
  });
});
