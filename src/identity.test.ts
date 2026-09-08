import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The identity, held to the two things about it that can be checked.
 *
 * Most of UX-004 is judgement. Whether a shape is too close to somebody's mark
 * is not a thing a test decides, and `docs/identity.md` says so and leaves it
 * with the licence review. Two parts are not judgement.
 *
 * The first is that the mark is drawn rather than imported. An identity built
 * from primitives has nothing to trace back to a source; one that grows an
 * `<image>` or a base64 payload has acquired something from somewhere, and that
 * is the moment worth noticing rather than the moment it ships.
 *
 * The second is the words. The product may name the machines it targets, no
 * other words would say which machine somebody selected, and it may not claim
 * a relationship with the people who made them.
 */
const FAVICON = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8');
const APP = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const ICONS = readFileSync(resolve(process.cwd(), 'src/components/Icon.tsx'), 'utf8');

describe('the mark', () => {
  it('is drawn from primitives and imports no artwork', () => {
    expect(FAVICON).toMatch(/<svg/);
    for (const imported of ['<image', 'xlink:href', 'data:image', '.png', '.jpg']) {
      expect(FAVICON, `the favicon has acquired ${imported}`).not.toContain(imported);
    }
    /* Two orbits and a seed: the shapes the identity document describes. */
    expect(FAVICON.match(/<ellipse/g) ?? [], 'two orbits').toHaveLength(2);
    expect(FAVICON.match(/<circle/g) ?? [], 'one seed').toHaveLength(1);
  });

  it('draws its icons rather than importing them', () => {
    for (const imported of ['<image', 'data:image', 'xlink:href']) {
      expect(ICONS, `the icon family has acquired ${imported}`).not.toContain(imported);
    }
    expect(ICONS.match(/<path/g)?.length ?? 0).toBeGreaterThan(20);
  });
});

describe('the words', () => {
  it('names the machines it targets, because nothing else would say which', () => {
    expect(APP).toMatch(/brand-name/);
    const machines = readFileSync(resolve(process.cwd(), 'src/data/machines.ts'), 'utf8');
    expect(machines).toContain('Acorn BBC Model B');
    expect(machines).toContain('Acorn Archimedes A300');
  });

  it('claims no relationship with the people who made them', () => {
    /*
     * Nominative use is naming a machine. This is the other thing, a word that
     * turns naming into a claim, and none of it appears.
     */
    const shipped = [APP, readFileSync(resolve(process.cwd(), 'src/data/machines.ts'), 'utf8')].join('\n');
    for (const claim of ['officially licensed', 'official Acorn', 'endorsed by', 'approved by Acorn', 'in partnership with']) {
      expect(shipped.toLowerCase(), `the product claims to be ${claim}`).not.toContain(claim.toLowerCase());
    }
  });

  it('says it is an alpha for as long as it is one', () => {
    expect(APP).toContain('LOCAL ALPHA');
  });
});
