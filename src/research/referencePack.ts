/* What a reference pack is, and what this build refuses to accept as one.
 *
 * The workbench already ships maintained knowledge — opcodes, SWIs, hardware
 * registers — each entry carrying its own citation. That is first-party and
 * fixed. A reference pack is the other kind: documentation somebody imports,
 * which this build did not write and cannot vouch for, and which therefore has
 * to carry its own account of where it came from and what may be done with it.
 *
 * Two things are modelled here that a simpler design would have left out, and
 * both exist because leaving them out would make the product lie.
 *
 * The first is the source tier. A page from Acorn's own manual and a paragraph
 * somebody generated are both text about a BBC Micro, and presenting them the
 * same way tells the reader they carry the same weight. They do not. The tier
 * travels with every entry and the interface is required to show it, so nothing
 * below `independent` can be read as authoritative by accident.
 *
 * The second is the licence. A pack may be readable and still not copyable —
 * most published manuals are exactly that. So permission to quote and
 * permission to insert into somebody's source are recorded separately from the
 * licence name, because "MIT" and "all rights reserved" are not the only two
 * cases and guessing between them would either lose a right the author granted
 * or take one they did not.
 */
import { sha256Hex } from '../build/digest';

export const REFERENCE_PACK_SCHEMA = '8bit-net.reference-pack';
export const REFERENCE_PACK_VERSION = 1;

/** Bounds, so an import cannot exhaust the browser it runs in. */
export const PACK_LIMITS = {
  /** A pack is documentation, not a media library. */
  packBytes: 8 * 1024 * 1024,
  entries: 5000,
  entryBodyCharacters: 20000,
  citationsPerEntry: 16,
  anchorsPerEntry: 64,
  topicsPerEntry: 24,
  identifierCharacters: 128,
} as const;

/**
 * Where an entry's text came from, in descending order of what it can be
 * relied upon to say.
 *
 * `publisher` is the vendor's own documentation — Acorn's manuals, a
 * toolchain's own reference. `independent` is a third party who published under
 * their own name and can be checked. `community` is collectively edited or
 * posted material. `generated` is machine-produced.
 *
 * Only the first two may be presented as authoritative. That is not a
 * presentation preference; it is enforced, because the difference between "the
 * manual says" and "someone wrote" is the whole value of a citation.
 */
export type SourceTier = 'publisher' | 'independent' | 'community' | 'generated';

export const SOURCE_TIERS: readonly SourceTier[] = ['publisher', 'independent', 'community', 'generated'];

const AUTHORITATIVE_TIERS: readonly SourceTier[] = ['publisher', 'independent'];

/** Whether a tier's text may be presented as authoritative. */
export function isAuthoritative(tier: SourceTier): boolean {
  return AUTHORITATIVE_TIERS.includes(tier);
}

/** Why a tier is not authoritative, in the words the interface should use. */
export function tierCaveat(tier: SourceTier): string | null {
  if (tier === 'community') return 'Collectively edited material. It may be right and it is not the publisher, so check anything you depend on.';
  if (tier === 'generated') return 'Machine-generated text. It is shown because it was imported, not because it is known to be correct, and it is never cited as a source.';
  return null;
}

/**
 * What may be done with a pack's text, recorded separately from the licence
 * name.
 *
 * A pack that grants neither can still be read; it simply cannot be copied out
 * of the reader, which is the position most published manuals are in.
 */
export interface PackLicence {
  /** SPDX identifier where there is one, or the licence's own name. */
  name: string;
  /** May a passage be shown quoted alongside a citation? */
  quotable: boolean;
  /** May a passage or example be inserted into somebody's own source? */
  insertable: boolean;
  /** Where the terms can be read. */
  url?: string;
  /** Who holds the rights, when the pack says. */
  holder?: string;
}

/** What an entry documents, so a search can find it by the thing rather than by prose. */
export type AnchorKind = 'symbol' | 'address' | 'opcode' | 'register' | 'swi' | 'oscall' | 'topic' | 'example';

export interface ReferenceAnchor {
  kind: AnchorKind;
  /** The name as a person would type it. */
  value: string;
  /** For an address or a numbered call, the number itself. */
  number?: number;
}

export interface ReferenceCitation {
  title: string;
  section?: string;
  page?: number;
  url?: string;
}

/** What a pack applies to. An empty list means "not restricted", not "none". */
export interface PackApplicability {
  machines: string[];
  processors: string[];
  /** Toolchain or language dialects, as the toolchain names them. */
  dialects: string[];
  /** Operating-system or firmware versions this documents. */
  versions: string[];
}

export interface ReferenceEntry {
  id: string;
  title: string;
  body: string;
  tier: SourceTier;
  anchors: ReferenceAnchor[];
  citations: ReferenceCitation[];
  topics: string[];
  /** An example's dialect, where the entry carries code meant to be inserted. */
  exampleDialect?: string;
}

export interface ReferencePack {
  schema: typeof REFERENCE_PACK_SCHEMA;
  version: typeof REFERENCE_PACK_VERSION;
  id: string;
  title: string;
  /** The pack's own version, as its publisher numbers it. */
  packVersion: string;
  publisher: string;
  tier: SourceTier;
  licence: PackLicence;
  applicability: PackApplicability;
  entries: ReferenceEntry[];
  /** Free text from the publisher about the pack as a whole. */
  description?: string;
}

export class ReferencePackError extends Error {
  constructor(message: string) { super(message); this.name = 'ReferencePackError'; }
}

/* A function declaration rather than a const, so TypeScript narrows after a
 * call to it: an arrow function's `never` return does not end a control-flow
 * branch unless the variable is annotated, and the whole point of this helper
 * is that nothing after it runs. */
function refuse(message: string): never {
  throw new ReferencePackError(message);
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;

function text(value: unknown, field: string, limit: number, { optional = false } = {}): string {
  if (value === undefined || value === null) {
    if (optional) return '';
    refuse(`${field} is missing, and a pack without it cannot be described to anyone.`);
  }
  if (typeof value !== 'string') refuse(`${field} is a ${typeof value}; it has to be text.`);
  const trimmed = (value as string).trim();
  if (!optional && !trimmed) refuse(`${field} is empty.`);
  if (trimmed.length > limit) refuse(`${field} is ${trimmed.length} characters and the limit is ${limit}.`);
  return trimmed;
}

function stringList(value: unknown, field: string, limit: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) refuse(`${field} has to be a list.`);
  if ((value as unknown[]).length > limit) refuse(`${field} holds ${(value as unknown[]).length} items and the limit is ${limit}.`);
  return (value as unknown[]).map((item, index) => text(item, `${field}[${index}]`, PACK_LIMITS.identifierCharacters));
}

function tier(value: unknown, field: string): SourceTier {
  const name = text(value, field, 32);
  if (!SOURCE_TIERS.includes(name as SourceTier)) {
    refuse(`${field} is "${name}", and a source tier is one of ${SOURCE_TIERS.join(', ')}. An unrecognised tier is refused rather than treated as the safest one, because the safest one is also the one that hides the problem.`);
  }
  return name as SourceTier;
}

function licence(value: unknown): PackLicence {
  if (!value || typeof value !== 'object') refuse('The pack records no licence. A pack whose terms are unknown is not one this build will hold, because every later question about quoting or inserting from it would have no answer.');
  const source = value as Record<string, unknown>;
  if (typeof source.quotable !== 'boolean' || typeof source.insertable !== 'boolean') {
    refuse('The licence has to say plainly whether its text may be quoted and whether it may be inserted into somebody’s source. Those are separate permissions and neither is assumed from the other.');
  }
  if (source.insertable === true && source.quotable !== true) {
    refuse('The licence permits inserting text it does not permit quoting, which cannot be right: inserting is the stronger permission.');
  }
  return {
    name: text(source.name, 'licence.name', 128),
    quotable: source.quotable as boolean,
    insertable: source.insertable as boolean,
    ...(source.url === undefined ? {} : { url: text(source.url, 'licence.url', 512) }),
    ...(source.holder === undefined ? {} : { holder: text(source.holder, 'licence.holder', 256) }),
  };
}

function anchors(value: unknown, entryId: string): ReferenceAnchor[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) refuse(`Entry ${entryId} has anchors that are not a list.`);
  if (value.length > PACK_LIMITS.anchorsPerEntry) refuse(`Entry ${entryId} declares ${value.length} anchors and the limit is ${PACK_LIMITS.anchorsPerEntry}.`);
  const kinds: readonly AnchorKind[] = ['symbol', 'address', 'opcode', 'register', 'swi', 'oscall', 'topic', 'example'];
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') refuse(`Entry ${entryId} anchor ${index} is not an object.`);
    const record = item as Record<string, unknown>;
    const kind = text(record.kind, `entry ${entryId} anchor ${index} kind`, 32) as AnchorKind;
    if (!kinds.includes(kind)) refuse(`Entry ${entryId} anchor ${index} is of kind "${kind}", which this build does not model. It is refused rather than carried as an anchor nothing will ever match.`);
    const anchor: ReferenceAnchor = { kind, value: text(record.value, `entry ${entryId} anchor ${index} value`, PACK_LIMITS.identifierCharacters) };
    if (record.number !== undefined) {
      if (!Number.isInteger(record.number)) refuse(`Entry ${entryId} anchor ${index} has a number that is not an integer.`);
      anchor.number = record.number as number;
    }
    return anchor;
  });
}

function citations(value: unknown, entryId: string, entryTier: SourceTier): ReferenceCitation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) refuse(`Entry ${entryId} has citations that are not a list.`);
  if (value.length > PACK_LIMITS.citationsPerEntry) refuse(`Entry ${entryId} declares ${value.length} citations and the limit is ${PACK_LIMITS.citationsPerEntry}.`);
  if (entryTier === 'generated' && value.length) {
    refuse(`Entry ${entryId} is machine-generated and carries citations. Generated text does not get to cite a source, because a citation is a claim that a document says this and nothing generated can make that claim.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') refuse(`Entry ${entryId} citation ${index} is not an object.`);
    const record = item as Record<string, unknown>;
    const citation: ReferenceCitation = { title: text(record.title, `entry ${entryId} citation ${index} title`, 256) };
    if (record.section !== undefined) citation.section = text(record.section, `entry ${entryId} citation ${index} section`, 256);
    if (record.url !== undefined) citation.url = text(record.url, `entry ${entryId} citation ${index} url`, 512);
    if (record.page !== undefined) {
      if (!Number.isInteger(record.page) || (record.page as number) < 1) refuse(`Entry ${entryId} citation ${index} has a page that is not a positive whole number.`);
      citation.page = record.page as number;
    }
    return citation;
  });
}

/**
 * Read a pack, refusing anything this build could not present honestly.
 *
 * Nothing is repaired on the way in. A pack with a tier this build does not
 * recognise, or a licence that does not say what may be done with it, is
 * refused rather than given a default — a default here is a claim about
 * somebody else's rights or somebody else's accuracy.
 */
export function parseReferencePack(value: unknown): ReferencePack {
  if (!value || typeof value !== 'object') refuse('A reference pack is a JSON object.');
  const source = value as Record<string, unknown>;
  if (source.schema !== REFERENCE_PACK_SCHEMA) refuse(`This is not a reference pack: its schema is ${JSON.stringify(source.schema)} rather than ${JSON.stringify(REFERENCE_PACK_SCHEMA)}.`);
  if (source.version !== REFERENCE_PACK_VERSION) refuse(`This pack is version ${JSON.stringify(source.version)} and this build reads version ${REFERENCE_PACK_VERSION}. It is refused rather than read as though the difference did not matter.`);

  const id = text(source.id, 'id', PACK_LIMITS.identifierCharacters);
  if (!IDENTIFIER.test(id)) refuse(`A pack identifier is lowercase letters, digits, dots, dashes and underscores, starting with a letter or digit; "${id}" is not.`);

  const packTier = tier(source.tier, 'tier');
  const entriesValue = source.entries;
  if (!Array.isArray(entriesValue)) refuse('A pack has to carry a list of entries.');
  if (!entriesValue.length) refuse('This pack holds no entries. An empty pack would occupy the library and answer nothing.');
  if (entriesValue.length > PACK_LIMITS.entries) refuse(`This pack holds ${entriesValue.length} entries and the limit is ${PACK_LIMITS.entries}.`);

  const seen = new Set<string>();
  const entries: ReferenceEntry[] = entriesValue.map((item, index) => {
    if (!item || typeof item !== 'object') refuse(`Entry ${index} is not an object.`);
    const record = item as Record<string, unknown>;
    const entryId = text(record.id, `entry ${index} id`, PACK_LIMITS.identifierCharacters);
    if (!IDENTIFIER.test(entryId)) refuse(`Entry ${index} has identifier "${entryId}", which is not a valid one.`);
    if (seen.has(entryId)) refuse(`Entry identifier "${entryId}" appears twice; a reference nothing can address uniquely cannot be cited.`);
    seen.add(entryId);
    /* An entry may declare its own tier when a pack mixes material — a manual
     * with community notes beside it — and inherits the pack's otherwise. */
    const entryTier = record.tier === undefined ? packTier : tier(record.tier, `entry ${entryId} tier`);
    const entry: ReferenceEntry = {
      id: entryId,
      title: text(record.title, `entry ${entryId} title`, 256),
      body: text(record.body, `entry ${entryId} body`, PACK_LIMITS.entryBodyCharacters),
      tier: entryTier,
      anchors: anchors(record.anchors, entryId),
      citations: citations(record.citations, entryId, entryTier),
      topics: stringList(record.topics, `entry ${entryId} topics`, PACK_LIMITS.topicsPerEntry),
    };
    if (record.exampleDialect !== undefined) entry.exampleDialect = text(record.exampleDialect, `entry ${entryId} exampleDialect`, 64);
    return entry;
  });

  const applicabilityValue = (source.applicability ?? {}) as Record<string, unknown>;
  return {
    schema: REFERENCE_PACK_SCHEMA,
    version: REFERENCE_PACK_VERSION,
    id,
    title: text(source.title, 'title', 256),
    packVersion: text(source.packVersion, 'packVersion', 64),
    publisher: text(source.publisher, 'publisher', 256),
    tier: packTier,
    licence: licence(source.licence),
    applicability: {
      machines: stringList(applicabilityValue.machines, 'applicability.machines', 64),
      processors: stringList(applicabilityValue.processors, 'applicability.processors', 32),
      dialects: stringList(applicabilityValue.dialects, 'applicability.dialects', 32),
      versions: stringList(applicabilityValue.versions, 'applicability.versions', 32),
    },
    entries,
    ...(source.description === undefined ? {} : { description: text(source.description, 'description', 2000, { optional: true }) }),
  };
}

/**
 * The pack's content digest.
 *
 * Taken over the parsed pack rather than the bytes that arrived, so the same
 * pack formatted differently is recognised as the same pack, and a pack whose
 * text changed is recognised as changed even if its version number did not.
 */
export function referencePackDigest(pack: ReferencePack): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(pack)));
}

/* Keys in a fixed order and no incidental whitespace, so the digest describes
 * the content and not the formatting it arrived in. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
