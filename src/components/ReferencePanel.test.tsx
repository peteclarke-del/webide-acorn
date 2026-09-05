import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReferencePanel } from './ReferencePanel';
import { emptyLibrary, installPack, type PackLibrary } from '../research/packLibrary';

afterEach(cleanup);

const AT = '2026-08-30T00:00:00Z';

const entry = (overrides: Record<string, unknown>) => ({
  id: 'e', title: 'Entry', body: 'Body.', anchors: [], citations: [], topics: [], ...overrides,
});

const pack = (overrides: Record<string, unknown>) => ({
  schema: '8bit-net.reference-pack', version: 1,
  id: 'p', title: 'Pack', packVersion: '1', publisher: 'Publisher', tier: 'publisher',
  licence: { name: 'CC-BY-4.0', quotable: true, insertable: false },
  applicability: { machines: [], processors: [], dialects: [], versions: [] },
  entries: [entry({})],
  ...overrides,
});

const library = (...packs: Array<Record<string, unknown>>): PackLibrary =>
  packs.reduce((held, next) => installPack(held, next, AT).library, emptyLibrary());

/* One call documented twice: by the manual, and by a wiki. */
const contested = () => library(
  pack({ id: 'manual', title: 'Publisher Manual', entries: [entry({ id: 'p', title: 'OSWRCH', body: 'Writes a character.', anchors: [{ kind: 'oscall', value: 'OSWRCH' }], citations: [{ title: 'The Manual', section: 'OS calls', page: 7 }] })] }),
  pack({ id: 'wiki', title: 'A Wiki', publisher: 'Wiki', tier: 'community', licence: { name: 'CC-BY-SA-4.0', quotable: true, insertable: true }, entries: [entry({ id: 'c', title: 'OSWRCH notes', body: 'Someone wrote this.', anchors: [{ kind: 'oscall', value: 'OSWRCH' }] })] }),
);

const search = (term: string) => {
  fireEvent.change(screen.getByLabelText('Search imported documentation'), { target: { value: term } });
  fireEvent.submit(screen.getByRole('search'));
};

describe('being told what you are reading', () => {
  it('separates publisher material from everything else under headings, not by order alone', () => {
    /* A single ordered list is read as a single list, whatever the ranking. */
    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    search('OSWRCH');

    const authoritative = screen.getByRole('listbox', { name: /From a publisher or a named author/ });
    const unverified = screen.getByRole('listbox', { name: /Not a publisher/ });
    expect(within(authoritative).getByText('OSWRCH')).toBeInTheDocument();
    expect(within(unverified).getByText('OSWRCH notes')).toBeInTheDocument();
  });

  it('shows the caveat on a community entry when it is opened', () => {
    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    search('OSWRCH');
    fireEvent.click(screen.getByText('OSWRCH notes'));
    /* Scoped to the entry being read: the same words also head the section it
     * came from, and both saying it is the point. */
    const detail = screen.getByRole('article');
    expect(within(detail).getByText(/check anything you depend on/)).toBeInTheDocument();
  });

  it('shows the citation for an entry that carries one', () => {
    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    search('OSWRCH');
    expect(screen.getByText(/The Manual, OS calls, p\.7/)).toBeInTheDocument();
  });

  it('can be narrowed to publishers only, and says how many that is', () => {
    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    search('OSWRCH');
    const only = screen.getByRole('button', { name: /Publishers only \(1\)/ });
    fireEvent.click(only);
    expect(only).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('OSWRCH notes')).toBeNull();
  });
});

describe('when there is nothing to show', () => {
  it('distinguishes an empty library from one that does not cover this', () => {
    /* Both show nothing, and they are very different situations. */
    const { unmount } = render(<ReferencePanel library={emptyLibrary()} onNotice={vi.fn()} />);
    search('OSWRCH');
    expect(screen.getByText(/No reference packs are held, so "OSWRCH" could not be looked up/)).toBeInTheDocument();
    unmount();

    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    search('NOTHINGLIKETHIS');
    expect(screen.getByText(/an absence in what you have imported, not an absence of documentation/)).toBeInTheDocument();
  });

  it('says what is ready to search before anything is asked', () => {
    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/2 entries across 2 packs are ready to search/);
  });
});

describe('history and bookmarks', () => {
  it('keeps recent searches and re-runs one when it is chosen', () => {
    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    search('OSWRCH');
    search('nothing');
    const history = screen.getByRole('heading', { name: 'Recent searches' }).parentElement!;
    expect(within(history).getByRole('button', { name: 'OSWRCH' })).toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: 'OSWRCH' }));
    expect(screen.getByRole('listbox', { name: /From a publisher/ })).toBeInTheDocument();
  });

  it('bookmarks an entry and takes the bookmark away again', () => {
    render(<ReferencePanel library={contested()} onNotice={vi.fn()} />);
    search('OSWRCH');
    fireEvent.click(screen.getByRole('button', { name: /^Bookmark$/ }));
    expect(screen.getByRole('heading', { name: 'Bookmarks' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remove the bookmark for OSWRCH/ }));
    expect(screen.queryByRole('heading', { name: 'Bookmarks' })).toBeNull();
  });
});

describe('inserting into somebody’s source', () => {
  it('refuses when the licence does not permit copying, and says which licence', () => {
    render(<ReferencePanel library={contested()} insertionLanguage="6502" onInsert={vi.fn()} onNotice={vi.fn()} />);
    search('OSWRCH');
    expect(screen.getByText(/CC-BY-4\.0, which does not permit its text being copied/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Insert with provenance/ })).toBeNull();
  });

  it('offers insertion where the licence permits it, and hands over text carrying its provenance', () => {
    const onInsert = vi.fn();
    render(<ReferencePanel library={contested()} insertionLanguage="6502" onInsert={onInsert} onNotice={vi.fn()} />);
    search('OSWRCH');
    fireEvent.click(screen.getByText('OSWRCH notes'));
    fireEvent.click(screen.getByRole('button', { name: /Insert with provenance/ }));

    expect(onInsert).toHaveBeenCalledTimes(1);
    const [text] = onInsert.mock.calls[0]!;
    expect(text).toMatch(/^; From A Wiki \(Wiki\), version 1\./m);
    expect(text).toMatch(/Licence: CC-BY-SA-4\.0/);
    /* Community text says so in the file it lands in, not only on screen. */
    expect(text).toMatch(/Source tier: community/);
    expect(text).toMatch(/Someone wrote this\./);
  });

  it('shows what would be inserted before anything is inserted', () => {
    render(<ReferencePanel library={contested()} insertionLanguage="6502" onInsert={vi.fn()} onNotice={vi.fn()} />);
    search('OSWRCH');
    fireEvent.click(screen.getByText('OSWRCH notes'));
    expect(screen.getByText('What would be inserted')).toBeInTheDocument();
  });
});

describe('relevance to the machine being worked on', () => {
  it('says when a result names a different machine rather than hiding it', () => {
    const held = library(pack({
      id: 'master', title: 'Master Reference',
      applicability: { machines: ['master'], processors: [], dialects: [], versions: [] },
      entries: [entry({ id: 'acccon', title: 'ACCCON', body: 'Master only.' })],
    }));
    render(<ReferencePanel library={held} target={{ machineId: 'bbc-b' }} onNotice={vi.fn()} />);
    search('ACCCON');
    expect(screen.getByText(/names a different machine/)).toBeInTheDocument();
    expect(screen.getByText(/a different machine from the one selected/)).toBeInTheDocument();
  });
});
