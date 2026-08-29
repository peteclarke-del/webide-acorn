/* Reading a C declaration properly, rather than by pattern.
 *
 * C declarations were matched with a regular expression shaped like
 * `type name;`, which covers the simple half of the language and quietly
 * misses the half that Acorn C is actually written in:
 *
 *   char *names[8];              an array of pointers, not a pointer
 *   void (*handler)(int);        a function pointer, not a function
 *   int (*table[4])(void);       an array of function pointers
 *   int a, *b, c[3];             three declarators, three different types
 *   unsigned char screen[8][8];  two dimensions, not one
 *
 * A pattern that misses these does not fail loudly. It offers `handler` as a
 * variable of type `void`, or offers nothing at all and the completion list is
 * simply short — which reads as "this file has no such symbol" and is wrong.
 *
 * So the declarator is parsed the way the C grammar actually reads it: find the
 * innermost identifier, then work outwards, applying each construct in the
 * order the language applies it. The result names what the thing is and writes
 * its type back out in a form a person recognises, because the point of a type
 * hint is to be read.
 *
 * This is deliberately a declaration parser and not a C parser. It answers
 * "what is declared here, and what is its type" for declarations that appear in
 * source, and returns nothing for anything it cannot read rather than guessing.
 * Nothing downstream should present a type this module did not produce.
 */

export type DeclaratorKind = 'variable' | 'pointer' | 'array' | 'function' | 'function-pointer';

export interface CDeclarator {
  name: string;
  /**
   * The declared type. For a function or a function pointer this is what it
   * returns, which is the question a reader is actually asking; the parameters
   * are separate, and the whole declaration is in `declaration`.
   */
  type: string;
  kind: DeclaratorKind;
  /** Present for a function or a function pointer. */
  parameters?: string[];
  /** The declaration as written, normalised. Nothing is inferred into it. */
  declaration: string;
  /** Offset of the name within the text that was parsed. */
  offset: number;
}

const STORAGE_AND_QUALIFIERS = new Set(['static', 'extern', 'register', 'auto', 'inline', 'const', 'volatile', 'restrict', '__attribute__']);
/* Words that open a statement rather than a declaration. Without these,
 * `return x;` reads as a variable `x` of type `return`. */
const STATEMENT_KEYWORDS = new Set(['return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'goto', 'sizeof', 'typedef']);
const TYPE_WORDS = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool', 'struct', 'union', 'enum']);

/** Split on commas that are not inside brackets, braces or parentheses. */
function splitTopLevel(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') depth -= 1;
    else if (character === separator && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The matching close for the bracket at `open`, or -1. */
function matchBracket(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']' };
  const close = pairs[text[open]!];
  if (!close) return -1;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === text[open]) depth += 1;
    else if (text[index] === close) { depth -= 1; if (depth === 0) return index; }
  }
  return -1;
}

interface Parsed {
  name: string;
  offset: number;
  /** The type built outwards from the name, e.g. `*[8]` becomes an array of pointers. */
  describe: (base: string) => string;
  kind: DeclaratorKind;
  parameters?: string[];
  /** True when a `*` binds to the declarator itself rather than to the type. */
  pointer?: boolean;
}

/**
 * Read one declarator — everything after the base type and before the comma or
 * semicolon — into a name and a description of what surrounds it.
 *
 * The recursion mirrors the grammar: parentheses group, a suffix binds tighter
 * than a prefix `*`, and the innermost identifier is the thing being declared.
 */
function parseDeclarator(text: string, base: string): Parsed | null {
  let body = text.trim();
  const leading = text.length - text.trimStart().length;

  /* A prefix `*`, possibly several, possibly qualified. */
  const stars = /^(\*\s*(?:const\s+|volatile\s+)*)+/.exec(body);
  if (stars) {
    const inner = parseDeclarator(body.slice(stars[0].length), base);
    if (!inner) return null;
    const pointers = (stars[0].match(/\*/g) ?? []).length;
    return {
      ...inner,
      offset: inner.offset + leading + stars[0].length,
      pointer: true,
      /* A pointer wrapping a suffix means "pointer to that"; the parentheses
       * the grammar needs are exactly the ones the source already wrote. */
      describe: (outer) => inner.describe(`${outer} ${'*'.repeat(pointers)}`.trim()),
      kind: inner.kind === 'variable' ? 'pointer' : inner.kind,
    };
  }

  /* A parenthesised declarator, which regroups what follows it. */
  if (body.startsWith('(')) {
    const close = matchBracket(body, 0);
    if (close < 0) return null;
    const inner = parseDeclarator(body.slice(1, close), base);
    if (!inner) return null;
    const suffix = body.slice(close + 1).trim();
    if (suffix.startsWith('(')) {
      const parameterClose = matchBracket(suffix, 0);
      const parameters = parameterClose < 0 ? [] : splitTopLevel(suffix.slice(1, parameterClose));
      /* The `*` inside the parentheses makes this a pointer to a function; it
       * decorates the declarator, not the return type, so it is not carried
       * outwards into the type the function returns. */
      return {
        name: inner.name,
        offset: inner.offset + leading + 1,
        parameters: parameters.filter((parameter) => parameter !== 'void'),
        kind: inner.pointer ? 'function-pointer' : 'function',
        describe: (outer) => `${outer} ${inner.name}`,
      };
    }
    if (suffix.startsWith('[')) {
      const dimensions = suffix;
      return {
        name: inner.name,
        offset: inner.offset + leading + 1,
        parameters: inner.parameters,
        kind: 'array',
        describe: (outer) => `${inner.describe(outer)}${dimensions}`,
      };
    }
    return { ...inner, offset: inner.offset + leading + 1 };
  }

  /* The identifier, then whatever suffix follows it. */
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(body);
  if (!identifier) return null;
  const name = identifier[0];
  const offset = leading;
  const suffix = body.slice(name.length).trim();

  if (suffix.startsWith('(')) {
    const close = matchBracket(suffix, 0);
    if (close < 0) return null;
    const parameters = splitTopLevel(suffix.slice(1, close));
    return {
      name, offset,
      parameters: parameters.filter((parameter) => parameter !== 'void'),
      kind: 'function',
      /* The return type is what a reader wants; the parameters are separate. */
      describe: (outer) => `${outer} ${name}`,
    };
  }

  if (suffix.startsWith('[')) {
    /* Every dimension, in the order written. */
    let dimensions = '';
    let rest = suffix;
    while (rest.startsWith('[')) {
      const close = matchBracket(rest, 0);
      if (close < 0) return null;
      dimensions += rest.slice(0, close + 1);
      rest = rest.slice(close + 1).trim();
    }
    return { name, offset, kind: 'array', describe: (outer) => `${outer} ${name}${dimensions}` };
  }

  return { name, offset, kind: 'variable', describe: (outer) => `${outer} ${name}` };
}

/**
 * Every declarator in one C declaration, or null when this is not a
 * declaration this module can read.
 *
 * Null is a real answer and callers must treat it as one: a declaration whose
 * type cannot be established gets no type shown, rather than a guess.
 */
export function parseCDeclaration(text: string): CDeclarator[] | null {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '').trim().replace(/[;{]\s*$/, '').trim();
  if (!source) return null;

  /* The base type is the leading run of type words, qualifiers and a tag. */
  const words: string[] = [];
  let rest = source;
  for (;;) {
    const word = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(rest);
    if (!word) break;
    const value = word[1]!;
    if (STORAGE_AND_QUALIFIERS.has(value)) { rest = rest.slice(word[0].length); continue; }
    if (TYPE_WORDS.has(value)) { words.push(value); rest = rest.slice(word[0].length); continue; }
    /* A single leading identifier is a typedef name, but only when something
     * follows it: `frame_counter = 0` is an assignment, not a declaration. */
    if (STATEMENT_KEYWORDS.has(value)) return null;
    if (!words.length && /^[*(A-Za-z_]/.test(rest.slice(word[0].length))) { words.push(value); rest = rest.slice(word[0].length); continue; }
    break;
  }
  if (!words.length) return null;

  /* `struct sprite state;` — the tag is part of the type. */
  if (['struct', 'union', 'enum'].includes(words[words.length - 1]!)) {
    const tag = /^([A-Za-z_][A-Za-z0-9_]*)\s*/.exec(rest);
    if (tag) { words.push(tag[1]!); rest = rest.slice(tag[0].length); }
  }

  const base = words.join(' ');
  const consumed = source.length - rest.length;
  const declarators: CDeclarator[] = [];
  let scanned = consumed;
  for (const part of splitTopLevel(rest)) {
    /* An initialiser is not part of the declarator. */
    const withoutInitialiser = part.split(/\s=(?!=)/)[0]!;
    const at = source.indexOf(part, scanned);
    scanned = at >= 0 ? at + part.length : scanned;
    const parsed = parseDeclarator(withoutInitialiser, base);
    if (!parsed) continue;
    declarators.push({
      name: parsed.name,
      type: parsed.describe(base).replace(new RegExp(`\\s*\\b${parsed.name}\\b`), '').replace(/\s+/g, ' ').trim(),
      kind: parsed.kind,
      ...(parsed.parameters ? { parameters: parsed.parameters } : {}),
      declaration: `${base} ${withoutInitialiser.trim()}`.replace(/\s+/g, ' ').trim(),
      offset: (at >= 0 ? at : 0) + parsed.offset,
    });
  }
  return declarators.length ? declarators : null;
}

/** How a declarator reads back to a person, for a hint or a completion detail. */
export function describeDeclarator(declarator: CDeclarator): string {
  switch (declarator.kind) {
    case 'function': return `function returning ${declarator.type}`;
    case 'function-pointer': return `pointer to function returning ${declarator.type}`;
    case 'array': return `array of ${declarator.type}`;
    case 'pointer': return `pointer to ${declarator.type}`;
    default: return declarator.type;
  }
}
