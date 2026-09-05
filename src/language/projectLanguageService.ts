import { opcodeTable } from '../analysis/disassembler6502';
import { parseCDeclaration } from './cDeclarators';
import { commitCharactersFor } from './completionModel';
import { definedNames, guardState, guardSummary, guardsByLine, type Guard } from './cPreprocessor';
import type { Processor } from '../analysis/types';
import type { ProjectFile } from '../project/project';
import {
  completionItems,
  signatureHelpAt,
  sourceReferences,
  tokenAt,
  type LanguageItem,
  type SignatureHelp,
  type SourceDefinition,
  type SourceReference,
} from './languageService';
import { instructionLanguageItem } from './instructionReference6502';
import { basicLanguageItem, mosLanguageItem } from './acornLanguageReference';
import { acornTargetReferenceItems } from './acornTargetReference';
import { languageSnippetItems } from './languageSnippets';
import type { LanguageTargetContext } from './languageTarget';
import { resolveIncluded } from '../project/includeResolution';

export interface ProjectSymbol extends SourceDefinition {
  /* Conditional-compilation directives guarding this declaration, when there
   * are any. A `#define` inside `#ifdef DEBUG` exists only in a build that
   * defines DEBUG, and offering it unconditionally suggests a symbol that will
   * not be there when the code is compiled. */
  guards?: Guard[];
  fileId: string;
  fileName: string;
  language: ProjectFile['language'];
  signature: string;
  parameters: string[];
}

export interface ProjectLanguageIndex {
  version: string;
  revisionKey: string;
  files: ProjectFile[];
  symbols: ProjectSymbol[];
  includes: Map<string, string[]>;
}

export interface DefinitionResolution {
  token: string;
  status: 'resolved' | 'ambiguous' | 'unresolved';
  candidates: ProjectSymbol[];
  reason: string;
}

export type ProjectRelationshipKind = 'definition' | 'declaration' | 'implementation' | 'type-definition';

export interface SdkDocumentTarget { path: string; token?: string }

export interface ProjectSourceReference extends SourceReference {
  status: DefinitionResolution['status'];
  targetFileId?: string;
  targetFileName?: string;
  targetColumn?: number;
  targetLength?: number;
  candidates?: ProjectSymbol[];
  reason: string;
}

export interface BasicNavigationDiagnostic {
  id: string;
  severity: 'error' | 'warning';
  kind: 'missing-line-number' | 'line-range' | 'duplicate-line' | 'duplicate-label' | 'missing-target' | 'ambiguous-target';
  line: number;
  column: number;
  message: string;
}

export interface BasicNavigationModel {
  references: ProjectSourceReference[];
  diagnostics: BasicNavigationDiagnostic[];
  declaredLines: Array<{ number: number; line: number; column: number }>;
}

export interface ProjectReferenceLocation {
  token: string;
  fileId: string;
  fileName: string;
  line: number;
  column: number;
  length: number;
  kind: 'declaration' | 'reference';
}

export interface ProjectReferenceResult {
  token: string;
  status: DefinitionResolution['status'];
  reason: string;
  declarations: ProjectSymbol[];
  locations: ProjectReferenceLocation[];
}

export interface ProjectCallHierarchyEdge {
  direction: 'incoming' | 'outgoing';
  caller: string;
  callee: string;
  fileId: string;
  fileName: string;
  line: number;
  column: number;
  length: number;
  targetFileId?: string;
  targetFileName?: string;
  targetLine?: number;
  targetColumn?: number;
  targetLength?: number;
}

export interface ProjectCallHierarchyResult {
  token: string;
  status: DefinitionResolution['status'];
  reason: string;
  incoming: ProjectCallHierarchyEdge[];
  outgoing: ProjectCallHierarchyEdge[];
}

export interface BasicTypeHint {
  token: string;
  line: number;
  column: number;
  type: 'signed integer' | 'string' | 'real';
  storage: '32-bit / 4 bytes' | 'variable length' | '5-byte floating point';
  detail: string;
}

export interface SourceTypeHint {
  token: string;
  line: number;
  column: number;
  type: string;
  storage: string;
  detail: string;
  role: 'variable' | 'parameter' | 'return' | 'member';
  signedness?: string;
  addressSpace?: string;
  parameters?: string[];
  returns?: string;
  callingConvention?: string;
}

export function buildProjectLanguageIndex(files: ProjectFile[]): ProjectLanguageIndex {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const includes = new Map<string, string[]>();
  const symbols = files.flatMap(extractSymbols);
  for (const file of files) {
    const assemblyTargets = Array.from(file.content.matchAll(/^\s*\.?INCLUDE(?:ASSET)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))/gim))
      .map((match) => resolveIncluded(byName, match[1] ?? match[2] ?? match[3] ?? '', file.name)?.id)
      .filter((id): id is string => !!id);
    const cTargets = file.language === 'c' ? Array.from(file.content.matchAll(/^\s*#\s*include\s*"([^"]+)"/gim))
      .map((match) => resolveIncluded(byName, match[1] ?? '', file.name)?.id)
      .filter((id): id is string => !!id) : [];
    includes.set(file.id, Array.from(new Set([...assemblyTargets, ...cTargets])));
  }
  return { version: projectVersion(files), revisionKey: exactProjectRevision(files), files, symbols, includes };
}

/**
 * Completion candidates for a position, with their commit characters decided
 * by the one rule that decides them. Applying it here rather than at each of
 * the twenty places a candidate is built means a producer cannot declare a set
 * that disagrees with the rule, which is exactly the drift this codebase has
 * had to remove elsewhere.
 */
export function projectCompletionItems(file: ProjectFile, index: ProjectLanguageIndex, processor: Processor = '6502', position?: number, target?: LanguageTargetContext, includeUnavailable = false): LanguageItem[] {
  return completionCandidates(file, index, processor, position, target, includeUnavailable)
    .map((item) => ({ ...item, commitCharacters: commitCharactersFor(item) }));
}

function completionCandidates(file: ProjectFile, index: ProjectLanguageIndex, processor: Processor = '6502', position?: number, target?: LanguageTargetContext, includeUnavailable = false): LanguageItem[] {
  const sourceVersion = index.version;
  const requestPosition = position ?? file.content.length;
  const includeContext = position === undefined ? undefined : includeContextAt(file, requestPosition);
  if (includeContext) {
    const projectFiles = index.files.filter((candidate) => candidate.id !== file.id && (includeContext.kind === 'asset' ? /\.asset\.json$/i.test(candidate.name) : includeContext.kind === 'c' ? /\.(?:h|inc)$/i.test(candidate.name) : candidate.language === file.language)).map((candidate) => ({
      token: candidate.name,
      kind: 'file' as const,
      detail: includeContext.kind === 'asset' ? `Versioned pixel asset available as a live generated dependency from ${file.name}.` : includeContext.kind === 'c' ? `Project header available through the active target include paths from ${file.name}.` : `Project assembly source file available to INCLUDE from ${file.name}.`,
      signature: includeContext.kind === 'c' ? `#include "${candidate.name}"` : `${includeContext.kind === 'asset' ? 'INCLUDEASSET' : 'INCLUDE'} "${candidate.name}"`,
      languages: [file.language],
      insertText: `${candidate.name}${includeContext.close ?? ''}`,
      commitCharacters: ['Enter', 'Tab'] as Array<'Enter' | 'Tab'>,
      source: { kind: 'project' as const, label: candidate.name, version: sourceVersion, fileId: candidate.id, fileName: candidate.name },
    }));
    if (includeContext.kind !== 'c') return projectFiles;
    const sdkHeaders = target?.toolchainId === 'cc65.c-bbc' ? [
      ['acorn.h', '8bit-net BBC C SDK declarations for MOS character I/O.'],
      ['conio.h', 'cc65 console I/O declarations supported by the selected BBC runtime.'],
      ['peekpoke.h', 'cc65 absolute memory access macros.'],
    ] : [];
    return [...projectFiles, ...sdkHeaders.map(([name, detail]) => ({ token: name!, kind: 'file' as const, detail: detail!, signature: `#include <${name}>`, languages: ['c' as const], insertText: `${name}${includeContext.close ?? ''}`, commitCharacters: ['Enter', 'Tab'] as Array<'Enter' | 'Tab'>, source: { kind: 'builtin' as const, label: 'active toolchain SDK', version: target?.toolchainId ?? 'no-toolchain' } }))];
  }

  const allowedOpcodes = new Set(opcodeTable(processor).flatMap((opcode) => opcode ? [opcode.mnemonic] : []));
  const rawBuiltins = [...completionItems(file, target), ...(includeUnavailable && target ? completionItems(file) : [])].filter((item) => item.kind !== 'symbol' && item.kind !== 'line');
  const builtinByKey = new Map<string, LanguageItem>();
  for (const raw of rawBuiltins) {
    const enriched = file.language === '6502' && raw.kind === 'opcode' ? instructionLanguageItem(raw.token, processor) ?? raw
      : file.language === '6502' && raw.kind === 'mos' ? mosLanguageItem(raw.token, target) ?? raw
        : file.language === 'bbc-basic' ? basicLanguageItem(raw.token, target) ?? raw : raw;
    const available = enriched.documentation?.compatibility?.supported !== false && (file.language !== '6502' || enriched.kind !== 'opcode' || allowedOpcodes.has(enriched.token));
    const item = { ...enriched, available, unavailableReason: available ? undefined : enriched.documentation?.compatibility?.warning ?? `${enriched.token} is incompatible with the selected target.`, commitCharacters: ['Enter', 'Tab'] as Array<'Enter' | 'Tab'>, source: enriched.source ?? { kind: 'builtin' as const, label: `${file.language} reference`, version: 'offline-reference-1' } };
    const key = `${item.kind}:${normalizeSymbol(item.token)}`;
    if (!builtinByKey.has(key) || builtinByKey.get(key)?.available === false && item.available) builtinByKey.set(key, item);
  }
  const builtins = [...builtinByKey.values()].filter((item) => includeUnavailable || item.available !== false);
  const related = relatedFiles(index, file.id);
  const memberItems = file.language === 'c' && position !== undefined ? cMemberCompletionItems(file, position, index, related) : undefined;
  if (memberItems) return memberItems;
  const projectSymbols = index.symbols.filter((symbol) => symbol.language === file.language && (!['6502', 'arm', 'c'].includes(file.language) ? symbol.fileId === file.id : related.has(symbol.fileId)))
    .map((symbol) => symbolItem(symbol, sourceVersion, definedNames(target?.buildDefines ?? [])));
  const sortedSymbols = projectSymbols.sort((left, right) => sourceRank(left, file.id) - sourceRank(right, file.id) || (left.kind === 'line' && right.kind === 'line' ? Number(left.token) - Number(right.token) : left.token.localeCompare(right.token)));
  const localVariables = file.language === 'bbc-basic' ? bbcBasicTypeHints(file, target).map((hint): LanguageItem => ({ token: hint.token, kind: 'variable', detail: `${hint.type}, ${hint.storage}; first assigned or declared at ${file.name}:${hint.line}. ${hint.detail}`, signature: `${hint.token}: ${hint.type}`, languages: ['bbc-basic'], commitCharacters: ['Enter', 'Tab'], source: { kind: 'project', label: `${file.name}:${hint.line}`, version: sourceVersion, fileId: file.id, fileName: file.name } })) : [];
  const scopedVariables = file.language === 'c' && position !== undefined ? cLocalCompletionItems(file, position, sourceVersion) : [];
  const defines = buildDefineItems(file, target);
  const generatedSymbols = generatedSymbolItems(file, target);
  const generatedByToken = new Map(generatedSymbols.map((item) => [normalizeSymbol(item.token), item]));
  const completionSymbols = sortedSymbols.map((item) => {
    const generated = generatedByToken.get(normalizeSymbol(item.token));
    return generated ? { ...item, detail: `${item.detail} ${generated.detail}`, signature: `${item.signature ?? item.token} · ${generated.signature}` } : item;
  });
  const sourceTokens = new Set(sortedSymbols.map((item) => normalizeSymbol(item.token)));
  const generatedOnly = generatedSymbols.filter((item) => !sourceTokens.has(normalizeSymbol(item.token)));
  const registers = file.language === 'arm' ? armRegisterItems() : [];
  const targetReferences = acornTargetReferenceItems(file, target).map((item) => ({ ...item, available: item.documentation?.compatibility?.supported !== false, unavailableReason: item.documentation?.compatibility?.supported === false ? item.documentation.compatibility.warning ?? `${item.token} is incompatible with the selected target.` : undefined })).filter((item) => includeUnavailable || item.available !== false);
  const snippets = languageSnippetItems(file, target);
  const slot = position === undefined ? 'general' : completionSlotAt(file, requestPosition, target?.machineId === 'atom');
  if (slot === 'basic-line-target') return completionSymbols.filter((item) => item.kind === 'line' || item.detail.includes('Atom BASIC line label'));
  if (slot === 'assembly-target') return [...completionSymbols.filter((item) => item.kind === 'symbol' || item.kind === 'constant'), ...generatedOnly, ...defines, ...builtins.filter((item) => file.language === '6502' && item.kind === 'mos')];
  if (slot === 'arm-swi') return targetReferences.filter((item) => item.kind === 'swi');
  if (slot === 'assembly-operand') return [...completionSymbols.filter((item) => item.kind !== 'macro' && item.kind !== 'function'), ...generatedOnly, ...defines, ...registers, ...targetReferences.filter((item) => item.kind === 'hardware'), ...builtins.filter((item) => file.language === '6502' && item.kind === 'mos')];
  if (slot === 'assembly-mnemonic') return [...completionSymbols.filter((item) => item.kind === 'macro'), ...snippets, ...builtins.filter((item) => item.kind === 'opcode' || item.kind === 'directive')];
  return [...scopedVariables, ...completionSymbols, ...localVariables, ...generatedOnly, ...defines, ...registers, ...targetReferences, ...snippets, ...builtins];
}

export function projectHelpForToken(file: ProjectFile, token: string, index: ProjectLanguageIndex, processor: Processor = '6502', target?: LanguageTargetContext): LanguageItem | undefined {
  const normalized = normalizeSymbol(token);
  const typeHint = file.language === 'bbc-basic' ? bbcBasicTypeHints(file, target).find((hint) => normalizeSymbol(hint.token) === normalized) : undefined;
  if (typeHint) return { token: typeHint.token, kind: 'type', languages: ['bbc-basic'], signature: `${typeHint.token}: ${typeHint.type} · ${typeHint.storage}`, detail: typeHint.detail, source: { kind: 'project', label: `${file.name}:${typeHint.line}`, version: index.version, fileId: file.id, fileName: file.name } };
  const targetReference = acornTargetReferenceItems(file, target).find((item) => normalizeSymbol(item.token) === normalized);
  if (targetReference) return targetReference;
  if (file.language === '6502') {
    const instruction = instructionLanguageItem(normalized, processor);
    if (instruction) return instruction;
  }
  const matching = projectCompletionItems(file, index, processor, undefined, target).filter((item) => normalizeSymbol(item.token) === normalized);
  if (!matching.length) return file.language === 'bbc-basic' ? basicLanguageItem(normalized, target) : file.language === '6502' ? mosLanguageItem(normalized, target) : undefined;
  const dottedDirective = token.startsWith('.') ? matching.find((item) => item.kind === 'directive') : undefined;
  if (dottedDirective) return dottedDirective;
  const projectMatches = matching.filter((item) => item.source?.kind === 'project');
  if (projectMatches.length > 1) return {
    token: token.replace(/^\./, ''), kind: 'symbol', languages: [file.language],
    detail: `${projectMatches.length} declarations are visible in the current include graph. Use Go to definition to choose the intended declaration.`,
    signature: projectMatches.map((item) => item.source?.fileName).filter(Boolean).join(' | '),
    source: { kind: 'project', label: 'ambiguous project symbols', version: index.version },
  };
  return projectMatches[0] ?? matching[0];
}

export function projectSignatureHelpAt(file: ProjectFile, position: number, index: ProjectLanguageIndex, processor: Processor = '6502', target?: LanguageTargetContext): SignatureHelp | undefined {
  return signatureHelpAt(file, position, projectCompletionItems(file, index, processor, undefined, target));
}

export function projectTokensWithHelp(file: ProjectFile, line: number, index: ProjectLanguageIndex, processor: Processor = '6502', target?: LanguageTargetContext): LanguageItem[] {
  const rawSource = file.content.split('\n')[line - 1] ?? '';
  const source = target?.machineId === 'atom' ? rawSource.replace(/^(\s*\d{1,5}\s*)([a-z])(?=[A-Z])/, '$1$2 ') : rawSource;
  const unique = new Set<string>(); const results: LanguageItem[] = [];
  for (const token of source.match(/[A-Za-z_.][A-Za-z0-9_.]*[$%]?|\d+/g) ?? []) {
    const help = projectHelpForToken(file, token, index, processor, target);
    if (help && !unique.has(`${help.kind}:${help.token}`)) { unique.add(`${help.kind}:${help.token}`); results.push(help); }
  }
  return results;
}

export function bbcBasicTypeHints(file: ProjectFile, target?: LanguageTargetContext): BasicTypeHint[] {
  if (file.language !== 'bbc-basic') return [];
  if (target?.machineId === 'atom') return atomBasicTypeHints(file, target.enabledCapabilities.includes('fp-rom') || target.romId === 'atom-fp');
  const first = new Map<string, BasicTypeHint>();
  file.content.split('\n').forEach((source, lineIndex) => {
    const code = basicCode(source);
    const add = (token: string, column: number) => {
      const normalized = token.toUpperCase(); if (first.has(normalized)) return;
      const type = token.endsWith('$') ? 'string' : token.endsWith('%') ? 'signed integer' : 'real';
      const storage = type === 'string' ? 'variable length' : type === 'signed integer' ? '32-bit / 4 bytes' : '5-byte floating point';
      first.set(normalized, { token, line: lineIndex + 1, column: Math.max(1, column), type, storage, detail: `BBC BASIC II determines this variable type from its ${token.endsWith('$') || token.endsWith('%') ? `${token.slice(-1)} suffix` : 'absence of a suffix'}; no additional type is inferred.` });
    };
    for (const match of code.matchAll(/\b(?:LET\s+|FOR\s+|LOCAL\s+)?([A-Za-z_][A-Za-z0-9_]*[$%]?)\s*=/gi)) {
      const token = match[1]!; add(token, source.toUpperCase().indexOf(token.toUpperCase(), match.index ?? 0) + 1);
    }
    for (const declaration of code.matchAll(/\bDEF\s+(?:PROC|FN)[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/gi)) {
      for (const parameter of (declaration[1] ?? '').split(',')) {
        const token = parameter.trim().match(/^([A-Za-z_][A-Za-z0-9_]*[$%]?)/)?.[1];
        if (token) add(token, source.toUpperCase().indexOf(token.toUpperCase(), declaration.index ?? 0) + 1);
      }
    }
  });
  return [...first.values()];
}

export function sourceTypeHints(file: ProjectFile, target?: LanguageTargetContext): SourceTypeHint[] {
  if (file.language === 'bbc-basic') return bbcBasicTypeHints(file, target).map((hint) => ({ ...hint, role: 'variable' }));
  if (file.language !== 'c') return [];
  return cTypeHints(file, target);
}

function cTypeHints(file: ProjectFile, target?: LanguageTargetContext): SourceTypeHint[] {
  const hints: SourceTypeHint[] = [];
  const occupied = new Set<string>();
  const add = (token: string, offset: number, declaredType: string, role: SourceTypeHint['role'], extra: Partial<SourceTypeHint> = {}) => {
    const location = sourceLocationAt(file.content, offset);
    const key = `${location.line}:${location.column}:${token}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    const model = cStorageModel(declaredType, target);
    hints.push({
      token, line: location.line, column: location.column, type: declaredType.trim(), role,
      storage: model.storage, signedness: model.signedness, addressSpace: model.addressSpace,
      detail: `${role === 'return' ? 'Function' : role[0]!.toUpperCase() + role.slice(1)} declaration from ${file.name}:${location.line}. ${model.detail}`,
      ...extra,
    });
  };

  const functions = /\b((?:(?:static|extern|inline|const|volatile|__fastcall__)\s+)*(?:(?:unsigned|signed)\s+)?(?:void|char|int|short|long|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\*)?(?:\s+__fastcall__)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*(?:[;{])/g;
  for (const match of file.content.matchAll(functions)) {
    const name = match[2]!;
    const nameOffset = (match.index ?? 0) + match[0].indexOf(name, match[1]!.length);
    const parameters = splitParameters(match[3]).filter((parameter) => parameter !== 'void');
    const convention = /\b__fastcall__\b/.test(match[1]!) ? '__fastcall__' : target?.toolchainId === 'cc65.c-bbc' ? 'cc65 default C calling convention' : 'declared by the active C toolchain';
    const returnType = match[1]!.replace(/\b(?:static|extern|inline|__fastcall__)\b/g, '').replace(/\s+/g, ' ').trim();
    add(name, nameOffset, returnType, 'return', { parameters, returns: returnType, callingConvention: convention, storage: 'code symbol', detail: `Function declaration from ${file.name}:${sourceLocationAt(file.content, nameOffset).line}. Returns ${returnType}; ${parameters.length ? `parameters: ${parameters.join(', ')}` : 'no parameters'}; calling convention: ${convention}.` });
    const parameterStart = (match.index ?? 0) + match[0].indexOf(match[3] ?? '');
    let searchFrom = parameterStart;
    for (const parameter of parameters) {
      const parsed = /^(.*?)\b([A-Za-z_][A-Za-z0-9_]*)\s*(\[[^\]]*\])?$/.exec(parameter.trim());
      if (!parsed?.[1] || !parsed[2]) continue;
      const token = parsed[2];
      const offset = file.content.indexOf(token, searchFrom);
      if (offset < 0 || offset > parameterStart + (match[3]?.length ?? 0)) continue;
      searchFrom = offset + token.length;
      const declaredType = `${parsed[1].trim()}${parsed[3] ? ' *' : ''}`;
      add(token, offset, declaredType, 'parameter', { callingConvention: convention });
    }
  }

  const structures = /\b(?:typedef\s+)?struct(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\{([\s\S]*?)\}\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*;/g;
  for (const structure of file.content.matchAll(structures)) {
    const body = structure[1] ?? '';
    const bodyOffset = (structure.index ?? 0) + structure[0].indexOf(body);
    for (const member of body.matchAll(/\b((?:(?:const|volatile|unsigned|signed)\s+)*(?:char|int|short|long|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\*)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\[[^\]]*\])?\s*;/g)) {
      const token = member[2]!;
      const offset = bodyOffset + (member.index ?? 0) + member[0].lastIndexOf(token);
      add(token, offset, `${member[1]!.trim()}${member[3] ? ` ${member[3]}` : ''}`, 'member');
    }
  }

  const declarations = /(?:^|[;{}]\s*)\s*((?:(?:static|extern|const|volatile|register)\s+)*(?:(?:unsigned|signed)\s+)?(?:char|int|short|long|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\*)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\[[^\]]*\])?\s*(?==|;|,)/gm;
  for (const match of file.content.matchAll(declarations)) {
    const token = match[2]!;
    const offset = (match.index ?? 0) + match[0].lastIndexOf(token);
    const declaredType = `${match[1]!.trim()}${match[3] ? ` ${match[3]}` : ''}`;
    add(token, offset, declaredType, 'variable');
  }
  return hints.sort((left, right) => left.line - right.line || left.column - right.column);
}

interface CStorageModel {
  storage: string;
  signedness: string;
  detail: string;
  addressSpace?: string;
}

function cStorageModel(declaredType: string, target?: LanguageTargetContext): CStorageModel {
  const type = declaredType.replace(/\b(?:static|extern|register|const|volatile|__fastcall__)\b/g, '').replace(/\s+/g, ' ').trim();
  const cc65 = target?.toolchainId === 'cc65.c-bbc';
  const array = /\[\s*(\d+)\s*\]/.exec(type);
  if (array) {
    const element = cStorageModel(type.replace(/\[[^\]]*\]/, ''), target);
    const bytes = /(?:\/|in)\s*(\d+) bytes?/.exec(element.storage)?.[1];
    return { ...element, storage: bytes ? `${array[1]} elements / ${Number(array[1]) * Number(bytes)} bytes` : `${array[1]} elements; ${element.storage}`, detail: `The declared array extent is ${array[1]}. ${element.detail}` };
  }
  if (/\*/.test(type)) return { storage: cc65 ? '16-bit pointer / 2 bytes' : 'pointer width set by toolchain', signedness: 'not applicable', addressSpace: cc65 ? '16-bit CPU address space' : 'toolchain address space', detail: cc65 ? 'The selected cc65 target uses a 16-bit near pointer.' : 'Pointer width and address space require an active compiler target.' };
  if (/\bvoid\b/.test(type)) return { storage: 'no object storage', signedness: 'not applicable', detail: 'The declaration has void type.' };
  const unsigned = /\bunsigned\b/.test(type);
  const explicitlySigned = /\bsigned\b/.test(type);
  const signedness = unsigned ? 'unsigned' : /\bchar\b/.test(type) && !explicitlySigned ? 'implementation configured for plain char' : 'signed';
  if (!cc65) return { storage: 'size requires active cc65 target', signedness, detail: 'The declared C type is authoritative; its byte size requires the cc65 BBC target.' };
  if (/\bchar\b/.test(type)) return { storage: '8-bit / 1 byte', signedness, detail: `cc65 stores char objects in one byte.${unsigned || explicitlySigned ? ` This declaration is explicitly ${signedness}.` : ' Plain char signedness remains compiler-option dependent.'}` };
  if (/\blong\b/.test(type)) return { storage: '32-bit / 4 bytes', signedness, detail: 'The selected cc65 target stores long objects in four bytes.' };
  if (/\b(?:short|int)\b/.test(type)) return { storage: '16-bit / 2 bytes', signedness, detail: 'The selected cc65 target stores short and int objects in two bytes.' };
  return { storage: 'aggregate size requires compiler layout', signedness: 'declared by member types', detail: 'The source names an aggregate or typedef. Its size is not guessed without compiler layout data.' };
}

function atomBasicTypeHints(file: ProjectFile, floatingPointRom: boolean): BasicTypeHint[] {
  const first = new Map<string, BasicTypeHint>();
  file.content.split('\n').forEach((source, lineIndex) => {
    const code = basicCode(source);
    if (floatingPointRom) for (const match of code.matchAll(/%(?:@|[A-Z]|([A-Z])\1)\s*(?:\([^)]*\))?\s*=/g)) {
      const token = match[0]!.match(/^%(?:@|[A-Z]{1,2})/)?.[0];
      if (!token || first.has(token)) continue;
      first.set(token, { token, line: lineIndex + 1, column: source.indexOf(token, match.index ?? 0) + 1, type: 'real', storage: '5-byte floating point', detail: `Atom floating-point extension variable ${token} stores a five-byte real; doubled-letter names denote arrays allocated with FDIM.` });
    }
    for (const match of code.matchAll(/(?:^|[;\s])(?:LET\s+|FOR\s+)?([A-Z]|([A-Z])\2)\s*(?:\([^)]*\))?\s*=/g)) {
      const token = match[1]!;
      if (first.has(token)) continue;
      const column = source.indexOf(token, match.index ?? 0) + 1;
      const array = token.length === 2;
      first.set(token, {
        token, line: lineIndex + 1, column: Math.max(1, column), type: 'signed integer', storage: '32-bit / 4 bytes',
        detail: array
          ? `Atom BASIC ${token} is a doubled-letter integer array; each element is a signed 32-bit word and the array must be allocated with DIM.`
          : `Atom BASIC ${token} is a single-letter signed 32-bit integer variable. It may also hold an address used by $, ? and ! indirection.`,
      });
    }
  });
  return [...first.values()];
}

export function resolveProjectDefinition(file: ProjectFile, position: number, index: ProjectLanguageIndex): DefinitionResolution {
  const include = includeTargetAt(file, position, index);
  if (include) return { token: include.fileName, status: 'resolved', candidates: [include], reason: `Included project file ${include.fileName}` };
  const token = normalizeSymbol(tokenAt(file.content, position));
  if (!token) return { token: '', status: 'unresolved', candidates: [], reason: 'Place the caret on a source symbol, BASIC line target, or INCLUDE filename.' };
  return resolveProjectToken(file, token, index);
}

export function resolveProjectRelationship(file: ProjectFile, position: number, index: ProjectLanguageIndex, relationship: ProjectRelationshipKind): DefinitionResolution {
  const token = normalizeSymbol(tokenAt(file.content, position));
  if (!token) return { token: '', status: 'unresolved', candidates: [], reason: `Place the caret on a source token before requesting ${relationship.replace('-', ' ')}.` };
  if (relationship === 'type-definition') {
    if (file.language !== 'c') return { token, status: 'unresolved', candidates: [], reason: `Type-definition navigation is not derivable for ${file.language} source.` };
    const connected = relatedFiles(index, file.id);
    return relationshipResult(token, index.symbols.filter((symbol) => symbol.language === 'c' && symbol.kind === 'type' && connected.has(symbol.fileId) && normalizeSymbol(symbol.token) === token), 'type definition');
  }
  const base = resolveProjectDefinition(file, position, index);
  if (base.status === 'unresolved') return base;
  if (file.language !== 'c') {
    if (relationship === 'implementation' && !base.candidates.some((candidate) => ['label', 'line', 'procedure', 'function', 'macro'].includes(candidate.kind))) return { token: base.token, status: 'unresolved', candidates: [], reason: `${base.token} is a declaration without a separately derivable implementation.` };
    return relationshipResult(base.token, base.candidates, relationship);
  }
  if (relationship === 'declaration') {
    const declarations = base.candidates.filter((candidate) => candidate.kind !== 'function' || cFunctionRelationship(candidate, index) === 'declaration');
    return relationshipResult(base.token, declarations.length ? declarations : base.candidates, 'declaration');
  }
  const implementations = base.candidates.filter((candidate) => candidate.kind === 'function' && cFunctionRelationship(candidate, index) === 'implementation');
  if (relationship === 'implementation') return relationshipResult(base.token, implementations, 'implementation');
  return relationshipResult(base.token, implementations.length ? implementations : base.candidates, 'definition');
}

function relationshipResult(token: string, candidates: ProjectSymbol[], label: string): DefinitionResolution {
  if (candidates.length === 1) return { token, status: 'resolved', candidates, reason: `${label[0]!.toUpperCase()}${label.slice(1)} for ${token} is ${candidates[0]!.fileName}:${candidates[0]!.line}.` };
  if (candidates.length > 1) return { token, status: 'ambiguous', candidates, reason: `${token} has ${candidates.length} ${label} candidates.` };
  return { token, status: 'unresolved', candidates: [], reason: `No ${label} for ${token} is derivable from the connected project source.` };
}

function cFunctionRelationship(candidate: ProjectSymbol, index: ProjectLanguageIndex): 'declaration' | 'implementation' {
  const source = index.files.find((file) => file.id === candidate.fileId)?.content.split('\n')[candidate.line - 1] ?? '';
  return /\{/.test(source.slice(Math.max(0, candidate.column - 1 + candidate.length))) ? 'implementation' : 'declaration';
}

export function sdkDocumentTargetAt(file: ProjectFile, position: number, target?: LanguageTargetContext): SdkDocumentTarget | undefined {
  if (file.language !== 'c' || target?.toolchainId !== 'cc65.c-bbc') return undefined;
  const lineStart = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const lineEnd = file.content.indexOf('\n', position);
  const line = file.content.slice(lineStart, lineEnd < 0 ? file.content.length : lineEnd);
  const include = /^\s*#\s*include\s*<([^>]+)>/.exec(line);
  if (!include?.[1]) return undefined;
  const start = lineStart + (include.index ?? 0) + include[0].indexOf(include[1]);
  return position >= start && position <= start + include[1].length ? { path: include[1] } : undefined;
}

export function sdkDocumentForToken(file: ProjectFile, token: string, target?: LanguageTargetContext): SdkDocumentTarget | undefined {
  if (file.language !== 'c' || target?.toolchainId !== 'cc65.c-bbc') return undefined;
  const normalized = token.toLowerCase();
  if (normalized === 'acorn_oswrch' || normalized === 'acorn_osrdch') return { path: 'acorn.h', token };
  if (normalized === 'cputc') return { path: 'conio.h', token };
  return undefined;
}

export function projectSourceReferences(file: ProjectFile, index: ProjectLanguageIndex): ProjectSourceReference[] {
  return sourceReferences(file).map((reference) => {
    const resolution = resolveProjectToken(file, normalizeSymbol(reference.target), index);
    const candidate = resolution.status === 'resolved' ? resolution.candidates[0] : undefined;
    return {
      ...reference,
      resolved: resolution.status === 'resolved',
      targetLine: candidate?.line,
      targetFileId: candidate?.fileId,
      targetFileName: candidate?.fileName,
      targetColumn: candidate?.column,
      targetLength: candidate?.length,
      status: resolution.status,
      candidates: resolution.status === 'ambiguous' ? resolution.candidates : undefined,
      reason: resolution.reason,
    };
  });
}

export function basicNavigationModel(file: ProjectFile, index: ProjectLanguageIndex, atomBasic = false): BasicNavigationModel {
  if (file.language !== 'bbc-basic') return { references: [], diagnostics: [], declaredLines: [] };
  const diagnostics: BasicNavigationDiagnostic[] = [];
  const declaredLines: BasicNavigationModel['declaredLines'] = [];
  const numberDeclarations = new Map<number, Array<{ line: number; column: number }>>();
  const labelDeclarations = new Map<string, Array<{ line: number; column: number }>>();
  file.content.split('\n').forEach((source, index) => {
    if (!source.trim()) return;
    const match = source.match(/^\s*(\d{1,5})/);
    if (!match) {
      diagnostics.push({ id: `missing-line-${index + 1}`, severity: 'error', kind: 'missing-line-number', line: index + 1, column: 1, message: `Physical line ${index + 1} has no BASIC line number.` });
      return;
    }
    const number = Number(match[1]); const column = source.indexOf(match[1]!) + 1;
    declaredLines.push({ number, line: index + 1, column });
    const declarations = numberDeclarations.get(number) ?? []; declarations.push({ line: index + 1, column }); numberDeclarations.set(number, declarations);
    if (number > 32767 || (atomBasic && number < 1)) diagnostics.push({ id: `line-range-${index + 1}`, severity: 'error', kind: 'line-range', line: index + 1, column, message: `${atomBasic ? 'Atom' : 'BBC'} BASIC line ${number} is outside ${atomBasic ? '1' : '0'}–32767.` });
    if (atomBasic) {
      const label = source.match(/^\s*\d{1,5}\s*([a-z])(?=[A-Z])/)?.[1];
      if (label) { const entries = labelDeclarations.get(label) ?? []; entries.push({ line: index + 1, column: source.indexOf(label, column - 1 + match[1]!.length) + 1 }); labelDeclarations.set(label, entries); }
    }
  });
  for (const [number, declarations] of numberDeclarations) if (declarations.length > 1) for (const declaration of declarations) diagnostics.push({ id: `duplicate-line-${number}-${declaration.line}`, severity: 'error', kind: 'duplicate-line', ...declaration, message: `Line number ${number} is declared ${declarations.length} times.` });
  for (const [label, declarations] of labelDeclarations) if (declarations.length > 1) for (const declaration of declarations) diagnostics.push({ id: `duplicate-label-${label}-${declaration.line}`, severity: 'error', kind: 'duplicate-label', ...declaration, message: `Atom line label ${label} is declared ${declarations.length} times.` });
  const references = projectSourceReferences(file, index);
  references.forEach((reference, referenceIndex) => {
    if (reference.status === 'resolved') return;
    diagnostics.push({ id: `${reference.status}-target-${referenceIndex}`, severity: 'error', kind: reference.status === 'ambiguous' ? 'ambiguous-target' : 'missing-target', line: reference.fromLine, column: reference.fromColumn, message: `${reference.label}: ${reference.reason}` });
  });
  return { references, diagnostics: diagnostics.sort((left, right) => left.line - right.line || left.column - right.column || left.id.localeCompare(right.id)), declaredLines };
}

export function findProjectReferences(file: ProjectFile, position: number, index: ProjectLanguageIndex): ProjectReferenceResult {
  const definition = resolveProjectDefinition(file, position, index);
  if (definition.status === 'unresolved') return { token: definition.token, status: definition.status, reason: definition.reason, declarations: [], locations: [] };
  const declarations = definition.candidates;
  const allowedFiles = file.language === '6502' || file.language === 'arm' || file.language === 'c' ? relatedFiles(index, file.id) : new Set([file.id]);
  const normalized = normalizeSymbol(definition.token);
  const locations: ProjectReferenceLocation[] = declarations.map((candidate) => ({
    token: candidate.token, fileId: candidate.fileId, fileName: candidate.fileName, line: candidate.line,
    column: candidate.column, length: candidate.length, kind: 'declaration',
  }));
  for (const sourceFile of index.files) {
    if (!allowedFiles.has(sourceFile.id) || sourceFile.language !== file.language) continue;
    for (const reference of sourceReferences(sourceFile)) {
      if (normalizeSymbol(reference.target) !== normalized) continue;
      locations.push({ token: reference.target, fileId: sourceFile.id, fileName: sourceFile.name, line: reference.fromLine, column: reference.fromColumn, length: reference.length, kind: 'reference' });
    }
  }
  locations.sort((left, right) => left.fileName.localeCompare(right.fileName) || left.line - right.line || left.column - right.column || (left.kind === 'declaration' ? -1 : 1));
  return { token: definition.token, status: definition.status, reason: definition.reason, declarations, locations };
}

export function projectCallHierarchyAt(file: ProjectFile, position: number, index: ProjectLanguageIndex): ProjectCallHierarchyResult {
  const definition = resolveProjectDefinition(file, position, index);
  if (definition.status !== 'resolved') return { token: definition.token, status: definition.status, reason: definition.reason, incoming: [], outgoing: [] };
  const token = normalizeSymbol(definition.token);
  const allowedFiles = file.language === 'bbc-basic' ? new Set([file.id]) : relatedFiles(index, file.id);
  const incoming: ProjectCallHierarchyEdge[] = [];
  const outgoing: ProjectCallHierarchyEdge[] = [];
  for (const sourceFile of index.files) {
    if (sourceFile.language !== file.language || !allowedFiles.has(sourceFile.id)) continue;
    const owners = index.symbols.filter((symbol) => symbol.fileId === sourceFile.id && callOwnerKind(symbol, sourceFile.language)).sort((left, right) => left.line - right.line || left.column - right.column);
    for (const reference of sourceReferences(sourceFile)) {
      if (!isCallReference(sourceFile.language, reference.label)) continue;
      const owner = [...owners].reverse().find((symbol) => symbol.line <= reference.fromLine);
      const caller = owner?.token ?? `${sourceFile.name} top level`;
      const target = resolveProjectToken(sourceFile, normalizeSymbol(reference.target), index);
      const destination = target.status === 'resolved' ? target.candidates[0] : undefined;
      const base = {
        caller, callee: reference.target, fileId: sourceFile.id, fileName: sourceFile.name,
        line: reference.fromLine, column: reference.fromColumn, length: reference.length,
        targetFileId: destination?.fileId, targetFileName: destination?.fileName, targetLine: destination?.line,
        targetColumn: destination?.column, targetLength: destination?.length,
      };
      if (normalizeSymbol(reference.target) === token) incoming.push({ direction: 'incoming', ...base });
      if (owner && normalizeSymbol(owner.token) === token) outgoing.push({ direction: 'outgoing', ...base });
    }
  }
  const order = (left: ProjectCallHierarchyEdge, right: ProjectCallHierarchyEdge) => left.fileName.localeCompare(right.fileName) || left.line - right.line || left.column - right.column;
  incoming.sort(order); outgoing.sort(order);
  return { token: definition.token, status: definition.status, reason: `${incoming.length} incoming and ${outgoing.length} outgoing statically parsed call${incoming.length + outgoing.length === 1 ? '' : 's'} for ${definition.token}.`, incoming, outgoing };
}

function callOwnerKind(symbol: ProjectSymbol, language: ProjectFile['language']) {
  if (language === 'c' || language === 'bbc-basic') return symbol.kind === 'function' || symbol.kind === 'procedure';
  return (language === '6502' || language === 'arm') && symbol.kind === 'label';
}

function isCallReference(language: ProjectFile['language'], label: string) {
  if (language === '6502') return /^JSR\b/i.test(label);
  if (language === 'arm') return /^BL(?:AL)?\b/i.test(label);
  if (language === 'bbc-basic') return /^(?:PROC|FN|GOSUB\b)/i.test(label);
  return language === 'c';
}

function resolveProjectToken(file: ProjectFile, token: string, index: ProjectLanguageIndex): DefinitionResolution {
  if (file.language !== '6502' && file.language !== 'arm' && file.language !== 'c') {
    const candidates = index.symbols.filter((symbol) => symbol.fileId === file.id && normalizeSymbol(symbol.token) === normalizeSymbol(token));
    if (candidates.length === 1) return { token, status: 'resolved', candidates, reason: `Declared in ${file.name}` };
    if (candidates.length > 1) return { token, status: 'ambiguous', candidates, reason: `${token} has ${candidates.length} declarations in ${file.name}.` };
    return { token, status: 'unresolved', candidates: [], reason: `${token} is not declared in ${file.name}; cross-file BASIC symbols are not linked by the current toolchain.` };
  }
  const connected = relatedFiles(index, file.id);
  const candidates = index.symbols.filter((symbol) => symbol.language === file.language && connected.has(symbol.fileId) && normalizeSymbol(symbol.token) === normalizeSymbol(token));
  if (candidates.length === 1) return { token, status: 'resolved', candidates, reason: candidates[0]!.fileId === file.id ? `Declared in ${file.name}` : `Declared in included source ${candidates[0]!.fileName}` };
  if (candidates.length > 1) return { token, status: 'ambiguous', candidates, reason: `${token} has ${candidates.length} declarations in the connected INCLUDE graph.` };
  const elsewhere = index.symbols.some((symbol) => symbol.language === file.language && normalizeSymbol(symbol.token) === normalizeSymbol(token));
  return { token, status: 'unresolved', candidates: [], reason: elsewhere ? `${token} exists elsewhere in the project but is outside this file's INCLUDE graph.` : `${token} is not declared in the connected INCLUDE graph.` };
}

function extractSymbols(file: ProjectFile): ProjectSymbol[] {
  const results: ProjectSymbol[] = [];
  /* Read once for the whole file rather than per declaration. */
  const guards = file.language === 'c' ? guardsByLine(file.content) : undefined;
  file.content.split('\n').forEach((line, index) => {
    if (file.language === '6502' || file.language === 'arm') {
      if (file.language === 'arm') {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        const token = match?.[1];
        if (token) results.push({ token, line: index + 1, column: line.indexOf(token) + 1, length: token.length, kind: 'label', fileId: file.id, fileName: file.name, language: file.language, signature: token, parameters: [] });
        const constant = line.match(/^\s*(?:\.equ\s+([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*(.+)|([A-Za-z_][A-Za-z0-9_]*)\s+(?:EQU|\*)\s+(.+))$/i);
        const constantToken = constant?.[1] ?? constant?.[3]; const value = constant?.[2] ?? constant?.[4];
        if (constantToken && value) results.push(projectDeclaration(file, line, index, constantToken, 'constant', `${constantToken} = ${value.trim()}`));
        const macro = line.match(/^\s*\.macro\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.+))?$/i);
        if (macro?.[1]) results.push(projectDeclaration(file, line, index, macro[1], 'macro', `${macro[1]}${macro[2] ? ` ${macro[2].trim()}` : ''}`, splitParameters(macro[2])));
        return;
      }
      const match = line.match(/^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*):)/);
      const token = match?.[1] ?? match?.[2];
      const ca65Directive = !!match?.[1] && /^(?:segment|export|import|byte|word|include|incbin|define|set|macro|endmacro)$/i.test(token ?? '');
      if (token && match && !ca65Directive) results.push({ token, line: index + 1, column: line.indexOf(token) + 1, length: token.length, kind: 'label', fileId: file.id, fileName: file.name, language: file.language, signature: token, parameters: [] });
      const constant = line.match(/^\s*(?:([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|EQU)\s*(.+)|\.(?:define|set)\s+([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*(.+))$/i);
      const constantToken = constant?.[1] ?? constant?.[3]; const value = constant?.[2] ?? constant?.[4];
      if (constantToken && value) results.push(projectDeclaration(file, line, index, constantToken, 'constant', `${constantToken} = ${value.trim()}`));
      const macro = line.match(/^\s*\.macro\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.+))?$/i);
      if (macro?.[1]) results.push(projectDeclaration(file, line, index, macro[1], 'macro', `${macro[1]}${macro[2] ? ` ${macro[2].trim()}` : ''}`, splitParameters(macro[2])));
      return;
    }
    if (file.language === 'c') {
      const code = line.replace(/\/\/.*$/, '');
      const define = code.match(/^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?\s*(.*)$/);
      if (define?.[1]) {
        const parameters = splitParameters(define[2]); const kind = define[2] === undefined ? 'constant' : 'macro';
        const declared = projectDeclaration(file, line, index, define[1], kind, kind === 'macro' ? `${define[1]}(${parameters.join(', ')})` : `${define[1]} = ${define[3]?.trim() || '1'}`, parameters);
        results.push(guards?.[index]?.length ? { ...declared, guards: guards[index] } : declared);
        return;
      }
      const typedef = code.match(/^\s*typedef\b[^{;]*\b([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/);
      if (typedef?.[1]) results.push(projectDeclaration(file, line, index, typedef[1], 'type', code.trim().replace(/;\s*$/, '')));
      const taggedType = code.match(/^\s*(?:typedef\s+)?(?:struct|union|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (taggedType?.[1] && !results.some((symbol) => symbol.kind === 'type' && symbol.token === taggedType[1])) results.push(projectDeclaration(file, line, index, taggedType[1], 'type', code.trim().replace(/[;{]\s*$/, '')));
      if (typedef || taggedType) return;
      /* The declaration is read by the declarator parser rather than by a
       * `type name` pattern, so an array of pointers is not reported as a
       * pointer and a function pointer is not reported as a variable of its
       * return type. A declaration the parser cannot read yields nothing,
       * which is the honest outcome: no symbol rather than a wrong one. */
      const declarators = code.trim() && (code.includes('(') || /[;,=]/.test(code)) ? parseCDeclaration(code) : null;
      if (declarators?.length) {
        const topLevel = cBraceDepthBeforeLine(file.content, index) === 0;
        for (const declarator of declarators) {
          const isFunction = declarator.kind === 'function';
          if (!isFunction && !topLevel) continue;
          const declared = projectDeclaration(
            file, line, index, declarator.name,
            isFunction ? 'function' : 'variable',
            isFunction ? `${declarator.name}(${(declarator.parameters ?? []).join(', ')})` : declarator.declaration,
            declarator.parameters ?? [],
          );
          results.push(guards?.[index]?.length ? { ...declared, guards: guards[index] } : declared);
        }
      }
      return;
    }
    if (file.language !== 'bbc-basic') return;
    const number = line.match(/^\s*(\d{1,5})(?=\s|[A-Za-z*]|$)/);
    if (number) results.push({ token: number[1]!, line: index + 1, column: line.indexOf(number[1]!) + 1, length: number[1]!.length, kind: 'line', fileId: file.id, fileName: file.name, language: file.language, signature: number[1]!, parameters: [] });
    const atomLabel = line.match(/^\s*\d{1,5}\s*([a-z])(?=[A-Z])/);
    if (atomLabel) results.push({ token: atomLabel[1]!, line: index + 1, column: line.indexOf(atomLabel[1]!, line.indexOf(number?.[1] ?? '') + (number?.[1]?.length ?? 0)) + 1, length: 1, kind: 'label', fileId: file.id, fileName: file.name, language: file.language, signature: `${atomLabel[1]} · Atom BASIC line label`, parameters: [] });
    const routine = line.match(/\bDEF\s+((PROC|FN)([A-Za-z_][A-Za-z0-9_]*))\s*(?:\(([^)]*)\))?/i);
    if (routine) {
      const parameters = (routine[4] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      results.push({ token: routine[1]!, line: index + 1, column: line.toUpperCase().indexOf(routine[1]!.toUpperCase()) + 1, length: routine[1]!.length, kind: routine[2]!.toUpperCase() === 'PROC' ? 'procedure' : 'function', fileId: file.id, fileName: file.name, language: file.language, signature: `${routine[1]}${parameters.length ? `(${parameters.join(', ')})` : ''}`, parameters });
    }
  });
  return results;
}

function symbolItem(symbol: ProjectSymbol, version: string, defines: ReadonlySet<string> = new Set()): LanguageItem {
  const description = symbol.kind === 'line' ? 'Numbered line' : symbol.kind === 'label' ? (symbol.language === 'bbc-basic' ? 'Atom BASIC line label' : 'Assembly symbol') : symbol.kind === 'procedure' ? 'BBC BASIC procedure' : symbol.kind === 'function' ? `${symbol.language === 'c' ? 'C' : 'BBC BASIC'} function` : symbol.kind === 'constant' ? 'Source constant' : symbol.kind === 'macro' ? 'Source macro' : symbol.kind === 'type' ? 'C source type' : 'Source variable';
  const kind: LanguageItem['kind'] = symbol.kind === 'line' ? 'line' : symbol.kind === 'procedure' ? 'function' : symbol.kind === 'label' ? 'symbol' : symbol.kind;
  /* A declaration inside conditional compilation is reported against what the
   * build target actually defines. One in a branch this build does not take is
   * offered as unavailable with the reason, rather than either hidden — which
   * would make it unfindable — or offered as though it were unconditional. */
  const state = symbol.guards?.length ? guardState(symbol.guards, defines) : 'active';
  const guarded = symbol.guards?.length ? guardSummary(symbol.guards, state) : null;
  return {
    token: symbol.token, kind,
    detail: guarded ? `${description} declared at ${symbol.fileName}:${symbol.line}. ${guarded}` : `${description} declared at ${symbol.fileName}:${symbol.line}.`,
    signature: symbol.signature, parameters: symbol.parameters, languages: [symbol.language],
    commitCharacters: ['Enter', 'Tab'],
    ...(state === 'inactive' ? { available: false, unavailableReason: guarded ?? undefined } : {}),
    source: { kind: 'project', label: `${symbol.fileName}:${symbol.line}`, version, fileId: symbol.fileId, fileName: symbol.fileName },
  };
}

function projectDeclaration(file: ProjectFile, line: string, lineIndex: number, token: string, kind: ProjectSymbol['kind'], signature: string, parameters: string[] = []): ProjectSymbol {
  return { token, line: lineIndex + 1, column: line.indexOf(token) + 1, length: token.length, kind, fileId: file.id, fileName: file.name, language: file.language, signature, parameters };
}

function splitParameters(value?: string) {
  return (value ?? '').split(',').map((parameter) => parameter.trim()).filter(Boolean);
}

function cLocalCompletionItems(file: ProjectFile, position: number, version: string): LanguageItem[] {
  const enclosing = enclosingCFunction(file.content, position);
  if (!enclosing) return [];
  const declarations: Array<{ token: string; signature: string; offset: number; detail: string }> = [];
  for (const parameter of splitParameters(enclosing.parameters).filter((value) => value !== 'void')) {
    const token = parameter.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?$/)?.[1];
    if (token) declarations.push({ token, signature: parameter, offset: enclosing.declarationStart + file.content.slice(enclosing.declarationStart, enclosing.bodyStart).indexOf(token), detail: 'C function parameter' });
  }
  const visibleBody = file.content.slice(enclosing.bodyStart + 1, position);
  const declaration = /(?:^|[;{}]\s*)\s*((?:(?:static|const|volatile|register)\s+)*(?:(?:unsigned|signed)\s+)?(?:char|int|short|long|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\*)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*(?==|;|,)/gm;
  for (const match of visibleBody.matchAll(declaration)) {
    const token = match[2]!; const offset = enclosing.bodyStart + 1 + (match.index ?? 0) + match[0].lastIndexOf(token);
    if (cDeclarationVisibleAt(file.content, enclosing.bodyStart, offset, position)) declarations.push({ token, signature: `${match[1]!.trim()} ${token}`, offset, detail: 'C local variable declared before the caret in the current block scope' });
  }
  const latest = new Map<string, typeof declarations[number]>();
  for (const item of declarations) latest.set(item.token, item);
  return [...latest.values()].map((item): LanguageItem => {
    const location = sourceLocationAt(file.content, item.offset);
    return { token: item.token, kind: 'variable', detail: `${item.detail} at ${file.name}:${location.line}.`, signature: item.signature, languages: ['c'], commitCharacters: ['Enter', 'Tab'], source: { kind: 'project', label: `${file.name}:${location.line}`, version, fileId: file.id, fileName: file.name } };
  });
}

function enclosingCFunction(content: string, position: number): { declarationStart: number; bodyStart: number; parameters: string } | undefined {
  const functions = /(?:(?:static|extern|inline|const|volatile)\s+)*(?:(?:unsigned|signed)\s+)?(?:void|char|int|short|long|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\*)?\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^;{}]*)\)\s*\{/g;
  for (const match of content.matchAll(functions)) {
    const bodyStart = (match.index ?? 0) + match[0].lastIndexOf('{'); const bodyEnd = matchingCBrace(content, bodyStart);
    if (position > bodyStart && position <= bodyEnd) return { declarationStart: match.index ?? 0, bodyStart, parameters: match[1] ?? '' };
  }
  return undefined;
}

function matchingCBrace(content: string, start: number) {
  let depth = 0; let quote = ''; let lineComment = false; let blockComment = false;
  for (let index = start; index < content.length; index++) {
    const char = content[index]!; const next = content[index + 1] ?? '';
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (char === '\\') index++; else if (char === quote) quote = ''; continue; }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return index;
  }
  return content.length;
}

function cBraceDepthBeforeLine(content: string, lineIndex: number) {
  const offset = content.split('\n').slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0);
  const prefix = content.slice(0, offset).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  return [...prefix].reduce((depth, character) => depth + (character === '{' ? 1 : character === '}' ? -1 : 0), 0);
}

function sourceLocationAt(content: string, offset: number) {
  const before = content.slice(0, Math.max(0, offset)); const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: offset - lineStart + 1 };
}

function cDeclarationVisibleAt(content: string, bodyStart: number, declaration: number, position: number) {
  const declarationBlocks = cOpenBlocksAt(content, bodyStart, declaration);
  const positionBlocks = new Set(cOpenBlocksAt(content, bodyStart, position));
  return declarationBlocks.every((block) => positionBlocks.has(block));
}

function cOpenBlocksAt(content: string, start: number, point: number) {
  const stack: number[] = []; let quote = ''; let lineComment = false; let blockComment = false;
  for (let index = start; index < Math.min(point, content.length); index++) {
    const char = content[index]!; const next = content[index + 1] ?? '';
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (char === '\\') index++; else if (char === quote) quote = ''; continue; }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') stack.push(index);
    else if (char === '}') stack.pop();
  }
  return stack;
}

function cMemberCompletionItems(file: ProjectFile, position: number, index: ProjectLanguageIndex, related: Set<string>): LanguageItem[] | undefined {
  const lineStart = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const before = file.content.slice(lineStart, position); const access = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\.|->)\s*(?:[A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
  if (!access?.[1]) return undefined;
  const variable = access[1]; const prefix = file.content.slice(0, position);
  const declarations = Array.from(prefix.matchAll(new RegExp(`\\b(?:struct\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*\\*?\\s*${escapeRegExp(variable)}\\b`, 'g')));
  const type = declarations.at(-1)?.[1]; if (!type) return [];
  const candidates: LanguageItem[] = [];
  for (const sourceFile of index.files.filter((candidate) => candidate.language === 'c' && related.has(candidate.id))) {
    const bodies: Array<{ body: string; offset: number }> = [];
    const typedef = new RegExp(`\\btypedef\\s+struct(?:\\s+[A-Za-z_][A-Za-z0-9_]*)?\\s*\\{([\\s\\S]*?)\\}\\s*${escapeRegExp(type)}\\s*;`, 'g');
    for (const match of sourceFile.content.matchAll(typedef)) bodies.push({ body: match[1] ?? '', offset: (match.index ?? 0) + match[0].indexOf(match[1] ?? '') });
    const tagged = new RegExp(`\\bstruct\\s+${escapeRegExp(type)}\\s*\\{([\\s\\S]*?)\\}\\s*;`, 'g');
    for (const match of sourceFile.content.matchAll(tagged)) bodies.push({ body: match[1] ?? '', offset: (match.index ?? 0) + match[0].indexOf(match[1] ?? '') });
    for (const record of bodies) for (const member of record.body.matchAll(/\b((?:(?:const|volatile|unsigned|signed)\s+)*(?:char|int|short|long|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\*)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*;/g)) {
      const token = member[2]!; const offset = record.offset + (member.index ?? 0) + member[0].lastIndexOf(token); const location = sourceLocationAt(sourceFile.content, offset);
      candidates.push({ token, kind: 'member', detail: `${type} member declared at ${sourceFile.name}:${location.line}.`, signature: `${member[1]!.trim()} ${token}`, languages: ['c'], commitCharacters: ['Enter', 'Tab'], source: { kind: 'project', label: `${sourceFile.name}:${location.line}`, version: index.version, fileId: sourceFile.id, fileName: sourceFile.name } });
    }
  }
  const unique = new Map<string, LanguageItem>(); for (const item of candidates) if (!unique.has(item.token)) unique.set(item.token, item);
  return [...unique.values()];
}

function relatedFiles(index: ProjectLanguageIndex, start: string) {
  const adjacent = new Map<string, Set<string>>();
  for (const file of index.files) adjacent.set(file.id, new Set());
  for (const [from, targets] of index.includes) for (const target of targets) { adjacent.get(from)?.add(target); adjacent.get(target)?.add(from); }
  const visited = new Set<string>(); const pending = [start];
  while (pending.length) { const current = pending.pop()!; if (visited.has(current)) continue; visited.add(current); for (const next of adjacent.get(current) ?? []) pending.push(next); }
  return visited;
}

type CompletionSlot = 'general' | 'assembly-mnemonic' | 'assembly-target' | 'assembly-operand' | 'arm-swi' | 'basic-line-target';

function completionSlotAt(file: ProjectFile, position: number, atomBasic: boolean): CompletionSlot {
  const lineStart = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const before = file.content.slice(lineStart, position);
  if (file.language === 'bbc-basic') {
    const code = basicCode(before);
    if (/\b(?:GOTO|GOSUB|RESTORE|RESUME|THEN|ELSE)\s+(?:\d*|[a-z]?)$/i.test(code)) return 'basic-line-target';
    if (atomBasic && /\b(?:GOTO|GOSUB)\s+[a-z]?$/i.test(code)) return 'basic-line-target';
    return 'general';
  }
  if (file.language !== '6502' && file.language !== 'arm') return 'general';
  const code = before.replace(/;.*$/, '').replace(file.language === 'arm' ? /(?:\/\/|@).*$/ : /$^/, '');
  if (file.language === 'arm' && /\bSWI(?:EQ|NE|CS|CC|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|AL)?\s+[A-Za-z0-9_]*$/i.test(code)) return 'arm-swi';
  const branch = file.language === 'arm'
    ? /\b(?:B|BL)(?:EQ|NE|CS|CC|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|AL)?\s+[A-Za-z0-9_.]*$/i
    : /\b(?:BCC|BCS|BEQ|BMI|BNE|BPL|BRA|BVC|BVS|JMP|JSR)\s+[A-Za-z0-9_.]*$/i;
  if (branch.test(code)) return 'assembly-target';
  if (/^\s*[A-Za-z_.][A-Za-z0-9_.]*$/.test(code)) return 'assembly-mnemonic';
  if (/^\s*(?:[A-Za-z_.][A-Za-z0-9_.]*:?\s+)?[A-Za-z.][A-Za-z0-9.]*\s+.*$/.test(code)) return 'assembly-operand';
  return 'general';
}

function buildDefineItems(file: ProjectFile, target?: LanguageTargetContext): LanguageItem[] {
  if (!['6502', 'arm', 'c'].includes(file.language)) return [];
  const values = target?.buildDefines ?? [];
  const version = contextVersion(values);
  return values.flatMap((definition): LanguageItem[] => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(.+))?\s*$/.exec(definition);
    if (!match) return [];
    const value = match[2]?.trim() || '1';
    return [{ token: match[1]!, kind: 'constant', detail: `Build-target define with configured value ${value}.`, signature: `${match[1]} = ${value}`, languages: [file.language], insertText: match[1]!, commitCharacters: ['Enter', 'Tab'], source: { kind: 'project', label: 'active build target defines', version } }];
  });
}

function armRegisterItems(): LanguageItem[] {
  const numbered = Array.from({ length: 16 }, (_, register): LanguageItem => ({ token: `R${register}`, kind: 'register', detail: register === 15 ? 'ARM2 program counter register.' : register === 14 ? 'ARM2 link register.' : register === 13 ? 'ARM2 stack pointer by convention.' : `ARM2 general register R${register}.`, signature: `R${register}`, languages: ['arm'], commitCharacters: ['Enter', 'Tab'], source: { kind: 'builtin', label: 'ARM2 register set', version: 'ARM2-26bit' } }));
  return [...numbered, ...([['SP', 'R13 stack-pointer alias.'], ['LR', 'R14 link-register alias.'], ['PC', 'R15 program-counter alias.']] as const).map(([token, detail]): LanguageItem => ({ token, kind: 'register', detail, signature: `${token} (${token === 'SP' ? 'R13' : token === 'LR' ? 'R14' : 'R15'})`, languages: ['arm'], commitCharacters: ['Enter', 'Tab'], source: { kind: 'builtin', label: 'ARM2 register aliases', version: 'ARM2-26bit' } }))];
}

function generatedSymbolItems(file: ProjectFile, target?: LanguageTargetContext): LanguageItem[] {
  if (!['6502', 'arm', 'c'].includes(file.language)) return [];
  const symbols = target?.generatedSymbols ?? []; const version = contextVersion(symbols.map((symbol) => `${symbol.name}=${symbol.value}`));
  return symbols.map((symbol): LanguageItem => {
    const width = file.language === 'arm' || symbol.value > 0xffff ? 8 : 4; const digits = symbol.value.toString(16).toUpperCase().padStart(width, '0');
    return { token: symbol.name, kind: 'symbol', detail: `Address resolved by the exact current successful build to &${digits}.`, signature: `${symbol.name} = &${digits}`, languages: [file.language], commitCharacters: ['Enter', 'Tab'], source: { kind: 'project', label: 'current build symbols', version } };
  });
}

function contextVersion(values: string[]) {
  let hash = 0x811c9dc5;
  for (const value of values) for (let index = 0; index <= value.length; index += 1) { hash ^= value.charCodeAt(index) || 0; hash = Math.imul(hash, 0x01000193); }
  return `target-${values.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function includeContextAt(file: ProjectFile, position: number): { close?: '"' | "'" | '>'; kind: 'assembly' | 'asset' | 'c' } | undefined {
  const lineStart = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const before = file.content.slice(lineStart, position);
  if (file.language === 'c') {
    const cInclude = /^\s*#\s*include\s*([<"])([^>"]*)$/.exec(before);
    return cInclude ? { close: cInclude[1] === '<' ? '>' : '"', kind: 'c' } : undefined;
  }
  if (file.language !== '6502' && file.language !== 'arm') return undefined;
  const quoted = /^\s*\.?INCLUDE(ASSET)?\s+(["'])([^"']*)$/i.exec(before);
  if (quoted) return { close: quoted[2] as '"' | "'", kind: quoted[1] ? 'asset' : 'assembly' };
  const bare = /^\s*\.?INCLUDE(ASSET)?\s+[^\s"']*$/i.exec(before); return bare ? { kind: bare[1] ? 'asset' : 'assembly' } : undefined;
}

function includeTargetAt(file: ProjectFile, position: number, index: ProjectLanguageIndex): ProjectSymbol | undefined {
  const lineStart = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const lineEnd = file.content.indexOf('\n', position); const line = file.content.slice(lineStart, lineEnd < 0 ? file.content.length : lineEnd);
  if (file.language === 'c') {
    const include = /^\s*#\s*include\s*"([^"]+)"/.exec(line); const requested = include?.[1];
    if (!include || !requested) return undefined;
    const start = lineStart + (include.index ?? 0) + include[0].indexOf(requested); if (position < start || position > start + requested.length) return undefined;
    const target = resolveIncluded(new Map(index.files.map((candidate) => [candidate.name.toLowerCase(), candidate])), requested, file.name);
    if (!target) return undefined;
    return { token: target.name, line: 1, column: 1, length: 0, kind: 'label', fileId: target.id, fileName: target.name, language: target.language, signature: `#include "${target.name}"`, parameters: [] };
  }
  if (file.language !== '6502' && file.language !== 'arm') return undefined;
  const match = /\bINCLUDE(ASSET)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i.exec(line); const requested = match?.[2] ?? match?.[3] ?? match?.[4];
  if (!match || !requested) return undefined;
  const start = lineStart + match.index + match[0].indexOf(requested); if (position < start || position > start + requested.length) return undefined;
  const target = resolveIncluded(new Map(index.files.map((candidate) => [candidate.name.toLowerCase(), candidate])), requested, file.name);
  if (!target) return undefined;
  return { token: target.name, line: 1, column: 1, length: 0, kind: 'label', fileId: target.id, fileName: target.name, language: target.language, signature: `${match[1] ? 'INCLUDEASSET' : 'INCLUDE'} "${target.name}"`, parameters: [] };
}

function sourceRank(item: LanguageItem, currentFileId: string) { return item.source?.fileId === currentFileId ? 0 : 1; }
function normalizeSymbol(value: string) { return value.replace(/^\./, '').toUpperCase(); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function basicCode(source: string) {
  let result = ''; let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === '"') { quoted = !quoted; result += ' '; continue; }
    if (quoted) { result += ' '; continue; }
    if (/^REM(?:\s|:|$)/i.test(source.slice(index)) && (index === 0 || /[\s:]/.test(source[index - 1]!))) break;
    result += character;
  }
  return result;
}

function projectVersion(files: ProjectFile[]) {
  let hash = 0x811c9dc5;
  for (const file of files) {
    const value = `${file.id}\0${file.name}\0${file.language}\0${file.content}\0`;
    for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  }
  return `project-${files.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function exactProjectRevision(files: ProjectFile[]) {
  return files.map((file) => [file.id, file.name, file.language, file.content].map((value) => `${value.length}:${value}`).join('|')).join('\0');
}
