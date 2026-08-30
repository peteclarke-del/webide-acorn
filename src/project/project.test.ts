// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { emptyAnalysisAnnotations } from '../analysis/analysisAnnotations';
import { PROJECT_FORMAT, PROJECT_FORMAT_VERSION, createProjectFile, languageForFilename, newProject, parseProject, projectFormatVersion,
  reorderProjectFiles, portableProject, projectFileIsModified, revertedProjectFile, savedProjectFile, serializableProject, uniqueFilename } from './project';

describe('local project model', () => {
  it('selects source language from the filename', () => {
    expect(languageForFilename('main.bas')).toBe('bbc-basic');
    expect(languageForFilename('game.6502')).toBe('6502');
    expect(languageForFilename('module.arm')).toBe('arm');
    expect(languageForFilename('support.c')).toBe('c');
  });

  it('creates unique names without changing the extension', () => {
    expect(uniqueFilename('main.bas', [{ id: '1', name: 'MAIN.BAS', content: '', language: 'bbc-basic', modified: false }])).toBe('main-2.bas');
  });

  it('validates and normalizes imported projects', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-1', name: 'Real project',
      files: [{ id: 'a', name: 'code.6502', content: 'RTS', language: 'text', modified: true }],
    }));
    expect(result.files[0]?.language).toBe('6502');
    expect(result.files[0]?.modified).toBe(false);
    expect(result.format).toBe('8bit-net-dev-project-21');
    expect(result.files[0]).toMatchObject({ encoding: 'utf-8', lineEnding: 'lf', savedEncoding: 'utf-8', savedLineEnding: 'lf' });
    expect(result.target.machineId).toBe('bbc-b');
    expect(result.buildTargets).toHaveLength(1);
    expect(result.buildTargets[0]?.entryFileId).toBe(result.files[0]?.id);
  });

  it('rejects duplicate filenames', () => {
    expect(() => parseProject(JSON.stringify({
      format: '8bit-net-dev-project-1', name: 'Broken',
      files: [{ name: 'a.bas', content: '' }, { name: 'A.BAS', content: '' }],
    }))).toThrow(/unique/);
  });

  it('rejects portable source records beyond the editable file limit', () => {
    expect(() => parseProject(JSON.stringify({ format: '8bit-net-dev-project-15', name: 'Oversize', files: [{ id: 'large', name: 'large.asm', content: 'x'.repeat(1024 * 1024 + 1) }] }))).toThrow(/1 MiB/);
  });

  it('persists semantic source provenance and forces generated source read-only', () => {
    const project = parseProject(JSON.stringify({ format: '8bit-net-dev-project-16', name: 'Provenance', files: [
      { id: 'authored', name: 'main.asm', content: 'RTS', kind: 'authored', access: 'editable' },
      { id: 'imported', name: 'legacy.asm', content: 'RTS', kind: 'imported', access: 'editable' },
      { id: 'generated', name: 'sprites.inc', content: 'EQUB 0', kind: 'generated', access: 'editable', generator: 'Sprite asset hero.asset.json' },
    ] }));
    expect(project.files).toMatchObject([
      { kind: 'authored', access: 'editable' },
      { kind: 'imported', access: 'editable' },
      { kind: 'generated', access: 'read-only', generator: 'Sprite asset hero.asset.json' },
    ]);
    expect(serializableProject(project).files[2]).toMatchObject({ kind: 'generated', access: 'read-only', generator: 'Sprite asset hero.asset.json' });
  });

  it('saves one file without clearing other dirty files', () => {
    const project = parseProject(JSON.stringify({ format: '8bit-net-dev-project-2', name: 'Dirty', files: [{ id: 'a', name: 'a.bas', content: '10 END' }, { id: 'b', name: 'b.asm', content: 'RTS' }] }));
    const dirty = { ...project, files: project.files.map((file) => ({ ...file, modified: true })) };
    const saved = savedProjectFile(dirty, 'a');
    expect(saved.files.find((file) => file.id === 'a')?.modified).toBe(false);
    expect(saved.files.find((file) => file.id === 'a')?.savedContent).toBe('10 END');
    expect(saved.files.find((file) => file.id === 'b')?.modified).toBe(true);
  });

  it('persists a saved baseline for recovery and reverts only source content', () => {
    const recovered = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-4', name: 'Recovered',
      files: [{ id: 'a', name: 'renamed.bas', savedName: 'main.bas', content: '20 PRINT "DIRTY"', savedContent: '10 END', modified: true }],
    }));
    expect(recovered.files[0]).toMatchObject({ modified: true, savedName: 'main.bas', savedContent: '10 END' });
    const reverted = revertedProjectFile(recovered, 'a');
    expect(reverted.files[0]).toMatchObject({ name: 'renamed.bas', content: '10 END', modified: true });
    const saved = serializableProject(reverted);
    expect(saved.files[0]).toMatchObject({ savedName: 'renamed.bas', savedContent: '10 END', modified: false });
  });

  it('keeps never-saved files dirty while clearing saved files that return to baseline', () => {
    const created = createProjectFile('new.bas');
    expect(projectFileIsModified(created)).toBe(true);
    const recovered = parseProject(JSON.stringify({ format: '8bit-net-dev-project-4', name: 'New file recovery', files: [created] }));
    expect(recovered.files[0]).toMatchObject({ saved: false, modified: true });
    const saved = savedProjectFile(recovered, created.id).files[0]!;
    expect(saved).toMatchObject({ saved: true, modified: false });
    expect(projectFileIsModified({ ...saved, content: 'changed' })).toBe(true);
    expect(projectFileIsModified({ ...saved, content: saved.savedContent ?? '' })).toBe(false);
  });

  it('tracks source byte format as saved file state and restores it on revert', () => {
    const project = parseProject(JSON.stringify({ format: '8bit-net-dev-project-15', name: 'Formats', files: [{ id: 'a', name: 'a.bas', content: '10 END', encoding: 'utf-8', lineEnding: 'lf', savedEncoding: 'utf-8', savedLineEnding: 'lf', saved: true, savedName: 'a.bas', savedContent: '10 END', modified: false }] }));
    const changed = { ...project, files: project.files.map((file) => ({ ...file, encoding: 'windows-1252' as const, lineEnding: 'crlf' as const, modified: projectFileIsModified(file, file.name, file.content, 'windows-1252', 'crlf') })) };
    expect(changed.files[0]?.modified).toBe(true);
    expect(revertedProjectFile(changed, 'a').files[0]).toMatchObject({ encoding: 'utf-8', lineEnding: 'lf', modified: false });
    expect(serializableProject(changed).files[0]).toMatchObject({ savedEncoding: 'windows-1252', savedLineEnding: 'crlf', modified: false });
  });

  it('migrates, bounds and preserves named source bookmarks', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-5', name: 'Bookmarks', files: [{ id: 'a', name: 'a.bas', content: '10 PRINT\n20 END' }],
      bookmarks: [{ id: 'mark', fileId: 'a', line: 99, column: 4, name: 'Ending', enabled: false, anchor: '20 END' }, { id: 'lost', fileId: 'missing', line: 1 }],
    }));
    expect(result.bookmarks).toEqual([{ id: 'mark', fileId: 'a', line: 2, column: 4, name: 'Ending', description: '', scope: 'project', enabled: false, anchor: '20 END', orphaned: false }]);
  });

  it('normalizes bookmark notes and scope and excludes private bookmarks from portable export by default', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-14', name: 'Private notes', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }],
      bookmarks: [
        { id: 'shared', fileId: 'a', line: 1, name: 'Return', description: 'Public review note', scope: 'project' },
        { id: 'private', fileId: 'a', line: 1, name: 'Secret route', description: 'Do not share', scope: 'private' },
      ],
    }));
    const safe = portableProject(result);
    expect(safe.project.bookmarks.map((bookmark) => bookmark.id)).toEqual(['shared']);
    expect(safe).toMatchObject({ privateBookmarksIncluded: 0, privateBookmarksExcluded: 1 });
    const explicit = portableProject(result, true);
    expect(explicit.project.bookmarks.map((bookmark) => bookmark.id)).toEqual(['shared', 'private']);
    expect(explicit).toMatchObject({ privateBookmarksIncluded: 1, privateBookmarksExcluded: 0 });
  });

  it('migrates legacy build targets and preserves validated schema-two execution settings', () => {
    const legacy = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-3', name: 'Legacy build', files: [{ id: 'a', name: 'a.asm', content: '.start\n RTS' }],
      buildTargets: [{ schemaVersion: 1, id: 'legacy', name: 'Legacy', entryFileId: 'a', toolchainId: '8bit-net.asm.6502', outputName: 'a.bin' }], activeBuildTargetId: 'legacy',
    }));
    expect(legacy.buildTargets[0]).toMatchObject({ schemaVersion: 5, buildPolicy: 'manual', entryPoint: { mode: 'source', value: '' }, machineProfile: 'project', roots: ['.'], profile: 'debug', profileOptions: { customGoal: 'balanced', debugMetadata: 'full' } });
    const configured = parseProject(JSON.stringify({
      ...legacy,
      buildTargets: [{ ...legacy.buildTargets[0], buildPolicy: 'live', entryPoint: { mode: 'symbol', value: 'start' } }],
    }));
    expect(configured.buildTargets[0]).toMatchObject({ schemaVersion: 5, buildPolicy: 'live', entryPoint: { mode: 'symbol', value: 'start' } });
  });

  it('persists bounded test plans only for existing build targets', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-6', name: 'Tests', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }],
      buildTargets: [{ schemaVersion: 2, id: 'target', name: 'Target', entryFileId: 'a', toolchainId: '8bit-net.asm.6502', outputName: 'a.bin' }], activeBuildTargetId: 'target',
      testPlans: [{ id: 'test', targetId: 'target', name: 'Register contract', stop: '&1900', assertions: 'A = 0', cycleBudget: 500, enabled: true }, { id: 'lost', targetId: 'missing' }],
    }));
    expect(result.testPlans).toEqual([{ schemaVersion: 2, id: 'test', targetId: 'target', name: 'Register contract', suite: 'Default', setup: { reset: 'hard', media: 'retain' }, inputs: [], stop: '&1900', assertions: 'A = 0', screenGoldens: [], cycleBudget: 500, captures: [], teardown: { action: 'pause' }, enabled: true }]);
  });

  it('persists validated portable screen goldens and discards malformed records', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-17', name: 'Screen evidence', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }],
      buildTargets: [{ schemaVersion: 5, id: 'target', name: 'Target', entryFileId: 'a', toolchainId: '8bit-net.asm.6502', outputName: 'a.bin' }], activeBuildTargetId: 'target',
      testPlans: [{ id: 'test', targetId: 'target', name: 'Frame', stop: '&1900', assertions: 'SCREEN_IMAGE[pixel,0,0] TOLERANCE[0,0]', cycleBudget: 500, screenGoldens: [
        { id: 'pixel', name: 'pixel.png', width: 1, height: 1, rgbaBase64: 'AQIDBA==' },
        { id: 'wrong-size', name: 'wrong.png', width: 2, height: 1, rgbaBase64: 'AQIDBA==' },
        { id: 'bad id', name: 'bad.png', width: 1, height: 1, rgbaBase64: 'AQIDBA==' },
      ] }],
    }));
    expect(result.testPlans[0]).toMatchObject({ schemaVersion: 2, screenGoldens: [{ id: 'pixel', name: 'pixel.png', width: 1, height: 1, rgbaBase64: 'AQIDBA==' }] });
    expect(serializableProject(result).testPlans[0]?.screenGoldens).toEqual(result.testPlans[0]?.screenGoldens);
  });

  it('normalizes versioned setup, input, capture and teardown records', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-13', name: 'Test schema', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }],
      buildTargets: [{ schemaVersion: 5, id: 'target', name: 'Target', entryFileId: 'a', toolchainId: '8bit-net.asm.6502', outputName: 'a.bin' }], activeBuildTargetId: 'target',
      testPlans: [{ schemaVersion: 99, id: 'test', targetId: 'target', name: 'Capture', suite: 'CPU', setup: { reset: 'soft', media: 'eject' }, inputs: [{ kind: 'delay', cycles: 50 }, { kind: 'key', code: 'KeyA', pressed: true }, { kind: 'gamepad', action: 'fire1', code: 90, pressed: true }, { kind: 'bbc-analogue', channels: [65535, 0, 32768, 12345], buttons: [true, false] }, { kind: 'bbc-mouse', x: 16384, y: 49151, buttons: [false, true] }, { kind: 'atom-atommc', up: true, down: false, left: true, right: false, fire: true }, { kind: 'atom-atommc', up: 1, down: false, left: false, right: false, fire: false }, { kind: 'media', action: 'eject-disc-1' }, { kind: 'media', action: 'mount-initial-disc-0' }, { kind: 'media', action: 'mount-initial-tape' }, { kind: 'emulator-event', event: 'next-video-frame' }, { kind: 'emulator-event', event: 'host-timeout' }, { kind: 'media', action: 'mount-untrusted' }, { kind: 'bbc-mouse', x: -1, y: 0, buttons: [false, false] }, { kind: 'bbc-analogue', channels: [65536, 0, 0, 0], buttons: [false, false] }, { kind: 'gamepad', action: 'bad', code: 7, pressed: false }, { kind: 'delay', cycles: -1 }], stop: '&1900', assertions: 'A = 0', cycleBudget: 500, captures: [{ id: 'regs', kind: 'registers' }, { id: 'ram', kind: 'memory', address: 'buffer', length: 32 }, { id: 'bad', kind: 'memory', address: '&0', length: 5000 }], teardown: { action: 'reset' }, enabled: true }],
    }));
    expect(result.testPlans[0]).toMatchObject({ schemaVersion: 2, suite: 'CPU', setup: { reset: 'soft', media: 'eject' }, inputs: [{ kind: 'delay', cycles: 50 }, { kind: 'key', code: 'KeyA', pressed: true }, { kind: 'gamepad', action: 'fire1', code: 90, pressed: true }, { kind: 'bbc-analogue', channels: [65535, 0, 32768, 12345], buttons: [true, false] }, { kind: 'bbc-mouse', x: 16384, y: 49151, buttons: [false, true] }, { kind: 'atom-atommc', up: true, down: false, left: true, right: false, fire: true }, { kind: 'media', action: 'eject-disc-1' }, { kind: 'media', action: 'mount-initial-disc-0' }, { kind: 'media', action: 'mount-initial-tape' }, { kind: 'emulator-event', event: 'next-video-frame' }], screenGoldens: [], captures: [{ id: 'regs', kind: 'registers' }, { id: 'ram', kind: 'memory', address: 'buffer', length: 32 }], teardown: { action: 'reset' } });
  });

  it('migrates only bounded ARM breakpoint intents for existing build targets', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-8', name: 'ARM debug', files: [{ id: 'a', name: 'a.arm', content: 'start: MOV R0, #0' }],
      buildTargets: [{ schemaVersion: 5, id: 'arm', name: 'ARM', entryFileId: 'a', toolchainId: 'gnu.arm-none-eabi-binutils', outputName: 'a.bin' }], activeBuildTargetId: 'arm',
      armBreakpoints: { arm: [{ id: 'bp', expression: 'start+4', enabled: true, hitTarget: 3, conditions: [{ register: 0, operator: 'eq', value: 2 }], action: 'pause' }, { expression: '', action: 'pause' }], missing: [{ expression: '&8000', action: 'pause' }] },
    }));
    expect(result.format).toBe('8bit-net-dev-project-21');
    expect(result.armBreakpoints).toEqual({ arm: [{ id: 'bp', expression: 'start+4', enabled: true, hitTarget: 3, conditions: [{ register: 0, operator: 'eq', expression: '&00000002' }], action: 'pause' }] });
  });

  it('migrates bounded target-scoped ARM breakpoint groups and validates membership', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-10', name: 'Grouped ARM debug', files: [{ id: 'a', name: 'a.arm', content: '_start: MOV R0, #0' }],
      buildTargets: [{ schemaVersion: 5, id: 'arm', name: 'ARM', entryFileId: 'a', toolchainId: 'gnu.arm-none-eabi-binutils', outputName: 'a.bin' }], activeBuildTargetId: 'arm',
      armBreakpointGroups: { arm: [{ id: 'render', name: 'Rendering', enabled: false }, { id: 'duplicate', name: 'rendering', enabled: true }], missing: [{ id: 'lost', name: 'Lost', enabled: true }] },
      armBreakpoints: { arm: [{ id: 'grouped', expression: '_start', enabled: true, conditions: [], action: 'pause', groupId: 'render', resolutionHistory: [{ requestedExpression: '_start', buildFingerprint: 'abcdef12', address: 32768, verification: 'resolved', reason: 'initial resolution' }, { requestedExpression: '', buildFingerprint: 'bad', address: -1, verification: 'unknown', reason: '' }] }, { id: 'ungrouped', expression: '_start+4', enabled: true, conditions: [], action: 'pause', groupId: 'missing' }] },
    }));
    expect(result.format).toBe('8bit-net-dev-project-21');
    expect(result.armBreakpointGroups).toEqual({ arm: [{ id: 'render', name: 'Rendering', enabled: false }] });
    expect(result.armBreakpoints.arm).toEqual([
      { id: 'grouped', expression: '_start', enabled: true, conditions: [], action: 'pause', groupId: 'render', resolutionHistory: [{ requestedExpression: '_start', buildFingerprint: 'abcdef12', address: 32768, verification: 'resolved', reason: 'initial resolution' }] },
      { id: 'ungrouped', expression: '_start+4', enabled: true, conditions: [], action: 'pause' },
    ]);
  });

  it('migrates bounded target-scoped 6502 breakpoint groups, intents and history', () => {
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-11', name: '6502 debug', files: [{ id: 'a', name: 'a.asm', content: '.loop RTS' }],
      buildTargets: [{ schemaVersion: 5, id: 'cpu', name: '6502', entryFileId: 'a', toolchainId: '8bit-net.asm.6502', outputName: 'a.bin' }], activeBuildTargetId: 'cpu',
      breakpointGroups6502: { cpu: [{ id: 'game', name: 'Gameplay', enabled: false }, { id: 'duplicate', name: 'gameplay' }] },
      breakpoints6502: { cpu: [{ id: 'loop', expression: 'loop+1', enabled: true, action: 'pause-log', logMessage: 'A={a}', groupId: 'game', condition: { register: 'a', operator: 'eq', expression: 'limit' }, resolutionHistory: [{ requestedExpression: 'loop+1', buildFingerprint: 'abcdef12', address: 6401, verification: 'resolved', reason: 'initial resolution' }] }, { id: 'bad', expression: '', action: 'pause' }] },
    }));
    expect(result.breakpointGroups6502).toEqual({ cpu: [{ id: 'game', name: 'Gameplay', enabled: false }] });
    expect(result.breakpoints6502.cpu).toEqual([{ id: 'loop', expression: 'loop+1', enabled: true, action: 'pause-log', logMessage: 'A={a}', groupId: 'game', condition: { register: 'a', operator: 'eq', expression: 'limit' }, resolutionHistory: [{ requestedExpression: 'loop+1', buildFingerprint: 'abcdef12', address: 6401, verification: 'resolved', reason: 'initial resolution' }] }]);
  });
  it('persists analysis annotations keyed by the digest of the bytes they describe', () => {
    const digest = 'd'.repeat(64);
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-18', name: 'Annotated', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }],
      analysisAnnotations: {
        [digest]: {
          schema: '8bit-net.analysis-annotations', version: 1, sourceSha256: digest,
          entryPoints: [0x190c], regions: [{ start: 0x1908, end: 0x1909, kind: 'text' }],
          indirectTargets: [{ from: 0x1902, targets: [0x1905] }],
          comments: [{ address: 0x1900, text: 'loader entry' }], labels: [{ address: 0x1900, text: 'start' }],
        },
      },
    }));
    expect(Object.keys(result.analysisAnnotations)).toEqual([digest]);
    expect(result.analysisAnnotations[digest]!.entryPoints).toEqual([0x190c]);
    expect(result.analysisAnnotations[digest]!.labels).toEqual([{ address: 0x1900, text: 'start' }]);
  });

  it('discards annotations that are unreadable or that describe different bytes', () => {
    const digest = 'e'.repeat(64);
    const other = 'f'.repeat(64);
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-18', name: 'Annotated', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }],
      analysisAnnotations: {
        'not-a-digest': { schema: '8bit-net.analysis-annotations', version: 1, sourceSha256: digest },
        [digest]: { schema: '8bit-net.analysis-annotations', version: 1, sourceSha256: other },
        [other]: { schema: '8bit-net.analysis-annotations', version: 1, sourceSha256: other, regions: [{ start: 5, end: 1, kind: 'data' }] },
      },
    }));
    expect(result.analysisAnnotations).toEqual({});
  });

  it('gives a project with no recorded annotations an empty set rather than leaving it absent', () => {
    const result = parseProject(JSON.stringify({ format: '8bit-net-dev-project-11', name: 'Old', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }] }));
    expect(result.analysisAnnotations).toEqual({});
  });
  it('persists validated disk sets and drops one it cannot read back', () => {
    const good = {
      schema: '8bit-net.disk-set', version: 1, id: 'release', name: 'Release',
      discs: [{ id: 'd1', label: 'Disc one', format: 'dfs-ssd', sides: [{ title: 'GAME', entries: [{ id: 'a', name: 'GAME', source: { kind: 'build-target', targetId: 'cpu' } }], boot: { action: 'run', entryId: 'a' } }] }],
    };
    const result = parseProject(JSON.stringify({
      format: '8bit-net-dev-project-19', name: 'Sets', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }],
      diskSets: [good, { schema: '8bit-net.disk-set', version: 1, id: 'broken', name: 'Broken', discs: [] }],
    }));
    expect(result.diskSets).toHaveLength(1);
    expect(result.diskSets[0]!.id).toBe('release');
    expect(result.diskSets[0]!.discs[0]!.sides[0]!.boot).toEqual({ action: 'run', entryId: 'a' });
  });

  it('gives a project with no disk sets an empty list rather than leaving it absent', () => {
    const result = parseProject(JSON.stringify({ format: '8bit-net-dev-project-11', name: 'Old', files: [{ id: 'a', name: 'a.asm', content: 'RTS' }] }));
    expect(result.diskSets).toEqual([]);
  });
});

describe('reordering files in the explorer', () => {
  const file = (id: string, name: string, kind: 'authored' | 'imported' | 'generated' = 'authored') => ({
    id, name, content: 'RTS\n', language: '6502' as const, encoding: 'utf-8' as const, lineEnding: 'lf' as const,
    modified: false, saved: true, savedName: name, savedContent: 'RTS\n',
    savedEncoding: 'utf-8' as const, savedLineEnding: 'lf' as const, kind, access: 'editable' as const,
  });
  const files = [file('a', 'a.asm'), file('b', 'b.asm'), file('c', 'c.asm')];

  it('moves a file before another', () => {
    const result = reorderProjectFiles(files, 'c', 'a', 'before');
    expect(result.files.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(result.moved.id).toBe('c');
    expect(result.refusal).toBeUndefined();
  });

  it('moves a file after another', () => {
    expect(reorderProjectFiles(files, 'a', 'c', 'after').files.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(reorderProjectFiles(files, 'a', 'b', 'after').files.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('does nothing when a file is dropped on itself', () => {
    const result = reorderProjectFiles(files, 'b', 'b', 'before');
    expect(result.files.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.refusal).toBeUndefined();
  });

  it('refuses a move across group boundaries, because the group is the origin', () => {
    const mixed = [file('a', 'a.asm'), file('n', 'notes.txt', 'imported')];
    const result = reorderProjectFiles(mixed, 'n', 'a', 'before');
    expect(result.files.map((item) => item.id)).toEqual(['a', 'n']);
    expect(result.refusal).toContain('grouped by where they came from');
    expect(result.refusal).toContain('notes.txt');
    expect(result.refusal).toContain('a.asm');
  });

  it('refuses a file that is not in the project rather than reordering silently', () => {
    expect(reorderProjectFiles(files, 'absent', 'a', 'before').refusal).toContain('not in this project');
    expect(reorderProjectFiles(files, 'a', 'absent', 'before').refusal).toContain('dropped on is not in this project');
  });

  it('never loses or duplicates a file', () => {
    for (const moved of ['a', 'b', 'c']) {
      for (const target of ['a', 'b', 'c']) {
        for (const position of ['before', 'after'] as const) {
          const result = reorderProjectFiles(files, moved, target, position);
          expect(result.files.map((item) => item.id).sort()).toEqual(['a', 'b', 'c']);
        }
      }
    }
  });
});


describe('the project format version', () => {
  /* The acceptance rule used to be two hand-written lists of every version
   * string. These pin the derived rule so that bumping the version cannot
   * quietly stop the product reading a document it wrote itself. */
  it('reads the version out of a format string, and refuses anything that is not one', () => {
    expect(projectFormatVersion(PROJECT_FORMAT)).toBe(PROJECT_FORMAT_VERSION);
    expect(projectFormatVersion('8bit-net-dev-project-1')).toBe(1);
    expect(projectFormatVersion('8bit-net-dev-project-07')).toBeNull();
    expect(projectFormatVersion('8bit-net-dev-project-0')).toBeNull();
    expect(projectFormatVersion('8bit-net-dev-project-')).toBeNull();
    expect(projectFormatVersion('8bit-net-dev-project-1x')).toBeNull();
    expect(projectFormatVersion('8bit-net-dev-bundle-1')).toBeNull();
    expect(projectFormatVersion(undefined)).toBeNull();
    expect(projectFormatVersion(21)).toBeNull();
  });

  it('opens every version this product has ever written', () => {
    for (let version = 1; version <= PROJECT_FORMAT_VERSION; version += 1) {
      const document = JSON.stringify({
        format: `8bit-net-dev-project-${version}`,
        name: `v${version}`,
        files: [{ name: 'main.asm', content: 'RTS\n' }],
      });
      const project = parseProject(document);
      expect(project.name).toBe(`v${version}`);
      expect(project.format).toBe(PROJECT_FORMAT);
      expect(project.files[0]!.name).toBe('main.asm');
      /* A migrated document is not reported as carrying unsaved work: the
       * baseline it did not record is taken from the content it did. */
      expect(project.files[0]!.modified).toBe(false);
    }
  });

  it('tells someone with a newer document to update, rather than calling it unsupported', () => {
    const newer = JSON.stringify({
      format: `8bit-net-dev-project-${PROJECT_FORMAT_VERSION + 1}`,
      name: 'from the future',
      files: [{ name: 'main.asm', content: 'RTS\n' }],
    });
    expect(() => parseProject(newer)).toThrow(new RegExp(`newer version of the workbench \\(format ${PROJECT_FORMAT_VERSION + 1}; this build reads up to ${PROJECT_FORMAT_VERSION}\\)`));
  });

  it('still refuses something that is not a project document at all', () => {
    expect(() => parseProject(JSON.stringify({ format: 'something-else', name: 'x', files: [] }))).toThrow(/not a supported/);
    expect(() => parseProject(JSON.stringify({ format: PROJECT_FORMAT, files: [] }))).toThrow(/not a supported/);
    expect(() => parseProject(JSON.stringify({ format: PROJECT_FORMAT, name: 'x' }))).toThrow(/not a supported/);
  });
});


const DIGEST = 'a'.repeat(64);

describe('every section of the document survives a save and reopen', () => {
  /* The strongest statement that the schema is finished: a project with every
   * optional section populated is serialised, parsed back, and compared whole.
   * A field added to the model without parser support fails here rather than
   * being discovered as data quietly lost from someone's project. */
  it('round-trips a project with every section populated, losing nothing', () => {
    /* The project's own starting file, so the build targets that reference it
     * stay valid: this checks the parser keeps what it is given, not that it
     * repairs a fixture that was inconsistent to begin with. */
    const base = newProject();
    const id = base.files[0]!.id;
    const target = base.buildTargets[0]!.id;
    const populated = {
      ...base,
      name: 'Everything',
      breakpoints: { [id]: [0x1900, 0x1904] },
      bookmarks: [{ id: 'b1', fileId: id, line: 1, column: 1, name: 'start', description: 'entry', scope: 'project' as const, enabled: true, anchor: '', orphaned: false }],
      armBreakpoints: { [target]: [{ id: 'arm1', expression: '&8000', enabled: true, conditions: [{ register: 0, operator: 'eq' as const, expression: '1' }], action: 'pause' as const, groupId: 'g1' }] },
      armBreakpointGroups: { [target]: [{ id: 'g1', name: 'boot', enabled: true }] },
      breakpoints6502: { [target]: [{ id: 'bp1', expression: '&1900', enabled: true, condition: { register: 'a' as const, operator: 'eq' as const, expression: '0' }, action: 'pause' as const, groupId: 'g2' }] },
      breakpointGroups6502: { [target]: [{ id: 'g2', name: 'loop', enabled: true }] },
      analysisAnnotations: { [DIGEST]: emptyAnalysisAnnotations(DIGEST) },
      settings: { 'machine.runtimeSpeed': 2 },
    };
    const reopened = parseProject(JSON.stringify(serializableProject(populated)));

    /* Compared through the same serialiser, so the check is "the document says
     * the same thing", not "the in-memory objects are identical" — the parser
     * legitimately fills in defaults the model already carries. */
    expect(serializableProject(reopened)).toEqual(serializableProject(populated));
  });

  it('lists no section of the model that the parser does not read back', () => {
    /* Enumerated from the document rather than from the type, so a section
     * added to one and not the other is caught. */
    const document = serializableProject(newProject()) as unknown as Record<string, unknown>;
    const reopened = serializableProject(parseProject(JSON.stringify(document))) as unknown as Record<string, unknown>;
    expect(Object.keys(reopened).sort()).toEqual(Object.keys(document).sort());
  });
});
