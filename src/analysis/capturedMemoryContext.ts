/* What a window of machine memory is, when it reaches the analyser.
 *
 * A file has a name, a length and load addresses; a memory capture has none of
 * those. What it has instead is where it was read from, which the analyser
 * otherwise loses entirely — and losing it is not a small thing. Sixteen
 * sideways banks share one address range, so bytes from bank 4 and bytes from
 * bank 12 disassemble at the same addresses and look identical afterwards. A
 * listing that does not say which bank it came from cannot be compared with
 * anything, including itself an hour later.
 *
 * So the context travels with the bytes: the space, the bank when the space is
 * banked, the address they start at, and the cycle they were taken at. The
 * last of those matters because a capture is a moment rather than a document —
 * the same read a moment later can be different bytes, and a listing that
 * looked like a file would give no hint of that.
 */
import type { AcornFileMetadata } from './types';

export interface CapturedMemoryContext {
  machineLabel: string;
  spaceId: string;
  spaceLabel: string;
  /** Set when the space is banked, and meaningless when it is not. */
  bank?: number;
  /** Whether the space this came from is one of several sharing its addresses. */
  banked: boolean;
  address: number;
  byteLength: number;
  capturedAtCycles: number;
}

/** A name that says what this is, since a capture has none of its own. */
export function capturedMemoryName(context: CapturedMemoryContext): string {
  const address = `&${context.address.toString(16).toUpperCase().padStart(4, '0')}`;
  const bank = context.banked && context.bank !== undefined ? ` bank ${context.bank}` : '';
  return `${context.spaceId}${bank} ${address}`.replace(/[^A-Za-z0-9&_. -]/g, '-');
}

/**
 * The metadata a capture carries into analysis.
 *
 * The origin is the address the bytes were read from, because that is the one
 * thing about a capture that is certainly true. There is no execution address:
 * nothing about a window of memory says anything is entered at its start, and
 * defaulting one would be inventing a fact about somebody's program. The
 * analyser's own entry point defaults to the origin, which is a choice a reader
 * can see and change rather than a claim this build made for them.
 */
export function capturedMemoryMetadata(context: CapturedMemoryContext): AcornFileMetadata {
  const warnings: string[] = [
    `These bytes are a capture of ${context.spaceLabel} at cycle ${context.capturedAtCycles.toLocaleString()}, not a file. The same read at another moment can hold different bytes.`,
  ];
  if (context.banked && context.bank === undefined) {
    /* The one case the caller must not be allowed to slide past. Every banked
     * space shares its addresses with fifteen others, so a capture that does
     * not say which bank it is cannot be told apart from the wrong one. */
    warnings.push('This space is banked and no bank was recorded with the capture, so which of the banks these bytes came from is not established.');
  }
  if (!context.banked && context.bank !== undefined) {
    warnings.push(`${context.spaceLabel} is not banked, so the bank recorded with this capture has been ignored rather than shown as if it meant something.`);
  }

  return {
    source: 'container',
    catalogueName: capturedMemoryName(context),
    load: context.address,
    declaredLength: context.byteLength,
    addressSpace: `${context.machineLabel} · ${context.spaceLabel}`,
    ...(context.banked && context.bank !== undefined ? { bank: `Sideways bank ${context.bank}` } : {}),
    warnings,
  };
}
