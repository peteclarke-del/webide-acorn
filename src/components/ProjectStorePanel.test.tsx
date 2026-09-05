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

describe('what state the project is in with the store', () => {
  const listing = (revisions: unknown[]) => ({ revisions });

  it('says untracked when the store has never held it, and does not call that a problem', async () => {
    panel(vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/revisions')) return answer(listing([]));
      if (url.endsWith('/projects')) return answer({ projects: [] });
      return answer(description);
    }) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByText(/This project is not in the store/)).toBeVisible());
  });

  it('says diverged and offers a merge preview once both sides have moved', async () => {
    /* The only state where something has to be decided, so it must appear
     * exactly when it applies and not before. */
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') return answer({ revision: { id: '000001-a', parent: null, writtenAt: 't', note: '', files: { 'main.asm': 'd' } } }, 201);
      if (/revisions\/[^/]+$/.test(url)) return answer({ files: { 'main.asm': encodeContent('LDA #2') } });
      if (url.endsWith('/revisions')) return answer(listing([
        { id: '000001-a', parent: null, writtenAt: 't', note: '', files: 1 },
        { id: '000002-b', parent: '000001-a', writtenAt: 't', note: '', files: 1 },
      ]));
      if (url.endsWith('/projects')) return answer({ projects: [{ id: 'demo-project', revisions: 2 }] });
      return answer(description);
    });
    panel(fetcher as unknown as typeof fetch, { files: [{ name: 'main.asm', content: 'LDA #1' }] });

    /* Nothing has been synchronised and the files differ from the store's
     * head, which is what diverged means. */
    await waitFor(() => expect(screen.getByRole('button', { name: /Show what a merge would produce/ })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: /Show what a merge would produce/ }));
    await waitFor(() => expect(screen.getByLabelText('Merge preview')).toBeVisible());
    /* No shared ancestor, so the honest answer is a fork rather than a guess. */
    expect(screen.getByText(/share no revision to merge against/)).toBeVisible();
  });

  it('reports being in step after copying up, because reading and writing both synchronise', async () => {
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') return answer({ revision: { id: '000001-a', parent: null, writtenAt: 't', note: '', files: { 'main.asm': 'd' } } }, 201);
      if (url.endsWith('/revisions')) return answer(listing([{ id: '000001-a', parent: null, writtenAt: 't', note: '', files: 1 }]));
      if (url.endsWith('/projects')) return answer({ projects: [{ id: 'demo-project', revisions: 1 }] });
      return answer(description);
    });
    panel(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: /Copy this project/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Copy this project/ }));
    await waitFor(() => expect(screen.getByText(/nothing has changed since/)).toBeVisible());
  });
});

describe('comparing and forking', () => {
  const twoRevisions = [
    { id: '000001-a', parent: null, writtenAt: 't', note: '', files: 1 },
    { id: '000002-b', parent: '000001-a', writtenAt: 't', note: '', files: 1 },
  ];

  it('compares the two newest revisions and counts lines only for text', async () => {
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('000001-a')) return answer({ files: { 'main.asm': encodeContent('one\ntwo'), 'art.ssd': encodeContent('aaa') } });
      if (url.endsWith('000002-b')) return answer({ files: { 'main.asm': encodeContent('one\ntwo\nthree'), 'art.ssd': encodeContent('bbb') } });
      if (url.endsWith('/revisions')) return answer({ revisions: twoRevisions });
      if (url.endsWith('/projects')) return answer({ projects: [{ id: 'demo-project', revisions: 2 }] });
      return answer(description);
    });
    panel(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show revisions of demo-project' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Show revisions of demo-project' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compare the two newest' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Compare the two newest' }));

    const report = await screen.findByLabelText('Revision comparison');
    expect(report).toHaveTextContent('2 changed.');
    expect(report).toHaveTextContent('+1 −0');
    /* The honest absence: no line count is offered for content that is not
     * text, rather than a number that looks like one. */
    expect(report).toHaveTextContent('not text, so no line count is offered');
  });

  it('forks under a name that says where it came from, leaving the original alone', async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        sent.push({ url, init });
        return answer({ revision: { id: '000001-f', parent: null, writtenAt: 't', note: '', files: { 'main.asm': 'd' } } }, 201);
      }
      if (/revisions\/[^/]+$/.test(url)) return answer({ files: { 'main.asm': encodeContent('LDA #2') } });
      if (url.endsWith('/revisions')) return answer({ revisions: twoRevisions });
      if (url.endsWith('/projects')) return answer({ projects: [{ id: 'demo-project', revisions: 2 }] });
      return answer(description);
    });
    const props = panel(fetcher as unknown as typeof fetch, { files: [{ name: 'main.asm', content: 'LDA #1' }] });

    await waitFor(() => expect(screen.getByRole('button', { name: /Fork instead, keeping both/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Fork instead, keeping both/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.url).toContain('demo-project-fork');
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/demo-project is untouched/));
  });
});

describe('getting work out and removing it', () => {
  const oneProject = { projects: [{ id: 'demo-project', revisions: 1 }] };

  it('offers the export beside the store’s own numbers, and takes nothing away', async () => {
    /* The moment somebody wonders whether to trust a store with their work is
     * the moment they should see they can take it back. */
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/export')) return answer({ schema: '8bit-net.project-store-export', projects: [] });
      if (url.endsWith('/revisions')) return answer({ revisions: [] });
      if (url.endsWith('/projects')) return answer(oneProject);
      return answer(description);
    });
    const onDownload = vi.fn();
    const props = panel(fetcher as unknown as typeof fetch, { onDownload });
    await waitFor(() => expect(screen.getByRole('button', { name: /Export everything, history included/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Export everything, history included/ }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith('project-store-export.json', expect.stringContaining('project-store-export')));
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Nothing was removed/));
  });

  it('does not offer an export nobody can be given', async () => {
    /* Without somewhere to put it the button would do nothing, and a control
     * that does nothing is worse than no control. */
    panel(vi.fn(async (input: unknown) => String(input).endsWith('/projects') ? answer(oneProject) : answer(description)) as unknown as typeof fetch, { onDownload: undefined });
    await waitFor(() => expect(screen.getByRole('button', { name: /Copy this project to the store/ })).toBeVisible());
    expect(screen.queryByRole('button', { name: /Export everything/ })).toBeNull();
  });

  it('asks before deleting, and says what survived', async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') { sent.push({ url, init }); return answer({ tombstone: { projectId: 'demo-project', revisions: 2, deletedAt: 't' } }); }
      if (url.endsWith('/revisions')) return answer({ revisions: [] });
      if (url.endsWith('/projects')) return answer(oneProject);
      return answer(description);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = panel(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete demo-project and every revision of it/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Delete demo-project and every revision of it/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    /* The store refuses a deletion that does not name what it means, so the
     * client sends it again. */
    expect(JSON.parse(String(sent[0]!.init.body)).confirmProjectId).toBe('demo-project');
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/A record of the deletion was kept/));
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Content other projects still use was not removed/));
    vi.restoreAllMocks();
  });

  it('deletes nothing when the question is answered no', async () => {
    const attempted: string[] = [];
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method) attempted.push(init.method);
      return String(input).endsWith('/projects') ? answer(oneProject) : answer(description);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    panel(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete demo-project/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Delete demo-project/ }));
    expect(attempted).not.toContain('DELETE');
    vi.restoreAllMocks();
  });
});

describe('warning before the store fills', () => {
  it('warns at four fifths and says what would free space', async () => {
    /* Learning a limit exists at the moment work is refused is the worst time
     * to learn it. */
    panel(vi.fn(async (input: unknown) => String(input).endsWith('/projects')
      ? answer({ projects: [] })
      : answer({ ...description, usage: { projects: 1, revisions: 1, bytes: 900 }, limits: { ownerBytes: 1000, ownerProjects: 10 } })) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByText(/90% full/)).toBeVisible());
    expect(screen.getByText(/free what only it held/)).toBeVisible();
  });

  it('says nothing while there is room, because a panel that always warns is not read', async () => {
    panel(vi.fn(async (input: unknown) => String(input).endsWith('/projects')
      ? answer({ projects: [] })
      : answer({ ...description, usage: { projects: 1, revisions: 1, bytes: 10 }, limits: { ownerBytes: 1000, ownerProjects: 10 } })) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByRole('button', { name: /Copy this project to the store/ })).toBeVisible());
    expect(screen.queryByText(/full/)).toBeNull();
  });
});
