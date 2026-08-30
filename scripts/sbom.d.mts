/* Types for the bill-of-materials generator, which is plain JavaScript so the
 * release gate and the tests read one implementation. */

export type LicenceClass = 'permissive' | 'copyleft' | 'undetermined' | 'other';

export interface SbomEntry {
  name: string;
  version: string;
  licence: string | null;
  licenceClass: LicenceClass;
  /** True when the package is in what the product distributes. */
  shipped: boolean;
  /** True when the lockfile marks it development-only. */
  development: boolean;
  /** Why it is installed but not distributed, or null when it is. */
  excludedBecause: string | null;
  optional: boolean;
  resolved: string | null;
  integrity: string | null;
}

export interface SbomSummary {
  total: number;
  shipped: number;
  development: number;
  installedNotDistributed: number;
  shippedPermissive: number;
  shippedCopyleft: number;
  shippedUndetermined: number;
  shippedOther: number;
  withoutIntegrity: number;
}

export function classifyLicence(expression: unknown): LicenceClass;
export function readLockfile(
  lockfile: { packages?: Record<string, Record<string, unknown>> },
  /** Package names found in the built output. Empty treats all as distributed. */
  built?: ReadonlySet<string>,
): SbomEntry[];
export function sbomSummary(entries: readonly SbomEntry[]): SbomSummary;
export function licencesNeedingReview(entries: readonly SbomEntry[]): SbomEntry[];
export function renderSbom(entries: readonly SbomEntry[], audit?: Record<string, number> | null): string;
