/* How far through a file a parser is, in bytes it has actually settled.
 *
 * Reported rather than estimated. A percentage a parser invented is worse than
 * no percentage at all: it moves when nothing is happening, it stops when
 * something is, and the one question a person watching it wants answered — is
 * this going to finish — becomes unanswerable. Every figure here is a count of
 * bytes the parser has decided about, against the number it was given.
 *
 * The stages are named because they are not interchangeable. A file can spend
 * most of its time in the reachability walk and almost none in the listing, or
 * the other way round, and a bar that hid which one it was in would say the
 * same thing about two very different situations.
 */

export type AnalysisStage = 'decoding' | 'listing' | 'labelling';

export const ANALYSIS_STAGE_LABELS: Readonly<Record<AnalysisStage, string>> = Object.freeze({
  decoding: 'Following reachable code',
  listing: 'Building the listing',
  labelling: 'Naming targets',
});

export interface AnalysisProgress {
  stage: AnalysisStage;
  /** Bytes this stage has settled. */
  bytesDone: number;
  /** Bytes it was given. Never zero, so a caller need not guard a division. */
  bytesTotal: number;
}

export type AnalysisProgressReporter = (progress: AnalysisProgress) => void;

/**
 * How often a parser is allowed to report.
 *
 * A report from inside a decode loop costs a message across a worker boundary,
 * and one per instruction would cost more than the decoding. Every four
 * kilobytes is often enough that a person sees movement on a file large enough
 * to wait for, and rare enough to disappear into the work.
 */
export const PROGRESS_INTERVAL_BYTES = 4096;

/**
 * A reporter that only passes a report on when it is worth passing on.
 *
 * The last report of a stage is always sent, whatever the interval, because a
 * stage that stopped at eighty per cent reads as a stage that stalled.
 */
export function throttleProgress(report: AnalysisProgressReporter | undefined, intervalBytes = PROGRESS_INTERVAL_BYTES): AnalysisProgressReporter {
  if (!report) return () => undefined;
  let lastStage: AnalysisStage | null = null;
  let lastBytes = -intervalBytes;
  return (progress) => {
    const finished = progress.bytesDone >= progress.bytesTotal;
    if (progress.stage === lastStage && !finished && progress.bytesDone - lastBytes < intervalBytes) return;
    lastStage = progress.stage;
    lastBytes = progress.bytesDone;
    report(progress);
  };
}

/** The words a person reads, from figures the parser measured. */
export function describeProgress(progress: AnalysisProgress): string {
  const share = progress.bytesTotal > 0 ? Math.round((progress.bytesDone / progress.bytesTotal) * 100) : 0;
  return `${ANALYSIS_STAGE_LABELS[progress.stage]} · ${progress.bytesDone.toLocaleString()} of ${progress.bytesTotal.toLocaleString()} bytes (${share}%)`;
}
