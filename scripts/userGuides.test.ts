// @vitest-environment node

/* The standalone guides, and the ways they must refuse.
 *
 * A book generated from the product cannot be wrong about the product, but it
 * can be silently incomplete: an area nobody wrote, a topic nobody published, a
 * feature that shipped after the guides declared it absent. Each of those is
 * asserted here to be a failure rather than a shorter book.
 */
import { describe, expect, it } from 'vitest';
import { HELP_TOPICS } from '../src/help/helpTopics';
import {
  GENERATED_NOTE, GUIDE_AREAS, guideFiles, renderTopic, UNAVAILABLE_AREAS,
  unavailableFailures, unpublishedTopics,
} from './userGuides.mjs';

describe('what the guides cover', () => {
  it('publishes every topic the IDE carries', () => {
    /* A topic that reaches the IDE and not the book is exactly the drift this
     * generator exists to prevent. */
    expect(unpublishedTopics(HELP_TOPICS)).toEqual([]);
  });

  it('names an area for every part of DOC-901, with cloud declared absent', () => {
    const covered = [...GUIDE_AREAS.map((area) => area.id), ...UNAVAILABLE_AREAS.map((area) => area.id)];
    for (const area of ['first-run', 'target-selection', 'rom-import', 'projects', 'builds', 'media',
      'emulator', 'debugging', 'tests', 'assets', 'research', 'cloud', 'accessibility', 'troubleshooting']) {
      expect(covered, area).toContain(area);
    }
  });

  it('covers every asset editor the interface offers', () => {
    /* DOC-901 asks for every asset editor, and the interface has nine tabs. A
     * guide covering two of them would read as a guide covering the editors. */
    const assets = GUIDE_AREAS.find((area) => area.id === 'assets')!;
    const published = HELP_TOPICS.filter((topic) => assets.topics.includes(topic.id));
    const text = published.map((topic) => `${topic.title} ${topic.steps.join(' ')}`).join(' ');
    for (const tab of ['Characters', 'Sprites', 'Tiles', 'Fonts', 'Screens', 'Maps', 'Palettes', 'Sound', 'Samples']) {
      expect(text, tab).toContain(tab);
    }
  });

  it('covers tracing, which is a debugger surface in its own right', () => {
    const debugging = GUIDE_AREAS.find((area) => area.id === 'debugging')!;
    expect(debugging.topics).toContain('hardware-trace');
  });

  it('lists no topic twice, so no procedure is published in two places', () => {
    const published = GUIDE_AREAS.flatMap((area) => area.topics);
    expect(published).toHaveLength(new Set(published).size);
  });

  it('names only topics that exist', () => {
    const known = new Set(HELP_TOPICS.map((topic) => topic.id));
    for (const area of GUIDE_AREAS) {
      for (const id of area.topics) expect(known, `${area.id} names ${id}`).toContain(id);
    }
  });
});

describe('an area with no feature to document', () => {
  it('is named with a reason rather than omitted', () => {
    /* A book that quietly leaves out an area reads as a book that covered
     * everything. */
    const cloud = UNAVAILABLE_AREAS.find((area) => area.id === 'cloud')!;
    expect(cloud.reason).toMatch(/no server-side project store/);
    expect(cloud.reason).toMatch(/CLD-800/);
    expect(cloud.reason.length).toBeGreaterThan(120);
  });

  it('fails once the feature it declares absent is present', () => {
    /* Without this the declaration is a note that outlives the thing it
     * describes: cloud projects could ship and the book would still say they
     * do not exist. */
    expect(unavailableFailures('nothing of the sort here')).toEqual([]);
    const failures = unavailableFailures('export function CloudProjectWorkspace() {}');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/Write the guide or correct the declaration/);
  });

  it('checks for markers specific enough to mean the feature', () => {
    for (const area of UNAVAILABLE_AREAS) {
      expect(area.absentMarkers.length, area.id).toBeGreaterThan(0);
      for (const marker of area.absentMarkers) expect(marker.length, marker).toBeGreaterThan(10);
    }
  });
});

describe('rendering', () => {
  const topic = HELP_TOPICS.find((entry) => entry.id === 'hardware-trace')!;

  it('renders a topic with its procedure numbered and its limits kept', () => {
    const rendered = renderTopic(topic, 4);
    expect(rendered).toContain(`## 4. ${topic.title}`);
    expect(rendered).toContain(`1. ${topic.steps[0]}`);
    expect(rendered).toContain(`- ${topic.limitations[0]}`);
    expect(rendered).toContain('**If it goes wrong**');
  });

  it('links back to the same topic inside the IDE', () => {
    /* The point of one source is that a reader can move between the book and
     * the product without wondering whether they are the same procedure. */
    expect(renderTopic(topic, 1)).toContain(`#help/${topic.id}`);
  });

  it('omits a heading rather than printing an empty one', () => {
    const bare = { ...topic, prerequisites: [], recovery: [], screenshot: undefined };
    const rendered = renderTopic(bare, 1);
    expect(rendered).not.toContain('**Before you start**');
    expect(rendered).not.toContain('**If it goes wrong**');
    expect(rendered).toContain('**Limits**');
  });

  it('marks every file as generated, so nobody edits the copy', () => {
    const files = guideFiles(HELP_TOPICS);
    expect(files.size).toBe(GUIDE_AREAS.length + 1);
    for (const [name, content] of files) expect(content, name).toContain(GENERATED_NOTE);
  });

  it('indexes every area and states why cloud has no guide', () => {
    const index = guideFiles(HELP_TOPICS).get('index.md')!;
    for (const area of GUIDE_AREAS) expect(index, area.id).toContain(`](${area.id}.md)`);
    expect(index).toContain('Areas with no guide, and why');
    expect(index).toContain(UNAVAILABLE_AREAS[0]!.reason);
  });

  it('refuses to render an area naming a topic that does not exist', () => {
    expect(() => guideFiles(HELP_TOPICS.filter((entry) => entry.id !== 'first-run')))
      .toThrow(/names topics that do not exist: first-run/);
  });
});
