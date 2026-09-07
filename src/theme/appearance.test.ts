import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyAppearance, applyScaleToFrames, floorForScale, readAppearance, resolveContrast, resolveTheme, saveAppearance, syncFrameScale, watchSystemAppearance,
  DEFAULT_APPEARANCE, DEFAULT_FLOOR_PX, DEFAULT_SCALE, TEXT_SIZES, THEME_CHOICES, CONTRAST_CHOICES,
} from './appearance';

/*
 * The appearance choice, and the two things it is not allowed to get wrong.
 *
 * The first is that `system` must stay `system`. Resolving it once when the tab
 * opens looks identical on the day it is chosen and stops following the machine
 * the moment somebody switches their computer to dark in the evening, which is
 * the whole reason to pick it.
 *
 * The second is that the multiplier and the floor move together. The stylesheet
 * records what happens when they do not: at a 1.74 multiplier with a 14px
 * floor, every size below 8 collapsed onto the floor while inherited body text
 * went to 22.6, and captions rendered larger than the labels beside them.
 */
const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8');

function root(): HTMLElement {
  const element = document.createElement('html');
  return element;
}

describe('what the stylesheet expects of this module', () => {
  it('names the attribute the light theme is written against', () => {
    /* If the selector is renamed, setting `data-theme` stops doing anything and
     * every test below would still pass. */
    expect(THEME_CSS).toContain(":root[data-theme='light']");
  });

  it('ships the pair this module treats as the default', () => {
    expect(THEME_CSS).toContain(`--ui-scale: ${DEFAULT_SCALE};`);
    expect(THEME_CSS).toContain(`--fs-floor: ${DEFAULT_FLOOR_PX}px;`);
  });
});

/** A machine whose settings say exactly these things. */
const machine = (matching: string[]) => (feature: string) => ({ matches: matching.includes(feature) });

describe('applying a choice', () => {
  it('resolves system against the machine rather than freezing it', () => {
    const asked = { ...DEFAULT_APPEARANCE, theme: 'system' as const };
    expect(resolveTheme(asked, machine(['(prefers-color-scheme: light)']))).toBe('light');
    expect(resolveTheme(asked, machine([]))).toBe('dark');
  });

  it('resolves the system contrast setting the same way', () => {
    const asked = { ...DEFAULT_APPEARANCE, contrast: 'system' as const };
    expect(resolveContrast(asked, machine(['(prefers-contrast: more)']))).toBe('more');
    expect(resolveContrast(asked, machine([]))).toBe('standard');
  });

  it('lets an explicit choice override the machine', () => {
    const light = machine(['(prefers-color-scheme: light)', '(prefers-contrast: more)']);
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, theme: 'dark' }, light)).toBe('dark');
    expect(resolveContrast({ ...DEFAULT_APPEARANCE, contrast: 'standard' }, light)).toBe('standard');
  });

  it('always leaves the document saying which palette it is showing', () => {
    /* Both attributes are set even for `system`, because the stylesheet holds
     * each palette once under an attribute selector and has no
     * `prefers-color-scheme` block to fall back on. */
    const element = root();
    applyAppearance(element, { ...DEFAULT_APPEARANCE, theme: 'system' }, machine(['(prefers-color-scheme: light)']));
    expect(element.getAttribute('data-theme')).toBe('light');
    expect(element.getAttribute('data-contrast')).toBe('standard');
    applyAppearance(element, { theme: 'dark', contrast: 'more', scale: DEFAULT_SCALE }, machine([]));
    expect(element.getAttribute('data-theme')).toBe('dark');
    expect(element.getAttribute('data-contrast')).toBe('more');
  });

  it('leaves a workbench that has always been dark looking the way it did', () => {
    /*
     * The default is the one place where the conventional answer is the wrong
     * one. Defaulting the theme to the machine would mean anybody whose
     * computer is set to light opening a completely different-looking
     * application one morning without having asked, so light is offered rather
     * than imposed. Contrast does follow the machine, because asking an
     * operating system for more contrast is already a deliberate act.
     */
    expect(DEFAULT_APPEARANCE.theme).toBe('dark');
    expect(DEFAULT_APPEARANCE.contrast).toBe('system');
    const element = root();
    applyAppearance(element, DEFAULT_APPEARANCE, machine(['(prefers-color-scheme: light)']));
    expect(element.getAttribute('data-theme'), 'a light machine must not change an unasked-for workbench').toBe('dark');
    applyAppearance(element, DEFAULT_APPEARANCE, machine(['(prefers-contrast: more)']));
    expect(element.getAttribute('data-contrast'), 'but a request for more contrast is honoured').toBe('more');
  });

  it('survives a browser that cannot answer a media query', () => {
    const element = root();
    expect(() => applyAppearance(element, DEFAULT_APPEARANCE, () => { throw new Error('unknown feature'); })).not.toThrow();
    expect(element.getAttribute('data-theme')).toBe('dark');
    expect(() => applyAppearance(element, DEFAULT_APPEARANCE, null)).not.toThrow();
  });

  it('moves the floor with the multiplier', () => {
    const element = root();
    applyAppearance(element, { ...DEFAULT_APPEARANCE, scale: 2 }, null);
    expect(element.style.getPropertyValue('--ui-scale')).toBe('2');
    expect(element.style.getPropertyValue('--fs-floor')).toBe(`${floorForScale(2)}px`);
  });

  it('stops listening when it is told to', () => {
    const listeners = new Map<string, Set<() => void>>();
    const matchMedia = ((feature: string) => ({
      matches: false,
      addEventListener: (_: string, listener: () => void) => {
        listeners.set(feature, (listeners.get(feature) ?? new Set()).add(listener));
      },
      removeEventListener: (_: string, listener: () => void) => { listeners.get(feature)?.delete(listener); },
    })) as unknown as (query: string) => MediaQueryList;
    let changes = 0;
    const stop = watchSystemAppearance(matchMedia, () => { changes += 1; });
    expect([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 'both features are watched').toBe(2);
    for (const set of listeners.values()) for (const listener of set) listener();
    expect(changes).toBe(2);
    stop();
    expect([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 'and released again').toBe(0);
  });

  it('keeps the shipped pair exactly, so the default changes nothing', () => {
    expect(floorForScale(DEFAULT_SCALE)).toBe(DEFAULT_FLOOR_PX);
  });

  it('keeps the floor under the base size at every offered scale', () => {
    /* The base body size is 13px on the scale. A floor at or above it would
     * flatten the bottom of the range onto the body text, which is the two-scale
     * failure the stylesheet describes. */
    for (const size of TEXT_SIZES) {
      expect(floorForScale(size.scale), `${size.label} floor`).toBeLessThan(13 * size.scale);
    }
  });
});

describe('the framed runtimes, which cannot see the stylesheet', () => {
  /*
   * The Electron and Archimedes pages are loaded in an iframe and each carries
   * its own copy of the type scale, because it has no access to `theme.css`.
   * That copy is a constant, so the text-size setting worked everywhere in the
   * product except on the machine's own status line and output pane.
   */
  function pageWithFrame(scale: string, floor: string) {
    document.body.innerHTML = '<iframe></iframe>';
    document.documentElement.style.setProperty('--ui-scale', scale);
    document.documentElement.style.setProperty('--fs-floor', floor);
    return document.querySelector('iframe')!;
  }

  it('gives a frame the size that is actually in force', () => {
    const frame = pageWithFrame('2', '23.1px');
    expect(applyScaleToFrames(document)).toBe(1);
    const inner = frame.contentDocument!.documentElement;
    expect(inner.style.getPropertyValue('--ui-scale')).toBe('2');
    expect(inner.style.getPropertyValue('--fs-floor')).toBe('23.1px');
  });

  it('reads the size from the page rather than being told it', () => {
    /* One path, so a frame arriving later cannot be given a different answer
     * from the one the workbench is showing. */
    const frame = pageWithFrame('1.15', '13.3px');
    expect(syncFrameScale(frame, document.documentElement)).toBe(true);
    expect(frame.contentDocument!.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.15');
  });

  it('says no rather than throwing when a frame cannot be reached', () => {
    const unreachable = { get contentDocument(): Document | null { throw new Error('cross-origin'); } } as unknown as HTMLIFrameElement;
    expect(syncFrameScale(unreachable, document.documentElement)).toBe(false);
  });

  it('does not remount anything, because that would restart the machine', () => {
    /* The size is copied into the frame's document. If it were carried in the
     * frame's URL instead, changing the text size would reload the iframe and
     * reboot the emulator inside it. */
    const frame = pageWithFrame('1.5', '17.3px');
    const before = frame.getAttribute('src');
    applyScaleToFrames(document);
    expect(frame.getAttribute('src')).toBe(before);
  });
});

describe('remembering it', () => {
  function storage() {
    const held = new Map<string, string>();
    return {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => { held.set(key, value); },
      held,
    };
  }

  it('reads back what was written', () => {
    const store = storage();
    saveAppearance(store, { theme: 'light', contrast: 'more', scale: 1.75 });
    expect(readAppearance(store)).toEqual({ theme: 'light', contrast: 'more', scale: 1.75 });
  });

  it('falls back to the default where nothing was stored', () => {
    expect(readAppearance(storage())).toEqual(DEFAULT_APPEARANCE);
  });

  it('discards a size this build no longer offers rather than applying it', () => {
    const store = storage();
    store.setItem('8bit-net-dev:appearance', JSON.stringify({ theme: 'light', contrast: 'more', scale: 9 }));
    /* The theme it still understands is kept; the size it does not is not. */
    expect(readAppearance(store)).toEqual({ theme: 'light', contrast: 'more', scale: DEFAULT_SCALE });
  });

  it('survives a corrupt value and a browser that refuses storage', () => {
    const store = storage();
    store.setItem('8bit-net-dev:appearance', 'not json');
    expect(readAppearance(store)).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(() => saveAppearance(null, DEFAULT_APPEARANCE)).not.toThrow();
  });

  it('offers every theme the stylesheet can actually produce', () => {
    expect(THEME_CHOICES.map((choice) => choice.id)).toEqual(['system', 'dark', 'light']);
    expect(CONTRAST_CHOICES.map((choice) => choice.id)).toEqual(['system', 'standard', 'more']);
  });
});
