import { beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_DIRECTORY_FILES,
  directorySupport,
  pickDirectory,
  readDirectory,
  writeDirectory,
  type FileSystemDirectoryHandleLike,
} from './directoryAccess';
import { planCodebaseImport } from './codebaseImport';

/* jsdom does not define `isSecureContext`, and the picker legitimately requires
 * one. Declaring it here keeps the production check honest rather than relaxing
 * it to suit the test environment. */
beforeAll(() => {
  if (!('isSecureContext' in window)) Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

const secureContext = (secure: boolean) => Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });

/* A directory tree standing in for the real handles, built from a plain object
 * so a test states the folder it means rather than mocking call by call.
 * The file objects supply `size` and `text` directly, because a jsdom `File`
 * does not implement `text()` in every version and the walk depends on it. */
type Tree = { [name: string]: string | Uint8Array | Tree };

function directory(tree: Tree, name = 'project'): FileSystemDirectoryHandleLike {
  const writes: Array<{ path: string; content: string }> = [];
  const build = (node: Tree, prefix: string): FileSystemDirectoryHandleLike => ({
    name: prefix || name,
    kind: 'directory',
    async *entries() {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' || value instanceof Uint8Array) {
          const text = typeof value === 'string' ? value : String.fromCharCode(...value);
          yield [key, {
            name: key, kind: 'file' as const,
            getFile: async () => ({ size: text.length, text: async () => text }) as unknown as File,
            createWritable: async () => ({
              write: async (data: string) => { writes.push({ path: prefix ? `${prefix}/${key}` : key, content: String(data) }); },
              close: async () => undefined,
            }),
          }];
        } else {
          yield [key, build(value, prefix ? `${prefix}/${key}` : key)];
        }
      }
    },
    async getDirectoryHandle(child: string) {
      const value = node[child];
      if (value && typeof value === 'object' && !(value instanceof Uint8Array)) return build(value, prefix ? `${prefix}/${child}` : child);
      const created: Tree = {};
      node[child] = created;
      return build(created, prefix ? `${prefix}/${child}` : child);
    },
    async getFileHandle(child: string) {
      return {
        name: child, kind: 'file' as const,
        getFile: async () => ({ size: String(node[child] ?? '').length, text: async () => String(node[child] ?? '') }) as unknown as File,
        createWritable: async () => ({
          write: async (data: string) => { node[child] = String(data); writes.push({ path: prefix ? `${prefix}/${child}` : child, content: String(data) }); },
          close: async () => undefined,
        }),
      };
    },
    requestPermission: async () => 'granted' as PermissionState,
  });
  const handle = build(tree, '');
  (handle as FileSystemDirectoryHandleLike & { writes: typeof writes }).writes = writes;
  return handle;
}

describe('what this browser can do with a folder', () => {
  it('says a browser without the picker can still import, just not write back', () => {
    const support = directorySupport({});
    expect(support.available).toBe(false);
    expect(support.reason).toContain('Importing still works');
  });

  it('reports the secure-context requirement rather than failing at the picker', () => {
    secureContext(false);
    const support = directorySupport({ showDirectoryPicker: async () => directory({}) });
    expect(support.available).toBe(false);
    expect(support.reason).toContain('secure context');
    secureContext(true);
  });

  it('confirms availability when the picker is there', () => {
    expect(directorySupport({ showDirectoryPicker: async () => directory({}) }).available).toBe(true);
  });

  it('refuses to open a picker this browser does not have, with the reason', async () => {
    await expect(pickDirectory({} as Window)).rejects.toThrow(/cannot open a folder it can also write back to/);
  });

  it('treats a dismissed picker as no choice rather than an error', async () => {
    const target = { showDirectoryPicker: async () => { throw new DOMException('cancelled', 'AbortError'); } } as unknown as Window;
    await expect(pickDirectory(target)).resolves.toBeNull();
  });

  it('lets a real failure through rather than swallowing it', async () => {
    const target = { showDirectoryPicker: async () => { throw new DOMException('denied', 'SecurityError'); } } as unknown as Window;
    await expect(pickDirectory(target)).rejects.toThrow('denied');
  });
});

describe('reading a folder', () => {
  it('walks nested directories and keeps the path of every file', async () => {
    const result = await readDirectory(directory({
      'main.asm': 'ORG &1900\n',
      src: { 'helper.asm': 'RTS\n', assets: { 'sprite.asm': 'EQUB 0\n' } },
    }));
    expect(result.entries.map((entry) => entry.path).sort()).toEqual(['main.asm', 'src/assets/sprite.asm', 'src/helper.asm']);
    expect(result.entries.find((entry) => entry.path === 'src/helper.asm')!.content).toBe('RTS\n');
    expect(result.truncated).toBe(false);
  });

  it('hands the importer paths that keep their folders, and the importer keeps them', async () => {
    /* The two folder routes disagree about whether the chosen folder is in the
     * paths: a directory input reports MyGame/src/main.asm, while this one
     * walks from the handle and reports src/main.asm for the same folder. The
     * join between them is where a project lost its directories once, so it is
     * checked end to end rather than at either end. */
    const read = await readDirectory(directory({
      'Makefile': 'all:\n\tbeebasm -i src/main.asm -o game\n',
      src: { 'main.asm': 'ORG &1900\n.start\nINCLUDE "src/util.asm"\nRTS\n', 'util.asm': '.one\nRTS\n' },
      lib: { 'maths.asm': '.double\nASL A\nRTS\n' },
    }));
    const plan = planCodebaseImport(
      read.entries.map((entry) => ({ path: entry.path, content: entry.content })),
      'MyGame',
      { pathsIncludeChosenFolder: false },
    );

    expect(plan.files.map((file) => file.name).sort()).toEqual(['Makefile', 'lib/maths.asm', 'src/main.asm', 'src/util.asm']);
    expect(plan.files.every((file) => !file.renamedFrom)).toBe(true);
  });

  it('names the build directories it passed over rather than skipping them quietly', async () => {
    const result = await readDirectory(directory({
      'main.asm': 'RTS\n',
      node_modules: { 'huge.js': 'x' },
      '.git': { HEAD: 'ref' },
      dist: { 'out.bin': 'x' },
    }));
    expect(result.entries.map((entry) => entry.path)).toEqual(['main.asm']);
    expect(result.skipped.map((entry) => entry.path).sort()).toEqual(['.git', 'dist', 'node_modules']);
    expect(result.skipped[0]!.reason).toContain('build or tooling directory');
  });

  it('reports a file that is not text rather than importing rubbish', async () => {
    const result = await readDirectory(directory({
      'main.asm': 'RTS\n',
      'sprite.bin': new Uint8Array([0, 1, 2, 3]),
    }));
    expect(result.entries.map((entry) => entry.path)).toEqual(['main.asm']);
    expect(result.skipped).toEqual([{ path: 'sprite.bin', reason: 'not readable as text' }]);
  });

  it('says it stopped early rather than pretending it read everything', async () => {
    const many: Tree = {};
    for (let index = 0; index < MAX_DIRECTORY_FILES + 10; index += 1) many[`f${index}.asm`] = 'RTS\n';
    const result = await readDirectory(directory(many));
    expect(result.entries).toHaveLength(MAX_DIRECTORY_FILES);
    expect(result.truncated).toBe(true);
  });

  it('reports a file it could not read, with the reason', async () => {
    const handle = directory({ 'main.asm': 'RTS\n' });
    const original = handle.entries.bind(handle);
    handle.entries = async function* () {
      for await (const [name, child] of original()) {
        yield [name, { ...child, getFile: async () => { throw new Error('the file was removed'); } } as never];
      }
    };
    const result = await readDirectory(handle);
    expect(result.entries).toEqual([]);
    expect(result.skipped).toEqual([{ path: 'main.asm', reason: 'the file was removed' }]);
  });
});

describe('writing a project back', () => {
  it('writes every file, creating the directories it needs', async () => {
    const tree: Tree = {};
    const handle = directory(tree);
    const result = await writeDirectory(handle, [
      { path: 'main.asm', content: 'ORG &1900\n' },
      { path: 'src/helper.asm', content: 'RTS\n' },
    ]);
    expect(result.written).toEqual(['main.asm', 'src/helper.asm']);
    expect(result.failed).toEqual([]);
    expect(tree['main.asm']).toBe('ORG &1900\n');
    expect((tree.src as Tree)['helper.asm']).toBe('RTS\n');
  });

  it('writes nothing at all when permission is refused, and says so', async () => {
    const tree: Tree = {};
    const handle = directory(tree);
    handle.requestPermission = async () => 'denied' as PermissionState;
    await expect(writeDirectory(handle, [{ path: 'main.asm', content: 'RTS\n' }])).rejects.toThrow(/not granted, so nothing was saved/);
    expect(Object.keys(tree)).toEqual([]);
  });

  it('reports the files it could not write instead of failing the whole save', async () => {
    const handle = directory({});
    const original = handle.getFileHandle.bind(handle);
    handle.getFileHandle = async (name: string, options?: { create?: boolean }) => {
      if (name === 'locked.asm') throw new Error('the file is read-only');
      return original(name, options);
    };
    const result = await writeDirectory(handle, [
      { path: 'main.asm', content: 'RTS\n' },
      { path: 'locked.asm', content: 'RTS\n' },
    ]);
    expect(result.written).toEqual(['main.asm']);
    expect(result.failed).toEqual([{ path: 'locked.asm', reason: 'the file is read-only' }]);
  });

  it('refuses a path with no filename rather than writing somewhere unexpected', async () => {
    const result = await writeDirectory(directory({}), [{ path: 'src/', content: 'RTS\n' }, { path: '', content: 'x' }]);
    expect(result.written).toEqual([]);
    expect(result.failed).toEqual([
      { path: 'src/', reason: 'has no filename' },
      { path: '', reason: 'has no filename' },
    ]);
  });

  it('refuses a path that would climb out of the folder that was chosen', async () => {
    const tree: Tree = {};
    const result = await writeDirectory(directory(tree), [
      { path: '../escaped.asm', content: 'RTS\n' },
      { path: 'src/../../escaped.asm', content: 'RTS\n' },
      { path: './main.asm', content: 'RTS\n' },
    ]);
    expect(result.written).toEqual([]);
    expect(result.failed.map((entry) => entry.reason)).toEqual(['leaves the chosen folder', 'leaves the chosen folder', 'leaves the chosen folder']);
    expect(Object.keys(tree)).toEqual([]);
  });
});
