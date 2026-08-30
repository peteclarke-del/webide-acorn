/* Types for the traceability reader, which is plain JavaScript so the release
 * gate and the tests use one implementation. */

export interface Requirement {
  id: string;
  complete: boolean;
  title: string;
  section: string;
  /** Text recorded under an Evidence heading, where it can be found. */
  evidence: string[];
  /** Other sub-item text, which may still name a verification. */
  prose: string[];
  subItems: number;
  subItemsComplete: number;
}

export interface TraceabilitySummary {
  total: number;
  complete: number;
  open: number;
  traced: number;
  described: number;
  untraced: number;
}

export type TraceState = 'traced' | 'described' | 'untraced' | 'open';

export function parseBacklog(markdown: string): Requirement[];
export function traceState(requirement: Pick<Requirement, 'complete' | 'evidence' | 'prose' | 'title'>): TraceState;
export function traceabilitySummary(requirements: readonly Requirement[]): TraceabilitySummary;
export function untracedRequirements(requirements: readonly Requirement[]): Requirement[];
export function renderTraceability(requirements: readonly Requirement[]): string;
