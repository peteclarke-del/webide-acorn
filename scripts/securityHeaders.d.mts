/* Types for the response-header audit, which is plain JavaScript so the release
 * gate and the tests read the same shipped configuration. */

export interface PolicyDifference {
  directive: string;
  /** Why the two policies are allowed to differ here. */
  reason: string;
}

export const REQUIRED_DIRECTIVES: Record<string, string[]>;
export const ALLOWED_DIFFERENCES: PolicyDifference[];
export const REQUIRED_HEADERS: Record<string, string>;

export function parseHeaders(text: string): Record<string, string>;
export function parsePolicy(policy: string): Record<string, string[]>;
export function auditSnippet(name: string, text: string): string[];
export function unexplainedDifferences(documentPolicy: string, embeddedPolicy: string): string[];
export function headerPairs(text: string): Array<[string, string]>;
