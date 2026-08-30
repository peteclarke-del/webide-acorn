import { opcodeTable } from '../analysis/disassembler6502';
import type { ProjectFile, SourceLanguage } from '../project/project';
import { basicLineReferences } from './basicRenumber';
import { instructionLanguageItem } from './instructionReference6502';
import { armDirectiveItems, armInstructionItems } from './instructionReferenceArm';
import { basicLanguageItems, mosLanguageItems } from './acornLanguageReference';
import type { LanguageTargetContext } from './languageTarget';

export interface LanguageItemDocumentation {
  category: string;
  parameters?: Array<{ name: string; detail: string; range?: string }>;
  result?: string;
  examples?: string[];
  sideEffects?: string[];
  flags?: string[];
  cycles?: Array<{ form: string; minimum: number; maximum: number; variability?: string }>;
  compatibility?: { supported: boolean; appliesTo: string[]; warning?: string };
  deprecation?: { message: string; replacement?: string };
  related?: string[];
  citations?: Array<{ title: string; url: string; section?: string; version?: string }>;
}

export interface LanguageItem {
  token: string;
  kind: 'command' | 'opcode' | 'directive' | 'mos' | 'symbol' | 'line' | 'file' | 'type' | 'constant' | 'register' | 'variable' | 'function' | 'macro' | 'member' | 'hardware' | 'swi' | 'snippet';
  detail: string;
  signature?: string;
  parameters?: string[];
  signatureForms?: Array<{ signature: string; parameters: string[]; detail?: string }>;
  languages: SourceLanguage[];
  insertText?: string;
  /* Keys and punctuation that accept this candidate. Punctuation is also
   * typed; `Enter` and `Tab` are not. Derived by `commitCharactersFor`. */
  commitCharacters?: string[];
  available?: boolean;
  unavailableReason?: string;
  source?: { kind: 'builtin' | 'project'; label: string; version: string; fileId?: string; fileName?: string };
  documentation?: LanguageItemDocumentation;
}

export interface SourceReference { label: string; fromLine: number; fromColumn: number; length: number; targetLine?: number; target: string; resolved: boolean; }
export interface SignatureHelp {
  item: LanguageItem;
  activeParameter: number;
  parameters: string[];
  parameter?: string;
  activeSignature: number;
  signatures: Array<{ signature: string; parameters: string[]; detail?: string }>;
}
export interface SourceDefinition { token: string; line: number; column: number; length: number; kind: 'label' | 'line' | 'procedure' | 'function' | 'constant' | 'variable' | 'macro' | 'type'; }

export class StaleLanguageResponseError extends Error {
  constructor() { super('Language response belongs to an older document version'); this.name = 'StaleLanguageResponseError'; }
}

export interface LanguageRequestRevision {
  documentId: string;
  documentVersion: number;
  projectVersion: string;
  channel: string;
  requestId: number;
}

export interface VersionedLanguageResponse<T> {
  value: T;
  revision: LanguageRequestRevision;
}

/** Coordinates future asynchronous language adapters without allowing an old
 * document result to update the editor. Opening a new document version aborts
 * every outstanding request; each response is checked again on completion. */
export class VersionedLanguageSession {
  private version = 0;
  private requestSequence = 0;
  private documentKey = '';
  private controllers = new Set<AbortController>();
  private channelControllers = new Map<string, AbortController>();
  private channelRequestIds = new Map<string, number>();

  open(file: ProjectFile, projectVersion = '') {
    const key = `${file.id}\u0000${file.language}\u0000${file.content}\u0000${projectVersion}`;
    if (key === this.documentKey) return this.version;
    this.documentKey = key; this.version++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.channelControllers.clear(); this.channelRequestIds.clear();
    return this.version;
  }

  async request<T>(file: ProjectFile, provider: (signal: AbortSignal) => T | Promise<T>, projectVersion = '', channel = 'default'): Promise<T> {
    return (await this.requestVersioned(file, provider, projectVersion, channel)).value;
  }

  async requestVersioned<T>(file: ProjectFile, provider: (signal: AbortSignal, revision: LanguageRequestRevision) => T | Promise<T>, projectVersion = '', channel = 'default'): Promise<VersionedLanguageResponse<T>> {
    const documentVersion = this.open(file, projectVersion);
    this.channelControllers.get(channel)?.abort();
    const controller = new AbortController(); this.controllers.add(controller);
    this.channelControllers.set(channel, controller);
    const revision: LanguageRequestRevision = { documentId: file.id, documentVersion, projectVersion, channel, requestId: ++this.requestSequence };
    this.channelRequestIds.set(channel, revision.requestId);
    try {
      const value = await provider(controller.signal, revision);
      if (controller.signal.aborted || !this.isCurrent(revision)) throw new StaleLanguageResponseError();
      return { value, revision };
    } finally { this.controllers.delete(controller); if (this.channelControllers.get(channel) === controller) this.channelControllers.delete(channel); }
  }

  isCurrent(revision: LanguageRequestRevision) {
    return revision.documentVersion === this.version && revision.documentId === this.documentKey.split('\u0000', 1)[0] && this.channelRequestIds.get(revision.channel) === revision.requestId;
  }

  cancel(channel?: string) {
    if (channel) {
      const controller = this.channelControllers.get(channel);
      if (controller) { controller.abort(); this.controllers.delete(controller); }
      this.channelControllers.delete(channel);
      this.channelRequestIds.set(channel, ++this.requestSequence);
      return;
    }
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.channelControllers.clear(); this.channelRequestIds.clear();
    this.version++;
  }

  dispose() { this.cancel(); this.documentKey = ''; }
}

const BASIC = basicLanguageItems();

const opcodes = Array.from(new Set(opcodeTable('65c02').flatMap((opcode) => opcode ? [opcode.mnemonic] : []))).sort().map((token) =>
  instructionLanguageItem(token, '65c02')!,
);
const directives = [
  item('ORG', 'directive', 'Set the assembly address for subsequent output.', 'ORG &address', ['6502']),
  item('EQUB', 'directive', 'Emit comma-separated byte values or quoted text.', 'EQUB value[, value…]', ['6502']),
  item('EQUS', 'directive', 'Emit the bytes of a quoted string.', 'EQUS "text"', ['6502']),
  item('EQUW', 'directive', 'Emit comma-separated little-endian 16-bit words.', 'EQUW value[, value…]', ['6502']),
  item('SKIP', 'directive', 'Reserve uninitialised bytes: the address advances but no bytes are emitted.', 'SKIP byteCount', ['6502']),
];
const ca65Directives: LanguageItem[] = [
  { token: '.SEGMENT', kind: 'directive', detail: 'Select a named ld65 output segment for subsequent bytes.', signature: '.segment "name"', parameters: ['name'], languages: ['6502'], insertText: '.segment "CODE"', source: { kind: 'builtin', label: 'ca65 adapter reference', version: '2026.08.1' }, documentation: { category: 'ca65 segment control', parameters: [{ name: 'name', detail: 'A segment declared or accepted by the effective ld65 configuration.' }], examples: ['.segment "CODE"', '.segment "RODATA"'], sideEffects: ['Changes the segment receiving subsequent emitted bytes.'], compatibility: { supported: true, appliesTo: ['cc65.ca65-ld65'], warning: 'Not accepted by the browser-local BBC-style assembler.' } } },
  { token: '.EXPORT', kind: 'directive', detail: 'Export one or more symbols to the linker and generated debug data.', signature: '.export symbol[, symbol…]', parameters: ['symbol'], languages: ['6502'], insertText: '.export ', source: { kind: 'builtin', label: 'ca65 adapter reference', version: '2026.08.1' }, documentation: { category: 'ca65 symbol visibility', examples: ['.export _start'], compatibility: { supported: true, appliesTo: ['cc65.ca65-ld65'] } } },
  { token: '.IMPORT', kind: 'directive', detail: 'Declare a symbol that must be resolved by another linked object.', signature: '.import symbol[, symbol…]', parameters: ['symbol'], languages: ['6502'], insertText: '.import ', source: { kind: 'builtin', label: 'ca65 adapter reference', version: '2026.08.1' }, documentation: { category: 'ca65 symbol visibility', examples: ['.import draw_sprite'], compatibility: { supported: true, appliesTo: ['cc65.ca65-ld65'] } } },
  { token: '.BYTE', kind: 'directive', detail: 'Emit one or more byte expressions or strings.', signature: '.byte expression[, expression…]', parameters: ['expression'], languages: ['6502'], insertText: '.byte ', source: { kind: 'builtin', label: 'ca65 adapter reference', version: '2026.08.1' }, documentation: { category: 'ca65 data', examples: ['.byte $41, $42, 0'], compatibility: { supported: true, appliesTo: ['cc65.ca65-ld65'] } } },
  { token: '.WORD', kind: 'directive', detail: 'Emit one or more little-endian 16-bit expressions.', signature: '.word expression[, expression…]', parameters: ['expression'], languages: ['6502'], insertText: '.word ', source: { kind: 'builtin', label: 'ca65 adapter reference', version: '2026.08.1' }, documentation: { category: 'ca65 data', examples: ['.word handler, $FFFF'], compatibility: { supported: true, appliesTo: ['cc65.ca65-ld65'] } } },
  { token: '.INCLUDE', kind: 'directive', detail: 'Include a literal project-local text file. Absolute and traversal paths are rejected by the native sandbox.', signature: '.include "project/path"', parameters: ['project/path'], languages: ['6502'], insertText: '.include ""', source: { kind: 'builtin', label: 'ca65 adapter reference', version: '2026.08.1' }, documentation: { category: 'ca65 source inclusion', sideEffects: ['Reads only a supplied project file inside the isolated build job.'], compatibility: { supported: true, appliesTo: ['cc65.ca65-ld65'], warning: '.incbin remains denied until bounded binary project-file transport is implemented.' } } },
];
const beebAsmDirectives: LanguageItem[] = [
  { token: 'SAVE', kind: 'directive', detail: 'Save one assembled address range as the target binary. The IDE owns the filename.', signature: 'SAVE start, end[, exec[, reload]]', parameters: ['start', 'end', 'exec', 'reload'], languages: ['6502'], insertText: 'SAVE start, P%, start', source: { kind: 'builtin', label: 'BeebAsm adapter reference', version: '1.11@ca2cc5fd' }, documentation: { category: 'BeebAsm binary output', parameters: [{ name: 'start', detail: 'First saved address, inclusive.' }, { name: 'end', detail: 'End address, exclusive.' }, { name: 'exec', detail: 'Optional execution address; select the same symbol in the build target for debugger/run handoff.' }, { name: 'reload', detail: 'Optional reload address for self-relocating output.' }], examples: ['SAVE start, P%, start'], sideEffects: ['Produces the single controlled build artifact.'], compatibility: { supported: true, appliesTo: ['stardot.beebasm'], warning: 'Source-controlled SAVE filenames are rejected by the isolated adapter.' } } },
  { token: 'INCLUDE', kind: 'directive', detail: 'Assemble another literal project-local source file at this location.', signature: 'INCLUDE "project/path.asm"', parameters: ['project/path.asm'], languages: ['6502'], insertText: 'INCLUDE ""', source: { kind: 'builtin', label: 'BeebAsm adapter reference', version: '1.11@ca2cc5fd' }, documentation: { category: 'BeebAsm source inclusion', examples: ['INCLUDE "sprites.asm"'], sideEffects: ['Adds the supplied source and its transitive includes to build provenance.'], compatibility: { supported: true, appliesTo: ['stardot.beebasm'], warning: 'Only static quoted project paths are permitted; cycles and traversal are rejected.' } } },
  { token: 'INCLUDEASSET', kind: 'directive', detail: 'Validate and generate a versioned pixel asset as a live build input at this address.', signature: 'INCLUDEASSET "name.asset.json"', parameters: ['name.asset.json'], languages: ['6502'], insertText: 'INCLUDEASSET ""', source: { kind: 'builtin', label: '8bit-net asset build adapter', version: '1' }, documentation: { category: '8bit-net generated asset dependency', parameters: [{ name: 'name.asset.json', detail: 'A project-local schema-1 character, tile, or sprite asset document.' }], examples: ['INCLUDEASSET "hero.asset.json"'], sideEffects: ['Emits colour bytes, and for sprites mask and hotspot bytes, into the current assembly address.', 'Adds the editable document to provenance, cache keys, incremental impact, and stale-artifact checks.'], compatibility: { supported: true, appliesTo: ['8bit-net.browser-6502'], warning: 'This IDE extension is not portable to standalone BeebAsm without generating EQUB source first.' } } },
  { token: 'INCLUDEMAP', kind: 'directive', detail: 'Validate and generate a versioned tile map, pulling in the tileset artwork it names.', signature: 'INCLUDEMAP "name.map.json"', parameters: ['name.map.json'], languages: ['6502'], insertText: 'INCLUDEMAP ""', source: { kind: 'builtin', label: '8bit-net map build adapter', version: '1' }, documentation: { category: '8bit-net generated map dependency', parameters: [{ name: 'name.map.json', detail: 'A project-local schema-1 tile map document.' }], examples: ['INCLUDEMAP "level.map.json"'], sideEffects: ['Emits a header, one block per layer, a tile pointer table and an object table at the current address.', 'Emits any tileset pixel asset the build has not already included, once per build.', 'Adds the map and its tileset artwork to provenance, cache keys, incremental impact and stale-artifact checks.'], compatibility: { supported: true, appliesTo: ['8bit-net.browser-6502'], warning: 'A declared tile index with no artwork chosen generates a zero pointer and a build diagnostic.' } } },
  { token: 'INCLUDEPALETTE', kind: 'directive', detail: 'Generate the VDU 19 stream for a versioned palette document at this address.', signature: 'INCLUDEPALETTE "name.palette.json"', parameters: ['name.palette.json'], languages: ['6502'], insertText: 'INCLUDEPALETTE ""', source: { kind: 'builtin', label: '8bit-net palette build adapter', version: '1' }, documentation: { category: '8bit-net generated palette dependency', parameters: [{ name: 'name.palette.json', detail: 'A project-local schema-1 palette document for one BBC display mode.' }], examples: ['INCLUDEPALETTE "level.palette.json"'], sideEffects: ['Emits six bytes per logical colour: 19, logical, physical, 0, 0, 0.', 'Adds the palette document to provenance, cache keys, incremental impact and stale-artifact checks.'], compatibility: { supported: true, appliesTo: ['8bit-net.browser-6502'], warning: 'Send the generated bytes through OSWRCH; the directive emits data, it does not call the OS.' } } },
  { token: 'INCLUDEFONT', kind: 'directive', detail: 'Generate the VDU 23 definitions for a versioned character-set document at this address.', signature: 'INCLUDEFONT "name.font.json"', parameters: ['name.font.json'], languages: ['6502'], insertText: 'INCLUDEFONT ""', source: { kind: 'builtin', label: '8bit-net font build adapter', version: '1' }, documentation: { category: '8bit-net generated character-set dependency', parameters: [{ name: 'name.font.json', detail: 'A project-local schema-1 character-set document.' }], examples: ['INCLUDEFONT "game.font.json"'], sideEffects: ['Emits ten bytes per character: 23, the code and its eight rows.', 'Adds the character-set document to provenance, cache keys, incremental impact and stale-artifact checks.'], compatibility: { supported: true, appliesTo: ['8bit-net.browser-6502'], warning: 'Codes below 224 redefine machine characters and claim extra definition memory.' } } },
  { token: 'INCLUDESCREEN', kind: 'directive', detail: 'Generate the packed frame buffer of a versioned screen document at this address.', signature: 'INCLUDESCREEN "name.screen.json"', parameters: ['name.screen.json'], languages: ['6502'], insertText: 'INCLUDESCREEN ""', source: { kind: 'builtin', label: '8bit-net screen build adapter', version: '1' }, documentation: { category: '8bit-net generated screen dependency', parameters: [{ name: 'name.screen.json', detail: 'A project-local schema-1 full-screen bitmap document.' }], examples: ['INCLUDESCREEN "title.screen.json"'], sideEffects: ['Emits the whole frame buffer in hardware character-block order: 10,240 bytes for MODE 4 or 5 and 20,480 for MODE 0, 1 or 2.', 'Adds the screen document to provenance, cache keys, incremental impact and stale-artifact checks.'], compatibility: { supported: true, appliesTo: ['8bit-net.browser-6502'], warning: 'The bytes are the picture only; select the mode and the palette separately.' } } },
  { token: 'INCLUDESONG', kind: 'directive', detail: 'Generate the pattern data and OSWORD 7 player of a versioned song document at this address.', signature: 'INCLUDESONG "name.song.json"', parameters: ['name.song.json'], languages: ['6502'], insertText: 'INCLUDESONG ""', source: { kind: 'builtin', label: '8bit-net song build adapter', version: '1' }, documentation: { category: '8bit-net generated song dependency', parameters: [{ name: 'name.song.json', detail: 'A project-local schema-1 four-channel song document.' }], examples: ['INCLUDESONG "theme.song.json"'], sideEffects: ['Emits a three-byte header, two bytes per channel per row, and a player exposing name_reset and name_play_row.', 'Claims the three zero-page bytes the document declares.', 'Adds the song document to provenance, cache keys, incremental impact and stale-artifact checks.'], compatibility: { supported: true, appliesTo: ['8bit-net.browser-6502'], warning: 'The player calls OSWORD 7, so it needs the operating system; it does not drive the sound chip directly.' } } },
  { token: 'GUARD', kind: 'directive', detail: 'Reject assembly that reaches or crosses the guarded address.', signature: 'GUARD address', parameters: ['address'], languages: ['6502'], insertText: 'GUARD &8000', source: { kind: 'builtin', label: 'BeebAsm adapter reference', version: '1.11@ca2cc5fd' }, documentation: { category: 'BeebAsm memory safety', examples: ['GUARD &7C00'], compatibility: { supported: true, appliesTo: ['stardot.beebasm'] } } },
  { token: 'CLEAR', kind: 'directive', detail: 'Clear guards and prior assembly ownership across an address range.', signature: 'CLEAR start, end', parameters: ['start', 'end'], languages: ['6502'], insertText: 'CLEAR ', source: { kind: 'builtin', label: 'BeebAsm adapter reference', version: '1.11@ca2cc5fd' }, documentation: { category: 'BeebAsm memory control', compatibility: { supported: true, appliesTo: ['stardot.beebasm'] } } },
  { token: 'SKIPTO', kind: 'directive', detail: 'Advance the assembly address to an absolute destination without moving backwards.', signature: 'SKIPTO address', parameters: ['address'], languages: ['6502'], insertText: 'SKIPTO ', source: { kind: 'builtin', label: 'BeebAsm adapter reference', version: '1.11@ca2cc5fd' }, documentation: { category: 'BeebAsm memory control', compatibility: { supported: true, appliesTo: ['stardot.beebasm'] } } },
  { token: 'ALIGN', kind: 'directive', detail: 'Advance the assembly address to the next requested alignment.', signature: 'ALIGN alignment', parameters: ['alignment'], languages: ['6502'], insertText: 'ALIGN ', source: { kind: 'builtin', label: 'BeebAsm adapter reference', version: '1.11@ca2cc5fd' }, documentation: { category: 'BeebAsm memory control', examples: ['ALIGN &100'], compatibility: { supported: true, appliesTo: ['stardot.beebasm'] } } },
  { token: 'ASSERT', kind: 'directive', detail: 'Fail the build unless every expression evaluates as true.', signature: 'ASSERT expression[, expression…]', parameters: ['expression'], languages: ['6502'], insertText: 'ASSERT ', source: { kind: 'builtin', label: 'BeebAsm adapter reference', version: '1.11@ca2cc5fd' }, documentation: { category: 'BeebAsm build assertion', examples: ['ASSERT P% <= &7C00'], compatibility: { supported: true, appliesTo: ['stardot.beebasm'] } } },
];
const cItems: LanguageItem[] = [
  ...['void', 'char', 'int', 'unsigned', 'signed', 'short', 'long', 'const', 'static', 'extern', 'volatile', 'struct', 'union', 'enum', 'typedef', 'sizeof'].map((token) => ({ token, kind: 'type' as const, detail: `${token} is a cc65 C declaration/type keyword.`, signature: token, languages: ['c' as const], source: { kind: 'builtin' as const, label: 'cc65 C language reference', version: '2.19-1' }, documentation: { category: 'cc65 C type system', compatibility: { supported: true, appliesTo: ['cc65.c-bbc'] } } })),
  ...['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return'].map((token) => ({ token, kind: 'command' as const, detail: `${token} is a cc65 C control-flow keyword.`, signature: token === 'return' ? 'return expression;' : `${token} …`, languages: ['c' as const], source: { kind: 'builtin' as const, label: 'cc65 C language reference', version: '2.19-1' }, documentation: { category: 'cc65 C control flow', compatibility: { supported: true, appliesTo: ['cc65.c-bbc'] } } })),
  { token: 'acorn_oswrch', kind: 'mos', detail: 'Write one byte through BBC MOS OSWRCH (&FFEE).', signature: 'acorn_oswrch(value)', parameters: ['value'], languages: ['c'], insertText: 'acorn_oswrch()', source: { kind: 'builtin', label: '8bit-net BBC C SDK', version: '2026.08.1' }, documentation: { category: 'BBC MOS C bridge', parameters: [{ name: 'value', detail: 'Unsigned 8-bit VDU character or control byte.', range: '0–255' }], sideEffects: ['Calls OSWRCH and may change the display, VDU state, or selected output stream.'], examples: ["acorn_oswrch('A');"], compatibility: { supported: true, appliesTo: ['BBC B', 'BBC B+', 'BBC Master'], warning: 'Include <acorn.h>. Requires a BBC MOS ROM at runtime.' } } },
  { token: 'acorn_osrdch', kind: 'mos', detail: 'Read one byte through BBC MOS OSRDCH (&FFE0).', signature: 'acorn_osrdch()', parameters: [], languages: ['c'], insertText: 'acorn_osrdch()', source: { kind: 'builtin', label: '8bit-net BBC C SDK', version: '2026.08.1' }, documentation: { category: 'BBC MOS C bridge', result: 'Unsigned 8-bit input character.', sideEffects: ['Waits for input according to the active MOS input stream.'], compatibility: { supported: true, appliesTo: ['BBC B', 'BBC B+', 'BBC Master'], warning: 'Include <acorn.h>. Requires a BBC MOS ROM at runtime.' } } },
  { token: 'cputc', kind: 'command', detail: 'Write one character using the WebIDE BBC conio bridge.', signature: 'cputc(value)', parameters: ['value'], languages: ['c'], insertText: 'cputc()', source: { kind: 'builtin', label: 'cc65 conio + 8bit-net BBC bridge', version: '2.19-1/2026.08.1' }, documentation: { category: 'cc65 console I/O', parameters: [{ name: 'value', detail: 'Character byte passed to BBC OSWRCH.' }], compatibility: { supported: true, appliesTo: ['cc65.c-bbc'], warning: 'Include <conio.h>. The WebIDE runtime currently implements the character output primitive, not every target-specific conio function.' } } },
  { token: 'PEEK', kind: 'command', detail: 'Read an unsigned byte from an absolute 6502 address.', signature: 'PEEK(address)', parameters: ['address'], languages: ['c'], insertText: 'PEEK()', source: { kind: 'builtin', label: 'cc65 peekpoke.h', version: '2.19-1' }, documentation: { category: 'cc65 memory access', result: 'Unsigned 8-bit value.', examples: ['value = PEEK(0xFE40);'], compatibility: { supported: true, appliesTo: ['cc65.c-bbc'], warning: 'Include <peekpoke.h>; hardware addresses and side effects depend on the selected machine.' } } },
  { token: 'POKE', kind: 'command', detail: 'Write an unsigned byte to an absolute 6502 address.', signature: 'POKE(address, value)', parameters: ['address', 'value'], languages: ['c'], insertText: 'POKE(, )', source: { kind: 'builtin', label: 'cc65 peekpoke.h', version: '2.19-1' }, documentation: { category: 'cc65 memory access', parameters: [{ name: 'address', detail: '16-bit target address.' }, { name: 'value', detail: '8-bit value.' }], sideEffects: ['Writes target memory or a memory-mapped hardware register.'], compatibility: { supported: true, appliesTo: ['cc65.c-bbc'] } } },
];
const mos = mosLanguageItems();
const assetDirectives = beebAsmDirectives.filter((directive) => ['INCLUDEASSET', 'INCLUDEMAP', 'INCLUDEPALETTE', 'INCLUDEFONT', 'INCLUDESCREEN', 'INCLUDESONG'].includes(directive.token));
const BASE = [...BASIC, ...opcodes, ...directives, ...assetDirectives, ...mos, ...cItems, ...armInstructionItems, ...armDirectiveItems];

export function referenceItems(language?: SourceLanguage, target?: LanguageTargetContext): LanguageItem[] {
  const selectedDirectives = target?.toolchainId === 'cc65.ca65-ld65' ? ca65Directives : target?.toolchainId === 'stardot.beebasm' ? [...directives, ...beebAsmDirectives] : directives;
  const dialectDirectives = selectedDirectives.some((directive) => directive.token === 'INCLUDEASSET') ? selectedDirectives : [...selectedDirectives, ...assetDirectives];
  const catalogue = target ? [...basicLanguageItems(target), ...opcodes, ...dialectDirectives, ...mosLanguageItems(target), ...cItems, ...armInstructionItems, ...armDirectiveItems] : BASE;
  return language ? catalogue.filter((candidate) => candidate.languages.includes(language)) : [...catalogue];
}

export function completionItems(file: ProjectFile, target?: LanguageTargetContext): LanguageItem[] {
  const dynamic: LanguageItem[] = [];
  if (file.language === '6502' || file.language === 'arm') {
    const labelPattern = file.language === 'arm'
      ? /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:@.*)?$/gm
      : /^\s*[.]?([A-Za-z_][A-Za-z0-9_]*)\s*:?(?:\s*(?:;.*)?)$/gm;
    for (const match of file.content.matchAll(labelPattern)) dynamic.push(item(match[1]!, 'symbol', 'Symbol declared in the current source file.', match[1], [file.language]));
  } else if (file.language === 'c') {
    for (const match of file.content.matchAll(/^\s*(?:static\s+|extern\s+)?(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:void|char|int|short|long|[A-Za-z_][A-Za-z0-9_]*\s*\*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*(?:\{|;)/gm)) {
      const parameters = (match[2] ?? '').split(',').map((value) => value.trim()).filter((value) => value && value !== 'void');
      dynamic.push(item(match[1]!, 'symbol', 'Function declared in the current C source file.', `${match[1]}(${parameters.join(', ')})`, ['c'], parameters));
    }
    for (const match of file.content.matchAll(/^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)) dynamic.push(item(match[1]!, 'symbol', 'Preprocessor macro declared in the current C source file.', match[1], ['c']));
  } else if (file.language === 'bbc-basic') {
    for (const match of file.content.matchAll(/^\s*(\d{1,5})(?=\s|[A-Za-z*]|$)/gm)) dynamic.push(item(match[1]!, 'line', 'Numbered line in the current BASIC program.', match[1], ['bbc-basic']));
    if (target?.machineId === 'atom') {
      for (const match of file.content.matchAll(/^\s*\d{1,5}\s*([a-z])(?=[A-Z])/gm)) dynamic.push(item(match[1]!, 'symbol', 'Lower-case Atom BASIC line label declared in this source file.', match[1], ['bbc-basic']));
    } else for (const match of file.content.matchAll(/^\s*\d*\s*DEF\s+(PROC|FN)([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/gim)) {
      const kind = match[1]!.toUpperCase();
      const parameters = (match[3] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      const token = `${kind}${match[2]}`;
      dynamic.push(item(token, 'symbol', `${kind === 'PROC' ? 'Procedure' : 'Function'} declared in the current BASIC source file.`, `${token}${parameters.length ? `(${parameters.join(', ')})` : ''}`, ['bbc-basic'], parameters));
    }
  }
  return [...referenceItems(file.language, target), ...dynamic];
}

export function helpForToken(file: ProjectFile, token: string, target?: LanguageTargetContext): LanguageItem | undefined {
  const normalized = token.replace(/^\./, '').toUpperCase();
  return completionItems(file, target).find((candidate) => candidate.token.replace(/^\./, '').toUpperCase() === normalized);
}

export function tokenAt(content: string, position: number): string {
  const left = content.slice(0, position).match(/[A-Za-z0-9_.$%]+$/)?.[0] ?? '';
  const right = content.slice(position).match(/^[A-Za-z0-9_.$%]+/)?.[0] ?? '';
  const raw = `${left}${right}`;
  const start = position - left.length;
  const lineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const compactAtomLineToken = raw.match(/^(\d{1,5})([a-z])([A-Z][A-Z0-9.]*)$/);
  if (compactAtomLineToken && /^\s*$/.test(content.slice(lineStart, start))) {
    const labelOffset = compactAtomLineToken[1]!.length;
    if (position - start < labelOffset) return compactAtomLineToken[1]!;
    if (position - start === labelOffset) return compactAtomLineToken[2]!;
    return compactAtomLineToken[3]!;
  }
  const atomLineToken = raw.match(/^([a-z])([A-Z][A-Z0-9.]*)$/);
  if (atomLineToken && /^\s*\d{1,5}\s*$/.test(content.slice(lineStart, start))) return position === start ? atomLineToken[1]! : atomLineToken[2]!;
  return raw;
}

export function tokensWithHelp(file: ProjectFile, line: number, target?: LanguageTargetContext): LanguageItem[] {
  const source = file.content.split('\n')[line - 1] ?? '';
  const unique = new Set<string>(); const results: LanguageItem[] = [];
  for (const token of source.match(/[A-Za-z_.][A-Za-z0-9_.]*|\d+/g) ?? []) {
    const help = helpForToken(file, token, target);
    if (help && !unique.has(help.token)) { unique.add(help.token); results.push(help); }
  }
  return results;
}

const BASIC_PARAMETERS: Record<string, string[]> = {
  MODE: ['mode'], PRINT: ['expression'], PROC: ['parameters'], DEF: ['declaration'], GOSUB: ['line'], GOTO: ['line'],
  VDU: ['byte'], OSCLI: ['string'], CALL: ['address', 'parameters'], SOUND: ['channel', 'amplitude', 'pitch', 'duration'],
  ENVELOPE: ['number', 'step', 'p1', 'p2', 'p3', 'n1', 'n2', 'n3', 'a1', 'a2', 'a3', 'a4', 'target1', 'target2'],
  FOR: ['variable', 'start', 'end', 'increment'], NEXT: ['variable'], UNTIL: ['condition'], IF: ['condition', 'statement', 'else statement'],
};

export function signatureHelpAt(file: ProjectFile, position: number, suppliedCandidates?: LanguageItem[]): SignatureHelp | undefined {
  const lineStart = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const beforeCaret = file.content.slice(lineStart, position);
  const candidates = (suppliedCandidates ?? completionItems(file)).filter((candidate) => candidate.signature && candidate.kind !== 'line' && candidate.kind !== 'file' && !(file.language === 'bbc-basic' && candidate.token.toUpperCase() === 'REM'));
  let match: { item: LanguageItem; argumentText: string; argumentStart: number } | undefined;
  for (const candidate of candidates) {
    const atomBasic = candidate.documentation?.category.startsWith('Atom BASIC') === true;
    const expression = new RegExp(`${atomBasic ? '(?:\\b|(?<=[a-z]))' : '\\b'}${escapeRegExp(candidate.token)}\\b`, atomBasic ? 'g' : 'ig');
    for (const occurrence of beforeCaret.matchAll(expression)) {
      const end = (occurrence.index ?? 0) + occurrence[0].length;
      if (file.language === 'bbc-basic' && !isBasicCodePosition(beforeCaret, occurrence.index ?? 0)) continue;
      const invocation = activeInvocation(beforeCaret, end);
      if (invocation && (!match || invocation.argumentStart >= match.argumentStart)) match = { item: candidate, ...invocation };
    }
  }
  if (!match) return undefined;
  const fallbackParameters = match.item.parameters ?? (file.language === '6502' ? (match.item.kind === 'opcode' ? ['operand'] : ['value']) : BASIC_PARAMETERS[match.item.token.toUpperCase()] ?? []);
  const signatures = match.item.signatureForms?.length ? match.item.signatureForms : [{ signature: match.item.signature!, parameters: fallbackParameters }];
  const argumentIndex = countTopLevelCommas(match.argumentText);
  const matchingSignature = signatures.findIndex((form) => (!match.argumentText.trim() && form.parameters.length === 0) || argumentIndex < form.parameters.length || form.parameters.at(-1)?.includes('…'));
  const activeSignature = matchingSignature < 0 ? signatures.length - 1 : matchingSignature;
  const parameters = signatures[activeSignature]?.parameters ?? fallbackParameters;
  if (!parameters.length) return { item: match.item, activeParameter: 0, parameters, activeSignature, signatures };
  const activeParameter = Math.min(parameters.length - 1, argumentIndex);
  return { item: match.item, activeParameter, parameters, parameter: parameters[activeParameter], activeSignature, signatures };
}

export function sourceDefinitionAt(file: ProjectFile, position: number): SourceDefinition | undefined {
  const token = tokenAt(file.content, position).replace(/^\./, '');
  if (!token) return undefined;
  const lines = file.content.split('\n');
  if (file.language === 'bbc-basic') {
    if (/^\d{1,5}$/.test(token)) {
      const wanted = Number(token);
      for (let index = 0; index < lines.length; index++) {
        const found = lines[index]!.match(/^\s*(\d{1,5})(?=\s|[A-Za-z*]|$)/);
        if (found && Number(found[1]) === wanted) return { token, line: index + 1, column: found.index! + found[0].lastIndexOf(found[1]!) + 1, length: found[1]!.length, kind: 'line' };
      }
    }
    const procedure = token.match(/^(PROC|FN)([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (procedure) {
      for (let index = 0; index < lines.length; index++) {
        const found = lines[index]!.match(new RegExp(`\\bDEF\\s+(${escapeRegExp(token)})\\b`, 'i'));
        if (found) return { token: found[1]!, line: index + 1, column: found.index! + found[0].toUpperCase().lastIndexOf(found[1]!.toUpperCase()) + 1, length: found[1]!.length, kind: procedure[1]!.toUpperCase() === 'PROC' ? 'procedure' : 'function' };
      }
    }
    if (/^[a-z]$/.test(token)) {
      for (let index = 0; index < lines.length; index++) {
        const found = lines[index]!.match(new RegExp(`^\\s*\\d{1,5}\\s*(${escapeRegExp(token)})(?=[A-Z])`));
        if (found) return { token, line: index + 1, column: lines[index]!.indexOf(found[1]!) + 1, length: 1, kind: 'label' };
      }
    }
    return undefined;
  }
  if (file.language === 'c') {
    for (let index = 0; index < lines.length; index++) {
      const found = lines[index]!.match(new RegExp(`\\b(${escapeRegExp(token)})\\s*\\(`));
      if (found && /^(?!\s*(?:if|for|while|switch)\b)\s*(?:static\s+|extern\s+)?(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:void|char|int|short|long|[A-Za-z_][A-Za-z0-9_]*\s*\*)\s+/i.test(lines[index]!)) return { token: found[1]!, line: index + 1, column: found.index! + 1, length: found[1]!.length, kind: 'function' };
    }
    return undefined;
  }
  for (let index = 0; index < lines.length; index++) {
    const found = lines[index]!.match(/^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*):)/);
    const label = found?.[1] ?? found?.[2];
    if (label?.toUpperCase() === token.toUpperCase()) return { token: label, line: index + 1, column: lines[index]!.indexOf(label) + 1, length: label.length, kind: 'label' };
  }
  return undefined;
}

export function sourceReferences(file: ProjectFile): SourceReference[] {
  const lines = file.content.split('\n');
  if (file.language === 'bbc-basic') {
    const definitions = new Map<number, number>();
    lines.forEach((line, index) => { const match = line.match(/^\s*(\d{1,5})(?=\s|[A-Za-z*]|$)/); if (match) definitions.set(Number(match[1]), index + 1); });
    const routines = new Map<string, number>();
    lines.forEach((line, index) => { const match = line.match(/\bDEF\s+((?:PROC|FN)[A-Za-z_][A-Za-z0-9_]*)\b/i); if (match) routines.set(match[1]!.toUpperCase(), index + 1); });
    const atomLabels = new Map<string, number>();
    lines.forEach((line, index) => { const match = line.match(/^\s*\d{1,5}\s*([a-z])(?=[A-Z])/); if (match) atomLabels.set(match[1]!.toUpperCase(), index + 1); });
    return lines.flatMap((line, index) => {
      const prefix = line.match(/^\s*\d{1,5}\s?/)?.[0] ?? '';
      const body = line.slice(prefix.length);
      const numbered = basicLineReferences(body).map((reference) => ({ label: `${reference.command} ${reference.target}`, fromLine: index + 1, fromColumn: prefix.length + reference.start + 1, length: reference.end - reference.start, targetLine: definitions.get(reference.target), target: String(reference.target), resolved: definitions.has(reference.target) }));
      const routineCalls = Array.from(line.matchAll(/\b((?:PROC|FN)[A-Za-z_][A-Za-z0-9_]*)\b/gi)).filter((match) => !/\bDEF\s*$/i.test(line.slice(0, match.index))).map((match) => {
        const targetLine = routines.get(match[1]!.toUpperCase());
        return { label: match[1]!, fromLine: index + 1, fromColumn: (match.index ?? 0) + 1, length: match[1]!.length, targetLine, target: match[1]!, resolved: targetLine !== undefined };
      });
      const labelCalls = Array.from(line.matchAll(/\b(GOTO|GOSUB)\s+([a-z])(?=\s*(?:;|$))/g)).map((match) => ({ label: `${match[1]} ${match[2]}`, fromLine: index + 1, fromColumn: (match.index ?? 0) + match[0].lastIndexOf(match[2]!) + 1, length: 1, targetLine: atomLabels.get(match[2]!.toUpperCase()), target: match[2]!, resolved: atomLabels.has(match[2]!.toUpperCase()) }));
      return [...numbered, ...routineCalls, ...labelCalls];
    });
  }
  if (file.language === 'c') {
    const definitions = new Map<string, number>();
    lines.forEach((line, index) => { const match = line.match(/^\s*(?:static\s+|extern\s+)?(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:void|char|int|short|long|[A-Za-z_][A-Za-z0-9_]*\s*\*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*\{/); if (match) definitions.set(match[1]!, index + 1); });
    return lines.flatMap((line, index) => Array.from(line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)).flatMap((match) => {
      const token = match[1]!;
      if (/^(?:if|for|while|switch|sizeof)$/i.test(token)) return [];
      const before = line.slice(0, match.index ?? 0);
      if (/^\s*(?:(?:static|extern|inline|const|volatile)\s+)*(?:(?:unsigned|signed)\s+)?(?:void|char|int|short|long|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\*)?\s*$/.test(before)) return [];
      const targetLine = definitions.get(token);
      return [{ label: token, fromLine: index + 1, fromColumn: (match.index ?? 0) + 1, length: token.length, targetLine, target: token, resolved: targetLine !== undefined }];
    }));
  }
  if (file.language === '6502') {
    const definitions = new Map<string, number>();
    lines.forEach((line, index) => { const match = line.match(/^\s*[.]?([A-Za-z_][A-Za-z0-9_]*)\s*:?(?:\s*(?:;.*)?)$/); if (match) definitions.set(match[1]!.toUpperCase(), index + 1); });
    return lines.flatMap((line, index) => {
      const match = line.match(/^\s*(?:JMP|JSR|B[A-Z]{2})\s+([A-Za-z_.][A-Za-z0-9_.]*)/i);
      if (!match) return [];
      const target = match[1]!.replace(/^\./, ''); const targetLine = definitions.get(target.toUpperCase());
      return [{ label: match[0].trim(), fromLine: index + 1, fromColumn: line.indexOf(match[1]!) + 1, length: match[1]!.length, targetLine, target, resolved: targetLine !== undefined }];
    });
  }
  if (file.language === 'arm') {
    const definitions = new Map<string, number>();
    lines.forEach((line, index) => { const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/); if (match) definitions.set(match[1]!.toUpperCase(), index + 1); });
    return lines.flatMap((line, index) => {
      const code = line.replace(/(?:\/\/|@|;).*/, '');
      const match = code.match(/^\s*(?:BL|B(?:EQ|NE|CS|HS|CC|LO|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|AL)?)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
      if (!match) return [];
      const target = match[1]!; const targetLine = definitions.get(target.toUpperCase());
      return [{ label: match[0].trim(), fromLine: index + 1, fromColumn: line.indexOf(target) + 1, length: target.length, targetLine, target, resolved: targetLine !== undefined }];
    });
  }
  return [];
}

function countTopLevelCommas(value: string) {
  let commas = 0; let depth = 0; let quoted = false;
  for (const character of value) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === '(') depth++;
    else if (!quoted && character === ')') depth = Math.max(0, depth - 1);
    else if (!quoted && depth === 0 && character === ',') commas++;
  }
  return commas;
}

function activeInvocation(beforeCaret: string, tokenEnd: number): { argumentText: string; argumentStart: number } | undefined {
  let start = tokenEnd;
  while (/\s/.test(beforeCaret[start] ?? '')) start++;
  if (beforeCaret[start] !== '(') return { argumentText: beforeCaret.slice(tokenEnd), argumentStart: tokenEnd };
  let depth = 0; let quoted = false;
  for (let index = start + 1; index < beforeCaret.length; index++) {
    const character = beforeCaret[index]!;
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === '(') depth++;
    else if (!quoted && character === ')' && depth === 0) return undefined;
    else if (!quoted && character === ')') depth--;
  }
  return { argumentText: beforeCaret.slice(start + 1), argumentStart: start + 1 };
}

function isBasicCodePosition(line: string, position: number) {
  let quoted = false;
  for (let index = 0; index < position; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (!quoted && /\bREM\b/i.test(line.slice(index, position + 1))) return false;
  }
  return !quoted;
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function item(token: string, kind: LanguageItem['kind'], detail: string, signature: string | undefined, languages: SourceLanguage[], parameters?: string[]): LanguageItem { return { token, kind, detail, signature, languages, ...(parameters ? { parameters } : {}) }; }
