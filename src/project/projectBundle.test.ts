import { describe, expect, it } from 'vitest';
import { newProject, PROJECT_FORMAT, type LocalProject } from './project';
import {
  PROJECT_BUNDLE_SCHEMA,
  PROJECT_BUNDLE_VERSION,
  bundleSummary,
  createProjectBundle,
  findPossibleSecrets,
  openProjectBundle,
  projectDigest,
} from './projectBundle';

const NOW = '2026-08-28T00:00:00.000Z';

function project(overrides: Partial<LocalProject> = {}): LocalProject {
  const base = newProject();
  const main = { ...base.files[0]!, id: 'main', name: 'main.asm', language: '6502' as const, content: 'ORG &1900\n.start\nRTS\n' };
  return {
    ...base,
    name: 'Bundle probe',
    files: [main],
    buildTargets: [{ ...base.buildTargets[0]!, id: 'cpu', name: 'cpu', entryFileId: 'main', sourceFileIds: ['main'], toolchainId: '8bit-net.asm.6502' }],
    activeBuildTargetId: 'cpu',
    ...overrides,
  };
}

const bundleOf = (input = project()) => createProjectBundle(input, { createdAt: NOW });
const serialise = (bundle: ReturnType<typeof bundleOf>) => JSON.stringify(bundle);

describe('creating a project bundle', () => {
  it('records a digest for the project and for every file it carries', () => {
    const bundle = bundleOf();
    expect(bundle.schema).toBe(PROJECT_BUNDLE_SCHEMA);
    expect(bundle.createdAt).toBe(NOW);
    expect(bundle.producedBy.projectFormat).toBe(PROJECT_FORMAT);
    expect(bundle.integrity.projectSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.integrity.files).toEqual([
      { id: 'main', name: 'main.asm', bytes: 21, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it('produces the same bundle for the same project, so a digest is meaningful', () => {
    expect(serialise(bundleOf())).toBe(serialise(bundleOf()));
  });

  it('reports what the project needs in order to build', () => {
    const bundle = bundleOf();
    expect(bundle.dependencies.toolchains).toEqual(['8bit-net.asm.6502']);
    expect(bundle.dependencies.buildTargets).toEqual([
      { id: 'cpu', name: 'cpu', toolchainId: '8bit-net.asm.6502', entryFileName: 'main.asm' },
    ]);
    expect(bundle.dependencies.machine.machineId).toBe('bbc-b');
    expect(bundle.dependencies.missingSources).toEqual([]);
  });

  it('names a source a build target expects but the bundle does not contain', () => {
    const broken = project();
    broken.buildTargets[0]!.sourceFileIds = ['main', 'sprites'];
    const bundle = createProjectBundle(broken, { createdAt: NOW });
    expect(bundle.dependencies.missingSources).toEqual(['cpu names source file sprites']);
    expect(bundleSummary(bundle)).toContain('1 missing source reference');
  });

  it('states what is deliberately not in the bundle, rather than leaving it to be discovered', () => {
    const excluded = bundleOf().excluded.map((entry) => entry.what);
    expect(excluded).toContain('ROM and firmware images');
    expect(excluded).toContain('Build artifacts');
    expect(excluded).toContain('Browser settings');
    expect(excluded).toContain('Test history');
  });

  it('counts the private bookmarks it held back', () => {
    const withBookmarks = project({
      bookmarks: [
        { id: 'a', fileId: 'main', line: 1, column: 1, name: 'shared', description: '', scope: 'project', enabled: true, anchor: '.start' },
        { id: 'b', fileId: 'main', line: 2, column: 1, name: 'mine', description: '', scope: 'private', enabled: true, anchor: 'RTS' },
      ],
    });
    const held = createProjectBundle(withBookmarks, { createdAt: NOW });
    expect(held.excluded.find((entry) => entry.what === 'Private bookmarks')).toMatchObject({ count: 1 });
    expect(held.project.bookmarks).toHaveLength(1);

    const included = createProjectBundle(withBookmarks, { createdAt: NOW, includePrivateBookmarks: true });
    expect(included.excluded.some((entry) => entry.what === 'Private bookmarks')).toBe(false);
    expect(included.project.bookmarks).toHaveLength(2);
  });
});

describe('finding things that should not be exported', () => {
  it('reports a credential without repeating its value', () => {
    const found = findPossibleSecrets([
      { name: 'notes.txt', content: 'the api_key = s3cr3t-value-not-for-export\nnothing else' },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ fileName: 'notes.txt', line: 1, kind: 'assigned password' });
    expect(found[0]!.masked).not.toContain('s3cr3t-value-not-for-export');
  });

  it('recognises keys, headers, connection strings and cloud credentials', () => {
    const kinds = findPossibleSecrets([
      { name: 'a', content: '-----BEGIN RSA PRIVATE KEY-----' },
      { name: 'b', content: 'Authorization: Bearer abcdefghijklmnop' },
      { name: 'c', content: 'postgres://user:hunter2@host/db' },
      { name: 'd', content: 'AKIAIOSFODNN7EXAMPLE' },
    ]).map((entry) => entry.kind);
    expect(kinds).toEqual(['private key', 'authorization header', 'connection string', 'AWS access key']);
  });

  it('does not cry wolf over ordinary Acorn assembly', () => {
    expect(findPossibleSecrets([
      { name: 'main.asm', content: 'ORG &1900\n.start\nLDA #&41\nJSR &FFEE\nEQUB &DE,&AD,&BE,&EF\nRTS\n' },
      { name: 'notes.md', content: 'The screen sits at &5800 and the key token is described on page 12.' },
    ])).toEqual([]);
  });

  it('reports rather than removes, so the author decides', () => {
    const risky = project();
    risky.files[0]!.content = 'password = correcthorsebattery\nRTS\n';
    const bundle = createProjectBundle(risky, { createdAt: NOW });
    expect(bundle.possibleSecrets).toHaveLength(1);
    expect(bundle.project.files[0]!.content).toContain('correcthorsebattery');
    expect(bundleSummary(bundle)).toContain('1 possible secret to review');
  });
});

describe('opening a project bundle', () => {
  it('returns the project when everything matches', () => {
    const result = openProjectBundle(serialise(bundleOf()));
    expect(result.project.name).toBe('Bundle probe');
    expect(result.corrupted).toEqual([]);
    expect(result.migratedFrom).toBeNull();
  });

  it('refuses a file that is not a bundle, naming what is wrong', () => {
    expect(() => openProjectBundle('not json')).toThrow(/not valid JSON/);
    expect(() => openProjectBundle('{}')).toThrow(/must declare schema/);
    expect(() => openProjectBundle(JSON.stringify({ schema: PROJECT_BUNDLE_SCHEMA, version: 9 }))).toThrow(/newer version of the workbench/);
    expect(() => openProjectBundle(JSON.stringify({ schema: PROJECT_BUNDLE_SCHEMA, version: 0 }))).toThrow(/version 1 is required/);
    expect(() => openProjectBundle(JSON.stringify({ schema: PROJECT_BUNDLE_SCHEMA, version: 1 }))).toThrow(/carries no project/);
    expect(() => openProjectBundle(JSON.stringify({ schema: PROJECT_BUNDLE_SCHEMA, version: 1, project: { format: PROJECT_FORMAT } }))).toThrow(/no integrity manifest/);
  });

  it('refuses a bundle whose project was edited after it was created', () => {
    const bundle = bundleOf();
    bundle.project.name = 'Someone else’s edit';
    expect(() => openProjectBundle(serialise(bundle))).toThrow(/has been altered since it was created/);
  });

  it('refuses a bundle whose file content no longer matches its manifest', () => {
    const bundle = bundleOf();
    bundle.project.files[0]!.content = 'RTS\n';
    /* Repair the project digest so only the per-file check can catch it, which
     * is the case a whole-project digest alone would miss. */
    const tampered = JSON.parse(serialise(bundle));
    tampered.integrity.projectSha256 = projectDigest(tampered.project);
    expect(() => openProjectBundle(JSON.stringify(tampered))).toThrow(/does not match its recorded digest/);
  });

  it('refuses a bundle carrying a file its manifest never mentioned', () => {
    const bundle = bundleOf();
    bundle.project.files.push({ ...bundle.project.files[0]!, id: 'smuggled', name: 'smuggled.asm' });
    const tampered = JSON.parse(serialise(bundle));
    tampered.integrity.projectSha256 = projectDigest(tampered.project);
    expect(() => openProjectBundle(JSON.stringify(tampered))).toThrow(/not in its manifest/);
  });

  it('reports the older format a bundle was migrated from', () => {
    const bundle = bundleOf();
    const older = JSON.parse(serialise(bundle));
    older.project.format = '8bit-net-dev-project-13';
    /* Re-digest so the older project is genuinely what its manifest records. */
    older.integrity.projectSha256 = projectDigest(older.project);
    const result = openProjectBundle(JSON.stringify(older));
    expect(result.migratedFrom).toBe('8bit-net-dev-project-13');
    expect(result.project.format).toBe(PROJECT_FORMAT);
  });

  it('summarises what a bundle contains', () => {
    expect(bundleSummary(bundleOf())).toBe('1 file · 1 build target · 1 toolchain');
  });
});

describe('a bundle from a build that is not this one', () => {
  it('tells someone with a newer bundle to update rather than calling it malformed', () => {
    const newer = JSON.stringify({ ...bundleOf(), version: PROJECT_BUNDLE_VERSION + 1 });
    expect(() => openProjectBundle(newer)).toThrow(/newer version of the workbench \(bundle version 2; this build reads version 1\)/);
  });

  it('still refuses a version that is not one this product ever wrote', () => {
    expect(() => openProjectBundle(JSON.stringify({ ...bundleOf(), version: 0 }))).toThrow(/version 1 is required, not 0/);
    expect(() => openProjectBundle(JSON.stringify({ ...bundleOf(), version: 'one' }))).toThrow(/version 1 is required, not one/);
  });
});
