/* Types for the cross-browser matrix, which is plain JavaScript so that the
 * release gate and the test suite run the same rules. */

/** What a browser answered when the workbench was loaded in it. */
export interface BrowserPageAnswer {
  title: string;
  controls: number;
  landmarks: number;
  /** Children of the application root; zero means the workbench never mounted. */
  rootChildren: number;
  errors: string[];
  rejections: string[];
  violations: string[];
  capability: Record<string, boolean>;
}

export interface BrowserResult {
  browser: string;
  version: string;
  page: BrowserPageAnswer | null;
}

/** Evaluated in the page; returns JSON, because two protocols return values differently. */
export const PAGE_PROBE: string;
/** Served as a file and loaded before the application, so its own failures are visible. */
export const COLLECTOR_SOURCE: string;

export const MINIMUM_CONTROLS: number;
export const MINIMUM_LANDMARKS: number;

/** Capabilities recorded rather than required, against what each is for. */
export const OPTIONAL_CAPABILITIES: Readonly<Record<string, string>>;

/** Everything wrong across every browser, as sentences rather than exceptions. */
export function matrixFindings(results: readonly BrowserResult[]): string[];

/** One line per browser, naming what each does not have. */
export function matrixSummary(results: readonly BrowserResult[]): string[];
