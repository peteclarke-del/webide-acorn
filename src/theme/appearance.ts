/*
 * The two appearance choices a person can make, and why they are these two.
 *
 * Both already existed in the stylesheet and neither could be reached. The
 * light theme was a complete `:root[data-theme='light']` block that nothing
 * ever set `data-theme` for, so it had never been rendered, which is how it
 * came to inherit every foreground colour from the dark theme and set emphasis
 * text at 1.01:1 on its own paper. And `--ui-scale` carries a comment saying it
 * is "what a person can raise when they want the whole workbench larger", with
 * no control anywhere to raise it.
 *
 * Text size is a multiplier over the whole scale rather than a font size,
 * because every size in the workbench derives from it, and that is the only way
 * to make the interface larger without producing two scales side by side.
 *
 * The floor moves with it. `--fs-floor` is the size nothing is allowed below,
 * and the stylesheet records what happens when the two drift apart: at a 1.74
 * multiplier against a 14px floor, everything from 4.5 to 8 collapsed onto the
 * floor while inherited body text went to 22.6, and captions ended up larger
 * than the labels beside them. So the floor is held at the ratio the shipped
 * pair already has rather than being left fixed while the multiplier moves.
 */

export type ThemeChoice = 'system' | 'dark' | 'light';
export type ContrastChoice = 'system' | 'standard' | 'more';

/** What the stylesheet is actually given, once `system` has been resolved. */
export type ResolvedTheme = 'dark' | 'light';
export type ResolvedContrast = 'standard' | 'more';

export interface Appearance {
  theme: ThemeChoice;
  contrast: ContrastChoice;
  /** Multiplier over the whole type scale. */
  scale: number;
}

/** The shipped pair, and the ratio between them that any other scale keeps. */
export const DEFAULT_SCALE = 1.3;
export const DEFAULT_FLOOR_PX = 15;
const FLOOR_RATIO = DEFAULT_FLOOR_PX / DEFAULT_SCALE;

/*
 * What somebody gets who has never chosen.
 *
 * The theme defaults to dark rather than to the machine's setting, which is the
 * opposite of what a new product would do and is right for this one: the
 * workbench has only ever been dark, and defaulting to `system` would mean
 * anybody whose computer is set to light opening a completely different-looking
 * application one morning without having asked for it. Light is offered, not
 * imposed.
 *
 * Contrast does default to the machine, because asking an operating system for
 * more contrast is already a deliberate act by somebody who needs it, and
 * honouring it changes colours rather than the character of the interface.
 */
export const DEFAULT_APPEARANCE: Appearance = Object.freeze({ theme: 'dark', contrast: 'system', scale: DEFAULT_SCALE });

export const THEME_CHOICES: ReadonlyArray<{ id: ThemeChoice; label: string; description: string }> = Object.freeze([
  { id: 'system', label: 'Match the system', description: 'Follow whatever this computer is set to.' },
  { id: 'dark', label: 'Dark', description: 'Cream text on a dark ground.' },
  { id: 'light', label: 'Light', description: 'Dark text on paper.' },
]);

export const CONTRAST_CHOICES: ReadonlyArray<{ id: ContrastChoice; label: string; description: string }> = Object.freeze([
  { id: 'system', label: 'Match the system', description: "Follow this computer's contrast setting." },
  { id: 'standard', label: 'Standard', description: 'Text at 4.5:1 and control borders at 3:1.' },
  { id: 'more', label: 'High contrast', description: 'Text at 7:1 and control borders at 4.5:1.' },
]);

/**
 * The sizes offered, named rather than numbered.
 *
 * A multiplier means nothing to read, so each step says what it does. The range
 * stops at double because beyond that the fixed panel geometry (rails, strips
 * and the status bar) starts to crowd the work rather than the text getting
 * usefully larger, and offering a size that makes the product worse would be
 * offering a choice nobody should take.
 */
export const TEXT_SIZES: ReadonlyArray<{ scale: number; label: string }> = Object.freeze([
  { scale: 1.0, label: 'Small' },
  { scale: 1.15, label: 'Medium' },
  { scale: 1.3, label: 'Default' },
  { scale: 1.5, label: 'Large' },
  { scale: 1.75, label: 'Larger' },
  { scale: 2.0, label: 'Largest' },
]);

const STORAGE_KEY = '8bit-net-dev:appearance';

const isTheme = (value: unknown): value is ThemeChoice => THEME_CHOICES.some((choice) => choice.id === value);
const isContrast = (value: unknown): value is ContrastChoice => CONTRAST_CHOICES.some((choice) => choice.id === value);
const isScale = (value: unknown): value is number => typeof value === 'number' && TEXT_SIZES.some((size) => size.scale === value);

/**
 * What was chosen last time, or the default.
 *
 * A stored value that is not one of the offered ones is discarded rather than
 * clamped: it means the shape changed, and honouring half of it would apply a
 * size this build does not offer.
 */
export function readAppearance(storage: Pick<Storage, 'getItem'> | null | undefined): Appearance {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_APPEARANCE;
    const { theme, contrast, scale } = parsed as Record<string, unknown>;
    return {
      theme: isTheme(theme) ? theme : DEFAULT_APPEARANCE.theme,
      contrast: isContrast(contrast) ? contrast : DEFAULT_APPEARANCE.contrast,
      scale: isScale(scale) ? scale : DEFAULT_APPEARANCE.scale,
    };
  } catch {
    /* A browser that refuses storage, or a corrupt value, is not a reason to
     * fail to start; it is a reason to look the way the product ships. */
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(storage: Pick<Storage, 'setItem'> | null | undefined, appearance: Appearance): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* Saving is a convenience. Losing it must not lose the change already made
     * to the running interface. */
  }
}

/** A media query, or null where the browser has none, a test environment, or
 * an older engine that does not know the feature being asked about. */
export type MediaQuery = (query: string) => { matches: boolean } | null;

const query = (matchMedia: MediaQuery | null | undefined, feature: string): boolean => {
  try {
    return matchMedia?.(feature)?.matches ?? false;
  } catch {
    /* Asking about an unknown media feature must not stop the interface being
     * drawn; not matching is the same answer as the feature being off. */
    return false;
  }
};

/*
 * Resolving `system` here rather than in the stylesheet.
 *
 * The obvious way is a `prefers-color-scheme` block in CSS, and the reason this
 * does not is that the stylesheet holds each palette exactly once, under
 * `:root` and `:root[data-theme='light']`. A media query cannot be added to a
 * selector list, so following the operating system in CSS would mean a second
 * copy of the light palette that nothing keeps in step with the first, and a
 * palette that drifts out of step is how the light theme came to have no
 * foreground colours of its own in the first place.
 *
 * Resolving it here keeps one copy and still follows the machine, because
 * `watchSystemAppearance` re-applies when the setting changes rather than
 * reading it once at startup.
 */
export function resolveTheme(appearance: Appearance, matchMedia?: MediaQuery | null): ResolvedTheme {
  if (appearance.theme !== 'system') return appearance.theme;
  return query(matchMedia, '(prefers-color-scheme: light)') ? 'light' : 'dark';
}

export function resolveContrast(appearance: Appearance, matchMedia?: MediaQuery | null): ResolvedContrast {
  if (appearance.contrast !== 'system') return appearance.contrast;
  return query(matchMedia, '(prefers-contrast: more)') ? 'more' : 'standard';
}

/** Put the resolved choice on the document. */
export function applyAppearance(root: HTMLElement, appearance: Appearance, matchMedia?: MediaQuery | null): void {
  root.setAttribute('data-theme', resolveTheme(appearance, matchMedia));
  root.setAttribute('data-contrast', resolveContrast(appearance, matchMedia));
  root.style.setProperty('--ui-scale', String(appearance.scale));
  root.style.setProperty('--fs-floor', `${floorForScale(appearance.scale)}px`);
}

/** The media features whose changes should re-apply the appearance. */
export const WATCHED_FEATURES = Object.freeze(['(prefers-color-scheme: light)', '(prefers-contrast: more)']);

/**
 * Follow the machine while the tab is open.
 *
 * Without this, `system` would mean "whatever this computer was set to when the
 * page loaded", which looks identical on the day it is chosen and stops
 * following the moment somebody switches to dark in the evening.
 */
export function watchSystemAppearance(
  matchMedia: ((query: string) => MediaQueryList) | null | undefined,
  onChange: () => void,
): () => void {
  if (!matchMedia) return () => {};
  const stops: Array<() => void> = [];
  for (const feature of WATCHED_FEATURES) {
    try {
      const list = matchMedia(feature);
      const listener = () => onChange();
      list.addEventListener('change', listener);
      stops.push(() => list.removeEventListener('change', listener));
    } catch {
      /* A feature this engine does not know simply never changes. */
    }
  }
  return () => { for (const stop of stops) stop(); };
}

/*
 * And into the framed runtimes, which cannot see the workbench's stylesheet.
 *
 * The Electron and Archimedes pages are loaded in an iframe on this same
 * origin, and each carries its own copy of the two numbers because it has no
 * access to `theme.css`. That copy is a constant, so raising the workbench's
 * text size left the machine's own status line and output pane at the shipped
 * size. The one place in the product where the setting stopped working.
 *
 * The values are copied in rather than passed through the frame's URL, because
 * changing the URL remounts the iframe and remounting the iframe restarts the
 * emulator. Nobody expects a machine to reboot because they made the text
 * bigger.
 *
 * They are read from the workbench's own root rather than from an `Appearance`,
 * so that a frame arriving later, somebody opens the emulator after choosing a
 * size, is given the size that is actually in force, with one path rather than
 * two that can disagree.
 *
 * A frame that is not same-origin, or has not navigated yet, throws on access
 * and is skipped. The workbench's own text is already correct, and a frame that
 * cannot be reached is not a reason to fail applying the choice.
 */
export function syncFrameScale(frame: HTMLIFrameElement, from: HTMLElement): boolean {
  try {
    const inner = frame.contentDocument?.documentElement;
    if (!inner) return false;
    const showing = from.ownerDocument.defaultView?.getComputedStyle(from);
    const scale = showing?.getPropertyValue('--ui-scale').trim();
    const floor = showing?.getPropertyValue('--fs-floor').trim();
    if (!scale || !floor) return false;
    inner.style.setProperty('--ui-scale', scale);
    inner.style.setProperty('--fs-floor', floor);
    return true;
  } catch {
    return false;
  }
}

/** Every frame currently in the page, given the size in force. */
export function applyScaleToFrames(root: Document): number {
  let reached = 0;
  for (const frame of Array.from(root.querySelectorAll('iframe'))) {
    if (syncFrameScale(frame, root.documentElement)) reached += 1;
  }
  return reached;
}

/** The floor that goes with a scale, exposed so the pairing can be checked. */
export function floorForScale(scale: number): number {
  return Math.round(FLOOR_RATIO * scale * 10) / 10;
}
