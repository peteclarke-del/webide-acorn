/* Types for the repository hygiene scanner, which is plain JavaScript so the
 * release gate and the tests run one implementation. */

export type HygieneRule =
  | 'firmware' | 'capture' | 'private' | 'allowlist'
  | 'private-key' | 'aws-access-key' | 'github-token' | 'slack-token'
  | 'google-api-key' | 'jwt' | 'basic-auth-url' | 'assigned-secret';

export interface HygieneFinding {
  path: string;
  rule: HygieneRule | string;
  /** Zero for a rule decided by the path alone. */
  line: number;
  /** What was found, by shape. Never the value itself. */
  detail: string;
}

export interface AllowlistEntry {
  path: string;
  rules: string[];
  /** Why this file may match those rules. An entry without one is a finding. */
  reason: string;
}

export interface SecretPattern {
  id: string;
  label: string;
  pattern: RegExp;
}

export const FIRMWARE_EXTENSIONS: RegExp;
export const CAPTURE_EXTENSIONS: RegExp;
export const PRIVATE_PATHS: RegExp[];
export const SECRET_PATTERNS: SecretPattern[];
export const ALLOWLIST: AllowlistEntry[];

export function forbiddenPath(path: string): { rule: string; detail: string } | null;
export function scanText(path: string, text: string): HygieneFinding[];
export function scanRepository(
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<{ findings: HygieneFinding[]; scanned: number }>;
export function unexplainedAllowlistEntries(allowlist?: readonly AllowlistEntry[]): HygieneFinding[];
export function summarise(findings: readonly HygieneFinding[]): string[];
