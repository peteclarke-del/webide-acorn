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

/** One runtime page: a separate document with its own core and its own policy. */
export interface RuntimePage {
  readonly path: string;
  readonly label: string;
  /** Identifier of the status region the page's own script writes into. */
  readonly status: string;
  /** The channel the page announces itself on, which is what the workbench listens to. */
  readonly channel: string;
}

export const RUNTIME_PAGES: readonly RuntimePage[];

/** The harness document that frames a runtime page, so it has a parent to announce to. */
export const RUNTIME_HOST_HTML: string;
/** Its script, served as a file because the shipped policy forbids inline script. */
export const RUNTIME_HOST_SOURCE: string;

/** What a runtime page answered when it was framed and loaded. */
export interface RuntimePageAnswer {
  /** Whether the harness could reach into the frame at all. */
  framed: boolean;
  statusPresent: boolean;
  statusText: string;
  canvases: number;
  /** Message types the page posted on its own channel. */
  announced: string[];
  errors: string[];
  rejections: string[];
  violations: string[];
}

/** Evaluated in the harness once the framed runtime has had time to start. */
export function runtimeProbe(statusId: string, channel: string): string;

/** One runtime document as it was measured. */
export interface RuntimeResult {
  label: string;
  /** False only for a page that has no announcement to make. */
  expectsAnnouncement?: boolean;
  page: RuntimePageAnswer | null;
}

/** Everything wrong with the runtime pages in one browser. */
export function runtimeFindings(browser: string, pages: readonly RuntimeResult[]): string[];

/** What each runtime document announced, and in which browser. */
export function runtimeSummary(
  results: readonly { browser: string; runtimes?: readonly RuntimeResult[] }[],
): string;
