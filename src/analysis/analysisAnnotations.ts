/* What a person knows about a binary that the bytes cannot say.
 *
 * Reachability analysis is honest but incomplete: a jump through a pointer, a
 * dispatch table, or an entry the loader calls from outside the file all leave
 * real code looking like data. The answer is not to guess — a guessed entry
 * point produces a plausible listing of bytes that were never instructions —
 * but to let the reader record what they know and re-run the same deterministic
 * analysis with that knowledge added.
 *
 * This module is the record. It is a plain versioned document so it can travel
 * in the project file, be diffed, and be validated on the way back in. Every
 * mutator is pure and returns a new document, which is what makes an undo
 * history over it trivial and exact.
 *
 * Addresses are absolute 16-bit addresses, not offsets, because that is what
 * the listing shows and what a user reads off a disassembly.
 */

export const ANALYSIS_ANNOTATIONS_SCHEMA = '8bit-net.analysis-annotations';
export const ANALYSIS_ANNOTATIONS_VERSION = 1;

export type AnalysisRegionKind = 'code' | 'data' | 'text';

export interface AnalysisRegion {
  /** First address covered, inclusive. */
  start: number;
  /** Last address covered, inclusive. A one-byte region has start === end. */
  end: number;
  kind: AnalysisRegionKind;
  note?: string;
}

export interface IndirectFlowHint {
  /** Address of the instruction whose target the bytes do not determine. */
  from: number;
  /** Addresses the reader asserts control can reach from it. */
  targets: number[];
  note?: string;
}

export interface AddressedText {
  address: number;
  text: string;
}

export interface AnalysisAnnotations {
  readonly schema: typeof ANALYSIS_ANNOTATIONS_SCHEMA;
  readonly version: typeof ANALYSIS_ANNOTATIONS_VERSION;
  /** SHA-256 of the analysed bytes, so annotations cannot silently follow a different file. */
  readonly sourceSha256: string;
  readonly entryPoints: readonly number[];
  readonly regions: readonly AnalysisRegion[];
  readonly indirectTargets: readonly IndirectFlowHint[];
  readonly comments: readonly AddressedText[];
  readonly labels: readonly AddressedText[];
}

export const MAX_ENTRY_POINTS = 256;
export const MAX_REGIONS = 512;
export const MAX_INDIRECT_HINTS = 256;
export const MAX_INDIRECT_TARGETS = 64;
export const MAX_COMMENTS = 4096;
export const MAX_LABELS = 4096;
export const MAX_COMMENT_LENGTH = 240;
export const MAX_NOTE_LENGTH = 120;
/* Assembler-safe: what this build's own assembler accepts as a label. */
export const LABEL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const ADDRESS_LIMIT = 0x10000;

function isAddress(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < ADDRESS_LIMIT;
}

function sortedUniqueAddresses(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function sortedText(entries: Iterable<AddressedText>): AddressedText[] {
  return [...entries].sort((left, right) => left.address - right.address).map(({ address, text }) => ({ address, text }));
}

function sortedRegions(regions: Iterable<AnalysisRegion>): AnalysisRegion[] {
  return [...regions]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((region) => (region.note === undefined ? { start: region.start, end: region.end, kind: region.kind } : { ...region }));
}

function sortedHints(hints: Iterable<IndirectFlowHint>): IndirectFlowHint[] {
  return [...hints]
    .sort((left, right) => left.from - right.from)
    .map((hint) => {
      const targets = sortedUniqueAddresses(hint.targets);
      return hint.note === undefined ? { from: hint.from, targets } : { from: hint.from, targets, note: hint.note };
    });
}

function freeze(document: AnalysisAnnotations): AnalysisAnnotations {
  return Object.freeze({
    ...document,
    entryPoints: Object.freeze([...document.entryPoints]),
    regions: Object.freeze(document.regions.map((region) => Object.freeze({ ...region }))),
    indirectTargets: Object.freeze(document.indirectTargets.map((hint) => Object.freeze({ ...hint, targets: Object.freeze([...hint.targets]) }))),
    comments: Object.freeze(document.comments.map((entry) => Object.freeze({ ...entry }))),
    labels: Object.freeze(document.labels.map((entry) => Object.freeze({ ...entry }))),
  }) as AnalysisAnnotations;
}

/** An empty annotation set bound to the digest of the bytes it describes. */
export function emptyAnalysisAnnotations(sourceSha256: string): AnalysisAnnotations {
  if (!/^[0-9a-f]{64}$/i.test(sourceSha256)) throw new Error('Analysis annotations must be bound to a SHA-256 of the analysed bytes');
  return freeze({
    schema: ANALYSIS_ANNOTATIONS_SCHEMA,
    version: ANALYSIS_ANNOTATIONS_VERSION,
    sourceSha256: sourceSha256.toLowerCase(),
    entryPoints: [],
    regions: [],
    indirectTargets: [],
    comments: [],
    labels: [],
  });
}

/* ---- validation --------------------------------------------------------- */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Accept a candidate document or explain exactly why it is not one. Used on
 * every path where annotations arrive from outside this session: the project
 * file, an imported analysis document, or a pasted payload.
 */
export function validateAnalysisAnnotations(value: unknown): AnalysisAnnotations {
  assert(value && typeof value === 'object', 'Analysis annotations must be an object');
  const candidate = value as Record<string, unknown>;
  assert(candidate.schema === ANALYSIS_ANNOTATIONS_SCHEMA, `Analysis annotations must declare schema ${ANALYSIS_ANNOTATIONS_SCHEMA}`);
  assert(candidate.version === ANALYSIS_ANNOTATIONS_VERSION, `Analysis annotations version ${ANALYSIS_ANNOTATIONS_VERSION} is required`);
  assert(typeof candidate.sourceSha256 === 'string' && /^[0-9a-f]{64}$/i.test(candidate.sourceSha256), 'Analysis annotations must carry the SHA-256 of the bytes they describe');

  const entryPointsInput = candidate.entryPoints ?? [];
  assert(Array.isArray(entryPointsInput), 'Analysis annotation entry points must be an array');
  assert(entryPointsInput.length <= MAX_ENTRY_POINTS, `Analysis annotations accept at most ${MAX_ENTRY_POINTS} extra entry points`);
  for (const entry of entryPointsInput) assert(isAddress(entry), 'Every extra entry point must be a 16-bit address');

  const regionsInput = candidate.regions ?? [];
  assert(Array.isArray(regionsInput), 'Analysis annotation regions must be an array');
  assert(regionsInput.length <= MAX_REGIONS, `Analysis annotations accept at most ${MAX_REGIONS} regions`);
  const regions: AnalysisRegion[] = regionsInput.map((raw) => {
    assert(raw && typeof raw === 'object', 'Every region must be an object');
    const region = raw as Record<string, unknown>;
    assert(isAddress(region.start) && isAddress(region.end), 'Every region must span 16-bit addresses');
    assert((region.end as number) >= (region.start as number), 'A region cannot end before it starts');
    assert(region.kind === 'code' || region.kind === 'data' || region.kind === 'text', 'A region must be marked code, data or text');
    if (region.note !== undefined) {
      assert(typeof region.note === 'string' && region.note.length <= MAX_NOTE_LENGTH, `A region note must be text of at most ${MAX_NOTE_LENGTH} characters`);
    }
    return { start: region.start as number, end: region.end as number, kind: region.kind as AnalysisRegionKind, ...(region.note === undefined ? {} : { note: region.note as string }) };
  });
  const ordered = sortedRegions(regions);
  for (let index = 1; index < ordered.length; index += 1) {
    assert(ordered[index]!.start > ordered[index - 1]!.end, `Regions must not overlap; ${hex(ordered[index - 1]!.start)}–${hex(ordered[index - 1]!.end)} and ${hex(ordered[index]!.start)}–${hex(ordered[index]!.end)} do`);
  }

  const hintsInput = candidate.indirectTargets ?? [];
  assert(Array.isArray(hintsInput), 'Analysis annotation indirect targets must be an array');
  assert(hintsInput.length <= MAX_INDIRECT_HINTS, `Analysis annotations accept at most ${MAX_INDIRECT_HINTS} indirect-flow hints`);
  const seenFrom = new Set<number>();
  const hints: IndirectFlowHint[] = hintsInput.map((raw) => {
    assert(raw && typeof raw === 'object', 'Every indirect-flow hint must be an object');
    const hint = raw as Record<string, unknown>;
    assert(isAddress(hint.from), 'An indirect-flow hint must name the 16-bit address it applies to');
    assert(!seenFrom.has(hint.from as number), `Two indirect-flow hints claim the instruction at ${hex(hint.from as number)}`);
    seenFrom.add(hint.from as number);
    assert(Array.isArray(hint.targets) && hint.targets.length > 0, 'An indirect-flow hint must name at least one target');
    assert((hint.targets as unknown[]).length <= MAX_INDIRECT_TARGETS, `An indirect-flow hint accepts at most ${MAX_INDIRECT_TARGETS} targets`);
    for (const entry of hint.targets as unknown[]) assert(isAddress(entry), 'Every indirect-flow target must be a 16-bit address');
    if (hint.note !== undefined) {
      assert(typeof hint.note === 'string' && hint.note.length <= MAX_NOTE_LENGTH, `An indirect-flow note must be text of at most ${MAX_NOTE_LENGTH} characters`);
    }
    return { from: hint.from as number, targets: hint.targets as number[], ...(hint.note === undefined ? {} : { note: hint.note as string }) };
  });

  const comments = validateAddressedText(candidate.comments, 'comment', MAX_COMMENTS, MAX_COMMENT_LENGTH);
  const labels = validateAddressedText(candidate.labels, 'label', MAX_LABELS, 64);
  for (const label of labels) {
    assert(LABEL_PATTERN.test(label.text), `${label.text} is not a usable label; use a letter or underscore followed by letters, digits or underscores`);
  }
  const usedLabels = new Set<string>();
  for (const label of labels) {
    const key = label.text.toUpperCase();
    assert(!usedLabels.has(key), `The label ${label.text} is claimed by more than one address`);
    usedLabels.add(key);
  }

  return freeze({
    schema: ANALYSIS_ANNOTATIONS_SCHEMA,
    version: ANALYSIS_ANNOTATIONS_VERSION,
    sourceSha256: (candidate.sourceSha256 as string).toLowerCase(),
    entryPoints: sortedUniqueAddresses(entryPointsInput as number[]),
    regions: ordered,
    indirectTargets: sortedHints(hints),
    comments: sortedText(comments),
    labels: sortedText(labels),
  });
}

function validateAddressedText(value: unknown, what: string, maximum: number, maximumLength: number): AddressedText[] {
  const input = value ?? [];
  assert(Array.isArray(input), `Analysis annotation ${what}s must be an array`);
  assert(input.length <= maximum, `Analysis annotations accept at most ${maximum} ${what}s`);
  const seen = new Set<number>();
  return input.map((raw) => {
    assert(raw && typeof raw === 'object', `Every ${what} must be an object`);
    const entry = raw as Record<string, unknown>;
    assert(isAddress(entry.address), `Every ${what} must name a 16-bit address`);
    assert(!seen.has(entry.address as number), `Two ${what}s claim the address ${hex(entry.address as number)}`);
    seen.add(entry.address as number);
    assert(typeof entry.text === 'string' && entry.text.trim().length > 0, `A ${what} must carry text`);
    assert((entry.text as string).length <= maximumLength, `A ${what} is limited to ${maximumLength} characters`);
    assert(!/[\u0000-\u001f\u007f]/.test(entry.text as string), `A ${what} must not contain control characters`);
    return { address: entry.address as number, text: (entry.text as string).trim() };
  });
}

function hex(value: number): string {
  return `&${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

/* ---- pure edits --------------------------------------------------------- */

function rebuild(base: AnalysisAnnotations, changes: Partial<Omit<AnalysisAnnotations, 'schema' | 'version' | 'sourceSha256'>>): AnalysisAnnotations {
  return validateAnalysisAnnotations({
    schema: base.schema,
    version: base.version,
    sourceSha256: base.sourceSha256,
    entryPoints: [...(changes.entryPoints ?? base.entryPoints)],
    regions: [...(changes.regions ?? base.regions)],
    indirectTargets: [...(changes.indirectTargets ?? base.indirectTargets)],
    comments: [...(changes.comments ?? base.comments)],
    labels: [...(changes.labels ?? base.labels)],
  });
}

/** Add an entry point the bytes do not reach on their own. */
export function withEntryPoint(base: AnalysisAnnotations, address: number): AnalysisAnnotations {
  if (!isAddress(address)) throw new Error('An extra entry point must be a 16-bit address');
  if (base.entryPoints.includes(address)) return base;
  return rebuild(base, { entryPoints: [...base.entryPoints, address] });
}

export function withoutEntryPoint(base: AnalysisAnnotations, address: number): AnalysisAnnotations {
  if (!base.entryPoints.includes(address)) return base;
  return rebuild(base, { entryPoints: base.entryPoints.filter((entry) => entry !== address) });
}

/**
 * Mark a span as code, data or text. A new marking wins over what it covers:
 * overlapping parts of existing regions are trimmed or dropped, so a reader
 * correcting an earlier decision does not have to undo it first.
 */
export function withRegion(base: AnalysisAnnotations, region: AnalysisRegion): AnalysisAnnotations {
  if (!isAddress(region.start) || !isAddress(region.end)) throw new Error('A region must span 16-bit addresses');
  if (region.end < region.start) throw new Error('A region cannot end before it starts');
  const kept: AnalysisRegion[] = [];
  for (const existing of base.regions) {
    if (existing.end < region.start || existing.start > region.end) { kept.push(existing); continue; }
    if (existing.start < region.start) kept.push({ ...existing, end: region.start - 1 });
    if (existing.end > region.end) kept.push({ ...existing, start: region.end + 1 });
  }
  return rebuild(base, { regions: [...kept, { ...region }] });
}

/** Remove whichever region covers an address, leaving the rest untouched. */
export function withoutRegionAt(base: AnalysisAnnotations, address: number): AnalysisAnnotations {
  const remaining = base.regions.filter((region) => address < region.start || address > region.end);
  if (remaining.length === base.regions.length) return base;
  return rebuild(base, { regions: remaining });
}

export function regionAt(annotations: AnalysisAnnotations, address: number): AnalysisRegion | undefined {
  return annotations.regions.find((region) => address >= region.start && address <= region.end);
}

/** Record where control can go from an instruction whose target the bytes do not fix. */
export function withIndirectTarget(base: AnalysisAnnotations, hint: IndirectFlowHint): AnalysisAnnotations {
  const others = base.indirectTargets.filter((existing) => existing.from !== hint.from);
  return rebuild(base, { indirectTargets: [...others, { ...hint, targets: [...hint.targets] }] });
}

export function withoutIndirectTarget(base: AnalysisAnnotations, from: number): AnalysisAnnotations {
  const remaining = base.indirectTargets.filter((hint) => hint.from !== from);
  if (remaining.length === base.indirectTargets.length) return base;
  return rebuild(base, { indirectTargets: remaining });
}

/** Attach or replace a comment. Empty text removes it. */
export function withComment(base: AnalysisAnnotations, address: number, text: string): AnalysisAnnotations {
  const others = base.comments.filter((entry) => entry.address !== address);
  if (!text.trim()) {
    return others.length === base.comments.length ? base : rebuild(base, { comments: others });
  }
  return rebuild(base, { comments: [...others, { address, text }] });
}

/** Attach or replace a label. Empty text removes it. */
export function withLabel(base: AnalysisAnnotations, address: number, text: string): AnalysisAnnotations {
  const others = base.labels.filter((entry) => entry.address !== address);
  if (!text.trim()) {
    return others.length === base.labels.length ? base : rebuild(base, { labels: others });
  }
  return rebuild(base, { labels: [...others, { address, text }] });
}

/* ---- lookups for the analyser and the interface -------------------------- */

export function commentLookup(annotations: AnalysisAnnotations): Map<number, string> {
  return new Map(annotations.comments.map((entry) => [entry.address, entry.text]));
}

export function labelLookup(annotations: AnalysisAnnotations): Map<number, string> {
  return new Map(annotations.labels.map((entry) => [entry.address, entry.text]));
}

export function indirectTargetLookup(annotations: AnalysisAnnotations): Map<number, number[]> {
  return new Map(annotations.indirectTargets.map((hint) => [hint.from, [...hint.targets]]));
}

/** True when nothing has been recorded, so callers can skip storing it. */
export function isEmptyAnnotations(annotations: AnalysisAnnotations): boolean {
  return !annotations.entryPoints.length && !annotations.regions.length && !annotations.indirectTargets.length
    && !annotations.comments.length && !annotations.labels.length;
}

/** A one-line description for the interface and for history entries. */
export function annotationSummary(annotations: AnalysisAnnotations): string {
  const parts: string[] = [];
  const count = (value: number, singular: string, plural = `${singular}s`) => value === 1 ? `1 ${singular}` : `${value} ${plural}`;
  if (annotations.entryPoints.length) parts.push(count(annotations.entryPoints.length, 'extra entry point'));
  if (annotations.regions.length) parts.push(count(annotations.regions.length, 'marked region'));
  if (annotations.indirectTargets.length) parts.push(count(annotations.indirectTargets.length, 'indirect-flow hint'));
  if (annotations.comments.length) parts.push(count(annotations.comments.length, 'comment'));
  if (annotations.labels.length) parts.push(count(annotations.labels.length, 'label'));
  return parts.length ? parts.join(' · ') : 'No annotations recorded';
}
