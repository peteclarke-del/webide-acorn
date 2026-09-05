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
    expect(plan.files.map((file) => file.name).sort()).toEqual(['README.md', 'notes/design.txt', 'src/gfx.asm', 'src/main.asm']);
    const excluded = Object.fromEntries(plan.exclusions.map((exclusion) => [exclusion.path, exclusion.reason]));
    expect(excluded['.git/config']).toBe('ignored-directory');
    expect(excluded['build/out.bin']).toBe('ignored-directory');
    expect(plan.totalBytes).toBeGreaterThan(0);
    expect(plan.name).toBe('My Game');
  });

  it('classifies each file by the language the project parser will give it', () => {
    expect(plan.files.find((file) => file.name === 'src/main.asm')).toMatchObject({ language: '6502', role: 'source' });
    expect(plan.files.find((file) => file.name === 'README.md')).toMatchObject({ language: 'text', role: 'text' });
  });

  it('proposes the entry file that is not included by another, and says why', () => {
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ entryName: 'src/main.asm', toolchainId: '8bit-net.asm.6502', language: '6502' });
    expect(plan.targets[0]!.reason).toMatch(/sets an origin/);
    expect(plan.targets[0]!.reason).toMatch(/is not included by another file/);
  });

  it('creates a project through the ordinary parser, with migrated build targets', () => {
    const project = projectFromCodebaseImport(plan, contentsOf(SIMPLE, plan));
    expect(project.name).toBe('My Game');
    expect(project.files).toHaveLength(4);
    expect(project.buildTargets).toHaveLength(1);
    /* An identifier, not a path: a file id with a slash in it is refused by
     * the native build service, so an imported project could not be built. */
    expect(project.buildTargets[0]!.entryFileId).toBe('src-main.asm');
    expect(project.files.find((file) => file.id === 'src-main.asm')?.name).toBe('src/main.asm');
    expect(project.activeBuildTargetId).toBe(project.buildTargets[0]!.id);
    // Fields the importer does not write must be filled in by the migration.
    expect(project.buildTargets[0]).toMatchObject({ buildPolicy: 'manual', machineProfile: 'project', language: '6502' });
    expect(project.buildTargets[0]!.entryPoint).toBeDefined();
    expect(project.buildTargets[0]!.memoryLayout).toBeDefined();
  });
});

describe('keeping the folders a codebase arrived in', () => {
  const nested: CodebaseFileInput[] = [
    { path: 'a/util.asm', content: '.one\nRTS\n' },
    { path: 'b/util.asm', content: '.two\nRTS\n' },
    { path: 'c/util.asm', content: '.three\nRTS\n' },
    { path: 'main.asm', content: 'ORG &1900\n.start\nRTS\n' },
  ];
  const plan = planCodebaseImport(nested, 'Nested');

  it('keeps three files of the same name apart by the folders they came from', () => {
    /* These used to be flattened to util.asm, b-util.asm and c-util.asm, which
     * broke every INCLUDE that named them and lost the shape of the checkout. */
    expect(plan.files.map((file) => file.name).sort()).toEqual(['a/util.asm', 'b/util.asm', 'c/util.asm', 'main.asm']);
    expect(plan.files.every((file) => !file.renamedFrom)).toBe(true);
    expect(plan.warnings.join(' ')).not.toMatch(/renamed/);
  });

  it('drops only the folder that was opened, so its contents sit at the top', () => {
    const checkout = planCodebaseImport([
      { path: 'MyGame/main.asm', content: 'ORG &1900\n.start\nRTS\n' },
      { path: 'MyGame/src/util.asm', content: '.one\nRTS\n' },
    ], 'MyGame', { pathsIncludeChosenFolder: true });
    expect(checkout.files.map((file) => file.name).sort()).toEqual(['main.asm', 'src/util.asm']);
  });

  it('keeps a directory that only looks like the folder that was opened', () => {
    /* The two folder routes disagree about whether the chosen folder is in the
     * paths: a directory input reports MyGame/src/main.asm, while the File
     * System Access API walks from the handle and reports src/main.asm for the
     * same folder. Guessing from the paths alone flattened a project whose
     * sources all lived under src, and its build stopped finding them. */
    const walked = planCodebaseImport([
      { path: 'src/main.asm', content: 'ORG &1900\n.start\nINCLUDE "src/util.asm"\nRTS\n' },
      { path: 'src/util.asm', content: '.one\nRTS\n' },
    ], 'MyGame', { pathsIncludeChosenFolder: false });
    expect(walked.files.map((file) => file.name).sort()).toEqual(['src/main.asm', 'src/util.asm']);
  });

  it('reads an archive by the evidence in it, because a zip may hold either', () => {
    const wrapped = planCodebaseImport([
      { path: 'MyGame/main.asm', content: 'ORG &1900\nRTS\n' },
      { path: 'MyGame/src/util.asm', content: '.one\nRTS\n' },
    ], 'MyGame');
    expect(wrapped.files.map((file) => file.name).sort()).toEqual(['main.asm', 'src/util.asm']);

    const bare = planCodebaseImport([
      { path: 'main.asm', content: 'ORG &1900\nRTS\n' },
      { path: 'src/util.asm', content: '.one\nRTS\n' },
    ], 'MyGame');
    expect(bare.files.map((file) => file.name).sort()).toEqual(['main.asm', 'src/util.asm']);
  });

  it('repairs a path segment a filesystem would refuse, and says what it changed', () => {
    const awkward = planCodebaseImport([
      { path: 'src?bad/main.asm', content: 'ORG &1900\nRTS\n' },
      { path: 'README.md', content: '# notes\n' },
    ], 'Awkward');
    expect(awkward.files.map((file) => file.name).sort()).toEqual(['README.md', 'srcbad/main.asm']);
    expect(awkward.warnings.join(' ')).toMatch(/characters that a filesystem will not accept/);
  });

  it('places a file at the top rather than nesting it beyond what it will hold', () => {
    const deep = 'a/'.repeat(20);
    const buried = planCodebaseImport([{ path: `${deep}main.asm`, content: 'ORG &1900\nRTS\n' }], 'Deep');
    expect(buried.files[0]!.name).toBe('main.asm');
    expect(buried.warnings.join(' ')).toMatch(/folders are kept to/);
  });
});

describe('the files a codebase is built with', () => {
  /* A project that loses its build script loses the record of how its author
   * built it, which is the one thing nobody can reconstruct from the source. */
  const built: CodebaseFileInput[] = [
    { path: 'main.asm', content: 'ORG &1900\n.start\nRTS\n' },
    { path: 'Makefile', content: 'all:\n\tbeebasm -i main.asm -o game\n' },
    { path: 'make/rules.mk', content: 'ASM := beebasm\n' },
    /* Still ignored, because a build directory holds output rather than source. */
    { path: 'build/generated.mk', content: 'GENERATED := 1\n' },
    { path: 'scripts/package.sh', content: '#!/bin/sh\nexit 0\n' },
    { path: 'LICENSE', content: 'GPL-3.0\n' },
    { path: 'link.ld', content: 'SECTIONS { }\n' },
  ];

  it('keeps a makefile, which has no extension at all', () => {
    const plan = planCodebaseImport(built, 'Built');
    expect(plan.files.map((file) => file.name).sort()).toEqual([
      'LICENSE', 'Makefile', 'link.ld', 'main.asm', 'make/rules.mk', 'scripts/package.sh',
    ]);
    expect(plan.exclusions.map((exclusion) => exclusion.path)).toEqual(['build/generated.mk']);
  });

  it('treats them as text rather than as something to compile', () => {
    const plan = planCodebaseImport(built, 'Built');
    const makefile = plan.files.find((file) => file.name === 'Makefile')!;
    expect(makefile).toMatchObject({ language: 'text', role: 'text' });
    /* And so none of them can be proposed as the program's entry file. */
    expect(plan.targets.map((target) => target.entryName)).toEqual(['main.asm']);
  });

  it('still says no to a name it does not recognise, and says why', () => {
    const plan = planCodebaseImport([{ path: 'mystery', content: 'who knows\n' }], 'Odd');
    expect(plan.files).toEqual([]);
    expect(plan.exclusions[0]).toMatchObject({ path: 'mystery', reason: 'unsupported-file-type' });
    expect(plan.exclusions[0]!.detail).toMatch(/no extension and is not a name this product recognises/);
  });
});

describe('a checkout opened through the folder picker, end to end', () => {
  /* The shape the File System Access API produces: paths relative to the folder
   * that was chosen, so its name is not among them. A project whose sources all
   * live under src used to have src taken off it, and what built on disk did
   * not build here. */
  const checkout: CodebaseFileInput[] = [
    { path: 'Makefile', content: 'all:\n\tbeebasm -i src/main.asm -o game\n' },
    { path: 'src/main.asm', content: 'ORG &1900\n.start\nINCLUDE "sprites.asm"\nINCLUDE "../lib/maths.asm"\nRTS\n' },
    { path: 'src/sprites.asm', content: '.hero\nEQUB 1, 2, 3, 4\n' },
    { path: 'lib/maths.asm', content: '.double\nASL A\nRTS\n' },
  ];

  it('keeps every folder and assembles what the Makefile says it builds', () => {
    const plan = planCodebaseImport(checkout, 'MyGame', { pathsIncludeChosenFolder: false });
    expect(plan.files.map((file) => file.name).sort()).toEqual(['Makefile', 'lib/maths.asm', 'src/main.asm', 'src/sprites.asm']);
    expect(plan.exclusions).toEqual([]);

    const project = projectFromCodebaseImport(plan, contentsOf(checkout, plan));
    const artifact = assembleProject6502(project.buildTargets[0]!.entryFileId, project.files, '6502', { defaultOrigin: 0x1900, maximumAddress: 0x57ff });
    expect(artifact.diagnostics).toEqual([]);
    /* Four bytes of artwork, ASL, and two RTS. */
    expect(artifact.bytes.length).toBe(7);
  });

  it('would have lost the folders, and the build with them, without being told', () => {
    /* The same checkout planned as though the chosen folder were in the paths.
     * Nothing shares a first segment here, so nothing is stripped either way;
     * the case that broke is the one below, where everything is under src. */
    const allUnderOne: CodebaseFileInput[] = [
      { path: 'src/main.asm', content: 'ORG &1900\n.start\nINCLUDE "src/util.asm"\nRTS\n' },
      { path: 'src/util.asm', content: '.one\nRTS\n' },
    ];
    expect(planCodebaseImport(allUnderOne, 'MyGame', { pathsIncludeChosenFolder: false }).files.map((file) => file.name).sort())
      .toEqual(['src/main.asm', 'src/util.asm']);
    expect(planCodebaseImport(allUnderOne, 'MyGame', { pathsIncludeChosenFolder: true }).files.map((file) => file.name).sort())
      .toEqual(['main.asm', 'util.asm']);
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

  it('recovers a room somebody drew as characters, which no byte run holds', () => {
    /* The rooms of a real forty-level game are text files like this one, read
     * by the generator that packs them. Before this they arrived as plain text
     * and nothing else, so a project whose maps were all in this form imported
     * with no maps at all. */
    const drawn = planCodebaseImport([
      { path: 'main.asm', content: 'ORG &1900\nRTS\n' },
      { path: 'rooms/room01.txt', content: [
        '; NAME: Sub-Basement',
        '; SHIFTS: 5',
        '',
        '################',
        '#......F.......#',
        '#..............#',
        '#...====.......#',
        '#............F.#',
        '#......##......#',
        '#...........#..#',
        '#P.........E...#',
        '################',
      ].join('\n') },
    ], 'Drawn');
    const room = drawn.mapCandidates.find((candidate) => candidate.sourceLabel === 'room01');
    expect(room, 'the room is offered as a map').toBeTruthy();
    expect(room!.shapes).toEqual([{ width: 16, height: 9 }]);
    /* The floor is what most of the room is, so it is the map's empty cell. */
    expect(room!.legend?.[0]).toMatchObject({ character: '.', index: 0 });
    /* And the file it was drawn in is still imported as itself. */
    expect(drawn.files.map((file) => file.name)).toContain('rooms/room01.txt');
  });

  it('offers the loading screen a game opens on, which is not text and was skipped', () => {
    /* Twenty kilobytes of frame buffer, exactly as the machine reads it. This
     * is how a loading screen reaches a project: converted by a tool, saved as
     * the bytes the video hardware wants, loaded by the game's own loader. */
    const bytes = new Uint8Array(20_480);
    bytes[0] = 0x0f;
    const plan = planCodebaseImport([
      { path: 'main.asm', content: 'ORG &1900\nRTS\n' },
      { path: 'assets/loading/loading_acorn_mode2_selected.scr', content: '', bytes },
    ], 'Loading');
    expect(plan.screenCandidates).toHaveLength(1);
    const offered = plan.screenCandidates[0]!;
    /* The filename names the mode, and three modes share that length, so the
     * named one leads and the other two remain available. */
    expect(offered.modes).toEqual(['bbc-mode-2', 'bbc-mode-0', 'bbc-mode-1']);
    expect(offered.namedByFilename).toBe(true);

    const contents = contentsOf([], plan);
    const without = projectFromCodebaseImport(plan, contents);
    expect(without.files.some((file) => file.name.endsWith('.screen.json')), 'nothing is recovered unasked').toBe(false);

    const project = projectFromCodebaseImport(plan, contents, { derivedScreens: [{ id: offered.id, mode: 'bbc-mode-2' }] });
    const screen = project.files.find((file) => file.name === 'loading_acorn_mode2_selected.screen.json');
    expect(screen, 'the screen becomes an editable document').toBeTruthy();
    const document = JSON.parse(screen!.content) as { mode: string; framebufferBase64: string };
    expect(document.mode).toBe('bbc-mode-2');
    /* And it is the picture that was saved, byte for byte. */
    const recovered = Uint8Array.from(atob(document.framebufferBase64), (character) => character.charCodeAt(0));
    expect(recovered.length).toBe(20_480);
    expect(recovered[0]).toBe(0x0f);
  });

  it('does not read an assembler include as a drawn map, because the run already reads it', () => {
    /* Eight EQUB lines of the same length are a rectangle too. Reading them
     * twice would offer the same artwork as a map beside itself as a sprite. */
    const include = planCodebaseImport([
      { path: 'main.asm', content: 'ORG &1900\nRTS\n' },
      { path: 'sprites.inc', content: Array.from({ length: 8 }, () => '    EQUB &00,&0F,&F0,&FF,&00,&0F,&F0,&FF').join('\n') },
    ], 'Include');
    expect(include.mapCandidates.filter((candidate) => candidate.id.endsWith(':drawn'))).toEqual([]);
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
    expect(plan.targets.map((target) => target.entryName)).toContain('src/main.asm');

    const project = projectFromCodebaseImport(plan, contentsOf(inputs, plan));
    const artifact = assembleProject6502(project.buildTargets[0]!.entryFileId, project.files, '6502', { defaultOrigin: 0x1900, maximumAddress: 0x57ff });
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
