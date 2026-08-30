/* Reading what the pinned cc65 linker actually recorded about a C build.
 *
 * Several editor features were held open waiting for "compiler-provided
 * records": where a variable really lives, which addresses a C line really
 * produced, what a function's frame really looks like. The build has been
 * emitting exactly that all along — ld65 writes a debug file whenever full
 * debug metadata is asked for, and it was retained as a document nothing read.
 *
 * This reads it. The format is a line per record: a kind, a tab, then
 * comma-separated key=value pairs with quoted strings. Nothing here interprets
 * a field the file does not spell out.
 *
 * One thing this deliberately does not do is map addresses back to source
 * lines, even though the file it reads is where that mapping comes from. The
 * build backend already reads this same file for exactly that, and the artifact
 * carries the result; answering it again here would be a second answer to a
 * question that already has one, and the two would eventually disagree.
 *
 * The other thing it deliberately does not do is decode a type. The pinned
 * toolchain — cc65 2.19-1, reporting itself as V2.18 — emits exactly one type
 * record, `id=0,val="00"`, and points every C symbol at it. There is no type
 * information in the file to read, so this build says so rather than producing
 * a decoded type it inferred from somewhere else. What the file does carry
 * about a C symbol is its storage class and its frame offset, and those are
 * exact.
 */

export interface Cc65File { id: number; name: string; size: number; mtime: number; mod: number }
export interface Cc65Module { id: number; name: string; file: number; lib: number | null }
export interface Cc65Segment {
  id: number; name: string; start: number; size: number;
  addrsize: string; type: string;
  /** The output file this segment was written into, when it was written at all. */
  outputName: string | null;
  outputOffset: number | null;
}
export interface Cc65Span { id: number; seg: number; start: number; size: number; type: number | null }
export interface Cc65Line {
  id: number; file: number; line: number;
  /** The compiler's own line-type code. Absent on assembler lines. */
  type: number | null;
  spans: number[];
}
export interface Cc65Symbol {
  id: number; name: string; addrsize: string; scope: number | null;
  /** Absent for an imported symbol, which has no address of its own here. */
  value: number | null;
  size: number | null; segment: number | null; type: string;
  definitionLine: number | null; referenceLines: number[];
}
export interface Cc65Scope {
  id: number; name: string; module: number; size: number;
  parent: number | null; symbol: number | null; spans: number[];
  type: string | null;
}
export interface Cc65CSymbol {
  id: number; name: string; scope: number;
  /** The type record this points at; see the note above about type records. */
  type: number;
  /** `auto`, `reg`, `static` or `ext`, as the file records it. */
  storage: string;
  /** Frame offset for an automatic symbol. Absent means offset zero was not written. */
  offset: number | null;
  /** The assembler symbol this C symbol corresponds to, when there is one. */
  symbol: number | null;
}
export interface Cc65Type { id: number; encoded: string }

export interface Cc65DebugInfo {
  version: { major: number; minor: number };
  files: Cc65File[];
  modules: Cc65Module[];
  segments: Cc65Segment[];
  spans: Cc65Span[];
  lines: Cc65Line[];
  symbols: Cc65Symbol[];
  scopes: Cc65Scope[];
  cSymbols: Cc65CSymbol[];
  types: Cc65Type[];
  /**
   * What the file said it contained against what was read out of it.
   *
   * The file states its own record counts in its `info` line, so a parser that
   * quietly dropped a malformed record can be caught by the file itself rather
   * than by someone noticing a missing variable much later.
   */
  counts: { declared: Record<string, number>; parsed: Record<string, number> };
  /** Counts that disagreed, each said in full. */
  disagreements: string[];
  /** Record kinds present in the file that this reader does not model. */
  unreadKinds: string[];
}

export class Cc65DebugInfoError extends Error {
  constructor(message: string) { super(message); this.name = 'Cc65DebugInfoError'; }
}

/*
 * `info` states a count for `file` that does not match the number of file
 * records this toolchain writes — it counts something else. Checking it would
 * fail every real build, so it is reported in `counts` and not enforced, which
 * is a different thing from pretending the file agreed.
 */
const UNCHECKED_COUNTS = new Set(['file']);

function parseFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let index = 0;
  while (index < body.length) {
    const equals = body.indexOf('=', index);
    if (equals < 0) throw new Cc65DebugInfoError(`A record field near "${body.slice(index, index + 24)}" has no value.`);
    const key = body.slice(index, equals);
    let value: string;
    if (body[equals + 1] === '"') {
      const close = body.indexOf('"', equals + 2);
      if (close < 0) throw new Cc65DebugInfoError(`The quoted value of ${key} is never closed.`);
      value = body.slice(equals + 2, close);
      index = close + 2;
    } else {
      const comma = body.indexOf(',', equals + 1);
      value = comma < 0 ? body.slice(equals + 1) : body.slice(equals + 1, comma);
      index = comma < 0 ? body.length : comma + 1;
    }
    fields.set(key, value);
  }
  return fields;
}

const number = (fields: Map<string, string>, key: string, fallback?: number): number => {
  const raw = fields.get(key);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Cc65DebugInfoError(`A record is missing its ${key}.`);
  }
  const value = raw.startsWith('0x') || raw.startsWith('0X') ? Number.parseInt(raw.slice(2), 16) : Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Cc65DebugInfoError(`${key}=${raw} is not a number.`);
  return value;
};

const optionalNumber = (fields: Map<string, string>, key: string): number | null =>
  fields.has(key) ? number(fields, key) : null;

const text = (fields: Map<string, string>, key: string, fallback?: string): string => {
  const raw = fields.get(key);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Cc65DebugInfoError(`A record is missing its ${key}.`);
  }
  return raw;
};

/** `ref=1+2+3` is how the file lists several records in one field. */
const idList = (fields: Map<string, string>, key: string): number[] => {
  const raw = fields.get(key);
  if (raw === undefined) return [];
  return raw.split('+').map((part) => Number.parseInt(part, 10)).filter((value) => Number.isFinite(value));
};

/**
 * Read an ld65 debug file.
 *
 * Refuses a file whose stated record counts disagree with what came out of it,
 * because a debug file that is partly read is worse than one that is not read
 * at all: the features built on it would show a confidently incomplete answer.
 */
export function parseCc65DebugInfo(source: string): Cc65DebugInfo {
  const info: Cc65DebugInfo = {
    version: { major: 0, minor: 0 },
    files: [], modules: [], segments: [], spans: [], lines: [], symbols: [], scopes: [], cSymbols: [], types: [],
    counts: { declared: {}, parsed: {} }, disagreements: [], unreadKinds: [],
  };
  let sawVersion = false;
  const unread = new Set<string>();

  for (const raw of source.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) throw new Cc65DebugInfoError(`"${line.slice(0, 40)}" is not a debug-file record; ld65 separates a record's kind from its fields with a tab.`);
    const kind = line.slice(0, tab);
    const fields = parseFields(line.slice(tab + 1));

    switch (kind) {
      case 'version':
        info.version = { major: number(fields, 'major'), minor: number(fields, 'minor') };
        sawVersion = true;
        break;
      case 'info':
        for (const [key, value] of fields) info.counts.declared[key] = Number.parseInt(value, 10);
        break;
      case 'file':
        info.files.push({ id: number(fields, 'id'), name: text(fields, 'name'), size: number(fields, 'size'), mtime: number(fields, 'mtime'), mod: number(fields, 'mod') });
        break;
      case 'mod':
        info.modules.push({ id: number(fields, 'id'), name: text(fields, 'name'), file: number(fields, 'file'), lib: optionalNumber(fields, 'lib') });
        break;
      case 'seg':
        info.segments.push({
          id: number(fields, 'id'), name: text(fields, 'name'), start: number(fields, 'start'), size: number(fields, 'size'),
          addrsize: text(fields, 'addrsize'), type: text(fields, 'type'),
          outputName: fields.get('oname') ?? null, outputOffset: optionalNumber(fields, 'ooffs'),
        });
        break;
      case 'span':
        info.spans.push({ id: number(fields, 'id'), seg: number(fields, 'seg'), start: number(fields, 'start'), size: number(fields, 'size'), type: optionalNumber(fields, 'type') });
        break;
      case 'line':
        info.lines.push({ id: number(fields, 'id'), file: number(fields, 'file'), line: number(fields, 'line'), type: optionalNumber(fields, 'type'), spans: idList(fields, 'span') });
        break;
      case 'sym':
        info.symbols.push({
          id: number(fields, 'id'), name: text(fields, 'name'), addrsize: text(fields, 'addrsize'),
          scope: optionalNumber(fields, 'scope'), value: optionalNumber(fields, 'val'), size: optionalNumber(fields, 'size'),
          segment: optionalNumber(fields, 'seg'), type: text(fields, 'type'),
          definitionLine: optionalNumber(fields, 'def'), referenceLines: idList(fields, 'ref'),
        });
        break;
      case 'scope':
        info.scopes.push({
          id: number(fields, 'id'), name: text(fields, 'name'), module: number(fields, 'mod'), size: number(fields, 'size', 0),
          parent: optionalNumber(fields, 'parent'), symbol: optionalNumber(fields, 'sym'), spans: idList(fields, 'span'),
          type: fields.get('type') ?? null,
        });
        break;
      case 'csym':
        info.cSymbols.push({
          id: number(fields, 'id'), name: text(fields, 'name'), scope: number(fields, 'scope'), type: number(fields, 'type'),
          storage: text(fields, 'sc'), offset: optionalNumber(fields, 'offs'), symbol: optionalNumber(fields, 'sym'),
        });
        break;
      case 'type':
        info.types.push({ id: number(fields, 'id'), encoded: text(fields, 'val') });
        break;
      case 'lib':
        /* Recorded by the file and not used here; counted so the completeness
         * check still balances. */
        break;
      default:
        unread.add(kind);
    }
  }

  if (!sawVersion) throw new Cc65DebugInfoError('This is not an ld65 debug file: it has no version record.');

  info.counts.parsed = {
    file: info.files.length, mod: info.modules.length, seg: info.segments.length, span: info.spans.length,
    line: info.lines.length, sym: info.symbols.length, scope: info.scopes.length, csym: info.cSymbols.length,
    type: info.types.length,
  };
  for (const [key, declared] of Object.entries(info.counts.declared)) {
    if (UNCHECKED_COUNTS.has(key)) continue;
    const parsed = info.counts.parsed[key];
    if (parsed === undefined) continue;
    if (parsed !== declared) info.disagreements.push(`The file says it holds ${declared} ${key} records and ${parsed} were read.`);
  }
  if (info.disagreements.length) {
    throw new Cc65DebugInfoError(`${info.disagreements[0]} A debug file that is only partly read is worse than one that is not read at all, because everything built on it would be confidently incomplete.`);
  }
  info.unreadKinds = [...unread].sort();
  return info;
}

/**
 * Whether this file carries any usable C type information.
 *
 * The pinned toolchain does not: it writes one empty type record and points
 * every C symbol at it. Callers ask this rather than discovering it by finding
 * that every variable is the same type.
 */
export function hasTypeInformation(info: Cc65DebugInfo): boolean {
  return info.types.some((type) => type.encoded !== '' && type.encoded !== '00');
}

export interface Cc65FrameEntry {
  name: string;
  storage: string;
  /** Frame offset, where the file recorded one. */
  offset: number | null;
  /** The address of the corresponding assembler symbol, for a static or extern. */
  address: number | null;
}

export interface Cc65Frame {
  /** The function's name as C wrote it, without the assembler's leading underscore. */
  function: string;
  address: number | null;
  size: number;
  entries: Cc65FrameEntry[];
}

/**
 * What each C function's locals look like, as the linker recorded them.
 *
 * Storage class and frame offset are exact and are the useful part: they say
 * which variables live on the stack, at what offset from it, and which were
 * given a fixed address instead. No type is reported, because this toolchain
 * records none — see the note at the top of this file.
 */
export function cFunctionFrames(info: Cc65DebugInfo): Cc65Frame[] {
  const symbolById = new Map(info.symbols.map((symbol) => [symbol.id, symbol]));
  const frames: Cc65Frame[] = [];
  for (const scope of info.scopes) {
    if (scope.type !== 'scope' || !scope.name) continue;
    const own = info.cSymbols.filter((symbol) => symbol.scope === scope.id);
    if (!own.length) continue;
    const symbol = scope.symbol === null ? null : symbolById.get(scope.symbol) ?? null;
    frames.push({
      /* ld65 names a C function's scope with the assembler symbol, which cc65
       * forms by prefixing an underscore. Stripped so the name matches the
       * source, and only when it is actually there. */
      function: scope.name.startsWith('_') ? scope.name.slice(1) : scope.name,
      address: symbol?.value ?? null,
      size: scope.size,
      entries: own.map((entry) => {
        const linked = entry.symbol === null ? null : symbolById.get(entry.symbol) ?? null;
        return { name: entry.name, storage: entry.storage, offset: entry.offset, address: linked?.value ?? null };
      }),
    });
  }
  return frames.sort((left, right) => left.function < right.function ? -1 : 1);
}
