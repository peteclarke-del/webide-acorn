/* Types for the accessibility rules, which are plain JavaScript so that the
 * release gate and the test suite run the same implementation. This declares
 * the shape rather than duplicating it; the module itself is the source. */

export interface AccessibilityCoverage {
  /** What a rule decides, each naming its WCAG success criterion. */
  readonly automated: readonly string[];
  /** What only a person can decide, stated so the scan claims no more. */
  readonly manual: readonly string[];
}

export interface AccessibilityFinding {
  rule: string;
  criterion: string;
  element: string;
  detail: string;
}

/** A finding from a rule that checks one condition rather than the whole page. */
export interface ConditionFinding {
  element: string;
  detail: string;
}

export const COVERAGE: AccessibilityCoverage;
export const MINIMUM_TARGET: number;
export const CONTRAST_NORMAL: number;
export const CONTRAST_LARGE: number;

/* Each of these is an expression evaluated inside the page, not a function. */
export const SCAN: string;
export const TEXT_SPACING: string;
export const FOCUS_VISIBILITY: string;
export const REDUCED_MOTION: string;
export const FORCED_COLOURS: string;
export const REDUCED_TRANSPARENCY: string;
export const KEYBOARD_REACHABILITY: string;
export const POINTER_ALTERNATIVES: string;
/** Content that does not fit and that nothing can be scrolled to reach. */
export const SCROLLABLE_OVERFLOW: string;
export const VISUAL_ALTERNATIVES: string;

export function summarise(findings: readonly AccessibilityFinding[]): string[];
