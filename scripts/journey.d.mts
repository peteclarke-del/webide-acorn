/** One machine's walk from an empty workbench to a distributable game. */
export interface Journey {
  machineId: string;
  label: string;
  /** The starter it should be offered, or null where no engine can run it. */
  template: string | null;
  /** False where the workbench is expected to refuse, for a stated reason. */
  runnable: boolean;
  /** The medium the machine should be able to leave on. */
  packages: 'cassette' | null;
}

export interface JourneyResult extends Journey {
  ok: boolean;
  /** What stopped it, or null where nothing did. */
  failure: string | null;
  /** What the workbench did at each step, in the workbench's own words. */
  steps?: Array<{ name: string; detail: string }>;
  /** Console errors, uncaught exceptions and blocked resources. */
  complaints?: string[];
}

export const JOURNEYS: readonly Journey[];

export function walkJourneys(
  dist: string,
  options?: { chromium: string; port?: number; journeys?: readonly Journey[] },
): Promise<JourneyResult[]>;
