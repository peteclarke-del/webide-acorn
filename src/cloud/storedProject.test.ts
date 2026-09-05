import { describe, expect, it } from 'vitest';
import { STORE_MANIFEST_FILENAME, isStoreManifest, projectFromStoredFiles, storedFilesFor } from './storedProject';
import { newProject } from '../project/project';

const projectWithWork = () => {
  const project = newProject();
  return {
    ...project,
    name: 'Harvest',
    files: [...project.files, { id: 'gfx', name: 'src/gfx.asm', content: '.hero\nEQUB 1\n', language: '6502' as const, modified: false }],
  };
};

describe('what a stored revision carries', () => {
  it('carries the project itself beside its sources', () => {
    const files = storedFilesFor(projectWithWork(), '2026-09-02T00:00:00Z');
    expect(Object.keys(files)).toContain('src/gfx.asm');
    expect(Object.keys(files)).toContain(STORE_MANIFEST_FILENAME);
    expect(isStoreManifest(STORE_MANIFEST_FILENAME)).toBe(true);
    expect(isStoreManifest('src/gfx.asm')).toBe(false);
  });

  it('opens a project back with the build targets it was stored with', () => {
    /* The whole point: a revision used to hold filenames against contents, so
     * opening one meant having its targets guessed again from the source. */
    const original = projectWithWork();
    const opened = projectFromStoredFiles(storedFilesFor(original, '2026-09-02T00:00:00Z'));
    expect(opened.project?.name).toBe('Harvest');
    expect(opened.project?.files.map((file) => file.name).sort()).toEqual(original.files.map((file) => file.name).sort());
    expect(opened.project?.buildTargets).toHaveLength(original.buildTargets.length);
    expect(opened.detail).toContain('Opened Harvest');
  });

  it('says plainly when a revision predates the manifest, rather than inventing one', () => {
    const opened = projectFromStoredFiles({ 'main.asm': 'RTS\n' });
    expect(opened.project).toBeNull();
    expect(opened.detail).toContain('no project manifest');
    expect(opened.detail).toContain('Import the files as a codebase');
  });

  it('reports a manifest that is not a bundle at all rather than throwing', () => {
    const opened = projectFromStoredFiles({ [STORE_MANIFEST_FILENAME]: 'not json' });
    expect(opened.project).toBeNull();
    expect(opened.detail).toContain('could not be opened');
  });

  it('refuses a revision whose contents no longer match what was recorded', () => {
    /* A digest that disagrees means the revision is not what was written, and
     * opening it silently would attribute somebody else's edits to its author. */
    const files = storedFilesFor(projectWithWork(), '2026-09-02T00:00:00Z');
    const bundle = JSON.parse(files[STORE_MANIFEST_FILENAME]!);
    bundle.project.files[0].content = `${bundle.project.files[0].content}; tampered`;
    const opened = projectFromStoredFiles({ ...files, [STORE_MANIFEST_FILENAME]: JSON.stringify(bundle) });
    expect(opened.project).toBeNull();
    expect(opened.detail).toContain('altered since it was created');
  });
});
