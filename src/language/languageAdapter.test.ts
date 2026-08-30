// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  languageAdapterFor,
  registeredLanguageAdapters,
  validateLanguageAdapters,
  type LanguageAdapter,
  type OutlineNode,
} from './languageAdapter';
import type { ProjectFile } from '../project/project';

function file(name: string, content: string, language: ProjectFile['language']): ProjectFile {
  return { id: name, name, content, language, modified: false } as ProjectFile;
}

const asm = (content: string) => file('main.asm', content, '6502');
const manifest = (content: string) => file('hero.asset.json', content, 'text');

/** Labels only, so a test states the shape rather than the whole node. */
function shape(nodes: readonly OutlineNode[]): unknown {
  return nodes.map((node) => node.children.length ? { [node.label]: shape(node.children) } : node.label);
}

describe('the adapter registry', () => {
  it('is internally consistent', () => {
    expect(validateLanguageAdapters()).toEqual([]);
    expect(registeredLanguageAdapters().length).toBeGreaterThanOrEqual(2);
  });

  it('reports every kind of malformed adapter rather than the first', () => {
    const broken = { id: '', language: '6502', label: ' ', dialects: [] } as unknown as LanguageAdapter;
    const problems = validateLanguageAdapters([broken]).map((problem) => problem.problem);
    expect(problems).toEqual(expect.arrayContaining([
      'has no identifier',
      'has no label',
      'names no dialect, so what it supports is unstated',
      'does not implement classify',
      'does not implement outline',
      'does not implement diagnostics',
    ]));
  });

  it('catches two adapters sharing an identifier', () => {
    const one = registeredLanguageAdapters()[0]!;
    expect(validateLanguageAdapters([one, one]).map((problem) => problem.problem))
      .toContain('shares its identifier with another adapter');
  });

  it('names the dialects it implements rather than implying them', () => {
    expect(languageAdapterFor(asm(''))!.dialects).toEqual(['Acorn-style (BeebAsm)', 'ca65']);
  });

  it('answers with nothing for a language this build has no adapter for', () => {
    /* Undefined is a real answer. A stub returning an empty outline and no
     * diagnostics would look like a working adapter and be believed. */
    expect(languageAdapterFor(file('notes.txt', 'hello', 'text'))).toBeUndefined();
    expect(languageAdapterFor(file('menu.bas', '10 END', 'bbc-basic'))).toBeUndefined();
  });

  it('recognises a project manifest by its name, since the project model calls it text', () => {
    expect(languageAdapterFor(manifest('{}'))!.id).toBe('8bit-net.language.manifest');
    expect(languageAdapterFor(file('level.map.json', '{}', 'text'))!.id).toBe('8bit-net.language.manifest');
    expect(languageAdapterFor(file('anything.json', '{}', 'text'))!.id).toBe('8bit-net.language.manifest');
  });
});

describe('6502 classification', () => {
  const classify = (line: string) => languageAdapterFor(asm(''))!.classify(line).map((item) => [line.substr(item.start, item.length), item.kind]);

  it('separates a mnemonic, a hexadecimal operand and a trailing comment', () => {
    expect(classify('  LDA #&1900 ; load it')).toEqual([['LDA', 'mnemonic'], ['#', 'punctuation'], ['&1900', 'number'], ['; load it', 'comment']]);
  });

  it('reads a leading dot as a label and a known directive as a directive', () => {
    expect(classify('.start')).toEqual([['.start', 'label']]);
    expect(classify('ORG &1900')).toEqual([['ORG', 'directive'], ['&1900', 'number']]);
    expect(classify('  EQUS "HI"')).toEqual([['EQUS', 'directive'], ['"HI"', 'string']]);
  });

  it('does not treat a semicolon inside a string as the start of a comment', () => {
    expect(classify('  EQUS "a;b"')).toEqual([['EQUS', 'directive'], ['"a;b"', 'string']]);
  });

  it('classifies a label followed by an instruction on one line', () => {
    expect(classify('.loop LDA &70')).toEqual([['.loop', 'label'], ['LDA', 'mnemonic'], ['&70', 'number']]);
  });

  it('reads binary, dollar and C hexadecimal, and decimal', () => {
    expect(classify('  LDA #%10101010').map((pair) => pair[1])).toEqual(['mnemonic', 'punctuation', 'number']);
    expect(classify('  LDA $7C00').map((pair) => pair[1])).toEqual(['mnemonic', 'number']);
    expect(classify('  LDA 0x70').map((pair) => pair[1])).toEqual(['mnemonic', 'number']);
    expect(classify('  LDA 112').map((pair) => pair[1])).toEqual(['mnemonic', 'number']);
  });

  it('takes an unknown word for an identifier rather than guessing', () => {
    expect(classify('  JSR draw_player')).toEqual([['JSR', 'mnemonic'], ['draw_player', 'identifier']]);
  });
});

describe('6502 outline', () => {
  const outline = (content: string) => languageAdapterFor(asm(''))!.outline(asm(content));

  it('nests what a label owns under it, and keeps includes at the top', () => {
    expect(shape(outline([
      'screen = &7C00',
      'INCLUDE "lib.asm"',
      '.start',
      'temp = &70',
      '  RTS',
      '.draw',
      '  RTS',
    ].join('\n')))).toEqual([
      'screen',
      'lib.asm',
      { start: ['temp'] },
      'draw',
    ]);
  });

  it('records what an include is, and strips the quotes from its path', () => {
    const [node] = outline('INCLUDEASSET "hero.asset.json"');
    expect(node).toMatchObject({ label: 'hero.asset.json', kind: 'include', detail: 'INCLUDEASSET', line: 1 });
  });

  it('closes a macro at ENDMACRO so what follows is not swallowed by it', () => {
    expect(shape(outline([
      '.macro plot x, y',
      'offset = 0',
      '.endmacro',
      'after = 1',
    ].join('\n')))).toEqual([{ plot: ['offset'] }, 'after']);
  });

  it('carries a constant’s value and a macro’s parameters as the detail', () => {
    const nodes = outline('.macro plot x, y\n.endmacro\nscreen = &7C00');
    expect(nodes[0]).toMatchObject({ kind: 'macro', detail: 'x, y' });
    expect(nodes[1]).toMatchObject({ kind: 'constant', detail: '&7C00' });
  });

  it('gives the exact line and column of everything it lists', () => {
    /* The column is the name's, not the dot's, which is where the project
     * symbol index also points, so navigation from either agrees. */
    const [label] = outline('\n\n  .start\n');
    expect(label).toMatchObject({ label: 'start', line: 3, column: 4 });
  });

  it('does not mistake a directive for a label or an instruction for a constant', () => {
    expect(outline('.byte 1, 2\n  LDA = &70')).toEqual([]);
  });
});

describe('6502 diagnostics, from one file alone', () => {
  const diagnose = (content: string) => languageAdapterFor(asm(''))!.diagnostics(asm(content));

  it('reports a label declared twice in this file, naming the first', () => {
    const [problem] = diagnose('.start\n  RTS\n.start\n  RTS');
    expect(problem).toMatchObject({ line: 3, severity: 'error' });
    expect(problem!.message).toContain('already declared at line 1');
  });

  it('accepts a constant restated at the value it already has, and reports one that disagrees', () => {
    expect(diagnose('OSWRCH = &FFEE\nOSWRCH = &FFEE')).toEqual([]);
    const [problem] = diagnose('OSWRCH = &FFEE\nOSWRCH = &FFC0');
    expect(problem!.message).toContain('&FFEE at line 1 and &FFC0 here');
  });

  it('reports a macro that is never closed, at the line that opened it', () => {
    const [problem] = diagnose('.macro plot\n  RTS');
    expect(problem).toMatchObject({ line: 1 });
    expect(problem!.message).toContain('never closed');
  });

  it('reports a macro opened inside another, and one closed without being opened', () => {
    expect(diagnose('.macro a\n.macro b\n.endmacro')[0]!.message).toContain('opens inside a');
    expect(diagnose('.endmacro')[0]!.message).toContain('never opened');
  });

  it('says nothing about a symbol it cannot see, because an included file may declare it', () => {
    /* One file is all an adapter sees. Calling an undeclared symbol an error
     * here would be wrong for every project that uses INCLUDE. */
    expect(diagnose('INCLUDE "lib.asm"\n.start\n  JSR draw_player\n  RTS')).toEqual([]);
  });

  it('ignores a duplicate that only appears inside a comment', () => {
    expect(diagnose('.start\n; .start again\n  RTS')).toEqual([]);
  });
});

describe('project manifests', () => {
  const adapter = () => languageAdapterFor(manifest('{}'))!;

  it('says nothing about a document of a schema it knows', () => {
    expect(adapter().diagnostics(manifest('{"schema":"8bit-net.tile-map","version":1}'))).toEqual([]);
    expect(adapter().diagnostics(manifest('{"format":"8bit-net-dev-project-21","name":"x"}'))).toEqual([]);
  });

  it('points at where the JSON actually failed rather than at line one', () => {
    /* The engine's message is not one shape: some failures carry a line and
     * column, some a byte position, and some only an excerpt of the text. All
     * three have to reach the same answer. */
    const [problem] = adapter().diagnostics(manifest('{\n  "schema": "8bit-net.tile-map",\n  "width": ,\n}'));
    expect(problem!.severity).toBe('error');
    expect(problem!.message).toContain('not valid JSON');
    expect(problem!.line).toBe(3);

    const [unterminated] = adapter().diagnostics(manifest('{\n  "schema": "8bit-net.tile-map"\n  "width": 8\n}'));
    expect(unterminated!.line).toBe(3);
  });

  it('never reports a position that is not in the document', () => {
    /* The three message shapes are handled, and where none of them yields a
     * position the diagnostic says so rather than pointing at line one as
     * though it meant it. Either way the line it gives has to exist. */
    const broken = ['{', '{"a":}', '[1,]', '{"a" 1}', '{\n\n\n  "a": ,\n}', 'not json', '{"a":"unterminated'];
    for (const content of broken) {
      const [problem] = adapter().diagnostics(manifest(content));
      expect(problem, content).toBeDefined();
      expect(problem!.severity).toBe('error');
      expect(problem!.line).toBeGreaterThanOrEqual(1);
      expect(problem!.line).toBeLessThanOrEqual(content.split('\n').length);
      expect(problem!.column).toBeGreaterThanOrEqual(1);
      /* When the parser gave nothing to go on, that is stated, not hidden. */
      if (problem!.message.includes('did not report where')) expect(problem!.line).toBe(1);
    }
  });

  it('says a schema it does not know cannot be checked, rather than calling it wrong', () => {
    const [problem] = adapter().diagnostics(manifest('{"schema":"someone-elses.format","version":1}'));
    expect(problem!.severity).toBe('warning');
    expect(problem!.message).toContain('is not a schema this build knows');
  });

  it('says a document declaring no schema at all cannot be checked either', () => {
    const [problem] = adapter().diagnostics(manifest('{"width":8}'));
    expect(problem!.message).toContain('declares no schema');
  });

  it('says a JSON array or literal is not a manifest', () => {
    expect(adapter().diagnostics(manifest('[1, 2, 3]'))[0]!.message).toContain('is a JSON object');
  });

  it('says nothing at all about an empty document, which is not yet wrong', () => {
    expect(adapter().diagnostics(manifest('   '))).toEqual([]);
  });

  it('outlines the top-level fields with what each holds, and nests one level', () => {
    const nodes = adapter().outline(manifest(JSON.stringify({
      schema: '8bit-net.tile-map',
      version: 1,
      size: { width: 8, height: 8 },
      tiles: [1, 2, 3],
    }, null, 2)));
    expect(nodes.map((node) => [node.label, node.detail])).toEqual([
      ['schema', '"8bit-net.tile-map"'],
      ['version', '1'],
      ['size', '2 fields'],
      ['tiles', '3 items'],
    ]);
    expect(shape(nodes)).toEqual(['schema', 'version', { size: ['width', 'height'] }, 'tiles']);
  });

  it('outlines nothing rather than guessing when the document will not parse', () => {
    expect(adapter().outline(manifest('{ broken'))).toEqual([]);
  });

  it('classifies a field name apart from a string value', () => {
    const line = '  "schema": "8bit-net.tile-map",';
    expect(adapter().classify(line).map((item) => [line.substr(item.start, item.length), item.kind])).toEqual([
      ['"schema"', 'label'],
      [':', 'punctuation'],
      ['"8bit-net.tile-map"', 'string'],
      [',', 'punctuation'],
    ]);
  });

  it('classifies the three JSON keywords apart from a bare word', () => {
    expect(adapter().classify('true false null other').map((item) => item.kind)).toEqual(['keyword', 'keyword', 'keyword', 'identifier']);
  });
});
