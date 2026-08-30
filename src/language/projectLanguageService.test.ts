import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../project/project';
import { basicNavigationModel, bbcBasicTypeHints, buildProjectLanguageIndex, findProjectReferences, projectCallHierarchyAt, projectCompletionItems, projectHelpForToken, projectSourceReferences, projectSignatureHelpAt, resolveProjectDefinition, resolveProjectRelationship, sdkDocumentForToken, sdkDocumentTargetAt, sourceTypeHints } from './projectLanguageService';
import type { LanguageTargetContext } from './languageTarget';

const source = (id: string, name: string, content: string, language: ProjectFile['language'] = '6502'): ProjectFile => ({ id, name, content, language, modified: false });

describe('project language service', () => {
  it('treats ca65 dotted directives as documented syntax rather than project labels', () => {
    const file = source('main', 'main.s', '.segment "CODE"\n.export _start\n_start:\n rts');
    const index = buildProjectLanguageIndex([file]);
    const target = { processor: '6502' as const, machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: false, enabledCapabilities: [], toolchainId: 'cc65.ca65-ld65' };
    expect(index.symbols.map((item) => item.token)).toEqual(['_start']);
    expect(projectHelpForToken(file, '.segment', index, '6502', target)).toMatchObject({ kind: 'directive', token: '.SEGMENT', detail: expect.stringMatching(/named ld65/i) });
  });
  it('indexes only the connected INCLUDE graph for assembly completion and definitions', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "draw.asm"\n JSR draw');
    const draw = source('draw', 'draw.asm', '.draw\n RTS');
    const unrelated = source('other', 'other.asm', '.elsewhere\n RTS');
    const index = buildProjectLanguageIndex([entry, draw, unrelated]);
    const items = projectCompletionItems(entry, index, '6502', entry.content.length);
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'draw', source: expect.objectContaining({ fileName: 'draw.asm', version: index.version }) })]));
    expect(items.some((item) => item.token === 'elsewhere')).toBe(false);
    expect(resolveProjectDefinition(entry, entry.content.lastIndexOf('draw') + 1, index)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'draw', line: 1 })] });
    expect(resolveProjectDefinition(entry, entry.content.indexOf('draw.asm') + 2, index)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'draw', line: 1, length: 0 })] });
  });

  it('provides ARM2 instruction help and cross-file branch navigation', () => {
    const entry = source('entry', 'main.arm', '.include "loop.sarm"\n.global _start\n_start:\n BL update\n B _start', 'arm');
    const loop = source('loop', 'loop.sarm', 'update:\n ADD r0, r0, #1\n MOV pc, lr', 'arm');
    const index = buildProjectLanguageIndex([entry, loop]);
    expect(projectCompletionItems(entry, index).map((item) => item.token)).toEqual(expect.arrayContaining(['ADD', 'BL', '.GLOBAL', 'update']));
    expect(projectHelpForToken(loop, 'ADD', index)).toMatchObject({ kind: 'opcode', documentation: { category: 'ARM2 instruction', compatibility: { supported: true } } });
    expect(projectSourceReferences(entry, index)[0]).toMatchObject({ target: 'update', status: 'resolved', targetFileId: 'loop', targetLine: 1 });
    expect(resolveProjectDefinition(entry, entry.content.indexOf('update') + 2, index)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'loop' })] });
  });

  it('reports ambiguous and out-of-graph declarations instead of guessing', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "a.asm"\nINCLUDE "b.asm"\n JSR shared\n JSR remote');
    const a = source('a', 'a.asm', '.shared\n RTS');
    const b = source('b', 'b.asm', 'shared:\n RTS');
    const remote = source('remote', 'remote.asm', '.remote\n RTS');
    const index = buildProjectLanguageIndex([entry, a, b, remote]);
    expect(resolveProjectDefinition(entry, entry.content.indexOf('shared') + 2, index)).toMatchObject({ status: 'ambiguous', candidates: [expect.anything(), expect.anything()] });
    expect(resolveProjectDefinition(entry, entry.content.lastIndexOf('remote') + 2, index)).toMatchObject({ status: 'unresolved', reason: expect.stringMatching(/outside.*INCLUDE graph/i) });
    expect(projectHelpForToken(entry, 'shared', index)?.detail).toMatch(/2 declarations/);
  });

  it('resolves cross-file jump references and filters opcodes by selected CPU', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "lib.asm"\n BNE loop');
    const library = source('lib', 'lib.asm', 'loop: NOP\n RTS');
    const index = buildProjectLanguageIndex([entry, library]);
    expect(projectSourceReferences(entry, index)[0]).toMatchObject({ status: 'resolved', targetFileId: 'lib', targetFileName: 'lib.asm', targetLine: 1 });
    expect(projectCompletionItems(entry, index, '6502').some((item) => item.token === 'STZ')).toBe(false);
    expect(projectCompletionItems(entry, index, '65c02').some((item) => item.token === 'STZ')).toBe(true);
    expect(projectHelpForToken(entry, 'STZ', index, '6502')?.documentation?.compatibility).toMatchObject({ supported: false, warning: expect.stringMatching(/not available/i) });
  });

  it('finds declarations and references across the connected build scope', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "lib.asm"\n JSR draw\n BNE draw');
    const library = source('lib', 'lib.asm', '.draw\n RTS');
    const unrelated = source('other', 'other.asm', ' JSR draw');
    const index = buildProjectLanguageIndex([entry, library, unrelated]);
    const result = findProjectReferences(entry, entry.content.indexOf('draw') + 1, index);
    expect(result).toMatchObject({ status: 'resolved', token: 'DRAW', declarations: [expect.objectContaining({ fileId: 'lib' })] });
    expect(result.locations).toEqual([
      expect.objectContaining({ fileId: 'lib', line: 1, kind: 'declaration' }),
      expect.objectContaining({ fileId: 'entry', line: 2, kind: 'reference' }),
      expect.objectContaining({ fileId: 'entry', line: 3, kind: 'reference' }),
    ]);
    expect(result.locations.some((location) => location.fileId === 'other')).toBe(false);
  });

  it('derives only statically proven incoming and outgoing assembly calls', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "lib.asm"\n.main\n JSR draw\n BNE draw\n RTS');
    const library = source('lib', 'lib.asm', '.draw\n JSR plot\n RTS\n.plot\n RTS');
    const index = buildProjectLanguageIndex([entry, library]);
    const draw = projectCallHierarchyAt(entry, entry.content.indexOf('draw') + 1, index);
    expect(draw).toMatchObject({ status: 'resolved', token: 'DRAW' });
    expect(draw.incoming).toEqual([expect.objectContaining({ caller: 'main', callee: 'draw', fileName: 'main.asm', line: 3 })]);
    expect(draw.outgoing).toEqual([expect.objectContaining({ caller: 'draw', callee: 'plot', fileName: 'lib.asm', line: 2, targetFileName: 'lib.asm', targetLine: 4 })]);
    expect(draw.incoming.some((edge) => edge.line === 4)).toBe(false);
  });

  it('derives direct C call hierarchy while excluding an unrelated project component', () => {
    const entry = source('entry', 'main.c', '#include "draw.h"\nvoid frame(void) {\n draw();\n}', 'c');
    const header = source('header', 'draw.h', 'void draw(void) {\n plot();\n}\nvoid plot(void) {\n}', 'c');
    const unrelated = source('other', 'other.c', 'void other(void) {\n draw();\n}', 'c');
    const index = buildProjectLanguageIndex([entry, header, unrelated]);
    const hierarchy = projectCallHierarchyAt(entry, entry.content.lastIndexOf('draw') + 1, index);
    expect(hierarchy.incoming).toEqual([expect.objectContaining({ caller: 'frame', callee: 'draw', fileName: 'main.c' })]);
    expect(hierarchy.outgoing).toEqual([expect.objectContaining({ caller: 'draw', callee: 'plot', fileName: 'draw.h' })]);
    expect([...hierarchy.incoming, ...hierarchy.outgoing].some((edge) => edge.fileName === 'other.c')).toBe(false);
  });

  it('separates C declaration, implementation and type-definition relationships', () => {
    const entry = source('entry', 'main.c', '#include "api.h"\nbyte value;\nvoid frame(void) {\n draw();\n}', 'c');
    const api = source('api', 'api.h', '#include "draw.c"\ntypedef unsigned char byte;\nvoid draw(void);', 'c');
    const implementation = source('impl', 'draw.c', 'void draw(void) {\n value = 1;\n}', 'c');
    const index = buildProjectLanguageIndex([entry, api, implementation]);
    const call = entry.content.lastIndexOf('draw') + 1;
    expect(resolveProjectRelationship(entry, call, index, 'declaration')).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'api', line: 3 })] });
    expect(resolveProjectRelationship(entry, call, index, 'implementation')).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'impl', line: 1 })] });
    expect(resolveProjectRelationship(entry, call, index, 'definition')).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'impl' })] });
    expect(resolveProjectRelationship(entry, entry.content.indexOf('byte') + 1, index, 'type-definition')).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'api', line: 2, kind: 'type' })] });
    expect(resolveProjectRelationship(entry, entry.content.indexOf('value') + 1, index, 'implementation')).toMatchObject({ status: 'unresolved' });
  });

  it('offers project filenames inside INCLUDE and keeps BASIC signatures file-local', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "ut');
    const utility = source('util', 'utilities.asm', '.utility\n RTS');
    const index = buildProjectLanguageIndex([entry, utility]);
    expect(projectCompletionItems(entry, index, '6502', entry.content.length)).toEqual([expect.objectContaining({ token: 'utilities.asm', kind: 'file', insertText: 'utilities.asm"', commitCharacters: ['Enter', 'Tab'] })]);

    const basic = source('basic', 'main.bas', '10 PROCdraw(1,', 'bbc-basic');
    const declaration = source('decl', 'other.bas', '100 DEF PROCdraw(x%, y%)', 'bbc-basic');
    const basicIndex = buildProjectLanguageIndex([basic, declaration]);
    expect(projectSignatureHelpAt(basic, basic.content.length, basicIndex)).toBeUndefined();
  });

  it('resolves quoted C project headers and distinguishes immutable cc65 system headers', () => {
    const entry = source('entry', 'main.c', '#include "game.h"\n#include <acorn.h>\nvoid main(void) { acorn_oswrch(65); }', 'c');
    const header = source('header', 'game.h', 'void draw(void);', 'c');
    const index = buildProjectLanguageIndex([entry, header]);
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: true, enabledCapabilities: [], toolchainId: 'cc65.c-bbc' };

    expect(resolveProjectDefinition(entry, entry.content.indexOf('game.h') + 2, index)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'header', line: 1 })] });
    expect(sdkDocumentTargetAt(entry, entry.content.indexOf('acorn.h') + 2, target)).toEqual({ path: 'acorn.h' });
    expect(sdkDocumentForToken(entry, 'acorn_oswrch', target)).toEqual({ path: 'acorn.h', token: 'acorn_oswrch' });
    expect(sdkDocumentForToken(entry, 'cputc', target)).toEqual({ path: 'conio.h', token: 'cputc' });
    expect(sdkDocumentTargetAt(entry, entry.content.indexOf('acorn.h') + 2, { ...target, toolchainId: '8bit-net.asm.6502' })).toBeUndefined();
  });

  it('filters branch, BASIC target and ARM operand completion by syntax position', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "lib.asm"\n BNE ');
    const library = source('lib', 'lib.asm', '.loop\n RTS');
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: true, enabledCapabilities: [], toolchainId: '8bit-net.asm.6502', buildDefines: ['SCREEN=&3000'] };
    const branch = projectCompletionItems(entry, buildProjectLanguageIndex([entry, library]), '6502', entry.content.length, target);
    expect(branch).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'loop', kind: 'symbol' }),
      expect.objectContaining({ token: 'SCREEN', kind: 'constant', source: expect.objectContaining({ label: 'active build target defines' }) }),
      expect.objectContaining({ token: 'OSWRCH', kind: 'mos' }),
    ]));
    expect(branch.some((item) => item.token === 'LDA' || item.token === 'EQUB')).toBe(false);

    const basic = source('basic', 'main.bas', '10 GOTO 20\n20 END\n100 DEF PROCdraw', 'bbc-basic');
    const basicTargets = projectCompletionItems(basic, buildProjectLanguageIndex([basic]), '6502', '10 GOTO 2'.length);
    expect(basicTargets.map((item) => item.token)).toEqual(['10', '20', '100']);

    const arm = source('arm', 'main.arm', '_start:\n ADD R0, ', 'arm');
    const armItems = projectCompletionItems(arm, buildProjectLanguageIndex([arm]), '6502', arm.content.length, { ...target, machineId: 'archimedes-a300', machineLabel: 'Archimedes A300', toolchainId: 'gnu.arm-none-eabi-binutils', buildDefines: ['WORKSPACE=&8000'] });
    expect(armItems).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'R1', kind: 'register' }), expect.objectContaining({ token: 'SP', kind: 'register' }), expect.objectContaining({ token: 'WORKSPACE', kind: 'constant' })]));
    expect(armItems.some((item) => item.token === 'ADD' || item.token === '.GLOBAL')).toBe(false);
  });

  it('offers project and active SDK headers only inside a C include operand', () => {
    const c = source('c', 'main.c', '#include <aco', 'c');
    const header = source('header', 'game.h', '#define GAME 1', 'text');
    const ordinary = source('asm', 'other.asm', 'RTS');
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: true, enabledCapabilities: [], toolchainId: 'cc65.c-bbc', includePaths: ['.'] };
    const items = projectCompletionItems(c, buildProjectLanguageIndex([c, header, ordinary]), '6502', c.content.length, target);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'game.h', kind: 'file', insertText: 'game.h>' }),
      expect.objectContaining({ token: 'acorn.h', kind: 'file', insertText: 'acorn.h>' }),
    ]));
    expect(items.some((item) => item.token === 'other.asm' || item.token === 'return')).toBe(false);
  });

  it('indexes source constants and macros in the assembly positions where they are valid', () => {
    const entry = source('entry', 'main.asm', 'INCLUDE "symbols.asm"\n LDA SCREEN\n LOAD_');
    const symbols = source('symbols', 'symbols.asm', 'SCREEN = &3000\n.macro LOAD_SCREEN address\n LDA address\n.endmacro');
    const index = buildProjectLanguageIndex([entry, symbols]);
    const mnemonic = projectCompletionItems(entry, index, '6502', entry.content.length);
    expect(mnemonic).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'LOAD_SCREEN', kind: 'macro', signature: 'LOAD_SCREEN address' })]));
    expect(mnemonic.some((item) => item.token === 'SCREEN')).toBe(false);
    const operandPosition = entry.content.indexOf('SCREEN') + 'SCREEN'.length;
    const operand = projectCompletionItems(entry, index, '6502', operandPosition);
    expect(operand).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'SCREEN', kind: 'constant', signature: 'SCREEN = &3000' })]));
    expect(operand.some((item) => item.token === 'LOAD_SCREEN')).toBe(false);
    expect(resolveProjectDefinition(entry, entry.content.indexOf('SCREEN') + 2, index)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ kind: 'constant', fileId: 'symbols' })] });
  });

  it('indexes linked C header macros, functions, and file declarations', () => {
    const entry = source('entry', 'main.c', '#include "game.h"\nstatic unsigned char score;\nvoid run(void) {\n score = CLAMP(score);\n}', 'c');
    const header = source('header', 'game.h', '#define SCREEN 0x3000\n#define CLAMP(value) ((value) & 255)\nvoid draw(unsigned char colour);', 'c');
    const remote = source('remote', 'remote.h', '#define REMOTE_ONLY 1', 'c');
    const index = buildProjectLanguageIndex([entry, header, remote]);
    const items = projectCompletionItems(entry, index, '6502', entry.content.indexOf('CLAMP') + 2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'score', kind: 'variable', source: expect.objectContaining({ fileName: 'main.c' }) }),
      expect.objectContaining({ token: 'run', kind: 'function' }),
      expect.objectContaining({ token: 'SCREEN', kind: 'constant', source: expect.objectContaining({ fileName: 'game.h' }) }),
      expect.objectContaining({ token: 'CLAMP', kind: 'macro', parameters: ['value'] }),
      expect.objectContaining({ token: 'draw', kind: 'function', parameters: ['unsigned char colour'] }),
    ]));
    expect(items.some((item) => item.token === 'REMOTE_ONLY')).toBe(false);
    expect(resolveProjectDefinition(entry, entry.content.indexOf('CLAMP') + 2, index)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'header', kind: 'macro' })] });
  });

  it('offers C parameters and preceding locals only inside their enclosing function', () => {
    const file = source('c', 'main.c', 'static unsigned char global;\nvoid draw(unsigned char colour, int x) {\n int width = 8;\n wid\n int later = 1;\n}\nvoid other(void) {\n oth\n}', 'c');
    const index = buildProjectLanguageIndex([file]);
    const drawPosition = file.content.indexOf('\n wid\n') + '\n wid'.length;
    const draw = projectCompletionItems(file, index, '6502', drawPosition);
    expect(draw).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'global', kind: 'variable' }),
      expect.objectContaining({ token: 'colour', kind: 'variable', detail: expect.stringMatching(/function parameter/) }),
      expect.objectContaining({ token: 'x', kind: 'variable', detail: expect.stringMatching(/function parameter/) }),
      expect.objectContaining({ token: 'width', kind: 'variable', detail: expect.stringMatching(/before the caret/) }),
    ]));
    expect(draw.some((item) => item.token === 'later')).toBe(false);
    const otherPosition = file.content.lastIndexOf('oth') + 3;
    const other = projectCompletionItems(file, index, '6502', otherPosition);
    expect(other.some((item) => ['colour', 'x', 'width', 'later'].includes(item.token))).toBe(false);
    expect(index.symbols.filter((symbol) => symbol.kind === 'variable').map((symbol) => symbol.token)).toEqual(['global']);
  });

  it('removes locals from closed C blocks while retaining declarations in active parent blocks', () => {
    const file = source('c', 'scope.c', 'void run(void) {\n int outer = 1;\n if (outer) {\n  int closed = 2;\n }\n clo\n if (outer) {\n  int active = 3;\n  act\n }\n}', 'c');
    const index = buildProjectLanguageIndex([file]);
    const closedPosition = file.content.indexOf('\n clo') + '\n clo'.length;
    const afterClosed = projectCompletionItems(file, index, '6502', closedPosition);
    expect(afterClosed).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'outer', kind: 'variable' })]));
    expect(afterClosed.some((item) => item.token === 'closed')).toBe(false);
    const activePosition = file.content.indexOf('\n  act') + '\n  act'.length;
    const active = projectCompletionItems(file, index, '6502', activePosition);
    expect(active).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'outer' }), expect.objectContaining({ token: 'active' })]));
    expect(active.some((item) => item.token === 'closed')).toBe(false);
  });

  it('offers only members of the C structure used by the expression receiver', () => {
    const header = source('header', 'sprite.h', 'typedef struct {\n unsigned char x;\n unsigned char y;\n int frame;\n} Sprite;\ntypedef struct { int volume; } Sound;', 'c');
    const file = source('c', 'main.c', '#include "sprite.h"\nvoid draw(Sprite *hero, Sound sound) {\n hero->fr\n}', 'c');
    const index = buildProjectLanguageIndex([file, header]); const position = file.content.indexOf('hero->fr') + 'hero->fr'.length;
    const items = projectCompletionItems(file, index, '6502', position);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'x', kind: 'member', source: expect.objectContaining({ fileName: 'sprite.h' }) }),
      expect.objectContaining({ token: 'y', kind: 'member' }),
      expect.objectContaining({ token: 'frame', kind: 'member', signature: 'int frame' }),
    ]));
    expect(items.some((item) => item.token === 'volume' || item.kind !== 'member')).toBe(false);
    const blank = { ...file, content: file.content.replace('hero->fr', 'hero->') }; const blankIndex = buildProjectLanguageIndex([blank, header]);
    expect(projectCompletionItems(blank, blankIndex, '6502', blank.content.indexOf('hero->') + 6).map((item) => item.token)).toEqual(['x', 'y', 'frame']);
  });

  it('offers assigned BBC BASIC variables with authoritative suffix types', () => {
    const basic = source('basic', 'main.bas', '10 score%=1:name$="Ada"\n20 PRINT score%;name$', 'bbc-basic');
    const items = projectCompletionItems(basic, buildProjectLanguageIndex([basic]), '6502', basic.content.length);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'score%', kind: 'variable', signature: 'score%: signed integer' }),
      expect.objectContaining({ token: 'name$', kind: 'variable', signature: 'name$: string' }),
    ]));
  });

  it('offers only selected-machine hardware addresses and formats them for the active toolchain', () => {
    const file = source('asm', 'main.s', ' LDA VIDEO_', '6502');
    const bbc: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC Micro Model B', romId: 'os12-basic2', romLabel: 'OS 1.20 / BASIC II', romReady: true, enabledCapabilities: [], toolchainId: 'cc65.ca65-ld65' };
    const items = projectCompletionItems(file, buildProjectLanguageIndex([file]), '6502', file.content.length, bbc);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'VIDEO_ULA_CONTROL', kind: 'hardware', insertText: '$FE20', documentation: expect.objectContaining({ sideEffects: expect.arrayContaining([expect.stringMatching(/acknowledge interrupts/)]) }) }),
      expect.objectContaining({ token: 'SYSVIA_ORB', insertText: '$FE40' }),
    ]));
    expect(items.some((item) => item.token === 'ATOM_PPIA' || item.token === 'ACCCON')).toBe(false);
    expect(projectHelpForToken(file, 'VIDEO_ULA_CONTROL', buildProjectLanguageIndex([file]), '6502', bbc)).toMatchObject({ documentation: { citations: [expect.objectContaining({ title: 'BBC Microcomputer User Guide' })] } });
  });

  it('completes RISC OS SWIs only in a SWI operand and inserts GNU as numeric syntax', () => {
    const file = source('arm', 'main.arm', '_start:\n SWI OS_Wr', 'arm');
    const ready: LanguageTargetContext = { processor: '6502', machineId: 'archimedes-a300', machineLabel: 'Archimedes A310', romId: 'riscos311', romLabel: 'RISC OS 3.11', romReady: true, enabledCapabilities: [], toolchainId: 'gnu.arm-none-eabi-binutils' };
    const items = projectCompletionItems(file, buildProjectLanguageIndex([file]), '6502', file.content.length, ready);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'OS_WriteC', kind: 'swi', insertText: '0x00', parameters: ['R0: character byte'] }),
      expect.objectContaining({ token: 'OS_Write0', kind: 'swi', insertText: '0x02' }),
    ]));
    expect(items.every((item) => item.kind === 'swi')).toBe(true);
    const unavailable = { ...ready, romReady: false };
    expect(projectCompletionItems(file, buildProjectLanguageIndex([file]), '6502', file.content.length, unavailable)).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'OS_WriteC' })]));
    expect(projectHelpForToken(file, 'OS_WriteC', buildProjectLanguageIndex([file]), '6502', unavailable)).toMatchObject({ kind: 'swi', documentation: { compatibility: { supported: true, warning: expect.stringMatching(/ROM is not ready/) } } });
  });

  it('offers only buildable snippets compatible with the selected machine and toolchain', () => {
    const bbc: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC Micro Model B', romId: 'os12-basic2', romLabel: 'OS 1.20 / BASIC II', romReady: true, enabledCapabilities: [], toolchainId: 'cc65.ca65-ld65' };
    const assembly = source('asm', 'main.s', ' MOS_', '6502');
    expect(projectCompletionItems(assembly, buildProjectLanguageIndex([assembly]), '6502', assembly.content.length, bbc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'MOS_WRITE_CHAR', kind: 'snippet', insertText: 'LDA #$41\n  JSR OSWRCH' }),
    ]));
    const atom = { ...bbc, machineId: 'atom', machineLabel: 'Acorn Atom', romId: 'atom-mos', romLabel: 'Atom MOS' };
    expect(projectCompletionItems(assembly, buildProjectLanguageIndex([assembly]), '6502', assembly.content.length, atom).some((item) => item.kind === 'snippet')).toBe(false);
    const arm = source('arm', 'main.arm', ' RISCOS_', 'arm');
    const archimedes = { ...bbc, machineId: 'archimedes-a300', machineLabel: 'Archimedes A310', romId: 'riscos311', romLabel: 'RISC OS 3.11', toolchainId: 'gnu.arm-none-eabi-binutils' };
    expect(projectCompletionItems(arm, buildProjectLanguageIndex([arm]), '6502', arm.content.length, archimedes)).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'RISCOS_WRITE_CHAR', kind: 'snippet', insertText: 'MOV R0, #65\n  SWI 0x00' }),
    ]));
  });

  it('offers only symbols from the exact current build revision with resolved addresses', () => {
    const file = source('asm', 'main.asm', ' JSR generated_', '6502');
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC Micro Model B', romId: 'os12-basic2', romLabel: 'OS 1.20 / BASIC II', romReady: true, enabledCapabilities: [], toolchainId: '8bit-net.asm.6502', generatedSymbols: [{ name: 'generated_draw', value: 0x2345 }] };
    const items = projectCompletionItems(file, buildProjectLanguageIndex([file]), '6502', file.content.length, target);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'generated_draw', kind: 'symbol', signature: 'generated_draw = &2345', source: expect.objectContaining({ label: 'current build symbols' }) }),
    ]));
    expect(projectCompletionItems(file, buildProjectLanguageIndex([file]), '6502', file.content.length, { ...target, generatedSymbols: [] }).some((item) => item.token === 'generated_draw')).toBe(false);
    const declared = source('declared', 'declared.asm', '.draw\n RTS', '6502');
    const declaredTarget = { ...target, generatedSymbols: [{ name: 'draw', value: 0x1900 }] };
    const merged = projectCompletionItems(declared, buildProjectLanguageIndex([declared]), '6502', undefined, declaredTarget).filter((item) => item.token === 'draw');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: expect.objectContaining({ fileName: 'declared.asm' }), detail: expect.stringMatching(/current successful build.*&1900/) });
  });

  it('completes and navigates only versioned assets inside INCLUDEASSET', () => {
    const entry = source('entry', 'main.asm', 'INCLUDEASSET "he');
    const asset = { ...source('asset', 'hero.asset.json', '{}'), language: 'text' as const };
    const ordinary = source('lib', 'helper.asm', 'RTS'); const index = buildProjectLanguageIndex([entry, asset, ordinary]);
    expect(projectCompletionItems(entry, index, '6502', entry.content.length).map((item) => item.token)).toEqual(['hero.asset.json']);
    const complete = { ...entry, content: 'INCLUDEASSET "hero.asset.json"' }; const completeIndex = buildProjectLanguageIndex([complete, asset, ordinary]);
    expect(resolveProjectDefinition(complete, complete.content.indexOf('hero') + 2, completeIndex)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ fileId: 'asset', signature: 'INCLUDEASSET "hero.asset.json"' })] });
  });

  it('changes the project version whenever any indexed source changes', () => {
    const first = source('entry', 'main.asm', 'RTS');
    const before = buildProjectLanguageIndex([first]);
    const after = buildProjectLanguageIndex([{ ...first, content: 'NOP\nRTS' }]);
    expect(before.version).not.toBe(after.version);
    expect(before.revisionKey).not.toBe(after.revisionKey);
  });

  it('reports only authoritative BBC BASIC suffix types and does not infer assembly types', () => {
    const basic = source('basic', 'types.bas', '10 score%=1:name$="Ada":ratio=2.5\n20 REM fake%=9\n30 DEF PROCdraw(colour%, title$)', 'bbc-basic');
    const hints = bbcBasicTypeHints(basic);
    expect(hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'score%', type: 'signed integer', storage: '32-bit / 4 bytes' }),
      expect.objectContaining({ token: 'name$', type: 'string', storage: 'variable length' }),
      expect.objectContaining({ token: 'ratio', type: 'real', storage: '5-byte floating point' }),
      expect.objectContaining({ token: 'colour%', type: 'signed integer' }),
      expect.objectContaining({ token: 'title$', type: 'string' }),
    ]));
    expect(hints.some((hint) => hint.token === 'fake%')).toBe(false);
    const index = buildProjectLanguageIndex([basic]);
    expect(projectHelpForToken(basic, 'score%', index)).toMatchObject({ kind: 'type', signature: expect.stringMatching(/signed integer.*32-bit/) });
    expect(bbcBasicTypeHints(source('asm', 'main.asm', 'score% = 1'))).toEqual([]);
  });

  it('reports declared cc65 C types, sizes, signatures, members and address spaces without guessing aggregate layout', () => {
    const c = source('c', 'types.c', 'typedef struct {\n  unsigned char x;\n  int samples[4];\n} Sprite;\nstatic unsigned long ticks;\nvoid __fastcall__ draw(Sprite *sprite, unsigned char frame) {\n  int local = 1;\n}', 'c');
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC Micro Model B', romId: 'os12-basic2', romLabel: 'OS 1.20 / BASIC II', romReady: true, enabledCapabilities: [], toolchainId: 'cc65.c-bbc' };
    const hints = sourceTypeHints(c, target);
    expect(hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'x', role: 'member', type: 'unsigned char', storage: '8-bit / 1 byte', signedness: 'unsigned' }),
      expect.objectContaining({ token: 'samples', role: 'member', type: 'int [4]', storage: '4 elements / 8 bytes', signedness: 'signed' }),
      expect.objectContaining({ token: 'ticks', role: 'variable', type: 'static unsigned long', storage: '32-bit / 4 bytes', signedness: 'unsigned' }),
      expect.objectContaining({ token: 'draw', role: 'return', returns: 'void', parameters: ['Sprite *sprite', 'unsigned char frame'], callingConvention: '__fastcall__' }),
      expect.objectContaining({ token: 'sprite', role: 'parameter', storage: '16-bit pointer / 2 bytes', addressSpace: '16-bit CPU address space' }),
      expect.objectContaining({ token: 'frame', role: 'parameter', storage: '8-bit / 1 byte', signedness: 'unsigned' }),
      expect.objectContaining({ token: 'local', role: 'variable', storage: '16-bit / 2 bytes', signedness: 'signed' }),
    ]));
    expect(sourceTypeHints(source('asm', 'main.asm', 'value = 1'), target)).toEqual([]);
  });

  it('filters incompatible built-ins from completion while preserving explanatory help', () => {
    const basic = source('basic', 'main.bas', '10 SOUND 1,-15,53,20', 'bbc-basic');
    const index = buildProjectLanguageIndex([basic]);
    const bbc: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC Micro Model B', romId: 'os12-basic2', romLabel: 'OS 1.20 / BASIC II', romReady: true, enabledCapabilities: [] };
    const atom: LanguageTargetContext = { ...bbc, machineId: 'atom', machineLabel: 'Acorn Atom', romId: 'atom', romLabel: 'Atom ROMs' };
    expect(projectCompletionItems(basic, index, '6502', basic.content.length, bbc).some((item) => item.token === 'SOUND')).toBe(true);
    expect(projectCompletionItems(basic, index, '6502', basic.content.length, atom).some((item) => item.token === 'SOUND')).toBe(false);
    expect(projectHelpForToken(basic, 'SOUND', index, '6502', atom)?.documentation?.compatibility).toMatchObject({ supported: false });

    const assembly = source('asm', 'main.asm', ' JSR OSWRCH');
    const assemblyIndex = buildProjectLanguageIndex([assembly]);
    expect(projectCompletionItems(assembly, assemblyIndex, '6502', assembly.content.length, atom).some((item) => item.token === 'OSWRCH')).toBe(false);
    expect(projectHelpForToken(assembly, 'OSWRCH', assemblyIndex, '6502', atom)?.documentation?.compatibility).toMatchObject({ supported: false });
    const explicit = projectCompletionItems(basic, index, '6502', basic.content.indexOf('SOUND') + 3, atom, true);
    expect(explicit).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'SOUND', available: false, unavailableReason: expect.stringMatching(/not compatible/i) })]));
  });

  it('uses Atom integer type semantics and resolves Atom line labels for an Atom project', () => {
    const basic = source('basic', 'atom.bas', '10 A=1;DIM BB(4)\n20 GOSUB a\n100aA=A+1;RETURN', 'bbc-basic');
    const index = buildProjectLanguageIndex([basic]);
    const atom: LanguageTargetContext = { processor: '6502', machineId: 'atom', machineLabel: 'Acorn Atom', romId: 'atom-basic', romLabel: 'Atom BASIC / OS', romReady: true, enabledCapabilities: [] };
    expect(bbcBasicTypeHints(basic, atom)).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'A', type: 'signed integer', storage: '32-bit / 4 bytes', detail: expect.stringMatching(/Atom BASIC/) }),
    ]));
    expect(projectHelpForToken(basic, 'A', index, '6502', atom)).toMatchObject({ kind: 'type', signature: expect.stringMatching(/signed integer/) });
    expect(projectCompletionItems(basic, index, '6502', basic.content.length, atom)).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'a', detail: expect.stringMatching(/Atom BASIC line label/) })]));
    expect(resolveProjectDefinition(basic, basic.content.indexOf('a'), index)).toMatchObject({ status: 'resolved', candidates: [expect.objectContaining({ token: 'a', line: 3 })] });
    expect(projectSourceReferences(basic, index)).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'a', targetLine: 3, status: 'resolved' })]));
    expect(projectCompletionItems(basic, index, '6502', basic.content.length, atom).some((item) => item.token === 'FPRINT')).toBe(false);
    const floatingPoint = { ...atom, romId: 'atom-fp', enabledCapabilities: ['fp-rom'] };
    expect(projectCompletionItems(basic, index, '6502', basic.content.length, floatingPoint).some((item) => item.token === 'FPRINT')).toBe(true);
    const fpSource = { ...basic, content: '10 %A=PI' };
    expect(bbcBasicTypeHints(fpSource, floatingPoint)).toEqual(expect.arrayContaining([expect.objectContaining({ token: '%A', type: 'real', storage: '5-byte floating point' })]));
  });

  it('builds exact BASIC line-reference ranges and missing/duplicate diagnostics', () => {
    const basic = source('basic', 'lines.bas', '10 GOTO 20\n10 GOSUB 99\n20 END\nPRINT "DIRECT"', 'bbc-basic');
    const index = buildProjectLanguageIndex([basic]);
    const navigation = basicNavigationModel(basic, index);
    expect(navigation.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'GOTO 20', fromLine: 1, fromColumn: 9, length: 2, status: 'resolved', targetLine: 3 }),
      expect.objectContaining({ label: 'GOSUB 99', fromLine: 2, fromColumn: 10, length: 2, status: 'unresolved' }),
    ]));
    expect(navigation.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'duplicate-line', 'duplicate-line', 'missing-target', 'missing-line-number',
    ]);
    const references = findProjectReferences(basic, basic.content.indexOf('20'), index);
    expect(references.locations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reference', line: 1, column: 9, length: 2 })]));
  });

  it('reports duplicate and unresolved Atom line labels without guessing a target', () => {
    const atom = source('atom', 'atom.bas', '10 GOSUB a\n20aRETURN\n30aRETURN\n40 GOTO z\n50 GOTO 20', 'bbc-basic');
    const navigation = basicNavigationModel(atom, buildProjectLanguageIndex([atom]), true);
    expect(navigation.diagnostics.filter((diagnostic) => diagnostic.kind === 'duplicate-label')).toHaveLength(2);
    expect(navigation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ambiguous-target', line: 1 }),
      expect.objectContaining({ kind: 'missing-target', line: 4 }),
    ]));
    expect(navigation.references).toEqual(expect.arrayContaining([expect.objectContaining({ target: '20', targetLine: 2, status: 'resolved' })]));
  });
});

describe('C declarations the old pattern got wrong', () => {
  it('indexes an array of pointers, a function pointer and every declarator in one declaration', () => {
    const file = source('support', 'support.c', [
      'char *names[8];',
      'void (*handler)(int);',
      'int a, *b, c[3];',
      'unsigned char screen[8][8];',
      'void draw_sprite(int x, int y) {',
      '}',
    ].join('\n'), 'c');
    const index = buildProjectLanguageIndex([file]);
    const byToken = new Map(index.symbols.map((symbol) => [symbol.token, symbol]));

    /* Each of these was either missed entirely or given the wrong type. */
    expect(byToken.get('names')!.signature).toBe('char *names[8]');
    expect(byToken.get('handler')!.signature).toBe('void (*handler)(int)');
    expect([...byToken.keys()]).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(byToken.get('b')!.signature).toBe('int *b');
    expect(byToken.get('c')!.signature).toBe('int c[3]');
    expect(byToken.get('screen')!.signature).toBe('unsigned char screen[8][8]');
    expect(byToken.get('draw_sprite')).toMatchObject({ kind: 'function', parameters: ['int x', 'int y'] });
  });

  it('does not index a statement as a declaration', () => {
    const file = source('support', 'support.c', [
      'int counter = 0;',
      'void frame(void) {',
      '  return;',
      '  counter += 1;',
      '  draw_sprite(1, 2);',
      '}',
    ].join('\n'), 'c');
    const tokens = buildProjectLanguageIndex([file]).symbols.map((symbol) => symbol.token);
    expect(tokens.sort()).toEqual(['counter', 'frame']);
  });
});

describe('C declarations behind conditional compilation', () => {
  const cTarget = (defines: string[] = []): LanguageTargetContext => ({
    processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20',
    romReady: false, enabledCapabilities: [], toolchainId: 'cc65.ca65-ld65', buildDefines: defines,
  });

  const file = source('support', 'support.c', [
    '#define ALWAYS 1',
    '#ifdef DEBUG',
    '#define TRACE 1',
    '#else',
    '#define TRACE 0',
    '#endif',
    '#if VERSION > 2',
    '#define LATE 1',
    '#endif',
  ].join('\n'), 'c');
  const index = buildProjectLanguageIndex([file]);
  const items = (defines: string[]) => new Map(
    projectCompletionItems(file, index, '6502', file.content.length, cTarget(defines), true)
      .filter((item) => item.source?.kind === 'project')
      .map((item) => [item.token, item]),
  );

  it('offers an unconditional define with nothing said about a condition', () => {
    const item = items(['DEBUG']).get('ALWAYS')!;
    expect(item.available).not.toBe(false);
    expect(item.detail).not.toContain('build target');
  });

  it('marks a define in a branch this build does not take as unavailable, with the reason', () => {
    /* Offering it would suggest a symbol that will not exist when the code is
     * compiled, and the failure would appear later with no connection back. */
    const withoutDebug = items([]);
    const traceLines = index.symbols.filter((symbol) => symbol.token === 'TRACE');
    expect(traceLines).toHaveLength(2);
    const trace = withoutDebug.get('TRACE')!;
    expect(trace).toBeDefined();
    expect(trace.detail).toMatch(/build target/);
  });

  it('says a define in the taken branch is compiled, naming the condition', () => {
    const trace = items(['DEBUG']).get('TRACE')!;
    expect(trace.detail).toContain('defined(DEBUG)');
  });

  it('offers a define behind a condition it cannot settle, saying it cannot settle it', () => {
    /* `#if VERSION > 2` needs a value and an expression evaluator. Guessing
     * either way would be a confidence the product has not earned. */
    const late = items(['DEBUG']).get('LATE')!;
    expect(late.available).not.toBe(false);
    expect(late.detail).toContain('does not settle');
  });

  it('says nothing about conditions for a language that has none', () => {
    const assembly = source('main', 'main.asm', 'OSWRCH = &FFEE\n.start\n  RTS');
    const assemblyIndex = buildProjectLanguageIndex([assembly]);
    for (const symbol of assemblyIndex.symbols) expect(symbol.guards).toBeUndefined();
  });
});
