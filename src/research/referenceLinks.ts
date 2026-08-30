/* Turning what the editor already knows into a question the library can answer.
 *
 * The workbench knows a great deal about what is under somebody's caret: that
 * this is an opcode, that this operand is an address, that this diagnostic is
 * about an OS call, that this hardware register is at &FE30. All of that is
 * thrown away when it reaches a documentation search as a word.
 *
 * So this maps the things the product already models onto the anchors a pack
 * declares, and asks by kind. Asking by kind matters: a project symbol called
 * `OSWRCH` and the OS call `OSWRCH` are different questions with different
 * right answers, and a search that could not tell them apart would answer the
 * wrong one confidently.
 *
 * What this deliberately does not do is fall back to a text search when there
 * is no anchor match. A panel that always finds something teaches people that
 * finding something means nothing.
 */
import type { AnchorKind } from './referencePack';
import type { PackLibrary } from './packLibrary';
import { referencesFor, type SearchHit, type SearchTarget } from './referenceSearch';

/** The places in the workbench a reference lookup can start from. */
export type LinkOrigin =
  | { from: 'diagnostic'; code?: string; message: string }
  | { from: 'hover'; token: string; language: 'bbc-basic' | '6502' | 'arm' | 'c' }
  | { from: 'disassembly'; mnemonic: string; processor: string; target?: number }
  | { from: 'hardware-register'; token: string; address: number }
  | { from: 'os-call'; token: string; number?: number }
  | { from: 'swi'; token: string; number?: number }
  | { from: 'project-symbol'; token: string }
  | { from: 'machine-setting'; setting: string };

export interface ResolvedLink {
  /** What was asked, in the words a panel can show. */
  question: string;
  anchors: Array<{ kind: AnchorKind; value: string; number?: number }>;
  hits: SearchHit[];
  /** Said when nothing matched, so an absence is explained rather than blank. */
  absence: string | null;
}

/*
 * An opcode mnemonic is an opcode whatever else it may also be, and an operand
 * that resolves to an address is an address. Where a thing is genuinely two
 * things — a token in a disassembly that is both a mnemonic and a jump target
 * — both anchors are asked and the results are merged, because either could be
 * what somebody wanted.
 */
function anchorsFor(origin: LinkOrigin): Array<{ kind: AnchorKind; value: string; number?: number }> {
  switch (origin.from) {
    case 'hover':
      /* A BASIC keyword and a 6502 mnemonic are different kinds of thing even
       * when they are spelled alike. */
      return origin.language === '6502' || origin.language === 'arm'
        ? [{ kind: 'opcode', value: origin.token }, { kind: 'symbol', value: origin.token }]
        : [{ kind: 'topic', value: origin.token }, { kind: 'symbol', value: origin.token }];
    case 'disassembly':
      return [
        { kind: 'opcode', value: origin.mnemonic },
        ...(origin.target === undefined ? [] : [{ kind: 'address' as const, value: hex(origin.target), number: origin.target }]),
      ];
    case 'hardware-register':
      return [{ kind: 'register', value: origin.token, number: origin.address }, { kind: 'address', value: hex(origin.address), number: origin.address }];
    case 'os-call':
      return [{ kind: 'oscall', value: origin.token, ...(origin.number === undefined ? {} : { number: origin.number }) }];
    case 'swi':
      return [{ kind: 'swi', value: origin.token, ...(origin.number === undefined ? {} : { number: origin.number }) }];
    case 'project-symbol':
      return [{ kind: 'symbol', value: origin.token }];
    case 'machine-setting':
      return [{ kind: 'topic', value: origin.setting }];
    case 'diagnostic':
      /* A diagnostic's code is the reliable part; its message is prose that
       * changes between toolchain versions, so it is not searched. */
      return origin.code ? [{ kind: 'topic', value: origin.code }] : [];
  }
}

function questionFor(origin: LinkOrigin): string {
  switch (origin.from) {
    case 'hover': return `what documents ${origin.token}`;
    case 'disassembly': return `what documents ${origin.mnemonic}${origin.target === undefined ? '' : ` or ${hex(origin.target)}`}`;
    case 'hardware-register': return `what documents ${origin.token} at ${hex(origin.address)}`;
    case 'os-call': return `what documents the OS call ${origin.token}`;
    case 'swi': return `what documents the SWI ${origin.token}`;
    case 'project-symbol': return `what documents the symbol ${origin.token}`;
    case 'machine-setting': return `what documents the ${origin.setting} setting`;
    case 'diagnostic': return origin.code ? `what documents diagnostic ${origin.code}` : 'what documents this diagnostic';
  }
}

const hex = (value: number) => `&${value.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Ask the library about something the workbench already understands.
 *
 * Returns nothing rather than something loosely worded when no pack says it
 * documents this, and explains the nothing.
 */
export function resolveReferenceLink(library: PackLibrary, origin: LinkOrigin, target?: SearchTarget): ResolvedLink {
  const anchors = anchorsFor(origin);
  const question = questionFor(origin);

  if (!anchors.length) {
    return {
      question, anchors, hits: [],
      absence: 'This has nothing a reference pack could be keyed on, so no lookup was made. A search of the message text would find whatever happened to share a word with it.',
    };
  }

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const anchor of anchors) {
    for (const hit of referencesFor(library, anchor, { target })) {
      const key = `${hit.packId}#${hit.entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  hits.sort((left, right) => right.score - left.score);

  if (hits.length) return { question, anchors, hits, absence: null };

  return {
    question,
    anchors,
    hits: [],
    absence: library.packs.length
      ? `Nothing in the ${library.packs.length} pack${library.packs.length === 1 ? '' : 's'} held says it documents this. The workbench's own maintained knowledge may still describe it.`
      : 'No reference packs are held, so there was nothing to ask. The workbench\'s own maintained knowledge is unaffected.',
  };
}

/** Whether a lookup would find anything, for an interface deciding to offer it. */
export function hasReferencesFor(library: PackLibrary, origin: LinkOrigin, target?: SearchTarget): boolean {
  return resolveReferenceLink(library, origin, target).hits.length > 0;
}
