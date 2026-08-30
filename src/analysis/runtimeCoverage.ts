/* Correlating a static listing with what the machine actually executed.
 *
 * These are two different kinds of evidence and the product must not blur them.
 * Static reachability says "control can get here from the entry point"; runtime
 * coverage says "the processor was observed here". Neither implies the other:
 * reachable code may never run, and an indirect jump can reach code static
 * analysis called data.
 *
 * The correlation is therefore refused unless it can be shown to be about the
 * same bytes at the same addresses. The profiler reports addresses in the live
 * machine's address space; the analysis describes a file. They only line up if
 * the loaded program's SHA-256 is the digest of the analysed bytes and it was
 * loaded at the origin the analysis assumes. Where that cannot be established,
 * this returns a refusal with the reason rather than an approximate overlay —
 * an overlay against the wrong program would be a fabricated claim about which
 * instructions ran.
 */
import type { Disassembly } from './types';

export interface RuntimeCoverageInput {
  /** The listing being correlated. */
  analysis: Disassembly;
  /** SHA-256 of the exact bytes that listing describes. */
  analysedSha256: string;
  /** The program the connected machine reports it loaded, if any. */
  programManifest: { outputSha256: string; origin: number; bytes: number; name: string } | null;
  /** The live profiler's own report, if any. */
  profiler: {
    enabled: boolean;
    instructions: number;
    untrackedInstructions: number;
    uniqueAddresses: number;
    source: string;
    addresses: ReadonlyArray<{ address: number; instructions: number; cycles: number }>;
  } | null;
}

export interface RuntimeCoverageEntry {
  address: number;
  instructions: number;
  cycles: number;
}

export type RuntimeCoverageStatus = 'no-runtime' | 'profiler-off' | 'no-program' | 'different-program' | 'different-origin' | 'bound';

export interface RuntimeCoverage {
  status: RuntimeCoverageStatus;
  /** Why the correlation is or is not being shown, in the user's terms. */
  reason: string;
  /** Executed addresses, empty unless the status is `bound`. */
  entries: ReadonlyMap<number, RuntimeCoverageEntry>;
  /** Rows of the listing the machine was observed executing. */
  executedRows: number;
  /** Rows the analysis called reachable that were never observed executing. */
  reachableNeverExecuted: number;
  /** Rows the analysis did not call code that the machine executed anyway. */
  executedOutsideStaticCode: number;
  /** Profiler samples that fall outside the analysed file entirely. */
  entriesOutsideFile: number;
  /** One line for the interface. */
  summary: string;
}

const EMPTY = new Map<number, RuntimeCoverageEntry>();

function refuse(status: RuntimeCoverageStatus, reason: string): RuntimeCoverage {
  return {
    status, reason, entries: EMPTY,
    executedRows: 0, reachableNeverExecuted: 0, executedOutsideStaticCode: 0, entriesOutsideFile: 0,
    summary: reason,
  };
}

/**
 * Correlate a static listing with live profiler coverage, or explain why the
 * two cannot honestly be shown together.
 */
export function correlateRuntimeCoverage(input: RuntimeCoverageInput): RuntimeCoverage {
  const { analysis, analysedSha256, programManifest, profiler } = input;
  if (!profiler) return refuse('no-runtime', 'No machine is attached, so nothing is known about which of these instructions ran.');
  if (!profiler.enabled) return refuse('profiler-off', 'The live profiler is off. Enable it in the debugger to record which addresses the processor reaches.');
  if (!programManifest) return refuse('no-program', 'The attached machine has not reported a loaded program, so its coverage cannot be attributed to this file.');
  if (programManifest.outputSha256.toLowerCase() !== analysedSha256.toLowerCase()) {
    return refuse('different-program', `The machine is running ${programManifest.name}, whose bytes differ from the ones analysed here. Coverage from a different program is not shown against this listing.`);
  }
  if (programManifest.origin !== analysis.origin) {
    return refuse('different-origin', `The machine loaded these bytes at ${hex(programManifest.origin)} but the listing assumes ${hex(analysis.origin)}. Re-analyse at the loaded address before correlating coverage.`);
  }

  const end = analysis.origin + analysis.rows.reduce((sum, row) => sum + row.bytes.length, 0);
  const entries = new Map<number, RuntimeCoverageEntry>();
  let entriesOutsideFile = 0;
  for (const sample of profiler.addresses) {
    if (sample.address < analysis.origin || sample.address >= end) { entriesOutsideFile += 1; continue; }
    const existing = entries.get(sample.address);
    if (existing) entries.set(sample.address, { address: sample.address, instructions: existing.instructions + sample.instructions, cycles: existing.cycles + sample.cycles });
    else entries.set(sample.address, { address: sample.address, instructions: sample.instructions, cycles: sample.cycles });
  }

  let executedRows = 0;
  let reachableNeverExecuted = 0;
  let executedOutsideStaticCode = 0;
  for (const row of analysis.rows) {
    /* A sample anywhere inside a row's bytes counts as that row having run;
     * for a data row that is exactly the interesting case. */
    let executed = false;
    for (let offset = 0; offset < row.bytes.length; offset += 1) {
      if (entries.has(row.address + offset)) { executed = true; break; }
    }
    if (executed) {
      executedRows += 1;
      if (row.kind !== 'instruction') executedOutsideStaticCode += 1;
    } else if (row.reachable) {
      reachableNeverExecuted += 1;
    }
  }

  const parts = [
    `${executedRows.toLocaleString()} row${executedRows === 1 ? '' : 's'} observed executing`,
    `${reachableNeverExecuted.toLocaleString()} reachable but never reached`,
  ];
  if (executedOutsideStaticCode) parts.push(`${executedOutsideStaticCode.toLocaleString()} executed that static analysis did not call code`);
  if (entriesOutsideFile) parts.push(`${entriesOutsideFile.toLocaleString()} sample${entriesOutsideFile === 1 ? '' : 's'} outside this file`);
  if (profiler.untrackedInstructions) parts.push(`${profiler.untrackedInstructions.toLocaleString()} instruction${profiler.untrackedInstructions === 1 ? '' : 's'} the profiler could not attribute`);

  return {
    status: 'bound',
    reason: `Coverage is bound to ${programManifest.name} by SHA-256 and load address, from ${profiler.source}.`,
    entries,
    executedRows,
    reachableNeverExecuted,
    executedOutsideStaticCode,
    entriesOutsideFile,
    summary: parts.join(' · '),
  };
}

/**
 * What a row should say about itself. Runtime silence is not evidence of
 * anything, so an unexecuted row says only that it was not observed.
 */
export function rowCoverageLabel(coverage: RuntimeCoverage, address: number, byteLength: number): string | null {
  if (coverage.status !== 'bound') return null;
  let instructions = 0;
  let cycles = 0;
  for (let offset = 0; offset < byteLength; offset += 1) {
    const entry = coverage.entries.get(address + offset);
    if (entry) { instructions += entry.instructions; cycles += entry.cycles; }
  }
  if (!instructions) return 'not observed executing';
  return `${instructions.toLocaleString()} × · ${cycles.toLocaleString()} cycles`;
}

function hex(value: number): string {
  return `&${value.toString(16).toUpperCase().padStart(4, '0')}`;
}
