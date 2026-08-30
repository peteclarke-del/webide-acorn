import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StartProjectDialog } from './StartProjectDialog';
import type { LocalProject } from '../project/project';
import { parseTileMapDocument } from '../assets/tileMapDocument';

/* The sample catalogue is a dynamic import of a large generated module. Under a
 * loaded machine that can take longer than the one-second default wait, which
 * made this file fail intermittently in a full run rather than for any reason
 * in the product. */
const SAMPLE_LOAD_TIMEOUT = 15_000;

afterEach(cleanup);

function fileFrom(path: string, content: string): File {
  const file = new File([content], path.split('/').pop()!, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  /* jsdom does not implement File.text() in every version. */
  Object.defineProperty(file, 'text', { value: async () => content });
  return file;
}

function chooseFolder(files: File[]) {
  const input = screen.getByLabelText('Choose a source folder') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  fireEvent.change(input);
}

describe('StartProjectDialog', () => {
  it('lists the sample catalogue and opens a sample as a real project', async () => {
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    const open = await screen.findByRole('button', { name: 'Open Acorn Harvest' }, { timeout: SAMPLE_LOAD_TIMEOUT });
    expect(screen.getByRole('heading', { level: 3, name: 'Acorn Harvest' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Acorn Catcher' })).toBeInTheDocument();
    fireEvent.click(open);
    expect(onOpenProject).toHaveBeenCalledTimes(1);
    const [project, description] = onOpenProject.mock.calls[0] as [LocalProject, string];
    expect(project.name).toBe('Acorn Harvest');
    expect(project.buildTargets.length).toBeGreaterThan(0);
    expect(project.files.some((file) => file.name === 'main.asm')).toBe(true);
    expect(description).toMatch(/Acorn Harvest/);
  });

  it('states that building a sample needs no firmware but running it does', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    await screen.findByRole('button', { name: 'Open Acorn Harvest' }, { timeout: SAMPLE_LOAD_TIMEOUT });
    expect(screen.getAllByText(/Building this sample needs no firmware/)[0]).toBeInTheDocument();
  });

  it('shows the whole import plan before anything is created', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'From an existing codebase' }));
    chooseFolder([
      fileFrom('game/src/main.asm', 'ORG &1900\n.start\nINCLUDE "gfx.asm"\nRTS\n'),
      fileFrom('game/src/gfx.asm', `.hero_pixels\nEQUB ${Array.from({ length: 16 }, (_, index) => index).join(', ')}\n`),
      fileFrom('game/.git/config', '[core]\n'),
      fileFrom('game/disk.ssd', 'binary'),
    ]);
    const summary = await screen.findByRole('status');
    expect(summary).toHaveTextContent('2 files');
    expect(summary).toHaveTextContent('1 proposed build target');
    expect(summary).toHaveTextContent('2 excluded');
    expect(screen.getByText('main.asm', { selector: 'th' })).toBeInTheDocument();
    expect(screen.getByText(/Proposed because it/)).toBeInTheDocument();
    expect(screen.getByLabelText('Imported project name')).toHaveValue('game');
  });

  it('creates the project only from the files and assets that were chosen', async () => {
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'From an existing codebase' }));
    chooseFolder([
      fileFrom('game/main.asm', 'ORG &1900\n.start\nRTS\n'),
      fileFrom('game/gfx.asm', `.hero_pixels\nEQUB ${Array.from({ length: 16 }, (_, index) => index).join(', ')}\n`),
    ]);
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('button', { name: /Create project from 2 files/ }));
    const [withoutAsset] = onOpenProject.mock.calls[0] as [LocalProject];
    expect(withoutAsset.files.map((file) => file.name).sort()).toEqual(['gfx.asm', 'main.asm']);

    fireEvent.click(screen.getByText(/Editable assets that can be recovered/));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Create project from 2 files/ }));
    const [withAsset] = onOpenProject.mock.calls[1] as [LocalProject];
    expect(withAsset.files.map((file) => file.name).sort()).toEqual(['gfx.asm', 'hero.asset.json', 'main.asm']);
    expect(withAsset.files.find((file) => file.name === 'gfx.asm')!.content).toContain('EQUB 0, 1, 2');
  });

  it('reports every excluded path with the reason it was left out', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'From an existing codebase' }));
    chooseFolder([
      fileFrom('game/main.asm', 'ORG &1900\n.start\nRTS\n'),
      fileFrom('game/node_modules/pkg/index.js', 'x'),
      fileFrom('game/art.png', 'x'),
    ]);
    await screen.findByRole('status');
    fireEvent.click(screen.getByText(/Left out \(2\)/));
    const excluded = await screen.findByText('game/art.png');
    expect(excluded.closest('li')).toHaveTextContent('.png is not an editable source type');
    expect(screen.getByText('game/node_modules/pkg/index.js').closest('li')).toHaveTextContent('Inside node_modules');
  });

  it('says a folder produced nothing importable rather than creating an empty project', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'From an existing codebase' }));
    chooseFolder([fileFrom('game/disk.ssd', 'binary')]);
    await waitFor(() => expect(screen.getByText(/No editable source file was found/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Create project from 0 files/ })).toBeDisabled();
  });

  it('warns when a recovered run is equally readable as tile-map data', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'From an existing codebase' }));
    chooseFolder([
      fileFrom('game/main.asm', 'ORG &1900\n.start\nRTS\n'),
      fileFrom('game/level.asm', ['.level_map', ...Array.from({ length: 8 }, () => 'EQUB 0, 1, 1, 0, 2, 0, 1, 0')].join('\n')),
    ]);
    await screen.findByRole('status');
    fireEvent.click(screen.getByText(/Editable assets that can be recovered/));
    expect(await screen.findByText(/also has the small value alphabet of tile-map data/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Tile maps that can be recovered/));
    const maps = document.querySelector('.import-maps')!;
    expect(maps).toHaveTextContent('level_map');
    expect(maps).toHaveTextContent('64 bytes');
    expect(maps).toHaveTextContent('3 distinct values');
  });

  it('promotes detected level data to a real editable map at the chosen grid shape', async () => {
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'From an existing codebase' }));
    chooseFolder([
      fileFrom('game/main.asm', 'ORG &1900\n.start\nRTS\n'),
      fileFrom('game/level.asm', ['.level_map', ...Array.from({ length: 8 }, () => 'EQUB 0, 1, 1, 0, 2, 0, 1, 0')].join('\n')),
    ]);
    await screen.findByRole('status');
    fireEvent.click(screen.getByText(/Tile maps that can be recovered/));
    fireEvent.click(await screen.findByLabelText('Promote level_map to an editable map'));
    fireEvent.change(screen.getByLabelText('Grid shape for level_map'), { target: { value: '8x8' } });
    fireEvent.click(screen.getByRole('button', { name: /Create project from 2 files/ }));

    const [project] = onOpenProject.mock.calls[0] as [LocalProject];
    const map = project.files.find((file) => file.name.endsWith('.map.json'));
    expect(map).toBeDefined();
    const document = parseTileMapDocument(map!.content);
    expect(document.width).toBe(8);
    expect(document.height).toBe(8);
    // The layout is recovered exactly; the artwork is declared as not chosen.
    expect(document.layers[0]!.cells).toEqual(Array.from({ length: 8 }, () => [0, 1, 1, 0, 2, 0, 1, 0]).flat());
    expect(document.tileset).toEqual([{ index: 1, assetFile: null, properties: [] }, { index: 2, assetFile: null, properties: [] }]);
  });
});

describe('opening a folder this browser can write back to', () => {
  /* A directory handle standing in for the picker's, holding just enough for
   * the walk: one source file at the top level. */
  const handle = (name = 'demo') => ({
    name,
    kind: 'directory' as const,
    async *entries() {
      yield ['main.asm', {
        name: 'main.asm', kind: 'file' as const,
        getFile: async () => ({ size: 10, text: async () => 'ORG &1900\n' }) as unknown as File,
        createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
      }] as never;
    },
    getFileHandle: async () => { throw new Error('not used'); },
    getDirectoryHandle: async () => { throw new Error('not used'); },
    requestPermission: async () => 'granted' as PermissionState,
  });

  afterEach(() => { delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker; });

  it('says plainly what a browser without the picker cannot do, rather than offering a control that would fail', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    expect(screen.getByText(/cannot open a folder it can also write back to/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write back to/i })).not.toBeInTheDocument();
    /* The one-way import is still there for everyone. */
    expect(screen.getByLabelText('Choose a source folder')).toBeInTheDocument();
  });

  it('hands the folder handle to the workbench so the project can be written back', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => handle();
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    fireEvent.click(screen.getByRole('button', { name: /write back to/i }));

    await screen.findByText(/Connected to demo/i);
    fireEvent.click(await screen.findByRole('button', { name: /^Create project from/i }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled());
    const [, description, folder] = onOpenProject.mock.calls[0]!;
    expect(description).toContain('connected to demo');
    expect((folder as { name: string }).name).toBe('demo');
  });

  it('does not claim a connection when the import came through the one-way directory input', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => handle();
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    chooseFolder([fileFrom('demo/main.asm', 'ORG &1900\n')]);

    fireEvent.click(await screen.findByRole('button', { name: /^Create project from/i }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled());
    expect(screen.queryByText(/Connected to/i)).not.toBeInTheDocument();
    expect(onOpenProject.mock.calls[0]![2]).toBeNull();
  });

  it('reports a folder with nothing readable in it rather than opening an empty project', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => ({ ...handle('empty'), async *entries() {} });
    const onNotice = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={onNotice} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    fireEvent.click(screen.getByRole('button', { name: /write back to/i }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('no readable source files')));
  });
});

describe('overriding an inferred entry point in the dialog', () => {
  it('offers the other files of the same language and creates the project from the one chosen', async () => {
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    chooseFolder([
      fileFrom('game/loader.asm', 'ORG &1900\n.start\nJMP start\n'),
      fileFrom('game/engine.asm', '.update\nRTS\n'),
    ]);

    const select = await screen.findByLabelText('Entry file for 6502 build') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['loader.asm', 'engine.asm']);
    expect(select.value).toBe('loader.asm');

    fireEvent.change(select, { target: { value: 'engine.asm' } });
    await waitFor(() => expect((screen.getByLabelText('Entry file for 6502 build') as HTMLSelectElement).value).toBe('engine.asm'));
    expect(screen.getByText(/Chosen during the import/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Create project from/i }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled());
    const created = onOpenProject.mock.calls[0]![0] as LocalProject;
    const target = created.buildTargets.find((candidate) => candidate.id === 'import-6502')!;
    expect(created.files.find((file) => file.id === target.entryFileId)!.name).toBe('engine.asm');
  });
});

describe('importing a zip archive of source', () => {
  /* A real archive, built byte by byte, so the dialog is driven through the
   * same reader a person's own file would go through. */
  async function archive(members: Array<{ name: string; content: string }>): Promise<File> {
    const { crc32 } = await import('../project/archiveImport');
    const encoder = new TextEncoder();
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const member of members) {
      const raw = encoder.encode(member.content);
      const name = encoder.encode(member.name);
      const crc = crc32(raw);
      const local = new Uint8Array(30 + name.length + raw.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, raw.length, true);
      localView.setUint32(22, raw.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(raw, 30 + name.length);
      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, raw.length, true);
      centralView.setUint32(24, raw.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      locals.push(local); centrals.push(central); offset += local.length;
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, centrals.length, true);
    endView.setUint16(10, centrals.length, true);
    endView.setUint32(12, centrals.reduce((sum, entry) => sum + entry.length, 0), true);
    endView.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, end];
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    const file = new File([bytes], 'acorn-game.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    return file;
  }

  function chooseArchive(file: File) {
    const input = screen.getByLabelText('Choose a zip archive') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);
  }

  it('plans a project from an archive and names what the reader refused', async () => {
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    chooseArchive(await archive([
      { name: 'game/main.asm', content: 'ORG &1900\n.start\nRTS\n' },
      { name: 'game/helper.asm', content: 'RTS\n' },
      { name: '../escaped.asm', content: 'RTS\n' },
    ]));

    const refusals = await screen.findByText(/were refused before the plan was made/i);
    fireEvent.click(refusals);
    expect(screen.getByText(/\.\.\/escaped\.asm: contains "\.\.", which would be unpacked outside the project/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Create project from 2 files/ }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalled());
    const created = onOpenProject.mock.calls[0]![0] as LocalProject;
    expect(created.files.map((file) => file.name).sort()).toEqual(['helper.asm', 'main.asm']);
    /* An archive is a snapshot, not a folder handle: nothing is connected. */
    expect(onOpenProject.mock.calls[0]![2]).toBeNull();
  });

  it('reports an archive with nothing importable in it rather than opening an empty project', async () => {
    const onNotice = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={onNotice} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    chooseArchive(await archive([{ name: '/etc/passwd', content: 'root\n' }]));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('holds no importable source files')));
    expect(onNotice.mock.calls[0]![0]).toContain('absolute path');
  });

  it('says why a file that is not an archive could not be read', async () => {
    const onNotice = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={onNotice} />);
    fireEvent.click(await screen.findByRole('tab', { name: /existing codebase/i }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    const bytes = new TextEncoder().encode('not a zip at all');
    const file = new File([bytes], 'notes.zip');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    chooseArchive(file);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('not a zip archive')));
  });
});

describe('starting from a template', () => {
  it('offers only what this machine can run, and says why the rest is not offered', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Templates' }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    expect(screen.getByText('BBC Model B · MODE 7 starter')).toBeInTheDocument();
    expect(screen.getByText('BBC Model B · disk catalogue starter')).toBeInTheDocument();
    /* Both fit a stock Model B, so nothing is listed as unavailable. */
    expect(screen.queryByText(/this machine cannot run/)).not.toBeInTheDocument();
  });

  it('records the licence position beside every template rather than leaving it to be assumed', async () => {
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Templates' }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    expect(screen.getAllByText(/8bit-net Dev, MIT\./)).toHaveLength(2);
  });

  it('opens a template as a real project with its build target intact', async () => {
    const onOpenProject = vi.fn();
    render(<StartProjectDialog machineId="bbc-b" onOpenProject={onOpenProject} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Templates' }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Start from this template' })[0]!);

    await waitFor(() => expect(onOpenProject).toHaveBeenCalled());
    const [project, description, folder] = onOpenProject.mock.calls[0]!;
    const created = project as LocalProject;
    expect(created.files.map((file) => file.name)).toEqual(['main.asm']);
    expect(created.buildTargets).toHaveLength(1);
    expect(created.target.machineId).toBe('bbc-b');
    expect(description).toContain('MODE 7 starter');
    /* A template is not a folder on disk, so nothing is connected. */
    expect(folder).toBeNull();
  });

  it('says a machine has no template rather than showing an empty list', async () => {
    render(<StartProjectDialog machineId="archimedes-a3000" onOpenProject={() => {}} onClose={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Templates' }, { timeout: SAMPLE_LOAD_TIMEOUT }));
    expect(screen.getByText('No template ships for this machine yet.')).toBeInTheDocument();
  });
});
