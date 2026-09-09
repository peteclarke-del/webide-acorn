/*
 * Types for `writingStyle.mjs`, the way `userGuides.d.mts` types its module.
 * Without this the test that imports it is implicitly `any`, and `npm run
 * typecheck` reports the file the gate is meant to protect.
 */
export interface PunctuationEntry { character: string; name: string; instead: string }
export interface AllowlistEntry { path: string; reason: string }
export interface Finding { path: string; line: number; column: number; name: string; instead: string; escaped: boolean }

export const MACHINE_PUNCTUATION: PunctuationEntry[];
export const ALLOWLIST: AllowlistEntry[];
export function scannable(path: string): boolean;
export function scanText(path: string, text: string): Finding[];
export function scanRepository(paths: string[], read: (path: string) => Promise<string | null>): Promise<{ findings: Finding[]; scanned: number }>;
export function summarise(findings: Finding[]): string[];
export function unexplainedAllowlistEntries(allowlist?: AllowlistEntry[]): AllowlistEntry[];
