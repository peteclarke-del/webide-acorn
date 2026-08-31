import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectStorePanel, storeProjectId } from './ProjectStorePanel';
import { ProjectStoreClient, encodeContent } from '../cloud/projectStoreClient';

afterEach(cleanup);

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const description = {
  identity: { owner: 'local', authenticated: false, detail: 'One local identity. Nothing proves who you are, so this store is exactly as private as the machine it runs on.' },
  usage: { projects: 1, revisions: 2, bytes: 900 },
  limits: {},
};

function panel(fetcher: typeof fetch, overrides: Partial<Parameters<typeof ProjectStorePanel>[0]> = {}) {
  const props = {
    files: [{ name: 'main.asm', content: 'RTS' }],
    projectName: 'Demo Project',
    onNotice: vi.fn(),
    onOpenFiles: vi.fn(),
    client: new ProjectStoreClient(fetcher),
    ...overrides,
  };
  render(<ProjectStorePanel {...props} />);
  return props;
}

describe('when there is no store', () => {
  it('says everything stays in this browser rather than reporting a fault', async () => {
    /* Somebody who never asked for a server should not be shown an error. */
    panel(vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByText(/No project store is running, so everything stays in this browser/)).toBeVisible());
    expect(screen.queryByRole('button', { name: /Copy this project/ })).toBeNull();
  });
});

describe('what the panel says the store is', () => {
  it('repeats the store’s own words about who can read it', async () => {
    /* Not "your projects are backed up": the difference decides whether
     * somebody puts something private here. */
    panel(vi.fn(async () => answer(description)) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByText(/exactly as private as the machine it runs on/)).toBeVisible());
  });

  it('promises that copying changes nothing locally, because that is the decision being made', async () => {
    panel(vi.fn(async () => answer(description)) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByText(/Copying puts a revision in the store and changes nothing here/)).toBeVisible());
    expect(screen.getByText(/never writes over what you are working on/)).toBeVisible();
  });
});

describe('copying a project to the store', () => {
  it('writes against the head the store reports, so a second workbench collides rather than overwrites', async () => {
    const sent: RequestInit[] = [];
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') { sent.push(init); return answer({ revision: { id: '000002-b', parent: '000001-a', writtenAt: 't', note: '', files: { 'main.asm': 'd' } } }, 201); }
      if (url.endsWith('/revisions')) return answer({ revisions: [{ id: '000001-a', parent: null, writtenAt: 't', note: '', files: 1 }] });
      if (url.endsWith('/projects')) return answer({ projects: [{ id: 'demo-project', revisions: 1 }] });
      return answer(description);
    });
    const props = panel(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: /Copy this project/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Copy this project/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const body = JSON.parse(String(sent[0]!.body));
    expect(body.parent).toBe('000001-a');
    expect(body.files['main.asm']).toBe(encodeContent('RTS'));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/The local project is unchanged/)));
  });

  it('shows the store’s refusal in its own words', async () => {
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') return answer({ error: { code: 'REVISION_STALE_PARENT', message: 'This revision was written against nothing but the project is now at 000001-a. Read the head and merge, or fork from the parent.' } }, 409);
      if (String(input).endsWith('/revisions')) return answer({ revisions: [] });
      if (String(input).endsWith('/projects')) return answer({ projects: [] });
      return answer(description);
    });
    const props = panel(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: /Copy this project/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Copy this project/ }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Read the head and merge/)));
  });

  it('says what a project will be called when its name is not one the store accepts', async () => {
    panel(vi.fn(async () => answer(description)) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByText(/stored as/)).toBeVisible());
    expect(screen.getByText('demo-project')).toBeVisible();
  });
});

describe('taking a revision back', () => {
  it('offers its files to open and replaces nothing', async () => {
    /* The whole point of copying rather than moving: somebody trying the store
     * and stopping has lost nothing. */
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (/revisions\/[^/]+$/.test(url)) return answer({ files: { 'main.asm': encodeContent('LDA #1') } });
      if (url.endsWith('/revisions')) return answer({ revisions: [{ id: '000001-a', parent: null, writtenAt: 'then', note: 'first', files: 1 }] });
      if (url.endsWith('/projects')) return answer({ projects: [{ id: 'demo-project', revisions: 1 }] });
      return answer(description);
    });
    const props = panel(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show revisions of demo-project' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Show revisions of demo-project' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Open the files of revision 000001-a/ })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: /Open the files of revision 000001-a/ }));

    await waitFor(() => expect(props.onOpenFiles).toHaveBeenCalledWith([{ name: 'main.asm', content: 'LDA #1' }]));
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Nothing in the project was replaced/));
  });
});

describe('naming a project for the store', () => {
  it('reduces a name to what the store accepts and says when it changed', () => {
    expect(storeProjectId('Demo Project')).toEqual({ id: 'demo-project', adjusted: true });
    expect(storeProjectId('demo')).toEqual({ id: 'demo', adjusted: false });
    /* A name with nothing usable in it produces nothing, rather than a
     * fabricated identifier somebody would not recognise. */
    expect(storeProjectId('***').id).toBe('');
  });
});
