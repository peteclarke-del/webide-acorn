import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_FILES, overrideTargetEntry, planCodebaseImport, projectFromCodebaseImport, type CodebaseFileInput } from './codebaseImport';
import { assembleProject6502 } from '../build/projectAssembler6502';
import { generatePixelAssetOutput, parsePixelAssetDocument } from '../assets/pixelAssetDocument';
import { loadSampleProjects } from '../samples/sampleProjects';

function contentsOf(inputs: readonly CodebaseFileInput[], plan: ReturnType<typeof planCodebaseImport>) {
  const byPath = new Map(inputs.map((input) => [input.path, input.content]));
  return new Map(plan.files.map((file) => [file.name, byPath.get(file.path)!]));
}

const SIMPLE: CodebaseFileInput[] = [
  { path: 'src/main.asm', content: 'ORG &1900\n.start\nINCLUDE "gfx.asm"\nRTS\n' },
  { path: 'src/gfx.asm', content: '.hero\nEQUB 1, 2, 3, 4\n' },
  { path: 'README.md', content: '# A project\n' },
  { path: '.git/config', content: '[core]\n' },
  { path: 'build/out.bin', content: 'ignored' },
  { path: 'notes/design.txt', content: 'notes\n' },
];

describe('planning a codebase import', () => {
  const plan = planCodebaseImport(SIMPLE, 'My Game');

  it('imports editable source and reports everything it left out', () => {
    expect(plan.files.map((file) => file.name).sort()).toEqual(['README.md', 'design.txt', 'gfx.asm', 'main.asm']);
    const excluded = Object.fromEntries(plan.exclusions.map((exclusion) => [exclusion.path, exclusion.reason]));
    expect(excluded['.git/config']).toBe('ignored-directory');
    expect(excluded['build/out.bin']).toBe('ignored-directory');
    expect(plan.totalBytes).toBeGreaterThan(0);
    expect(plan.name).toBe('My Game');
  });

  it('classifies each file by the language the project parser will give it', () => {
    expect(plan.files.find((file) => file.name === 'main.asm')).toMatchObject({ language: '6502', role: 'source' });
    expect(plan.files.find((file) => file.name === 'README.md')).toMatchObject({ language: 'text', role: 'text' });
  });

  it('proposes the entry file that is not included by another, and says why', () => {
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ entryName: 'main.asm', toolchainId: '8bit-net.asm.6502', language: '6502' });
    expect(plan.targets[0]!.reason).toMatch(/sets an origin/);
    expect(plan.targets[0]!.reason).toMatch(/is not included by another file/);
  });

  it('creates a project through the ordinary parser, with migrated build targets', () => {
    const project = projectFromCodebaseImport(plan, contentsOf(SIMPLE, plan));
    expect(project.name).toBe('My Game');
    expect(project.files).toHaveLength(4);
    expect(project.buildTargets).toHaveLength(1);
    expect(project.buildTargets[0]!.entryFileId).toBe('main.asm');
    expect(project.activeBuildTargetId).toBe(project.buildTargets[0]!.id);
    // Fields the importer does not write must be filled in by the migration.
    expect(project.buildTargets[0]).toMatchObject({ buildPolicy: 'manual', machineProfile: 'project', language: '6502' });
    expect(project.buildTargets[0]!.entryPoint).toBeDefined();
    expect(project.buildTargets[0]!.memoryLayout).toBeDefined();
  });
});

describe('flattening folder paths', () => {
  const nested: CodebaseFileInput[] = [
    { path: 'a/util.asm', content: '.one\nRTS\n' },
    { path: 'b/util.asm', content: '.two\nRTS\n' },
    { path: 'c/util.asm', content: '.three\nRTS\n' },
    { path: 'main.asm', content: 'ORG &1900\n.start\nRTS\n' },
  ];
  const plan = planCodebaseImport(nested, 'Nested');

  it('keeps the first basename and disambiguates the rest with their folder', () => {
    const names = plan.files.map((file) => file.name);
    expect(names).toContain('util.asm');
    expect(names).toContain('b-util.asm');
    expect(names).toContain('c-util.asm');
    expect(new Set(names).size).toBe(names.length);
  });

  it('records every rename and warns that INCLUDE directives may need updating', () => {
    expect(plan.files.filter((file) => file.renamedFrom).map((file) => file.renamedFrom)).toEqual(['util.asm', 'util.asm']);
    expect(plan.warnings.join(' ')).toMatch(/renamed/);
    expect(plan.warnings.join(' ')).toMatch(/INCLUDE/);
  });
});

describe('import limits and refusals', () => {
  it('excludes files that are not an editable source type', () => {
    const plan = planCodebaseImport([{ path: 'disk.ssd', content: 'x' }, { path: 'sprite.png', content: 'x' }]);
    expect(plan.files).toEqual([]);
    expect(plan.exclusions.map((exclusion) => exclusion.reason)).toEqual(['unsupported-file-type', 'unsupported-file-type']);
    expect(plan.warnings.join(' ')).toMatch(/No editable source file/);
  });

  it('excludes text that did not decode, and dot files', () => {
    const plan = planCodebaseImport([
      { path: 'broken.asm', content: `RTS${String.fromCharCode(0)}more` },
      { path: '.hidden.asm', content: 'RTS' },
    ]);
    expect(plan.files).toEqual([]);
    expect(plan.exclusions.map((exclusion) => exclusion.reason).sort()).toEqual(['not-text', 'unsupported-file-type']);
  });

  it('stops at the file count limit and says so', () => {
    const many = Array.from({ length: MAX_IMPORT_FILES + 5 }, (_, index) => ({ path: `f${String(index).padStart(4, '0')}.asm`, content: 'RTS\n' }));
    const plan = planCodebaseImport(many);
    expect(plan.files).toHaveLength(MAX_IMPORT_FILES);
    expect(plan.exclusions.filter((exclusion) => exclusion.reason === 'file-count-limit')).toHaveLength(5);
  });

  it('refuses a single file above the editable source limit', () => {
    const plan = planCodebaseImport([{ path: 'huge.asm', content: 'A'.repeat(1024 * 1024 + 1) }]);
    expect(plan.files).toEqual([]);
    expect(plan.exclusions[0]!.reason).toBe('file-too-large');
  });
});

describe('recovering assets from an imported codebase', () => {
  const withGraphics: CodebaseFileInput[] = [
    { path: 'main.asm', content: 'ORG &1900\n.start\nINCLUDE "sprites.asm"\nRTS\n' },
    { path: 'sprites.asm', content: `.ship_pixels\nEQUB ${Array.from({ length: 16 }, (_, index) => index * 3).join(', ')}\n` },
    { path: 'level.asm', content: ['.level_map', ...Array.from({ length: 8 }, () => 'EQUB 0, 1, 1, 0, 2, 0, 1, 0')].join('\n') },
  ];
  const plan = planCodebaseImport(withGraphics, 'Graphics');

  it('offers an editable asset that regenerates the original assembler bytes', () => {
    const candidate = plan.derivedAssets.find((entry) => entry.sourceLabel === 'ship_pixels')!;
    expect(candidate).toBeDefined();
    expect(candidate).toMatchObject({ sourceFile: 'sprites.asm', sourceLabel: 'ship_pixels', width: 8, height: 8 });
    const output = generatePixelAssetOutput(parsePixelAssetDocument(candidate.document));
    expect(Array.from(output.bytes)).toEqual(Array.from({ length: 16 }, (_, index) => index * 3));
  });

  it('only creates the assets the caller selected, and leaves the source untouched', () => {
    const contents = contentsOf(withGraphics, plan);
    const without = projectFromCodebaseImport(plan, contents);
    expect(without.files.some((file) => file.name.endsWith('.asset.json'))).toBe(false);
    const ship = plan.derivedAssets.find((entry) => entry.sourceLabel === 'ship_pixels')!;
    const withAsset = projectFromCodebaseImport(plan, contents, { derivedAssetIds: [ship.id] });
    expect(withAsset.files.some((file) => file.name === 'ship.asset.json')).toBe(true);
    expect(withAsset.files.find((file) => file.name === 'sprites.asm')!.content).toBe(contents.get('sprites.asm'));
  });

  it('flags a run that is equally readable as tile-map data', () => {
    expect(plan.derivedAssets.find((entry) => entry.sourceLabel === 'ship_pixels')!.alsoLooksLikeMapData).toBe(false);
    expect(plan.derivedAssets.find((entry) => entry.sourceLabel === 'level_map')!.alsoLooksLikeMapData).toBe(true);
  });

  it('reports map-shaped data without inventing a document for it', () => {
    expect(plan.mapCandidates.map((candidate) => candidate.sourceLabel)).toEqual(['level_map']);
    expect(plan.mapCandidates[0]!.shapes.length).toBeGreaterThan(0);
    const project = projectFromCodebaseImport(plan, contentsOf(withGraphics, plan));
    expect(project.files.some((file) => /map/i.test(file.name) && file.name.endsWith('.json'))).toBe(false);
  });
});

describe('importing a real multi-file codebase', () => {
  it('rebuilds the Acorn Harvest sources into a project that still assembles', async () => {
    const sample = (await loadSampleProjects()).find((candidate) => candidate.id === 'acorn-harvest')!;
    /* Present the sample as a folder tree, the way a real checkout would arrive. */
    const inputs: CodebaseFileInput[] = sample.project.files.map((file) => ({
      path: file.name.endsWith('.asset.json') ? `assets/${file.name}` : `src/${file.name}`,
      content: file.content,
    }));
    const plan = planCodebaseImport(inputs, 'Acorn Harvest checkout');

    expect(plan.files).toHaveLength(inputs.length);
    expect(plan.files.every((file) => !file.renamedFrom)).toBe(true);
    expect(plan.targets.map((target) => target.entryName)).toContain('main.asm');

    const project = projectFromCodebaseImport(plan, contentsOf(inputs, plan));
    const artifact = assembleProject6502('main.asm', project.files, '6502', { defaultOrigin: 0x1900, maximumAddress: 0x57ff });
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.bytes.length).toBeGreaterThan(0);
  });

  it('proposes one entry per language when a folder mixes assembly and BASIC', () => {
    const plan = planCodebaseImport([
      { path: 'main.asm', content: 'ORG &1900\n.start\nRTS\n' },
      { path: 'loader.bas', content: '10 REM loader\n20 END\n' },
    ]);
    expect(plan.targets.map((target) => `${target.language}:${target.entryName}`).sort()).toEqual(['6502:main.asm', 'bbc-basic:loader.bas']);
    expect(plan.targets.find((target) => target.language === 'bbc-basic')!.toolchainId).toBe('8bit-net.basic.bbc2');
  });

  it('still produces a buildable project when nothing scored as an entry', () => {
    const plan = planCodebaseImport([{ path: 'notes.txt', content: 'hello\n' }]);
    expect(plan.targets).toEqual([]);
    const project = projectFromCodebaseImport(plan, new Map([['notes.txt', 'hello\n']]));
    expect(project.buildTargets).toHaveLength(1);
    expect(project.files).toHaveLength(1);
  });
});


describe('choosing a different entry file', () => {
  const inputs: CodebaseFileInput[] = [
    { path: 'game/loader.asm', content: 'ORG &1900\n.start\nJMP start\n' },
    { path: 'game/engine.asm', content: '.update\nRTS\n' },
    { path: 'game/text.bas', content: '10 PRINT "HI"\n20 END\n' },
  ];

  it('offers every file of the target language, best first, with what each contains', () => {
    const plan = planCodebaseImport(inputs, 'game');
    const target = plan.targets.find((candidate) => candidate.language === '6502')!;
    expect(target.entryName).toBe('loader.asm');
    expect(target.candidates.map((candidate) => candidate.name)).toEqual(['loader.asm', 'engine.asm']);
    expect(target.candidates[0]!.reason).toContain('sets an origin');
    /* The BASIC target's candidates are BASIC files only: offering an assembly
     * file there would propose a build that cannot run. */
    expect(plan.targets.find((candidate) => candidate.language === 'bbc-basic')!.candidates.map((candidate) => candidate.name)).toEqual(['text.bas']);
  });

  it('re-derives the target name and output from the file that was chosen', () => {
    const plan = planCodebaseImport(inputs, 'game');
    const changed = overrideTargetEntry(plan, 'import-6502', 'engine.asm');
    const target = changed.targets.find((candidate) => candidate.id === 'import-6502')!;
    expect(target.entryName).toBe('engine.asm');
    expect(target.name).toBe('engine build');
    expect(target.outputName).toBe('engine.bin');
    expect(target.reason).toContain('Chosen during the import');
    /* The original is untouched, so a dialog can show what changed. */
    expect(plan.targets.find((candidate) => candidate.id === 'import-6502')!.entryName).toBe('loader.asm');
  });

  it('keeps the output extension the toolchain produces rather than assuming .bin', () => {
    const plan = planCodebaseImport([
      { path: 'game/main.bas', content: '10 PRINT\n' },
      { path: 'game/menu.bas', content: '10 PRINT\n20 END\n' },
    ], 'game');
    const changed = overrideTargetEntry(plan, 'import-bbc-basic', 'menu.bas');
    expect(changed.targets[0]!.outputName).toBe('menu.bbc');
  });

  it('refuses a file that is not a candidate rather than naming one that is not there', () => {
    const plan = planCodebaseImport(inputs, 'game');
    expect(() => overrideTargetEntry(plan, 'import-6502', 'text.bas')).toThrow(/cannot be its entry point/);
    expect(() => overrideTargetEntry(plan, 'import-6502', 'absent.asm')).toThrow(/cannot be its entry point/);
    expect(() => overrideTargetEntry(plan, 'import-arm', 'loader.asm')).toThrow(/not a proposed build target/);
  });

  it('carries the chosen entry into the project that is created', () => {
    const plan = overrideTargetEntry(planCodebaseImport(inputs, 'game'), 'import-6502', 'engine.asm');
    const contents = new Map(plan.files.map((file) => [file.name, inputs.find((input) => input.path.endsWith(file.name))!.content]));
    const project = projectFromCodebaseImport(plan, contents, {});
    const target = project.buildTargets.find((candidate) => candidate.id === 'import-6502')!;
    const entry = project.files.find((file) => file.id === target.entryFileId)!;
    expect(entry.name).toBe('engine.asm');
  });

  it('returns the same plan when the chosen file is the one already proposed', () => {
    const plan = planCodebaseImport(inputs, 'game');
    expect(overrideTargetEntry(plan, 'import-6502', 'loader.asm')).toBe(plan);
  });
});
