/*
 * Type hints decorated beside the source, rather than only listed in a panel.
 *
 * The editor is a textarea, so a hint cannot be drawn between two characters
 * the way a full editor component would: there is no way to place anything
 * inside the text without mirroring it and matching font metrics exactly, and
 * a decoration that drifts by a character is worse than none. What can be
 * placed accurately is a rail beside the source, one row per line, aligned to
 * the same line height the editor is using.
 *
 * That alignment holds only while a source line occupies exactly one visual
 * row. With word wrap on it does not, so the rail says it is unavailable and
 * why instead of drawing rows against the wrong lines.
 */
import type { SourceTypeHint } from '../language/projectLanguageService';

export interface InlayHintRow {
  line: number;
  /** What is shown in the rail: short, because the rail is narrow. */
  label: string;
  /** The whole hint, for the title and the accessible name. */
  detail: string;
  /** How many hints that line carries, when it carries more than one. */
  count: number;
}

export interface InlayHintRail {
  available: boolean;
  /** Said plainly when there is nothing to draw, or drawing would mislead. */
  unavailableReason: string | null;
  rows: InlayHintRow[];
}

/** The short form shown in the rail: the type, and the storage when it adds anything. */
export function inlayHintLabel(hint: SourceTypeHint): string {
  return hint.storage && hint.storage !== hint.type ? `${hint.type} ${hint.storage}` : hint.type;
}

function describe(hint: SourceTypeHint): string {
  const parts = [`${hint.token}: ${hint.type}`, hint.storage];
  if (hint.signedness) parts.push(hint.signedness);
  if (hint.addressSpace) parts.push(hint.addressSpace);
  if (hint.returns) parts.push(`returns ${hint.returns}`);
  if (hint.parameters) parts.push(`parameters ${hint.parameters.length ? hint.parameters.join(', ') : 'none'}`);
  if (hint.callingConvention) parts.push(hint.callingConvention);
  return parts.filter(Boolean).join(' · ');
}

/**
 * The rail for a file, or the reason there is none.
 *
 * A line with more than one hint shows the first and says how many there are,
 * because the rail has room for one and silently dropping the others would
 * make it look as though a line had a single type when it has three.
 */
export function inlayHintRail(
  hints: readonly SourceTypeHint[],
  options: { enabled: boolean; wordWrap: boolean; paused?: boolean },
): InlayHintRail {
  if (!options.enabled) return { available: false, unavailableReason: null, rows: [] };
  if (options.paused) {
    return { available: false, rows: [], unavailableReason: 'Large source mode has paused the type scan, so there are no hints to decorate.' };
  }
  if (options.wordWrap) {
    return {
      available: false, rows: [],
      unavailableReason: 'Word wrap is on, so a source line can take several rows and a rail beside it would sit against the wrong lines. Turn word wrap off to decorate hints.',
    };
  }
  if (!hints.length) {
    return { available: false, rows: [], unavailableReason: 'No authoritative type is known for anything in this file, so nothing is decorated.' };
  }
  const byLine = new Map<number, SourceTypeHint[]>();
  for (const hint of hints) byLine.set(hint.line, [...(byLine.get(hint.line) ?? []), hint]);
  const rows = [...byLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, lineHints]) => {
      const ordered = [...lineHints].sort((left, right) => left.column - right.column);
      const first = ordered[0]!;
      return {
        line,
        label: ordered.length > 1 ? `${inlayHintLabel(first)} +${ordered.length - 1}` : inlayHintLabel(first),
        detail: ordered.map(describe).join(' | '),
        count: ordered.length,
      };
    });
  return { available: true, unavailableReason: null, rows };
}
