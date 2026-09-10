import { describe, expect, it } from 'vitest';
import {
  PROJECT_MANIFEST_FILENAME,
  buildTargetsFromManifest,
  diskSetsFromManifest,
  manifestFromProject,
  parseProjectManifest,
  serializeProjectManifest,
} from './projectManifest';
import { newProject, parseProject, PROJECT_FORMAT, createProjectFile } from './project';
import { createBuildTarget } from '../build/buildTarget';
import { planCodebaseImport, projectFromCodebaseImport, type CodebaseFileInput } from './codebaseImport';

/*
 * A project that lives in a folder.
 *
 * Written back, a project was only ever its source files, so a folder opened
 * again had its machine guessed from the source and its build targets proposed
 * afresh. A game for a Model B with a second processor, a NuLA and a BeebSID
 * came back as a Model B with a DFS. The manifest is what makes the folder the
 * whole project, and these hold it to that.
 */

const MANIFEST = {
  format: PROJECT_FORMAT,
  name: 'FireWing',
  target: { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'Model B · 1770 DFS', romId: 'os12-basic2-adfs', enabledCapabilities: ['adfs', 'sideways', 'videonula', 'beebsid', 'beebscsi', 'tube', 'tube-turbo'] },
  buildTargets: [
    { id: 'host', name: 'FireWing host', entryFile: 'src/host.asm', toolchainId: '8bit-net.asm.6502', outputName: 'FIREW.bin', memoryLayout: { defaultOrigin: '&1900', maximumAddress: '&57FF' } },
    { id: 'parasite', name: 'FireWing second processor', entryFile: 'src/parasite.asm', toolchainId: '8bit-net.asm.6502', outputName: 'FIREWT.bin', processor: 'parasite', memoryLayout: { defaultOrigin: '&0800', maximumAddress: '&7FFF' } },
  ],
  activeBuildTargetId: 'parasite',
  settings: {},
};

const FOLDER: CodebaseFileInput[] = [
  { path: PROJECT_MANIFEST_FILENAME, content: JSON.stringify(MANIFEST) },
  { path: 'src/host.asm', content: 'ORG &1900\n.start\nRTS\n' },
  { path: 'src/parasite.asm', content: 'ORG &0800\n.start\nRTS\n' },
  { path: 'README.md', content: '# FireWing\n' },
];

describe('reading a project manifest', () => {
  it('reads the machine, its capabilities, the build targets and the active one', () => {
    const manifest = parseProjectManifest(JSON.stringify(MANIFEST));
    expect(manifest.name).toBe('FireWing');
    expect(manifest.target.machineId).toBe('bbc-b');
    expect(manifest.target.enabledCapabilities).toContain('tube-turbo');
    expect(manifest.buildTargets.map((target) => target.id)).toEqual(['host', 'parasite']);
    expect(manifest.buildTargets[1]!.processor).toBe('parasite');
    expect(manifest.activeBuildTargetId).toBe('parasite');
  });

  it('refuses a file that is not a project manifest, so an unrelated file cannot become the machine', () => {
    expect(() => parseProjectManifest('{"name":"x"}')).toThrow(/does not declare an 8bit-net project format/);
    expect(() => parseProjectManifest('not json')).toThrow(/not valid JSON/);
    expect(() => parseProjectManifest('[]')).toThrow(/not a JSON object/);
  });

  it('drops a build target with no entry file or an unknown toolchain, and keeps the rest', () => {
    const manifest = parseProjectManifest(JSON.stringify({ ...MANIFEST, buildTargets: [
      { id: 'a', name: 'No entry', toolchainId: '8bit-net.asm.6502', outputName: 'a.bin' },
      { id: 'b', name: 'No such toolchain', entryFile: 'x.asm', toolchainId: 'nobody.made-this', outputName: 'b.bin' },
      MANIFEST.buildTargets[0],
    ] }));
    expect(manifest.buildTargets.map((target) => target.id)).toEqual(['host']);
  });

  it('gives two targets with one identifier different ones rather than letting the second replace the first', () => {
    const manifest = parseProjectManifest(JSON.stringify({ ...MANIFEST, buildTargets: [MANIFEST.buildTargets[0], { ...MANIFEST.buildTargets[1], id: 'host' }] }));
    expect(manifest.buildTargets.map((target) => target.id)).toEqual(['host', 'host-2']);
  });

  it('ignores an active target that names nothing rather than pointing at a target that is not there', () => {
    expect(parseProjectManifest(JSON.stringify({ ...MANIFEST, activeBuildTargetId: 'nowhere' })).activeBuildTargetId).toBeNull();
  });
});

describe('a folder that carries its manifest', () => {
  it('is planned as the machine the manifest names, not the one the source suggests', () => {
    const plan = planCodebaseImport(FOLDER, 'FireWing', { pathsIncludeChosenFolder: false });
    expect(plan.manifest?.target.machineId).toBe('bbc-b');
    expect(plan.name).toBe('FireWing');
    /* The manifest is read, not imported as a source file. */
    expect(plan.files.map((file) => file.name)).not.toContain(PROJECT_MANIFEST_FILENAME);
    expect(plan.exclusions.find((entry) => entry.path === PROJECT_MANIFEST_FILENAME)?.reason).toBe('project-manifest');
  });

  it('opens as the project the manifest describes, with the second-processor target active', () => {
    const plan = planCodebaseImport(FOLDER, 'FireWing', { pathsIncludeChosenFolder: false });
    const contents = new Map(FOLDER.filter((input) => input.path !== PROJECT_MANIFEST_FILENAME).map((input) => [input.path, input.content]));
    const project = projectFromCodebaseImport(plan, contents);
    expect(project.name).toBe('FireWing');
    expect(project.target.enabledCapabilities).toEqual(expect.arrayContaining(['videonula', 'beebsid', 'beebscsi', 'tube', 'tube-turbo']));
    expect(project.buildTargets.map((target) => target.name)).toEqual(['FireWing host', 'FireWing second processor']);
    expect(project.activeBuildTargetId).toBe('parasite');
    const parasite = project.buildTargets.find((target) => target.id === 'parasite')!;
    expect(parasite.memoryLayout.defaultOrigin).toBe('&0800');
    expect(project.files.find((file) => file.id === parasite.entryFileId)?.name).toBe('src/parasite.asm');
    /* Which processor a target runs on is carried through to the author form
     * the project parser migrates. Whether the parser keeps it is the build
     * target schema's business, not this module's, and is asserted there. */
    const idFor = new Map(project.files.map((file) => [file.name, file.id]));
    const authored = buildTargetsFromManifest(plan.manifest!, idFor).targets.find((target) => target.id === 'parasite')!;
    expect(authored.processor).toBe('parasite');
  });

  it('leaves out a manifest build target whose entry file is not in the folder, and says so', () => {
    const withoutParasite = FOLDER.filter((input) => input.path !== 'src/parasite.asm');
    const plan = planCodebaseImport(withoutParasite, 'FireWing', { pathsIncludeChosenFolder: false });
    expect(plan.warnings.join(' ')).toContain('src/parasite.asm is not in the folder');
    const contents = new Map(withoutParasite.filter((input) => input.path !== PROJECT_MANIFEST_FILENAME).map((input) => [input.path, input.content]));
    const project = projectFromCodebaseImport(plan, contents);
    expect(project.buildTargets.map((target) => target.id)).toEqual(['host']);
  });

  it('still guesses the machine for a folder that has no manifest, as before', () => {
    const plan = planCodebaseImport(FOLDER.filter((input) => input.path !== PROJECT_MANIFEST_FILENAME), 'Plain', { pathsIncludeChosenFolder: false });
    expect(plan.manifest).toBeNull();
    expect(plan.name).toBe('Plain');
  });

  it('reports a manifest it cannot read rather than importing it as source or ignoring it', () => {
    const plan = planCodebaseImport([{ path: PROJECT_MANIFEST_FILENAME, content: '{"nothing": true}' }, FOLDER[1]!], 'Odd', { pathsIncludeChosenFolder: false });
    expect(plan.manifest).toBeNull();
    expect(plan.warnings.join(' ')).toContain('was not read as a project manifest');
    expect(plan.files.map((file) => file.name)).not.toContain(PROJECT_MANIFEST_FILENAME);
  });
});

const DISK_SET = {
  schema: '8bit-net.disk-set', version: 1, id: 'release', name: 'Release',
  discs: [{ id: 'd1', label: 'Game', format: 'dfs-ssd', sides: [{
    title: 'GAME',
    entries: [
      { id: 'boot', name: '!BOOT', directory: '$', source: { kind: 'generated-boot' } },
      { id: 'host', name: 'FIREW', directory: '$', source: { kind: 'build-target', targetId: 'host' } },
      { id: 'notes', name: 'NOTES', directory: '$', source: { kind: 'project-file', fileId: 'README.md' } },
    ],
    boot: { action: 'exec', entryId: 'boot' },
  }] }],
};

describe('a manifest that carries disk sets', () => {
  it('reads them, and points a project-file entry at the file by id once the folder is open', () => {
    const manifest = parseProjectManifest(JSON.stringify({ ...MANIFEST, diskSets: [DISK_SET] }));
    expect(manifest.diskSets).toHaveLength(1);
    const idFor = new Map([['README.md', 'file-readme']]);
    const { diskSets, dropped } = diskSetsFromManifest(manifest, idFor);
    expect(dropped).toEqual([]);
    const notes = diskSets[0]!.discs[0]!.sides[0]!.entries.find((entry) => entry.name === 'NOTES')!;
    expect(notes.source).toEqual({ kind: 'project-file', fileId: 'file-readme' });
  });

  it('leaves out an entry whose file is not in the folder, and names it', () => {
    const manifest = parseProjectManifest(JSON.stringify({ ...MANIFEST, diskSets: [DISK_SET] }));
    const { diskSets, dropped } = diskSetsFromManifest(manifest, new Map());
    expect(dropped).toEqual(['Release: README.md is not in the folder']);
    expect(diskSets[0]!.discs[0]!.sides[0]!.entries.map((entry) => entry.name)).toEqual(['!BOOT', 'FIREW']);
  });

  it('drops a disk set that is not one rather than repairing it', () => {
    const manifest = parseProjectManifest(JSON.stringify({ ...MANIFEST, diskSets: [{ schema: 'other' }, DISK_SET] }));
    expect(manifest.diskSets.map((set) => set.id)).toEqual(['release']);
  });

  it('comes back through a folder with the disk set intact', () => {
    const folder = [...FOLDER.filter((input) => input.path !== PROJECT_MANIFEST_FILENAME), { path: PROJECT_MANIFEST_FILENAME, content: JSON.stringify({ ...MANIFEST, diskSets: [DISK_SET] }) }];
    const plan = planCodebaseImport(folder, 'FireWing', { pathsIncludeChosenFolder: false });
    const contents = new Map(folder.filter((input) => input.path !== PROJECT_MANIFEST_FILENAME).map((input) => [input.path, input.content]));
    const project = projectFromCodebaseImport(plan, contents);
    expect(project.diskSets).toHaveLength(1);
    const readme = project.files.find((file) => file.name === 'README.md')!;
    const notes = project.diskSets[0]!.discs[0]!.sides[0]!.entries.find((entry) => entry.name === 'NOTES')!;
    expect(notes.source).toEqual({ kind: 'project-file', fileId: readme.id });
    /* And written back, the file is named again. */
    const written = manifestFromProject(project);
    const writtenNotes = written.diskSets[0]!.discs[0]!.sides[0]!.entries.find((entry) => entry.name === 'NOTES')!;
    expect(writtenNotes.source).toEqual({ kind: 'project-file', fileId: 'README.md' });
    expect(Object.keys(JSON.parse(serializeProjectManifest(written)))).toEqual(['format', 'name', 'target', 'buildTargets', 'activeBuildTargetId', 'diskSets', 'settings']);
  });
});

describe('writing a manifest for a project', () => {
  it('refers to files by name, because that is what a folder has', () => {
    const project = newProject();
    const host = createProjectFile('src/host.asm', 'ORG &1900\nRTS\n');
    const withHost = { ...project, name: 'FireWing', files: [...project.files, host], buildTargets: [createBuildTarget(host)] };
    const manifest = manifestFromProject(withHost);
    expect(manifest.buildTargets[0]!.entryFile).toBe('src/host.asm');
    expect(manifest.buildTargets[0]!.sourceFiles).toEqual(['src/host.asm']);
    expect(JSON.stringify(manifest)).not.toContain(host.id);
  });

  it('round-trips through a folder: what is written is what is read back', () => {
    const project = newProject();
    const host = createProjectFile('src/host.asm', 'ORG &1900\nRTS\n');
    const withHost = { ...project, name: 'FireWing', target: MANIFEST.target as typeof project.target, files: [...project.files, host], buildTargets: [createBuildTarget(host)], settings: { 'editor.fontSize': 18 } };
    const written = serializeProjectManifest(manifestFromProject(withHost));
    const read = parseProjectManifest(written);
    expect(read.name).toBe('FireWing');
    expect(read.target).toEqual(MANIFEST.target);
    expect(read.buildTargets).toHaveLength(1);
    expect(read.settings).toEqual({ 'editor.fontSize': 18 });
    /* And the parser the project goes through afterwards accepts what came
     * out, so a manifest is never something only this module can read. */
    const idFor = new Map([[host.name, host.id]]);
    const { targets, dropped } = buildTargetsFromManifest(read, idFor);
    expect(dropped).toEqual([]);
    expect(targets[0]).toMatchObject({ entryFileId: host.id, toolchainId: '8bit-net.asm.6502' });
    expect(() => parseProject(JSON.stringify({ format: PROJECT_FORMAT, name: 'x', files: [host], target: read.target, buildTargets: targets }))).not.toThrow();
  });

  it('ends with a newline and keeps its keys in one order, so it diffs like source', () => {
    const text = serializeProjectManifest(manifestFromProject(newProject()));
    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(['format', 'name', 'target', 'buildTargets', 'activeBuildTargetId', 'settings']);
  });
});
