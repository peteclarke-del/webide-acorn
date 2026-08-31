/*
 * Talking to the project store, and being honest about what it is.
 *
 * There is one identity and nothing proves it, so this is storage on a machine
 * somebody already controls rather than an account. The client says so from the
 * server's own answer rather than assuming it, because a person deciding
 * whether to put work somewhere needs to know who else can read it.
 *
 * Local mode is complete without any of this. Every call therefore has to fail
 * in a way the workbench can carry on from: a store that is not there is a
 * fact to report, not an error to throw at somebody who never asked for it.
 */

/** What the store said about itself. */
export interface StoreIdentity {
  owner: string;
  authenticated: boolean;
  detail: string;
}

export interface StoreUsage {
  projects: number;
  revisions: number;
  bytes: number;
  limits: Record<string, number>;
}

export interface StoredProject {
  id: string;
  revisions: number;
}

export interface StoredRevision {
  id: string;
  parent: string | null;
  writtenAt: string;
  note: string;
  files: number;
}

/** Either an answer or the reason there is none. Never a throw. */
export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; unreachable: boolean };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/*
 * A refusal the store explained, a transport that failed, and a server that is
 * not there are three different things, and only the last means "carry on
 * locally without mentioning it".
 */
async function call<T>(
  path: string,
  init: RequestInit,
  shape: (body: unknown) => T,
  fetcher: typeof fetch,
): Promise<StoreResult<T>> {
  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch (error) {
    return { ok: false, unreachable: true, reason: `The project store did not answer at ${path}. Local mode is unaffected: nothing here depends on it. (${error instanceof Error ? error.message : String(error)})` };
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const problem = (body as { error?: { message?: string; code?: string } } | null)?.error;
    /* The store's own wording, because it names the remedy and a status code
     * does not. A 404 from something that is not the store at all is reported
     * as unreachable rather than as a refusal it never made. */
    if (problem?.message) return { ok: false, unreachable: false, reason: problem.message };
    return { ok: false, unreachable: response.status === 404, reason: `The project store answered ${response.status} without explaining why.` };
  }
  try {
    return { ok: true, value: shape(body) };
  } catch (error) {
    return { ok: false, unreachable: false, reason: `The project store's answer was not the shape this build expects: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function requireObject(body: unknown, what: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`${what} was not an object`);
  return body as Record<string, unknown>;
}

export function readIdentity(body: unknown): { identity: StoreIdentity; usage: StoreUsage } {
  const root = requireObject(body, 'The store description');
  const identity = requireObject(root.identity, 'The store identity');
  const usage = requireObject(root.usage, 'The store usage');
  return {
    identity: {
      owner: String(identity.owner ?? ''),
      authenticated: identity.authenticated === true,
      detail: String(identity.detail ?? ''),
    },
    usage: {
      projects: Number(usage.projects ?? 0),
      revisions: Number(usage.revisions ?? 0),
      bytes: Number(usage.bytes ?? 0),
      limits: (root.limits ?? {}) as Record<string, number>,
    },
  };
}

export function readProjects(body: unknown): StoredProject[] {
  const root = requireObject(body, 'The project list');
  const projects = Array.isArray(root.projects) ? root.projects : [];
  return projects.map((entry) => {
    const project = requireObject(entry, 'A stored project');
    return { id: String(project.id ?? ''), revisions: Number(project.revisions ?? 0) };
  });
}

export function readRevisions(body: unknown): StoredRevision[] {
  const root = requireObject(body, 'The revision list');
  const revisions = Array.isArray(root.revisions) ? root.revisions : [];
  return revisions.map((entry) => {
    const revision = requireObject(entry, 'A revision');
    return {
      id: String(revision.id ?? ''),
      parent: revision.parent === null || revision.parent === undefined ? null : String(revision.parent),
      writtenAt: String(revision.writtenAt ?? ''),
      note: String(revision.note ?? ''),
      files: Number(revision.files ?? 0),
    };
  });
}

/** Bytes to base64 without assuming a Buffer or a huge call stack. */
export function encodeContent(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}

export function decodeContent(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class ProjectStoreClient {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly base = '/api/v1/store') {
  }

  describe(): Promise<StoreResult<{ identity: StoreIdentity; usage: StoreUsage }>> {
    return call(this.base, { method: 'GET' }, readIdentity, this.fetcher);
  }

  projects(): Promise<StoreResult<StoredProject[]>> {
    return call(`${this.base}/projects`, { method: 'GET' }, readProjects, this.fetcher);
  }

  revisions(projectId: string): Promise<StoreResult<StoredRevision[]>> {
    return call(`${this.base}/projects/${encodeURIComponent(projectId)}/revisions`, { method: 'GET' }, readRevisions, this.fetcher);
  }

  /** Write a revision. `parent` is the revision it was written against. */
  commit(projectId: string, files: Record<string, string>, parent: string | null, note: string): Promise<StoreResult<StoredRevision>> {
    const encoded: Record<string, string> = {};
    for (const [name, text] of Object.entries(files)) encoded[name] = encodeContent(text);
    return call(
      `${this.base}/projects/${encodeURIComponent(projectId)}/revisions`,
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ files: encoded, parent, note }) },
      (body) => {
        const root = requireObject(body, 'The written revision');
        const revision = requireObject(root.revision, 'The written revision');
        return {
          id: String(revision.id ?? ''),
          parent: revision.parent === null || revision.parent === undefined ? null : String(revision.parent),
          writtenAt: String(revision.writtenAt ?? ''),
          note: String(revision.note ?? ''),
          files: Object.keys(requireObject(revision.files, 'The revision manifest')).length,
        };
      },
      this.fetcher,
    );
  }

  read(projectId: string, revisionId: string): Promise<StoreResult<Record<string, string>>> {
    return call(
      `${this.base}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`,
      { method: 'GET' },
      (body) => {
        const root = requireObject(body, 'The revision content');
        const files = requireObject(root.files, 'The revision content');
        const decoded: Record<string, string> = {};
        for (const [name, encoded] of Object.entries(files)) decoded[name] = decodeContent(String(encoded));
        return decoded;
      },
      this.fetcher,
    );
  }
}
