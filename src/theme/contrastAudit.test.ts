import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditContrast, contrastRatio, describeFinding, parseColour, readThemes, CONTRAST_PAIRINGS, PALETTE_TARGETS, type PaletteName } from './contrastAudit';

/*
 * The theme's colours, measured.
 *
 * This is read out of `theme.css` rather than from a copy of the palette, so a
 * token cannot be changed without being measured again. It found two real
 * things on its first run and both are worth naming, because both are the same
 * mistake in different places: a block that looks right on its own.
 *
 * The dark theme's `--theme-line` measured between 1.39 and 1.98 against every
 * surface it borders. That is the line around five hundred controls, and it is
 * the boundary WCAG 1.4.11 asks to be 3:1 because it is what tells somebody
 * where a control is.
 *
 * The light theme measured worse and for a structural reason: it declares its
 * own surfaces and inherits every foreground from `:root`. So all six syntax
 * colours, chosen against a near-black editor, were being set on cream at
 * between 1.6 and 1.9 to one.
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8');
const palettes = readThemes(CSS);
const { dark, light } = palettes;

describe('reading the palette', () => {
  it('finds both themes', () => {
    expect(Object.keys(dark).length, 'the dark theme still declares its tokens').toBeGreaterThan(50);
    expect(dark['--theme-ink']).toBeTruthy();
    expect(light['--theme-ink']).toBeTruthy();
  });

  it('reads the light theme as an override of the dark one, which is how a browser reads it', () => {
    /* A token the light block does not mention keeps its `:root` value. If this
     * stopped being true the audit below would be measuring a theme that does
     * not exist. */
    expect(light['--theme-background']).not.toBe(dark['--theme-background']);
    expect(light['--control-h'], 'the light theme inherits what it does not override').toBe(dark['--control-h']);
    expect(dark['--control-h'], 'and that token is one the light block really does not mention').toBeTruthy();
  });

  it('measures a ratio the way WCAG defines it', () => {
    /* The two ends of the scale, which pin the arithmetic rather than the palette. */
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('flattens a translucent colour over its backdrop before comparing', () => {
    /* Half-opaque white on black is mid grey, not white, so it is not 21:1. */
    const flattened = contrastRatio('rgba(255, 255, 255, .5)', '#000000')!;
    expect(flattened).toBeGreaterThan(1);
    expect(flattened).toBeLessThan(21);
  });

  it('refuses to measure what is not a flat colour', () => {
    expect(parseColour('linear-gradient(#fff, #000)')).toBeNull();
    expect(parseColour('var(--theme-ink)')).toBeNull();
  });
});

describe('every colour a person has to read', () => {
  it('has pairings to check', () => {
    /* Without this the two assertions below can pass by measuring nothing. */
    expect(CONTRAST_PAIRINGS.length).toBeGreaterThan(60);
  });

  it.each(Object.keys(PALETTE_TARGETS) as PaletteName[])('reaches its contrast target across the %s palette', (name) => {
    expect(auditContrast(palettes[name], name).map(describeFinding)).toEqual([]);
  });

  it('holds the high-contrast palettes to a stricter figure than the standard ones', () => {
    /* Otherwise "high contrast" would be a setting that changed a few colours
     * and asked no more of them than before. */
    expect(PALETTE_TARGETS['dark high contrast'].text).toBeGreaterThan(PALETTE_TARGETS.dark.text);
    expect(PALETTE_TARGETS['light high contrast'].nonText).toBeGreaterThan(PALETTE_TARGETS.light.nonText);
  });

  it('actually changes something when high contrast is asked for', () => {
    /* A palette that overrode nothing would pass the audit above by being the
     * standard palette, which already passes. */
    const moved = Object.keys(dark).filter((token) => palettes['dark high contrast'][token] !== dark[token]);
    expect(moved.length, 'the dark high-contrast palette overrides nothing').toBeGreaterThan(4);
    const movedLight = Object.keys(light).filter((token) => palettes['light high contrast'][token] !== light[token]);
    expect(movedLight.length, 'the light high-contrast palette overrides nothing').toBeGreaterThan(4);
  });
});
