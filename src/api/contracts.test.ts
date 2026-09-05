// @vitest-environment node

/* That the clients and the description are the same API.
 *
 * Generating types from a description proves nothing on its own: a client can
 * import the generated module and still build its URLs from string literals,
 * which is what every client here did before. So the checks that matter are
 * about what the product does, not about what was generated — no caller may
 * spell an API path itself, every path a caller uses must be one the server
 * routes, and the generated module must match the description it came from.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { operations, renderContracts, renderSchema } from '../../scripts/apiDescription.mjs';
import { API_OPERATIONS, API_VERSION, apiPath, type ApiOperationId } from './contracts';

const root = join(__dirname, '../..');
const description = JSON.parse(readFileSync(join(root, 'api/openapi.json'), 'utf8'));

/** Every .ts and .tsx under src, except tests and the generated module itself. */
function productSources(directory = join(root, 'src')): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { found.push(...productSources(path)); continue; }
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
    if (path.endsWith('src/api/contracts.ts')) continue;
    found.push(path);
  }
  return found;
}

describe('the generated module and the description', () => {
  it('is exactly what the description produces', () => {
    /* The gate checks this too. It is asserted here as well so that a
     * description edited without regenerating fails in the suite a developer
     * runs, rather than only in the release. */
    expect(renderContracts(description)).toBe(readFileSync(join(root, 'src/api/contracts.ts'), 'utf8'));
  });

  it('carries every operation the description declares', () => {
    expect(Object.keys(API_OPERATIONS).sort()).toEqual(operations(description).map((entry) => entry.id).sort());
    expect(API_VERSION).toBe(description.info.version);
  });

  it('renders a construct it does not understand as an error rather than as unknown', () => {
    /* An unrecognised construct silently becoming `unknown` would turn a typed
     * field into an untyped one, which is the failure this whole exercise is
     * meant to prevent. */
    expect(() => renderSchema({ type: 'tuple' }, 'a test')).toThrow(/does not render/);
    expect(() => renderSchema({ allOf: [] }, 'a test')).toThrow(/does not render/);
  });

  it('declares no operation without a path the server could route', () => {
    for (const [id, operation] of Object.entries(API_OPERATIONS)) {
      expect(operation.path, id).toMatch(/^\/api\//);
      expect(['GET', 'POST', 'DELETE', 'PUT', 'PATCH'], id).toContain(operation.method);
    }
  });
});

describe('no client spells a path itself', () => {
  const sources = productSources();

  it('finds the product source it is meant to be reading', () => {
    /* A test that scanned nothing would pass. */
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((path) => path.endsWith('cloud/projectStoreClient.ts'))).toBe(true);
  });

  it('has no API path literal anywhere outside the generated module', () => {
    /* This is the check with teeth. Every one of these was a literal before:
     * five callers, each declaring for itself where a route lives, none of them
     * failing when the route moved. */
    const offenders = sources
      .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
      .filter((file) => /['"`]\/api\//.test(file.text))
      .map((file) => file.path.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it('names an operation for every route the description declares, so none is unreachable', () => {
    /* The other direction: a route nobody calls is either dead or a client
     * somebody forgot to write, and both are worth knowing about. */
    const text = sources.map((path) => readFileSync(path, 'utf8')).join('\n');
    const uncalled = Object.keys(API_OPERATIONS).filter((id) => !text.includes(`'${id}'`) && !text.includes(`"${id}"`));
    expect(uncalled, 'declared but called by nothing').toEqual([
      /* Routes the interface has no caller for yet. Named rather than omitted:
       * the store panel reads and writes but does not yet offer reclaiming
       * space or reading the tombstone list, and health/live is what the
       * container's own health check calls rather than the browser. */
      'healthLive', 'storeCollect', 'storeTombstones',
    ]);
  });
});

describe('building a path', () => {
  it('fills in parameters and encodes them', () => {
    expect(apiPath('storeProjects')).toBe('/api/v1/store/projects');
    expect(apiPath('storeRevisions', { projectId: 'demo' })).toBe('/api/v1/store/projects/demo/revisions');
    /* A slash in an identifier would otherwise address a different route. The
     * store refuses such a name, but the client should not be the reason it
     * never arrives to be refused. */
    expect(apiPath('storeRead', { projectId: 'a/b', revisionId: 'r 1' })).toBe('/api/v1/store/projects/a%2Fb/revisions/r%201');
  });

  it('refuses to send a path with a brace still in it', () => {
    expect(() => apiPath('storeRevisions' as ApiOperationId, {})).toThrow(/needs a projectId/);
  });

  it('leaves a path with no parameters alone', () => {
    for (const [id, operation] of Object.entries(API_OPERATIONS)) {
      if (operation.path.includes('{')) continue;
      expect(apiPath(id as ApiOperationId), id).toBe(operation.path);
    }
  });
});
