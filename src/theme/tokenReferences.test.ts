import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * Every custom property the stylesheets read, and where its value comes from.
 *
 * A custom property that is never given a value does not fall back to something
 * sensible. The declaration using it becomes invalid at computed-value time, so
 * the property is `unset`: an undefined colour makes text inherit whatever its
 * parent happens to be, an undefined `background` paints nothing, and an
 * undefined `border: 1px solid var(--x)` removes the border altogether, because
 * `border-style` reverts to its initial `none`.
 *
 * Nothing said so, and nineteen references had accumulated across ten names,
 * `--theme-on-primary` on four buttons whose label therefore inherited its
 * colour from the panel instead of contrasting with the green behind it,
 * `--theme-green` on the one thing that showed a sprite-animation button was
 * pressed, `--theme-line-soft` on the dividers of two tables that consequently
 * had none, `--theme-active` on a focus-visible background that never appeared,
 * and three dialogs and a popover asking for shadows by names nobody defined.
 * Each looked deliberate in the source and did nothing in the browser.
 *
 * A property may legitimately be set from JavaScript rather than in CSS, panel
 * geometry and the editor's own type size are, so those are listed by name
 * here. A name in that list is a promise that something sets it; the test holds
 * the promise by finding the code that does.
 */
const CSS_FILES = ['src/theme.css', 'src/styles.css'];
const THEME_FILE = 'src/theme.css';
const SOURCES = ['src/App.tsx', 'src/components/ProjectTree.tsx', 'src/components/SourceWorkspace.tsx'];

/** Properties set at runtime rather than declared in a stylesheet. */
const SET_FROM_SCRIPT = [
  '--machine-accent', '--tree-depth', '--graph-depth', '--workbench-columns', '--workspace-rows',
  '--editor-font-size', '--editor-line-height', '--editor-tab-size',
] as const;

const css = CSS_FILES.map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');
const scripts = SOURCES.map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');
const themeCss = readFileSync(resolve(process.cwd(), THEME_FILE), 'utf8');

/*
 * A token nobody reads, and the one that is allowed to be one.
 *
 * `--theme-overlay` was defined in every palette and read nowhere. The four
 * modal backdrops each mixed their own colour instead (one of them a
 * hard-coded `rgba(0, 5, 2, .68)`), so the product had three different
 * treatments for the same thing, none of them following the theme, and the
 * token that exists to settle it did nothing. A defined-but-unread token is how
 * that happens: it looks like the answer while not being the answer anywhere.
 *
 * `--radius-lg` is excused because it completes a four-step radius scale whose
 * other three steps are used. A scale with a hole in it is worse than a scale
 * with a step nothing has needed yet.
 */
const UNREAD_BY_DESIGN = ['--radius-lg'] as const;

/** Names given a value anywhere in the stylesheets. */
function declared(): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!));
}

/** Every reference, and whether it supplied its own fallback. */
function referenced(): Array<{ name: string; hasFallback: boolean }> {
  return [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)].map((match) => ({ name: match[1]!, hasFallback: Boolean(match[2]) }));
}

describe('the custom properties the stylesheets read', () => {
  it('has references to check', () => {
    expect(referenced().length).toBeGreaterThan(500);
  });

  it('gives every one of them a value, from CSS or from script', () => {
    const known = declared();
    const runtime = new Set<string>(SET_FROM_SCRIPT);
    const dangling = [...new Set(referenced()
      .filter((use) => !use.hasFallback && !known.has(use.name) && !runtime.has(use.name))
      .map((use) => use.name))];
    expect(dangling, 'a property with no value silently removes the declaration that reads it').toEqual([]);
  });

  it('reads every token the theme defines, so none can quietly become the wrong answer', () => {
    const defined = [...new Set([...themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!))];
    const read = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]!));
    for (const match of scripts.matchAll(/(--[a-z0-9-]+)/g)) read.add(match[1]!);
    const excused = new Set<string>(UNREAD_BY_DESIGN);
    expect(defined.length, 'the theme still defines tokens').toBeGreaterThan(50);
    expect(defined.filter((token) => !read.has(token) && !excused.has(token))).toEqual([]);
  });

  it('still defines every token it excuses as unread', () => {
    /* Otherwise the exclusion outlives the token and hides the next one. */
    for (const token of UNREAD_BY_DESIGN) expect(themeCss).toContain(`${token}:`);
  });

  it('finds the code that sets each property this test excuses', () => {
    /* Otherwise the exclusion list becomes a way of hiding the same defect. */
    const unset = SET_FROM_SCRIPT.filter((name) => !scripts.includes(name));
    expect(unset, 'excused as set from script, but nothing sets it').toEqual([]);
  });
});
