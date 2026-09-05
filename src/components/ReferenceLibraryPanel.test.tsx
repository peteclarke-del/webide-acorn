import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReferenceLibraryPanel } from './ReferenceLibraryPanel';
import { emptyLibrary, installPack, type PackLibrary } from '../research/packLibrary';

afterEach(cleanup);

const AT = '2026-08-30T00:00:00Z';
const now = () => AT;

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'e', title: 'Entry', body: 'Body.', anchors: [], citations: [], topics: [], ...overrides,
});

const pack = (overrides: Record<string, unknown> = {}) => ({
  schema: '8bit-net.reference-pack', version: 1,
  id: 'manual', title: 'Publisher Manual', packVersion: '2', publisher: 'Acorn', tier: 'publisher',
  licence: { name: 'All rights reserved', quotable: true, insertable: false },
  applicability: { machines: ['bbc-b'], processors: [], dialects: [], versions: [] },
  entries: [entry()],
  ...overrides,
});

const library = (...packs: Array<Record<string, unknown>>): PackLibrary =>
  packs.reduce((held, next) => installPack(held, next, AT).library, emptyLibrary());

function open(held: PackLibrary = emptyLibrary()) {
  const props = { library: held, onChange: vi.fn(), onNotice: vi.fn(), now };
  render(<ReferenceLibraryPanel {...props} />);
  return props;
}

const importFile = (contents: unknown, name = 'pack.json') => {
  const text = JSON.stringify(contents);
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  Object.defineProperty(file, 'size', { value: text.length });
  fireEvent.change(screen.getByLabelText('Import a reference pack'), { target: { files: [file] } });
};

describe('an empty library', () => {
  it('says what still answers, rather than implying the workbench knows nothing', () => {
    open();
    expect(screen.getByRole('status')).toHaveTextContent(/still answers from its own maintained knowledge/);
  });

  it('says nothing is fetched or uploaded, which is why it works offline', () => {
    open();
    expect(screen.getByText(/Nothing here is fetched and nothing is uploaded, which is why/)).toBeInTheDocument();
  });
});

describe('importing', () => {
  it('takes a pack in and reports what arrived', async () => {
    const props = open();
    importFile(pack());
    await waitFor(() => expect(props.onChange).toHaveBeenCalledTimes(1));
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Publisher Manual was imported/));
  });

  it('reports a refusal in the pack’s own terms rather than failing silently', async () => {
    const props = open();
    importFile(pack({ tier: 'official' }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/source tier is one of/)));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('refuses a file too large to be documentation before reading it', async () => {
    const props = open();
    const file = new File(['{}'], 'huge.json');
    Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 });
    Object.defineProperty(file, 'text', { value: async () => '{}' });
    fireEvent.change(screen.getByLabelText('Import a reference pack'), { target: { files: [file] } });
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/limited to/)));
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

describe('what is held', () => {
  it('shows each pack with what it permits, in those words', () => {
    open(library(pack()));
    const row = screen.getByRole('row', { name: /Publisher Manual/ });
    expect(within(row).getByText('All rights reserved')).toBeInTheDocument();
    expect(within(row).getByText(/quotable · may not be inserted/)).toBeInTheDocument();
    expect(within(row).getByText('Publisher')).toBeInTheDocument();
  });

  it('says what the library is made of, not only how big it is', () => {
    /* A library that is mostly community notes answers differently from one
     * that is mostly manuals, and the totals alone do not say so. */
    open(library(
      pack(),
      pack({
        id: 'wiki', title: 'A Wiki', publisher: 'Wiki', tier: 'community',
        licence: { name: 'CC-BY-SA-4.0', quotable: true, insertable: true },
        entries: [entry({ id: 'n1' }), entry({ id: 'n2' })],
      }),
    ));
    expect(screen.getByRole('heading', { name: 'What this library is made of' })).toBeInTheDocument();
    expect(screen.getByText(/2 community, 1 publisher/)).toBeInTheDocument();
    expect(screen.getByText(/check anything you depend on/)).toBeInTheDocument();
  });

  it('removes a pack and says what went with it', () => {
    const props = open(library(pack()));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Publisher Manual' }));
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/was removed, along with its 1 entries/));
  });

  it('shows what has been done to the library', () => {
    open(library(pack()));
    const audit = screen.getByRole('heading', { name: 'What has been done to this library' }).parentElement!;
    expect(within(audit).getByText('installed')).toBeInTheDocument();
    expect(within(audit).getByText('manual')).toBeInTheDocument();
  });
});

describe('the checks over what is held', () => {
  it('reports a clean library as checked, naming what it looked at', () => {
    open(library(pack()));
    expect(screen.getByText(/Checked 1 entries across 1 pack/)).toBeInTheDocument();
  });

  it('does not report an empty library as a clean result', () => {
    /* The distinction the accuracy rules exist to keep. */
    open();
    expect(screen.queryByText(/nothing found/)).toBeNull();
  });
});
