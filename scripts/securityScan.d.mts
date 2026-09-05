/* Types for the dependency scan, which is plain JavaScript so the gate and the
 * tests read the same logic. */

export const FAILING_SEVERITIES: readonly string[];
export const REPORTED_SEVERITIES: readonly string[];

export interface UnscannedArea {
  id: string;
  label: string;
  reason: string;
}
export const UNSCANNED: readonly UnscannedArea[];

export interface NpmAuditResult { counts: Record<string, number>; total: number }
export interface ComposerAuditResult { advisories: number; abandoned: string[] }

export function readNpmAudit(raw: string): NpmAuditResult;
export function readComposerAudit(raw: string): ComposerAuditResult;
export function scanFindings(npm: NpmAuditResult, composer: ComposerAuditResult): string[];
export function scanSummary(npm: NpmAuditResult, composer: ComposerAuditResult): string;
