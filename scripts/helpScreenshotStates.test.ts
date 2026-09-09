import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The one thing standing between the help images and a folder of stale
 * pictures is that every one of them can be taken again from the product. A
 * topic that gains a screenshot without a state to reach it is a picture
 * nothing can refresh, so it is caught here rather than noticed a release
 * later.
 */
const root = resolve(import.meta.dirname, '..');
const topics = readFileSync(resolve(root, 'src/help/helpTopics.ts'), 'utf8');
const states = readFileSync(resolve(root, 'scripts/helpScreenshotStates.mjs'), 'utf8');

const referenced = [...new Set(Array.from(topics.matchAll(/src: "\/help\/([a-z0-9-]+\.png)"/g), (match) => match[1]!))];
const defined = [...new Set(Array.from(states.matchAll(/file: '([a-z0-9-]+\.png)'/g), (match) => match[1]!))];

describe('every help screenshot can be taken again', () => {
  it('has a capture state for each image a topic shows', () => {
    expect(referenced.filter((file) => !defined.includes(file))).toEqual([]);
  });

  it('has no capture state for an image no topic shows', () => {
    expect(defined.filter((file) => !referenced.includes(file))).toEqual([]);
  });

  it('says what each state has to show before its picture is taken', () => {
    const withoutChecks = Array.from(states.matchAll(/file: '([a-z0-9-]+\.png)',\n(?:.*\n)*?    shows: (\[[^\]]*\])/g))
      .filter((match) => match[2]!.replace(/[[\]\s]/g, '') === '')
      .map((match) => match[1]!);
    expect(withoutChecks).toEqual([]);
    expect(Array.from(states.matchAll(/shows: \[/g))).toHaveLength(defined.length);
  });
});
