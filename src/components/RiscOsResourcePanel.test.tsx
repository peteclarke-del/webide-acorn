import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RiscOsResourcePanel } from './RiscOsResourcePanel';
import { createRiscOsAbsoluteApplication, type RiscOsApplicationPackage } from '../media/riscOsApplication';
import { extractAdfsFile } from '../media/adfsCatalogue';
import type { ArmArtifact } from '../build/artifactTypes';

afterEach(cleanup);

const artifact: ArmArtifact = {
  kind: 'arm-binary', bytes: new Uint8Array([0x00, 0x00, 0xa0, 0xe1]), origin: 0x8000, entryPoint: 0x8000,
  processor: 'arm2', endianness: 'little', containerFormat: 'raw', riscOsFiletype: null,
  symbols: {}, sourceMap: {}, sourceLocations: {}, entryFileId: 'main', dependencies: [], sourceFiles: {},
  diagnostics: [], listing: [],
};

function open(application: RiscOsApplicationPackage = createRiscOsAbsoluteApplication(artifact, 'Demo')) {
  const props = { application, onChange: vi.fn(), onNotice: vi.fn(), onDisc: vi.fn(), onDownload: vi.fn() };
  render(<RiscOsResourcePanel {...props} />);
  return props;
}

const addResource = async (path: string, name: string, bytes: Uint8Array) => {
  fireEvent.change(screen.getByLabelText(/Path inside the application directory/), { target: { value: path } });
  const input = screen.getByLabelText('Choose a file to add to the application') as HTMLInputElement;
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  fireEvent.change(input, { target: { files: [file] } });
};

describe('the rest of a RISC OS application', () => {
  it('lists what the application holds and marks what cannot be removed', () => {
    open();
    expect(screen.getByRole('rowheader', { name: '!Demo/!Run' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '!Demo/RunImage' })).toBeInTheDocument();
    expect(screen.getAllByText('required')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Remove !Demo\/!Run/ })).toBeNull();
  });

  it('adds a resource at a path that names a subdirectory', async () => {
    const props = open();
    await addResource('Resources/Messages', 'messages.txt', new TextEncoder().encode('Hello\n'));
    await waitFor(() => expect(props.onChange).toHaveBeenCalledTimes(1));
    const next = props.onChange.mock.calls[0]![0] as RiscOsApplicationPackage;
    expect(next.files.map((file) => file.path)).toContain('!Demo/Resources/Messages');
    expect(next.files.at(-1)!.hostFsPath).toBe('!Demo/Resources/Messages,fff');
  });

  it('refuses a name whose type RISC OS decides, rather than writing a broken application', async () => {
    const props = open();
    fireEvent.change(screen.getByLabelText(/RISC OS filetype for the resource/), { target: { value: String(0xfff) } });
    await addResource('!Sprites', 'sprites', new Uint8Array([1, 2, 3]));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/must have RISC OS filetype &FF9/)));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('writes a transfer disc holding the whole directory and hands it up', async () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: /Write an ADFS E transfer disc/ }));
    await waitFor(() => expect(props.onDisc).toHaveBeenCalledTimes(1));
    const [created, filename] = props.onDisc.mock.calls[0]!;
    expect(filename).toBe('demo.adf');
    expect(created.catalogue.warnings).toEqual([]);
    const root = created.catalogue.entries[0]!;
    expect(root.name).toBe('!Demo');
    const runImage = root.children!.find((entry: { name: string }) => entry.name === 'RunImage')!;
    expect(Array.from(extractAdfsFile(created.image, runImage))).toEqual(Array.from(artifact.bytes));
  });

  it('archives the application with its filetypes in the names', async () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: /Download as an archive/ }));
    await waitFor(() => expect(props.onDownload).toHaveBeenCalledTimes(1));
    const [bytes, filename] = props.onDownload.mock.calls[0]!;
    expect(filename).toBe('demo.zip');
    /* A zip begins with its local file header signature; the names inside are
     * checked by the package contracts rather than reopened here. */
    expect(Array.from((bytes as Uint8Array).slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
