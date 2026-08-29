import { describe, expect, it } from 'vitest';
import { loadSampleProjects, sampleLocalProject } from './sampleProjects';
import { assembleProject6502 } from '../build/projectAssembler6502';
import { tokenizeBasic } from '../build/basicTokeniser';
import { generatePixelAssetOutput, parsePixelAssetDocument } from '../assets/pixelAssetDocument';
import { parseTestPlan } from '../testing/testPlan';
import { parseTileMapDocument } from '../assets/tileMapDocument';
import { toolchainFor, validateBuildTarget } from '../build/buildTarget';
import { machineProfiles } from '../data/machines';

const samples = await loadSampleProjects();

describe('sample projects', () => {
  it('publishes a catalogue with unique identities and honest firmware expectations', () => {
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(new Set(samples.map((sample) => sample.id)).size).toBe(samples.length);
    for (const sample of samples) {
      expect(sample.name.trim()).not.toBe('');
      expect(sample.highlights.length).toBeGreaterThan(0);
      // Both samples run on a real BBC, which needs firmware the user supplies.
      expect(sample.requiresRoms).toBe(true);
    }
  });

  for (const sample of samples) {
    describe(sample.name, () => {
      const project = sampleLocalProject(sample);

      it('parses through the ordinary project parser without losing declared content', () => {
        expect(project.format).toBe('8bit-net-dev-project-21');
        expect(project.files).toHaveLength(sample.project.files.length);
        expect(project.buildTargets).toHaveLength(sample.project.buildTargets.length);
        expect(project.testPlans).toHaveLength(sample.project.testPlans.length);
        // Bookmarks survive only when they point at a file that exists.
        expect(project.bookmarks).toHaveLength(sample.project.bookmarks.length);
        for (const bookmark of project.bookmarks) expect(project.files.some((file) => file.id === bookmark.fileId)).toBe(true);
      });

      it('declares build targets that validate against the sample machine', () => {
        const machine = machineProfiles.find((candidate) => candidate.id === project.target.machineId)!;
        for (const target of project.buildTargets) {
          expect(validateBuildTarget(target, project.files, { cpu: machine.cpu, id: machine.id }, project.buildTargets)).toEqual([]);
        }
      });

      it('builds every target from the shipped sources with no diagnostics', () => {
        for (const target of project.buildTargets) {
          const entry = project.files.find((file) => file.id === target.entryFileId)!;
          const toolchain = toolchainFor(target.toolchainId)!;
          if (toolchain.language === 'bbc-basic') {
            const artifact = tokenizeBasic(entry.content);
            expect(artifact.diagnostics).toEqual([]);
            expect(artifact.lineCount).toBeGreaterThan(0);
            expect(artifact.bytes.length).toBeGreaterThan(0);
            continue;
          }
          const artifact = assembleProject6502(entry.id, project.files, toolchain.processor === '65c02' ? '65c02' : '6502', {
            defaultOrigin: 0x1900, maximumAddress: 0x57ff,
          });
          expect(artifact.diagnostics).toEqual([]);
          expect(artifact.bytes.length).toBeGreaterThan(0);
        }
      });

      it('builds deterministically', () => {
        for (const target of project.buildTargets) {
          const entry = project.files.find((file) => file.id === target.entryFileId)!;
          const toolchain = toolchainFor(target.toolchainId)!;
          const build = () => toolchain.language === 'bbc-basic'
            ? tokenizeBasic(entry.content).bytes
            : assembleProject6502(entry.id, project.files, '6502', { defaultOrigin: 0x1900, maximumAddress: 0x57ff }).bytes;
          expect(Array.from(build())).toEqual(Array.from(build()));
        }
      });

      it('validates every declared test plan against its own build symbols', () => {
        for (const plan of project.testPlans) {
          const target = project.buildTargets.find((candidate) => candidate.id === plan.targetId)!;
          expect(target).toBeDefined();
          const entry = project.files.find((file) => file.id === target.entryFileId)!;
          const artifact = assembleProject6502(entry.id, project.files, '6502', { defaultOrigin: 0x1900, maximumAddress: 0x57ff });
          const parsed = parseTestPlan(plan.stop, plan.assertions, artifact.symbols, plan.screenGoldens);
          expect(parsed.errors).toEqual([]);
          expect(parsed.stopAddress).not.toBeNull();
          expect(parsed.assertions.length).toBeGreaterThan(0);
        }
      });

      it('carries pixel assets that parse and generate deterministic output', () => {
        const assets = project.files.filter((file) => file.name.endsWith('.asset.json'));
        for (const file of assets) {
          const document = parsePixelAssetDocument(file.content);
          const output = generatePixelAssetOutput(document);
          expect(output.bytes.length).toBeGreaterThan(0);
          expect(output.manifest.sha256).toBe(generatePixelAssetOutput(document).manifest.sha256);
          expect(output.assembly).toContain(`.asset_${document.name}_pixels`);
        }
      });
    });
  }
});

describe('Acorn Harvest engine expectations', () => {
  const sample = samples.find((candidate) => candidate.id === 'acorn-harvest')!;
  const project = sampleLocalProject(sample);
  const artifact = assembleProject6502('selftest.asm', project.files, '6502', { defaultOrigin: 0x1900, maximumAddress: 0x57ff });

  it('asserts the same first sprite byte the asset pipeline actually packs', () => {
    const player = parsePixelAssetDocument(project.files.find((file) => file.name === 'player.asset.json')!.content);
    const packed = generatePixelAssetOutput(player).bytes;
    const plan = project.testPlans.find((candidate) => candidate.targetId === 'harvest-selftest')!;
    const memory = parseTestPlan(plan.stop, plan.assertions, artifact.symbols).assertions.find((assertion) => assertion.kind === 'memory');
    expect(memory).toBeDefined();
    // Offset 19 of the results block is the first screen byte written by the plotter.
    expect(memory && memory.kind === 'memory' ? memory.expected[19] : undefined).toBe(packed[0]);
  });

  it('asserts a screen address the MODE 5 layout actually produces', () => {
    const plan = project.testPlans.find((candidate) => candidate.targetId === 'harvest-selftest')!;
    const memory = parseTestPlan(plan.stop, plan.assertions, artifact.symbols).assertions.find((assertion) => assertion.kind === 'memory');
    expect(memory?.kind).toBe('memory');
    const expected = memory && memory.kind === 'memory' ? memory.expected : [];
    // Grid cell (0,0) is block row 8, and (9,11) is eleven rows lower plus nine cells across.
    expect(expected[0]! | (expected[1]! << 8)).toBe(0x5800 + 8 * 320);
    expect(expected[2]! | (expected[3]! << 8)).toBe(0x5800 + 19 * 320 + 9 * 16);
  });

  it('declares an acorn total that matches the map document it ships', () => {
    const map = parseTileMapDocument(project.files.find((file) => file.name === 'level.map.json')!.content);
    expect(map.width).toBe(10);
    expect(map.height).toBe(12);
    expect(map.layers[0]!.cells).toHaveLength(120);
    expect(artifact.symbols.LEVEL_ACORNS).toBeDefined();
    const declared = artifact.bytes[artifact.symbols.LEVEL_ACORNS! - artifact.origin];
    expect(declared).toBe(map.layers[0]!.cells.filter((cell) => cell === 2).length);
  });

  it('starts the player on clear ground inside the map it ships', () => {
    const map = parseTileMapDocument(project.files.find((file) => file.name === 'level.map.json')!.content);
    const column = artifact.bytes[artifact.symbols.LEVEL_START_COLUMN! - artifact.origin]!;
    const row = artifact.bytes[artifact.symbols.LEVEL_START_ROW! - artifact.origin]!;
    expect(map.layers[0]!.cells[row * map.width + column]).toBe(0);
  });

  it('generates the map layer into the build exactly as the document declares it', () => {
    const map = parseTileMapDocument(project.files.find((file) => file.name === 'level.map.json')!.content);
    const layer = artifact.symbols.MAP_LEVEL_LAYER0! - artifact.origin;
    expect(Array.from(artifact.bytes.slice(layer, layer + 120))).toEqual(map.layers[0]!.cells);
  });

  it('resolves the map tile pointer table to the artwork the tileset names', () => {
    const table = artifact.symbols.MAP_LEVEL_TILES! - artifact.origin;
    expect(artifact.bytes[table]! | (artifact.bytes[table + 1]! << 8)).toBe(artifact.symbols.ASSET_WALL_PIXELS);
    expect(artifact.bytes[table + 2]! | (artifact.bytes[table + 3]! << 8)).toBe(artifact.symbols.ASSET_ACORN_PIXELS);
  });
});
