// @vitest-environment node

/* The store is optional, so the client's behaviour when it is absent or
 * refusing matters more than its behaviour when everything works. */
import { describe, expect, it, vi } from 'vitest';
import { ProjectStoreClient, decodeContent, encodeContent } from './projectStoreClient';

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('when the store is not there', () => {
  it('reports it as unreachable and says local mode is unaffected', async () => {
    /* A person who never asked for a server should not be told something
     * broke. */
    const client = new ProjectStoreClient(vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    const result = await client.describe();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unreachable).toBe(true);
    expect(result.reason).toMatch(/Local mode is unaffected/);
  });

  it('treats a 404 from something that is not the store as absence, not a refusal it never made', async () => {
    const client = new ProjectStoreClient(vi.fn(async () => new Response('<html>', { status: 404 })) as unknown as typeof fetch);
    const result = await client.projects();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unreachable).toBe(true);
  });
});

describe('when the store refuses', () => {
  it('carries the store’s own wording rather than a status code', async () => {
    /* The store names the remedy — read the head and merge — and a 409 does
     * not. */
    const client = new ProjectStoreClient(vi.fn(async () => answer({
      error: { code: 'REVISION_STALE_PARENT', message: 'This revision was written against nothing but the project is now at 000001-abc. Read the head and merge, or fork from the parent.' },
    }, 409)) as unknown as typeof fetch);
    const result = await client.commit('demo', { 'a.asm': 'x' }, null, '');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unreachable).toBe(false);
    expect(result.reason).toMatch(/Read the head and merge/);
  });

  it('says so plainly when a refusal came with no explanation', async () => {
    const client = new ProjectStoreClient(vi.fn(async () => answer({}, 500)) as unknown as typeof fetch);
    const result = await client.describe();
    if (!result.ok) expect(result.reason).toMatch(/answered 500 without explaining why/);
  });

  it('refuses an answer of the wrong shape rather than inventing the missing parts', async () => {
    const client = new ProjectStoreClient(vi.fn(async () => answer({ nothing: true })) as unknown as typeof fetch);
    const result = await client.describe();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not the shape this build expects/);
  });
});

describe('what the store says about itself', () => {
  it('reports the identity from the server rather than assuming one', async () => {
    /* Whether anything proves who you are decides who else can read this, so
     * it is read from the answer and not hardcoded hopefully. */
    const client = new ProjectStoreClient(vi.fn(async () => answer({
      identity: { owner: 'local', authenticated: false, detail: 'One local identity.' },
      usage: { projects: 2, revisions: 5, bytes: 1024 },
      limits: { ownerBytes: 100 },
    })) as unknown as typeof fetch);
    const result = await client.describe();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identity).toEqual({ owner: 'local', authenticated: false, detail: 'One local identity.' });
    expect(result.value.usage.revisions).toBe(5);
    expect(result.value.usage.limits.ownerBytes).toBe(100);
  });

  it('lists projects and revisions in the shape the panel needs', async () => {
    const client = new ProjectStoreClient(vi.fn(async (input) => String(input).endsWith('/projects')
      ? answer({ projects: [{ id: 'demo', revisions: 3 }] })
      : answer({ revisions: [{ id: '000001-a', parent: null, writtenAt: 'then', note: 'first', files: 4 }] })) as unknown as typeof fetch);
    expect((await client.projects() as { value: unknown }).value).toEqual([{ id: 'demo', revisions: 3 }]);
    expect((await client.revisions('demo') as { value: unknown }).value).toEqual([
      { id: '000001-a', parent: null, writtenAt: 'then', note: 'first', files: 4 },
    ]);
  });
});

describe('carrying content there and back', () => {
  it('round-trips text that is not plain ASCII', async () => {
    /* Source carries names, comments and Acorn characters; content that only
     * survived ASCII would corrupt quietly. */
    const text = 'LDA #&41 ; “curly” — Ünïcödé ✓\n';
    expect(decodeContent(encodeContent(text))).toBe(text);
  });

  it('sends every file encoded and names the parent it was written against', async () => {
    const sent: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: unknown, init: RequestInit) => {
      sent.push(init);
      return answer({ revision: { id: '1', parent: 'p', writtenAt: 't', note: 'n', files: { 'a.asm': 'd' } } }, 201);
    });
    const client = new ProjectStoreClient(fetcher as unknown as typeof fetch);
    await client.commit('demo', { 'a.asm': 'RTS' }, 'p', 'a note');
    const body = JSON.parse(String(sent[0]!.body));
    expect(body.parent).toBe('p');
    expect(body.note).toBe('a note');
    expect(decodeContent(body.files['a.asm'])).toBe('RTS');
  });

  it('decodes what a revision holds', async () => {
    const client = new ProjectStoreClient(vi.fn(async () => answer({ files: { 'a.asm': encodeContent('RTS') } })) as unknown as typeof fetch);
    const result = await client.read('demo', '000001-a');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ 'a.asm': 'RTS' });
  });
});
