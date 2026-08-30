/* Which sideways ROM sits in which bank.
 *
 * Sideways ROM mounting already worked, but only by derivation: enable a
 * capability and the ROM it needs was mounted somewhere. That is enough to run
 * a machine and not enough to develop for one. A sideways ROM's bank number
 * decides its service-call priority, which ROM answers a `*` command first, and
 * which one wins when two claim the same name — and none of that is visible if
 * the product chooses the bank.
 *
 * So a bank is something a person assigns, and this is the model behind that.
 *
 * What is asserted here is deliberately narrow. Sixteen banks is architectural:
 * the ROM select register on the 6502 Acorn machines is four bits wide, so the
 * address space has sixteen and no more. Which banks a particular machine has
 * fitted, and what its own firmware occupies, is machine-specific and is taken
 * from the ROM set definition rather than assumed here — this build will not
 * state that BASIC lives in a particular bank on a particular model unless the
 * data it ships says so.
 */
import { validateRom, type RomRequirement } from './romProfiles';

/** The ROM select register is four bits wide, so there are sixteen banks. */
export const SIDEWAYS_BANKS = 16;

/** A sideways ROM image is exactly 16 KiB. */
export const SIDEWAYS_BANK_BYTES = 16 * 1024;

export interface SidewaysAssignment {
  /** 0 to 15. */
  bank: number;
  /** Identifier of the ROM image occupying it. */
  romId: string;
  /** What to call it. */
  label: string;
  /** True when the machine's own firmware occupies this bank, not the user. */
  reserved?: boolean;
}

export type SlotProblemKind =
  | 'bank-out-of-range'
  | 'bank-occupied'
  | 'bank-reserved'
  | 'image-wrong-size'
  | 'image-not-sideways'
  | 'duplicate-rom';

export interface SlotProblem {
  kind: SlotProblemKind;
  bank: number;
  /** Why, in the user's terms, and what to do about it. */
  reason: string;
}

export interface SlotLayout {
  assignments: SidewaysAssignment[];
  problems: SlotProblem[];
}

/** Whether a bank number is one the hardware has. */
export function isBank(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < SIDEWAYS_BANKS;
}

/**
 * Place a ROM in a bank, or say why it cannot go there.
 *
 * A refusal never silently relocates the image. Choosing a different bank on
 * someone's behalf would change the service-call priority they were setting,
 * which is the one thing this editor exists to let them control.
 */
export function assignBank(
  layout: readonly SidewaysAssignment[],
  candidate: SidewaysAssignment,
): { layout: SidewaysAssignment[]; problem: SlotProblem | null } {
  if (!isBank(candidate.bank)) {
    return {
      layout: [...layout],
      problem: { kind: 'bank-out-of-range', bank: candidate.bank, reason: `A sideways bank is numbered 0 to ${SIDEWAYS_BANKS - 1}; ${candidate.bank} is not one of them.` },
    };
  }
  const occupant = layout.find((entry) => entry.bank === candidate.bank);
  if (occupant?.reserved) {
    return {
      layout: [...layout],
      problem: { kind: 'bank-reserved', bank: candidate.bank, reason: `Bank ${candidate.bank} holds ${occupant.label}, which is part of this machine's own firmware and cannot be replaced from here.` },
    };
  }
  if (occupant) {
    return {
      layout: [...layout],
      problem: { kind: 'bank-occupied', bank: candidate.bank, reason: `Bank ${candidate.bank} already holds ${occupant.label}. Remove it first, or choose another bank; nothing is moved for you, because the bank is what sets service-call priority.` },
    };
  }
  const elsewhere = layout.find((entry) => entry.romId === candidate.romId);
  if (elsewhere) {
    return {
      layout: [...layout],
      problem: { kind: 'duplicate-rom', bank: candidate.bank, reason: `${candidate.label} is already in bank ${elsewhere.bank}. The same image in two banks answers every service call twice, which is rarely what anyone wants.` },
    };
  }
  return {
    layout: [...layout, candidate].sort((left, right) => left.bank - right.bank),
    problem: null,
  };
}

/** Take a ROM out of its bank. A reserved bank is not the user's to clear. */
export function clearBank(layout: readonly SidewaysAssignment[], bank: number): { layout: SidewaysAssignment[]; problem: SlotProblem | null } {
  const occupant = layout.find((entry) => entry.bank === bank);
  if (occupant?.reserved) {
    return {
      layout: [...layout],
      problem: { kind: 'bank-reserved', bank, reason: `Bank ${bank} holds ${occupant.label}, which is part of this machine's own firmware and cannot be removed from here.` },
    };
  }
  return { layout: layout.filter((entry) => entry.bank !== bank), problem: null };
}

/**
 * Check an image before it is placed, so a bad one is refused at the point of
 * choosing rather than at the point of running.
 *
 * The header checks come from the existing ROM validator, which is the same one
 * the firmware vault uses, so an image accepted here is accepted there.
 */
export function validateSidewaysImage(bytes: Uint8Array, label: string): SlotProblem[] {
  const problems: SlotProblem[] = [];
  if (bytes.length !== SIDEWAYS_BANK_BYTES) {
    problems.push({
      kind: 'image-wrong-size',
      bank: -1,
      reason: `A sideways ROM is exactly ${SIDEWAYS_BANK_BYTES.toLocaleString()} bytes. ${label} is ${bytes.length.toLocaleString()}, so it is not one${bytes.length > SIDEWAYS_BANK_BYTES && bytes.length % SIDEWAYS_BANK_BYTES === 0 ? '; a combined image has to be split into its banks first' : ''}.`,
    });
    return problems;
  }
  /* Checked as an extension ROM, which is what a sideways image is, using the
   * same validator the firmware vault uses so an image accepted here is
   * accepted there. */
  const requirement: RomRequirement = {
    id: 'sideways-candidate',
    label,
    purpose: 'extension',
    acceptedSizes: [SIDEWAYS_BANK_BYTES],
    emulatorPath: '',
    required: false,
    runtimeMount: 'sideways',
  };
  const validation = validateRom(requirement, bytes);
  for (const error of validation.errors) problems.push({ kind: 'image-not-sideways', bank: -1, reason: error });
  return problems;
}

/**
 * Every bank, occupied or not, in the order the hardware numbers them.
 *
 * Presented in full rather than as a list of what is filled, because an empty
 * bank is information: it is where the next ROM can go, and its number is what
 * sets that ROM's priority.
 */
export function bankRows(layout: readonly SidewaysAssignment[]): Array<{ bank: number; assignment: SidewaysAssignment | null }> {
  return Array.from({ length: SIDEWAYS_BANKS }, (_, bank) => ({
    bank,
    assignment: layout.find((entry) => entry.bank === bank) ?? null,
  }));
}

/**
 * What is wrong with a whole layout, rather than with one placement.
 *
 * Used when a layout arrives from a project document rather than from the
 * editor, where nothing stopped it being written badly.
 */
export function validateLayout(layout: readonly SidewaysAssignment[]): SlotProblem[] {
  const problems: SlotProblem[] = [];
  const seenBank = new Set<number>();
  const seenRom = new Map<string, number>();
  for (const entry of layout) {
    if (!isBank(entry.bank)) {
      problems.push({ kind: 'bank-out-of-range', bank: entry.bank, reason: `${entry.label} is recorded in bank ${entry.bank}, and a sideways bank is numbered 0 to ${SIDEWAYS_BANKS - 1}.` });
      continue;
    }
    if (seenBank.has(entry.bank)) {
      problems.push({ kind: 'bank-occupied', bank: entry.bank, reason: `Bank ${entry.bank} is recorded twice. Only one image can occupy a bank, so this layout cannot be applied as written.` });
      continue;
    }
    seenBank.add(entry.bank);
    const first = seenRom.get(entry.romId);
    if (first !== undefined) {
      problems.push({ kind: 'duplicate-rom', bank: entry.bank, reason: `${entry.label} is recorded in banks ${first} and ${entry.bank}. The same image in two banks answers every service call twice.` });
      continue;
    }
    seenRom.set(entry.romId, entry.bank);
  }
  return problems;
}

/**
 * The banks in the order the machine asks them, which is highest first.
 *
 * A service call is offered to bank 15 before bank 0, so two ROMs claiming the
 * same `*` command are resolved by bank number. Anyone arranging ROMs is doing
 * it for this reason, so the order is stated rather than left to be known.
 */
export function serviceCallOrder(layout: readonly SidewaysAssignment[]): SidewaysAssignment[] {
  return [...layout].sort((left, right) => right.bank - left.bank);
}
