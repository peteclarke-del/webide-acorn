import type { SourceLanguage } from '../project/project';
import type { LanguageItem } from './languageService';

export interface CompletionContext {
  prefix: string;
  start: number;
  end: number;
  automatic: boolean;
}

export interface RankedCompletion {
  item: LanguageItem;
  ambiguousCount: number;
  /* Where the typed characters landed in the token, so the interface can show
   * why a candidate matched. A prefix match has the leading run; a scattered
   * match has the individual positions. Empty when nothing was typed. */
  matched: number[];
  /* True when the token does not begin with what was typed, and so was found
   * by matching the characters in order rather than from the front. */
  scattered: boolean;
}

export interface FuzzyMatch {
  /** Higher is better. */
  score: number;
  positions: number[];
}

/**
 * Match the typed characters against a candidate in order, allowing gaps.
 *
 * Typing every character of `draw_sprite` to reach it is not how anyone works;
 * `dsp` should find it. What makes the difference between useful and noisy is
 * where the matched characters land, so a match at the start of the token or
 * at a word boundary — after an underscore or a dot, or at a capital in a
 * camel-cased name — is worth much more than one in the middle of a word, and
 * every skipped character costs.
 *
 * Returns null when the characters are not present in order at all, which is a
 * real answer: the candidate is then not offered rather than offered last.
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] };
  const lowerQuery = query.toLowerCase();
  const lowerCandidate = candidate.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let at = 0;

  for (let index = 0; index < lowerQuery.length; index += 1) {
    const found = lowerCandidate.indexOf(lowerQuery[index]!, at);
    if (found < 0) return null;
    const previous = found === 0 ? '' : candidate[found - 1]!;
    const boundary = found === 0 || previous === '_' || previous === '.' || previous === '-'
      || (/[a-z0-9]/.test(previous) && /[A-Z]/.test(candidate[found]!));
    score += boundary ? 12 : 3;
    /* A character immediately after the previous match keeps the run going. */
    if (positions.length && found === positions[positions.length - 1]! + 1) score += 6;
    /* Everything skipped costs, so a tight match beats a scattered one. */
    score -= Math.min(6, found - at);
    if (candidate[found] === query[index]) score += 1;
    positions.push(found);
    at = found + 1;
  }
  /* A shorter candidate matched the same characters more completely. */
  score -= Math.min(10, candidate.length - query.length) / 2;
  return { score, positions };
}

/**
 * The characters that both accept a candidate and are then typed.
 *
 * Deliberately few. A commit character that fires when someone meant to type
 * the character is worse than not having one at all, because it silently
 * rewrites what they wrote. So `(` commits a callable — nobody types an open
 * bracket after a half-written function name meaning anything else — and in
 * assembly `,` and `)` commit a symbol, because an operand is followed by one
 * or the other and by nothing else. Nothing commits on a letter, a digit, a
 * space or a full stop, because all four occur inside real tokens.
 */
export function commitCharactersFor(item: LanguageItem): string[] {
  const characters = ['Enter', 'Tab'];
  const callable = item.kind === 'function' || (item.kind === 'macro' && !!item.parameters?.length);
  if (callable) characters.push('(');
  const assembly = item.languages?.some((language) => language === '6502' || language === 'arm');
  if (assembly && ['symbol', 'constant', 'variable'].includes(item.kind)) characters.push(',', ')');
  return characters;
}

/** Derive the exact editable token range and whether automatic suggestions are
 * appropriate. Explicit Ctrl+Space remains available even where automatic
 * completion is suppressed, such as strings and comments. */
export function completionContextAt(content: string, position: number, language: SourceLanguage, atomBasic = false): CompletionContext {
  const safePosition = Math.max(0, Math.min(content.length, position));
  const lineStart = content.lastIndexOf('\n', Math.max(0, safePosition - 1)) + 1;
  const lineBefore = content.slice(lineStart, safePosition);

  if (language === '6502' || language === 'arm') {
    const include = lineBefore.match(/^\s*INCLUDE(?:ASSET)?\s+["']([^"']*)$/i);
    if (include) return range(include[1]!, safePosition, true);
    const comment = assemblyCommentIndex(lineBefore);
    const prefix = lineBefore.match(/[A-Za-z_.][A-Za-z0-9_.]*$/)?.[0] ?? '';
    const armComment = language === 'arm' ? armCommentIndex(lineBefore) : comment;
    return range(prefix, safePosition, armComment < 0);
  }

  if (language === 'bbc-basic') {
    const lineTarget = lineBefore.match(/\b(?:GOTO|GOSUB|RESTORE|RESUME|THEN|ELSE)\s+([0-9]*)$/i);
    if (lineTarget) return range(lineTarget[1]!, safePosition, isBasicCode(lineBefore));
    let prefix = lineBefore.match(/[A-Za-z_][A-Za-z0-9_$%]*$/)?.[0] ?? '';
    if (atomBasic) {
      const labelled = lineBefore.match(/^\s*\d{1,5}\s*[a-z]([A-Z][A-Z0-9]*)$/);
      if (labelled) prefix = labelled[1]!;
    }
    return range(prefix, safePosition, isBasicCode(lineBefore));
  }

  if (language === 'c') {
    const include = lineBefore.match(/^\s*#\s*include\s*[<"]([^>"]*)$/);
    if (include) return range(include[1]!, safePosition, true);
  }
  const prefix = lineBefore.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? '';
  return range(prefix, safePosition, language === 'c');
}

/** Stable ranking gives exact/case-preserving matches first, then same-file and
 * other project symbols, then the versioned reference catalogue. Duplicate
 * visible project declarations remain separate and are explicitly marked. */
/* Two characters before scattered matching joins in. With one character every
 * token containing that letter would qualify, which is a list nobody can read
 * and is worse than the short one it replaced. */
const SCATTERED_FROM = 2;

export function rankCompletionItems(candidates: LanguageItem[], prefix: string, currentFileId: string): RankedCompletion[] {
  const normalized = prefix.toUpperCase();
  const prefixed = candidates.filter((candidate) => candidate.token.toUpperCase().startsWith(normalized));

  /* Scattered matches are a second tier, never mixed into the first: someone
   * who typed the start of a name expects that name, and a cleverer ranking
   * that put something else above it would be worse than no ranking at all. */
  const prefixedTokens = new Set(prefixed);
  const scattered = prefix.length >= SCATTERED_FROM
    ? candidates.flatMap((candidate) => {
      if (prefixedTokens.has(candidate)) return [];
      const match = fuzzyMatch(prefix, candidate.token);
      return match ? [{ candidate, match }] : [];
    })
    : [];

  const declarationCounts = new Map<string, number>();
  for (const candidate of [...prefixed, ...scattered.map((entry) => entry.candidate)]) {
    if (candidate.source?.kind !== 'project') continue;
    const key = candidate.token.toUpperCase();
    declarationCounts.set(key, (declarationCounts.get(key) ?? 0) + 1);
  }
  const ambiguity = (item: LanguageItem) => {
    const count = declarationCounts.get(item.token.toUpperCase()) ?? 0;
    return count > 1 ? count : 0;
  };

  const exact = prefixed
    .map((item, order) => ({ item, order, score: score(item, prefix, currentFileId) }))
    .sort((left, right) => left.score - right.score || left.item.token.localeCompare(right.item.token) || left.order - right.order)
    .map(({ item }) => ({ item, ambiguousCount: ambiguity(item), matched: prefix ? [...prefix].map((_, index) => index) : [], scattered: false }));

  const loose = scattered
    .map((entry, order) => ({ ...entry, order }))
    .sort((left, right) => right.match.score - left.match.score || left.candidate.token.localeCompare(right.candidate.token) || left.order - right.order)
    .map(({ candidate, match }) => ({ item: candidate, ambiguousCount: ambiguity(candidate), matched: match.positions, scattered: true }));

  return [...exact, ...loose];
}

function range(prefix: string, end: number, automatic: boolean): CompletionContext {
  return { prefix, start: end - prefix.length, end, automatic };
}

function isBasicCode(lineBefore: string) {
  let quoted = false;
  for (let index = 0; index < lineBefore.length; index += 1) {
    if (lineBefore[index] === '"') quoted = !quoted;
    if (!quoted && /^REM\b/i.test(lineBefore.slice(index)) && (index === 0 || !/[A-Za-z0-9_]/.test(lineBefore[index - 1]!))) return false;
  }
  return !quoted;
}

function assemblyCommentIndex(lineBefore: string) {
  let quote = '';
  for (let index = 0; index < lineBefore.length; index += 1) {
    const character = lineBefore[index]!;
    if ((character === '"' || character === "'") && (!quote || quote === character)) quote = quote ? '' : character;
    else if (character === ';' && !quote) return index;
  }
  return -1;
}

function armCommentIndex(lineBefore: string) {
  const assembly = assemblyCommentIndex(lineBefore);
  const slash = lineBefore.indexOf('//');
  const at = lineBefore.indexOf('@');
  return [assembly, slash, at].filter((index) => index >= 0).reduce((first, index) => Math.min(first, index), Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY ? -1 : [assembly, slash, at].filter((index) => index >= 0).reduce((first, index) => Math.min(first, index));
}

function score(item: LanguageItem, prefix: string, currentFileId: string) {
  let value = item.source?.kind === 'project' ? (item.source.fileId === currentFileId ? 0 : 20) : 100;
  value += item.token === prefix ? 0 : item.token.toUpperCase() === prefix.toUpperCase() ? 2 : item.token.startsWith(prefix) ? 10 : 20;
  value += Math.min(20, Math.max(0, item.token.length - prefix.length));
  return value;
}
