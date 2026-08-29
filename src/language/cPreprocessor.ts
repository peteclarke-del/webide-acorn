/* Which parts of a C file are actually in this build.
 *
 * Acorn C is full of conditional compilation: a driver written for both a
 * BBC Master and an Archimedes, a debug build that defines extra symbols, a
 * header that guards itself. Until now every `#define` in a file was offered
 * for completion as though it were unconditional, which is wrong in the way
 * that matters most — it offers a symbol that will not exist when the code is
 * built, and the failure appears at compile time with no connection back to
 * the suggestion that caused it.
 *
 * What this module does is narrow and deliberate. It reads the conditional
 * structure of a file and says, for any line, which conditions guard it. Given
 * the build target's own defines it then answers one of three things:
 *
 *   active    — this branch is compiled for this target
 *   inactive  — this branch is not, and offering its symbols would be wrong
 *   unknown   — the condition depends on something not known here
 *
 * `unknown` is the important one and is never collapsed into either of the
 * others. A condition like `#if VERSION > 2` needs the value of `VERSION` and
 * an expression evaluator; guessing which way it goes would put a symbol in
 * front of someone with a confidence the product has not earned. An unknown
 * branch is offered with its condition stated, so the person decides.
 */

export type BranchState = 'active' | 'inactive' | 'unknown';

export interface Guard {
  /** The directive as written, e.g. `#ifdef DEBUG` or `#else`. */
  directive: string;
  /** The condition, normalised. Empty for `#else`. */
  condition: string;
  /** Line the directive is on, one-based. */
  line: number;
  /** True when this is the `#else`/`#elif` arm of the condition above it. */
  negated: boolean;
}

const CONDITIONAL = /^\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b\s*(.*)$/;

/**
 * The stack of conditions guarding every line of a file, indexed by line
 * number minus one. A line outside any conditional has an empty stack.
 */
export function guardsByLine(content: string): Guard[][] {
  const lines = content.split('\n');
  const result: Guard[][] = [];
  const stack: Guard[] = [];

  lines.forEach((line, index) => {
    const match = CONDITIONAL.exec(line);
    if (!match) { result.push([...stack]); return; }
    const [, directive, rest] = match as unknown as [string, string, string];
    const condition = rest.replace(/\/\*.*$/, '').replace(/\/\/.*$/, '').trim();
    const number = index + 1;

    /* A directive line belongs to the scope that encloses it, not to the arm
     * it opens or closes. Otherwise `#else` would report itself as being in
     * the branch it introduces, which reads as the directive being compiled
     * out of the build that is in fact taking it. */
    if (directive === 'endif') {
      stack.pop();
      result.push([...stack]);
      return;
    }
    if (directive === 'else' || directive === 'elif') {
      const opened = stack.pop();
      result.push([...stack]);
      stack.push({
        directive: `#${directive}${condition ? ` ${condition}` : ''}`,
        condition: directive === 'elif' ? condition : opened?.condition ?? '',
        line: number,
        negated: directive === 'else',
      });
      return;
    }
    result.push([...stack]);
    stack.push({
      directive: `#${directive} ${condition}`.trim(),
      condition: directive === 'ifndef' ? `!defined(${condition})` : directive === 'ifdef' ? `defined(${condition})` : condition,
      line: number,
      negated: false,
    });
  });

  return result;
}

/** The names a build target defines, from its `NAME` or `NAME=value` list. */
export function definedNames(defines: readonly string[]): Set<string> {
  return new Set(defines.map((define) => define.split('=')[0]!.trim()).filter(Boolean));
}

/**
 * Whether one condition holds, given what the build defines.
 *
 * Only the forms that can be decided without evaluating C are decided:
 * `defined(X)`, `X` on its own, and either of those negated, optionally joined
 * by `&&` or `||`. Anything else is `unknown`, which is the honest answer and
 * not a synonym for false.
 */
export function conditionState(condition: string, defines: ReadonlySet<string>): BranchState {
  const text = condition.trim();
  if (!text) return 'unknown';

  /* Split on the top-level connective, if there is exactly one kind of one. */
  for (const connective of ['&&', '||'] as const) {
    const parts = splitTopLevel(text, connective);
    if (parts.length > 1) {
      const states = parts.map((part) => conditionState(part, defines));
      if (states.includes('unknown')) {
        /* A decided operand can still settle the whole expression. */
        if (connective === '&&' && states.includes('inactive')) return 'inactive';
        if (connective === '||' && states.includes('active')) return 'active';
        return 'unknown';
      }
      return connective === '&&'
        ? (states.every((state) => state === 'active') ? 'active' : 'inactive')
        : (states.some((state) => state === 'active') ? 'active' : 'inactive');
    }
  }

  const stripped = text.replace(/^\((.*)\)$/s, '$1').trim();
  if (stripped !== text) return conditionState(stripped, defines);

  const negation = /^!\s*(.+)$/.exec(text);
  if (negation) {
    const inner = conditionState(negation[1]!, defines);
    return inner === 'unknown' ? 'unknown' : inner === 'active' ? 'inactive' : 'active';
  }

  const defined = /^defined\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?$/.exec(text);
  if (defined) return defines.has(defined[1]!) ? 'active' : 'inactive';

  /* `#if 0` and `#if 1` are the idiom for commenting a block out. */
  if (/^0+$/.test(text)) return 'inactive';
  if (/^\d+$/.test(text)) return 'active';

  /* A bare name is its definedness only when it is not compared to anything. */
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return defines.has(text) ? 'active' : 'inactive';

  return 'unknown';
}

/** The state of a whole guard stack: every guard must hold for the line to. */
export function guardState(guards: readonly Guard[], defines: ReadonlySet<string>): BranchState {
  let result: BranchState = 'active';
  for (const guard of guards) {
    const inner = conditionState(guard.condition, defines);
    const state: BranchState = guard.negated
      ? (inner === 'unknown' ? 'unknown' : inner === 'active' ? 'inactive' : 'active')
      : inner;
    if (state === 'inactive') return 'inactive';
    if (state === 'unknown') result = 'unknown';
  }
  return result;
}

/** One sentence for a person, or null when the line is unconditional. */
export function guardSummary(guards: readonly Guard[], state: BranchState): string | null {
  if (!guards.length) return null;
  const conditions = guards.map((guard) => guard.negated ? `not ${guard.condition}` : guard.condition).join(' and ');
  if (state === 'active') return `Compiled for this build target, under ${conditions}.`;
  if (state === 'inactive') return `Not compiled for this build target: it is inside ${conditions}.`;
  return `Compiled only when ${conditions}, which this build target does not settle.`;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (depth === 0 && text.startsWith(separator, index)) {
      parts.push(text.slice(start, index));
      index += separator.length - 1;
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}
