import { describe, expect, it } from 'vitest';
import type { ArmArtifact } from '../build/artifactTypes';
import { unzipSync } from 'fflate';
import { extractAdfsFile } from './adfsCatalogue';
import {
  addApplicationResource,
  applicationTree,
  createApplicationArchive,
  createApplicationDisc,
  createRiscOsAbsoluteApplication,
  removeApplicationResource,
  RISC_OS_FILETYPE_ABSOLUTE,
  RISC_OS_FILETYPE_OBEY,
  RISC_OS_FILETYPE_SPRITE,
  RISC_OS_FILETYPE_TEXT,
  validateRiscOsApplication,
} from './riscOsApplication';

const artifact = (update: Partial<ArmArtifact> = {}): ArmArtifact => ({
  kind: 'arm-binary', bytes: new Uint8Array([0x00, 0x00, 0xa0, 0xe1]), origin: 0x8000, entryPoint: 0x8000,
  processor: 'arm2', endianness: 'little', containerFormat: 'raw', riscOsFiletype: null,
  symbols: {}, sourceMap: {}, sourceLocations: {}, entryFileId: 'main', dependencies: [], sourceFiles: {}, diagnostics: [], listing: [], ...update,
});

describe('RISC OS application packaging', () => {
  it('wraps an &8000 ARM2 image in a typed application directory without relabelling the source artifact', () => {
    const source = artifact();
    const packaged = createRiscOsAbsoluteApplication(source, '!Demo');
    expect(packaged).toMatchObject({ schema: '8bit-net.riscos-application', version: 2, rootDirectory: '!Demo', executableFormat: 'absolute', executableLoadAddress: 0x8000, executablePath: '!Demo.RunImage', launchPath: '!Demo' });
    expect(packaged.files.map(({ path, filetype, hostFsPath }) => ({ path, filetype, hostFsPath }))).toEqual([
      { path: '!Demo/!Run', filetype: RISC_OS_FILETYPE_OBEY, hostFsPath: '!Demo/!Run,feb' },
      { path: '!Demo/RunImage', filetype: RISC_OS_FILETYPE_ABSOLUTE, hostFsPath: '!Demo/RunImage,ff8' },
    ]);
    expect(new TextDecoder().decode(packaged.files[0]!.bytes)).toBe('Run <Obey$Dir>.RunImage %*0\n');
    expect(packaged.files[1]!.bytes).toEqual(source.bytes);
    expect(packaged.files[1]!.bytes).not.toBe(source.bytes);
    expect(source.riscOsFiletype).toBeNull();
    expect(() => validateRiscOsApplication(packaged)).not.toThrow();
  });

  it('rejects inputs that FileSwitch cannot truthfully run as an Absolute file', () => {
    expect(() => createRiscOsAbsoluteApplication(artifact({ origin: 0x9000 }), 'Demo')).toThrow('&00008000');
    expect(() => createRiscOsAbsoluteApplication(artifact({ entryPoint: 0x8004 }), 'Demo')).toThrow('&00008000');
    expect(() => createRiscOsAbsoluteApplication(artifact({ bytes: new Uint8Array() }), 'Demo')).toThrow('empty');
    expect(() => createRiscOsAbsoluteApplication(artifact({ diagnostics: [{ line: 1, column: 1, severity: 'error', message: 'bad' }] }), 'Demo')).toThrow('build errors');
  });

  it('enforces old FileCore-compatible leaf names and detects metadata loss', () => {
    expect(() => createRiscOsAbsoluteApplication(artifact(), '1Demo')).toThrow('beginning with a letter');
    expect(() => createRiscOsAbsoluteApplication(artifact(), 'Application')).toThrow('1–9');
    const packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    packaged.files[1]!.hostFsPath = '!Demo/RunImage';
    expect(() => validateRiscOsApplication(packaged)).toThrow('metadata suffix');
  });

  it('carries an application whose files are not just !Run and RunImage', () => {
    /* The two-file application was the smallest thing FileSwitch would launch.
     * Nobody ships one: a real application has a !Boot so the Filer knows about
     * it before it is run, a !Sprites so it has an icon, and resources. */
    let packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    packaged = addApplicationResource(packaged, '!Boot', new TextEncoder().encode('Set Demo$Dir <Obey$Dir>\n'), RISC_OS_FILETYPE_OBEY);
    packaged = addApplicationResource(packaged, '!Sprites', new Uint8Array(64).fill(1), RISC_OS_FILETYPE_SPRITE);
    packaged = addApplicationResource(packaged, 'Resources/Messages', new TextEncoder().encode('Hello:World\n'), RISC_OS_FILETYPE_TEXT);
    expect(packaged.files.map((file) => file.path)).toEqual([
      '!Demo/!Run', '!Demo/RunImage', '!Demo/!Boot', '!Demo/!Sprites', '!Demo/Resources/Messages',
    ]);
    expect(packaged.files[4]!.hostFsPath).toBe('!Demo/Resources/Messages,fff');
    expect(() => validateRiscOsApplication(packaged)).not.toThrow();
  });

  it('will not let a name RISC OS decides carry the wrong type', () => {
    const packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    expect(() => addApplicationResource(packaged, '!Sprites', new Uint8Array(4), RISC_OS_FILETYPE_TEXT)).toThrow(/must have RISC OS filetype &FF9/);
    expect(() => addApplicationResource(packaged, '!Boot', new Uint8Array(4), RISC_OS_FILETYPE_TEXT)).toThrow(/must have RISC OS filetype &FEB/);
  });

  it('refuses a resource that would collide, be empty, or sit outside the application', () => {
    const packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    expect(() => addApplicationResource(packaged, 'runimage', new Uint8Array(4), RISC_OS_FILETYPE_TEXT)).toThrow(/does not distinguish names by case/);
    expect(() => addApplicationResource(packaged, 'Empty', new Uint8Array(), RISC_OS_FILETYPE_TEXT)).toThrow(/is empty/);
    expect(() => addApplicationResource(packaged, 'A.B', new Uint8Array(4), RISC_OS_FILETYPE_TEXT)).toThrow(/path or wildcard character/);
    expect(() => addApplicationResource(packaged, 'AVeryLongNameIndeed', new Uint8Array(4), RISC_OS_FILETYPE_TEXT)).toThrow(/at most 10 characters/);
  });

  it('refuses a tree where one path is both a file and a directory', () => {
    let packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    packaged = addApplicationResource(packaged, 'Res', new Uint8Array(4), RISC_OS_FILETYPE_TEXT);
    expect(() => addApplicationResource(packaged, 'Res/Deeper', new Uint8Array(4), RISC_OS_FILETYPE_TEXT)).toThrow(/both a file and a directory/);
  });

  it('will not remove what makes it an application', () => {
    let packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    expect(() => removeApplicationResource(packaged, '!Demo/!Run')).toThrow(/cannot be removed/);
    expect(() => removeApplicationResource(packaged, '!Demo/RunImage')).toThrow(/cannot be removed/);
    expect(() => removeApplicationResource(packaged, '!Demo/Nothing')).toThrow(/holds nothing at/);
    packaged = addApplicationResource(packaged, 'Notes', new Uint8Array(4).fill(9), RISC_OS_FILETYPE_TEXT);
    expect(removeApplicationResource(packaged, '!Demo/Notes').files.map((file) => file.path)).toEqual(['!Demo/!Run', '!Demo/RunImage']);
  });

  it('derives one tree from the paths rather than storing a second description of it', () => {
    let packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    packaged = addApplicationResource(packaged, 'Resources/Sprites22', new Uint8Array(8).fill(2), RISC_OS_FILETYPE_SPRITE);
    const [root] = applicationTree(packaged) as [{ name: string; children: Array<{ name: string; children?: unknown[] }> }];
    expect(root.name).toBe('!Demo');
    expect(root.children.map((child) => child.name)).toEqual(['!Run', 'RunImage', 'Resources']);
    expect((root.children[2] as { children: Array<{ name: string }> }).children.map((child) => child.name)).toEqual(['Sprites22']);
  });

  it('writes the whole application onto an ADFS E disc, subdirectories and all', () => {
    /* The transfer path for a machine with no HostFS. It is the same disc
     * writer the media workspace uses, so the image is read back through this
     * build's own parser before it is handed over. */
    let packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    const messages = new TextEncoder().encode('Hello:World\n');
    packaged = addApplicationResource(packaged, 'Resources/Messages', messages, RISC_OS_FILETYPE_TEXT);
    const created = createApplicationDisc(packaged, 'DemoDisc');
    expect(created.catalogue.warnings).toEqual([]);
    expect(created.image).toHaveLength(819200);
    const application = created.catalogue.entries[0]!;
    expect(application.name).toBe('!Demo');
    expect(application.directory).toBe(true);
    const resources = application.children!.find((entry) => entry.name === 'Resources')!;
    const onDisc = resources.children!.find((entry) => entry.name === 'Messages')!;
    expect(onDisc.filetype).toBe(RISC_OS_FILETYPE_TEXT);
    expect(Array.from(extractAdfsFile(created.image, onDisc))).toEqual(Array.from(messages));
  });

  it('archives the application with its filetypes in the names, so they survive a machine that knows nothing about RISC OS', () => {
    let packaged = createRiscOsAbsoluteApplication(artifact(), 'Demo');
    packaged = addApplicationResource(packaged, 'Resources/Messages', new TextEncoder().encode('Hello\n'), RISC_OS_FILETYPE_TEXT);
    const archive = createApplicationArchive(packaged);
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual(['!Demo/!Run,feb', '!Demo/Resources/Messages,fff', '!Demo/RunImage,ff8']);
    expect(new TextDecoder().decode(entries['!Demo/RunImage,ff8']!)).toBe(new TextDecoder().decode(packaged.files[1]!.bytes));
    /* Same input, same archive: a transfer container nobody has to diff by eye. */
    expect(Array.from(createApplicationArchive(packaged))).toEqual(Array.from(archive));
  });
});
