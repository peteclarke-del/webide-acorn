/* The language adapter API.
 *
 * Language behaviour was spread across the product: the outline was a private
 * helper inside the editor component, classification was implicit in the
 * editor's markup, and the per-language branches were `if (file.language ===
 * ...)` chains in several files at once. That works until a dialect is added,
 * at which point it has to be added everywhere and is inevitably added in
 * some places and not others.
 *
 * An adapter is the one declaration of what a language offers: how a line
 * classifies, what the outline of a document is, and what can be said about a
 * file on its own. "On its own" is the important boundary. An adapter sees one
 * file, so it reports only what one file can support — a duplicate label in
 * this file is a fact, an unresolved symbol is not, because the symbol may be
 * declared in an included file the adapter cannot see. Whole-project questions
 * stay with the project language service, which has the INCLUDE graph.
 *
 * Project manifests get an adapter too. The asset, tile-map, palette, font,
 * song, test-plan and project documents this product defines are JSON that a
 * person edits by hand often enough to deserve an outline and a straight
 * answer when a brace is missing, rather than being treated as plain text.
 */
import type { ProjectFile, SourceLanguage } from '../project/project';

export type OutlineKind =
  | 'section'
  | 'label'
  | 'constant'
  | 'macro'
  | 'procedure'
  | 'function'
  | 'type'
  | 'variable'
  | 'line'
  | 'include'
  | 'field';

export interface OutlineNode {
  label: string;
  kind: OutlineKind;
  /** One-line elaboration, shown beside the label. */
  detail?: string;
  line: number;
  column: number;
  children: OutlineNode[];
}

export type TokenClass =
  | 'comment'
  | 'string'
  | 'number'
  | 'directive'
  | 'mnemonic'
  | 'label'
  | 'keyword'
  | 'operator'
  | 'identifier'
  | 'punctuation'
  | 'text';

export interface SyntaxToken {
  /** Zero-based offset within the line. */
  start: number;
  length: number;
  kind: TokenClass;
}

export interface AdapterDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface LanguageAdapter {
  id: string;
  /** The project language this adapter serves. */
  language: SourceLanguage;
  label: string;
  /**
   * The dialects this adapter actually implements, named rather than implied.
   * A dialect absent from this list is not supported, whatever the file
   * extension suggests.
   */
  dialects: readonly string[];
  /** Classify one line. Pure, so a renderer can call it per visible line. */
  classify(line: string): SyntaxToken[];
  /** The structure of one document, nested. */
  outline(file: ProjectFile): OutlineNode[];
  /**
   * What can be said about this file without seeing any other. Cross-file
   * questions belong to the project language service, which has the graph.
   */
  diagnostics(file: ProjectFile): AdapterDiagnostic[];
}

/* ---- shared helpers -------------------------------------------------------- */

function token(start: number, length: number, kind: TokenClass): SyntaxToken {
  return { start, length, kind };
}

/** Where a line comment starts, or -1. Quotes are respected. */
function commentStart(line: string, markers: readonly string[]): number {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (quote) { if (character === quote) quote = null; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    for (const marker of markers) {
      if (line.startsWith(marker, index)) return index;
    }
  }
  return -1;
}

/* Tokenise the part of a line before any comment, with a caller-supplied rule
 * for what a bare word is. Shared so every adapter splits strings, numbers and
 * punctuation the same way and only disagrees where languages disagree. */
function classifyCode(line: string, upTo: number, word: (value: string, index: number) => TokenClass): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  let wordIndex = 0;
  while (index < upTo) {
    const character = line[index]!;
    if (/\s/.test(character)) { index += 1; continue; }
    if (character === '"' || character === "'") {
      const close = line.indexOf(character, index + 1);
      const end = close < 0 || close >= upTo ? upTo : close + 1;
      tokens.push(token(index, end - index, 'string'));
      index = end;
      continue;
    }
    const number = /^(?:&[0-9A-Fa-f]+|\$[0-9A-Fa-f]+|0[xX][0-9A-Fa-f]+|%[01]+|\d+)/.exec(line.slice(index, upTo));
    if (number) { tokens.push(token(index, number[0].length, 'number')); index += number[0].length; continue; }
    const identifier = /^[A-Za-z_.][A-Za-z0-9_.]*/.exec(line.slice(index, upTo));
    if (identifier) {
      tokens.push(token(index, identifier[0].length, word(identifier[0], wordIndex)));
      wordIndex += 1;
      index += identifier[0].length;
      continue;
    }
    tokens.push(token(index, 1, /[-+*/<>=!&|^~]/.test(character) ? 'operator' : 'punctuation'));
    index += 1;
  }
  return tokens;
}

function classifyLine(line: string, markers: readonly string[], word: (value: string, index: number) => TokenClass): SyntaxToken[] {
  const comment = commentStart(line, markers);
  const upTo = comment < 0 ? line.length : comment;
  const tokens = classifyCode(line, upTo, word);
  if (comment >= 0) tokens.push(token(comment, line.length - comment, 'comment'));
  return tokens;
}

/** Attach a node under the most recent scope-opening node, or at the top. */
function nest(roots: OutlineNode[], scope: OutlineNode | null, node: OutlineNode): void {
  (scope ? scope.children : roots).push(node);
}

/* ---- 6502 ------------------------------------------------------------------ */

const MNEMONICS_6502 = new Set([
  'ADC', 'AND', 'ASL', 'BCC', 'BCS', 'BEQ', 'BIT', 'BMI', 'BNE', 'BPL', 'BRK', 'BVC', 'BVS',
  'CLC', 'CLD', 'CLI', 'CLV', 'CMP', 'CPX', 'CPY', 'DEC', 'DEX', 'DEY', 'EOR', 'INC', 'INX',
  'INY', 'JMP', 'JSR', 'LDA', 'LDX', 'LDY', 'LSR', 'NOP', 'ORA', 'PHA', 'PHP', 'PLA', 'PLP',
  'ROL', 'ROR', 'RTI', 'RTS', 'SBC', 'SEC', 'SED', 'SEI', 'STA', 'STX', 'STY', 'TAX', 'TAY',
  'TSX', 'TXA', 'TXS', 'TYA',
  /* 65C02 additions, which the product's own 65C12 target also accepts. */
  'BRA', 'PHX', 'PHY', 'PLX', 'PLY', 'STZ', 'TRB', 'TSB',
]);

const DIRECTIVES_6502 = new Set([
  'ORG', 'EQUB', 'EQUW', 'EQUS', 'EQUD', 'BYTE', 'WORD', 'TEXT', 'SKIP', 'ALIGN', 'SAVE',
  'INCLUDE', 'INCBIN', 'INCLUDEASSET', 'INCLUDEMAP', 'INCLUDEPALETTE', 'INCLUDEFONT',
  'INCLUDESCREEN', 'INCLUDESONG', 'MACRO', 'ENDMACRO', 'IF', 'ELSE', 'ENDIF', 'FOR', 'NEXT',
  'SEGMENT', 'EXPORT', 'IMPORT', 'DEFINE', 'SET', 'PROC', 'ENDPROC', 'RES', 'ASSERT',
]);

const asm6502Adapter: LanguageAdapter = {
  id: '8bit-net.language.6502',
  language: '6502',
  label: '6502 and 65C12 assembly',
  dialects: ['Acorn-style (BeebAsm)', 'ca65'],

  classify(line) {
    return classifyLine(line, [';'], (value, index) => {
      const bare = value.replace(/^\./, '').toUpperCase();
      if (value.startsWith('.') && !DIRECTIVES_6502.has(bare)) return 'label';
      if (DIRECTIVES_6502.has(bare)) return 'directive';
      if (index === 0 && MNEMONICS_6502.has(bare)) return 'mnemonic';
      if (MNEMONICS_6502.has(bare) && index <= 1) return 'mnemonic';
      return 'identifier';
    });
  },

  outline(file) {
    const roots: OutlineNode[] = [];
    let scope: OutlineNode | null = null;
    file.content.split('\n').forEach((line, index) => {
      const code = line.slice(0, commentStart(line, [';']) < 0 ? line.length : commentStart(line, [';']));
      const number = index + 1;

      const include = /^\s*(INCLUDE(?:ASSET|MAP|PALETTE|FONT|SCREEN|SONG)?)\s+(.+?)\s*$/i.exec(code);
      if (include) {
        /* An include is always top level: it is a statement about the file, not
         * about whichever label happens to precede it. */
        roots.push({ label: include[2]!.replace(/^["']|["']$/g, ''), kind: 'include', detail: include[1]!.toUpperCase(), line: number, column: code.indexOf(include[2]!) + 1, children: [] });
        return;
      }

      const macro = /^\s*\.?macro\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.+))?$/i.exec(code);
      if (macro) {
        const node: OutlineNode = { label: macro[1]!, kind: 'macro', detail: macro[2]?.trim(), line: number, column: code.indexOf(macro[1]!) + 1, children: [] };
        roots.push(node);
        scope = node;
        return;
      }
      if (/^\s*\.?endmacro\b/i.test(code)) { scope = null; return; }

      const label = /^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*):)/.exec(code);
      const labelToken = label?.[1] ?? label?.[2];
      if (labelToken && !DIRECTIVES_6502.has(labelToken.toUpperCase())) {
        const node: OutlineNode = { label: labelToken, kind: 'label', line: number, column: code.indexOf(labelToken) + 1, children: [] };
        roots.push(node);
        scope = node;
        return;
      }

      const constant = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\bEQU\b)\s*(.+)$/i.exec(code);
      if (constant && !MNEMONICS_6502.has(constant[1]!.toUpperCase())) {
        /* A constant declared inside a label's body belongs to it; one declared
         * before any label belongs to the file. */
        nest(roots, scope, { label: constant[1]!, kind: 'constant', detail: constant[2]!.trim(), line: number, column: code.indexOf(constant[1]!) + 1, children: [] });
      }
    });
    return roots;
  },

  diagnostics(file) {
    const results: AdapterDiagnostic[] = [];
    const labels = new Map<string, number>();
    const constants = new Map<string, { line: number; value: string }>();
    let macro: { name: string; line: number } | null = null;

    file.content.split('\n').forEach((line, index) => {
      const cut = commentStart(line, [';']);
      const code = line.slice(0, cut < 0 ? line.length : cut);
      const number = index + 1;

      const macroOpen = /^\s*\.?macro\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(code);
      if (macroOpen) {
        if (macro) results.push({ line: number, column: 1, severity: 'error', message: `${macroOpen[1]} opens inside ${macro.name}, which was opened at line ${macro.line} and never closed.` });
        macro = { name: macroOpen[1]!, line: number };
        return;
      }
      if (/^\s*\.?endmacro\b/i.test(code)) {
        if (!macro) results.push({ line: number, column: 1, severity: 'error', message: 'ENDMACRO closes a macro that was never opened.' });
        macro = null;
        return;
      }

      const label = /^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*):)/.exec(code);
      const labelToken = label?.[1] ?? label?.[2];
      if (labelToken && !DIRECTIVES_6502.has(labelToken.toUpperCase())) {
        const key = labelToken.toUpperCase();
        const first = labels.get(key);
        if (first !== undefined) results.push({ line: number, column: code.indexOf(labelToken) + 1, severity: 'error', message: `${labelToken} is already declared at line ${first} in this file.` });
        else labels.set(key, number);
      }

      const constant = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\bEQU\b)\s*(.+)$/i.exec(code);
      if (constant && !MNEMONICS_6502.has(constant[1]!.toUpperCase())) {
        const key = constant[1]!.toUpperCase();
        const value = constant[2]!.trim();
        const previous = constants.get(key);
        /* Restating a constant at the value it already has is what real
         * listings do. Restating it at a different value is a mistake. */
        if (previous && previous.value !== value) {
          results.push({ line: number, column: code.indexOf(constant[1]!) + 1, severity: 'error', message: `${constant[1]} is ${previous.value} at line ${previous.line} and ${value} here.` });
        } else if (!previous) constants.set(key, { line: number, value });
      }
    });

    if (macro) results.push({ line: (macro as { line: number }).line, column: 1, severity: 'error', message: `${(macro as { name: string }).name} is opened here and never closed with ENDMACRO.` });
    return results;
  },
};

/* ---- project manifests ------------------------------------------------------ */

/* The JSON documents this product defines, by the field each uses to announce
 * itself. A manifest whose schema is not here is still valid JSON and still
 * gets an outline; it is simply not one of ours, and is said to be. */
const KNOWN_MANIFESTS: Readonly<Record<string, string>> = Object.freeze({
  '8bit-net.pixel-asset': 'pixel asset',
  '8bit-net.tile-map': 'tile map',
  '8bit-net.palette': 'palette',
  '8bit-net.font': 'font',
  '8bit-net.song': 'song',
  '8bit-net.screen': 'screen',
  '8bit-net.test-plan': 'test plan',
  '8bit-net.disk-set': 'disk set',
  '8bit-net.settings': 'settings',
  '8bit-net.project-bundle': 'project bundle',
  '8bit-net.analysis-annotations': 'analysis annotations',
  '8bit-net.template-catalogue': 'template catalogue',
});

const JSON_KEYWORDS = new Set(['true', 'false', 'null']);

/**
 * Where a JSON parse failure sits in the text.
 *
 * The engine's message is not one shape. Some failures carry a line and
 * column, some carry a byte position, and some carry only an excerpt of the
 * text around the problem — so all three are read, in that order, and the
 * excerpt is located in the document. When none of them yields a position,
 * `located` is false and the caller says so rather than pointing at line one
 * as though it meant it. Claiming a wrong line is worse than admitting none.
 */
function jsonErrorPosition(text: string, error: unknown): { line: number; column: number; located: boolean } {
  const message = error instanceof Error ? error.message : String(error);

  const lineColumn = /line (\d+) column (\d+)/i.exec(message);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]), located: true };

  const fromOffset = (offset: number) => {
    const before = text.slice(0, Math.min(Math.max(offset, 0), text.length));
    return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n'), located: true };
  };

  const at = /position (\d+)/i.exec(message);
  if (at) return fromOffset(Number(at[1]));

  /* The remaining shape quotes the text around the problem, so find it. */
  const quoted = /"((?:.|\n)*)" is not valid JSON$/.exec(message.replace(/^[^"]*\.\.\./, ''));
  const excerpt = quoted?.[1];
  if (excerpt) {
    const found = text.indexOf(excerpt);
    if (found >= 0) return fromOffset(found);
  }
  return { line: 1, column: 1, located: false };
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (value === null) return 'null';
  if (typeof value === 'object') return `${Object.keys(value as object).length} field${Object.keys(value as object).length === 1 ? '' : 's'}`;
  if (typeof value === 'string') return value.length > 40 ? `"${value.slice(0, 40)}…"` : `"${value}"`;
  return String(value);
}

/** The line a top-level key sits on, found by scanning rather than re-parsing. */
function keyLine(text: string, key: string): { line: number; column: number } {
  const needle = `"${key}"`;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const at = lines[index]!.indexOf(needle);
    if (at >= 0) return { line: index + 1, column: at + 1 };
  }
  return { line: 1, column: 1 };
}

const manifestAdapter: LanguageAdapter = {
  id: '8bit-net.language.manifest',
  language: 'text',
  label: 'Project manifests',
  dialects: ['JSON'],

  classify(line) {
    const tokens: SyntaxToken[] = [];
    let index = 0;
    while (index < line.length) {
      const character = line[index]!;
      if (/\s/.test(character)) { index += 1; continue; }
      if (character === '"') {
        const end = /"(?:[^"\\]|\\.)*"/.exec(line.slice(index));
        const length = end ? end[0].length : line.length - index;
        /* A string followed by a colon is a field name, not a value. */
        const after = line.slice(index + length).match(/^\s*:/);
        tokens.push(token(index, length, after ? 'label' : 'string'));
        index += length;
        continue;
      }
      const number = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(line.slice(index));
      if (number) { tokens.push(token(index, number[0].length, 'number')); index += number[0].length; continue; }
      const word = /^[a-z]+/.exec(line.slice(index));
      if (word) { tokens.push(token(index, word[0].length, JSON_KEYWORDS.has(word[0]) ? 'keyword' : 'identifier')); index += word[0].length; continue; }
      tokens.push(token(index, 1, 'punctuation'));
      index += 1;
    }
    return tokens;
  },

  outline(file) {
    let parsed: unknown;
    try { parsed = JSON.parse(file.content); }
    catch { return []; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
      const position = keyLine(file.content, key);
      const children = value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>).slice(0, 50).map(([childKey, childValue]) => ({
          label: childKey, kind: 'field' as const, detail: describeValue(childValue),
          ...keyLine(file.content, childKey), children: [],
        }))
        : [];
      return { label: key, kind: 'field' as const, detail: describeValue(value), ...position, children };
    });
  },

  diagnostics(file) {
    if (!file.content.trim()) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(file.content); }
    catch (error) {
      const { line, column, located } = jsonErrorPosition(file.content, error);
      const detail = error instanceof Error ? error.message : String(error);
      return [{
        line,
        column,
        severity: 'error',
        message: located
          ? `This document is not valid JSON: ${detail}`
          : `This document is not valid JSON, and the parser did not report where: ${detail}`,
      }];
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [{ line: 1, column: 1, severity: 'warning', message: 'A project manifest is a JSON object. This document parses, but it is not one of the documents this product defines.' }];
    }
    const record = parsed as Record<string, unknown>;
    const declared = typeof record.schema === 'string' ? record.schema : typeof record.format === 'string' ? record.format : null;
    if (!declared) {
      return [{ line: 1, column: 1, severity: 'warning', message: 'This document declares no schema, so nothing can be checked beyond it being valid JSON.' }];
    }
    const known = KNOWN_MANIFESTS[declared] ?? (declared.startsWith('8bit-net-dev-project-') ? 'project document' : null);
    if (!known) {
      return [{ ...keyLine(file.content, 'schema' in record ? 'schema' : 'format'), severity: 'warning', message: `${declared} is not a schema this build knows, so nothing can be checked beyond it being valid JSON.` }];
    }
    return [];
  },
};

/* ---- the registry ---------------------------------------------------------- */

const ADAPTERS: readonly LanguageAdapter[] = Object.freeze([asm6502Adapter, manifestAdapter]);

/** Every adapter this build registers. */
export function registeredLanguageAdapters(): readonly LanguageAdapter[] {
  return ADAPTERS;
}

/**
 * The adapter for a file, or undefined when this build has none.
 *
 * Undefined is a real answer: a language with no adapter gets the product's
 * unassisted behaviour, which is honest, rather than a stub that produces an
 * empty outline and no diagnostics and looks like a working one.
 */
export function languageAdapterFor(file: Pick<ProjectFile, 'language' | 'name'>): LanguageAdapter | undefined {
  /* A manifest is recognised by its name rather than its language: the project
   * model classifies `.json` as text, which is true and not useful here. */
  if (/\.(?:asset|map|palette|font|song|screen|plan|set|settings|bundle)?\.?json$/i.test(file.name)) return manifestAdapter;
  return ADAPTERS.find((adapter) => adapter.language === file.language && adapter !== manifestAdapter);
}

export interface AdapterProblem {
  where: string;
  problem: string;
}

/**
 * Check the registered adapters against the rules callers depend on. Run by a
 * contract test: a broken registry is a build defect, not a runtime condition.
 */
export function validateLanguageAdapters(adapters: readonly LanguageAdapter[] = ADAPTERS): AdapterProblem[] {
  const problems: AdapterProblem[] = [];
  const ids = new Set<string>();
  for (const adapter of adapters) {
    const where = adapter.id || '(an adapter with no id)';
    if (!adapter.id) problems.push({ where, problem: 'has no identifier' });
    if (ids.has(adapter.id)) problems.push({ where, problem: 'shares its identifier with another adapter' });
    ids.add(adapter.id);
    if (!adapter.label.trim()) problems.push({ where, problem: 'has no label' });
    if (!adapter.dialects.length) problems.push({ where, problem: 'names no dialect, so what it supports is unstated' });
    for (const method of ['classify', 'outline', 'diagnostics'] as const) {
      if (typeof adapter[method] !== 'function') problems.push({ where, problem: `does not implement ${method}` });
    }
  }
  return problems;
}
