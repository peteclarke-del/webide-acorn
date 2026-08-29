import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, searchHelpTopics } from './helpTopics';

describe('in-app help content', () => {
  it('has unique deep links and complete operational sections', () => {
    expect(new Set(HELP_TOPICS.map((topic) => topic.id)).size).toBe(HELP_TOPICS.length);
    for (const topic of HELP_TOPICS) {
      expect(topic.prerequisites.length).toBeGreaterThan(0);
      expect(topic.steps.length).toBeGreaterThan(2);
      expect(topic.expected.length).toBeGreaterThan(0);
      expect(topic.limitations.length).toBeGreaterThan(0);
      expect(topic.recovery.length).toBeGreaterThan(0);
      expect(topic.related.every((id) => HELP_TOPICS.some((candidate) => candidate.id === id))).toBe(true);
    }
  });
  it('contains no em dash and finds technical operations across sections', () => {
    expect(JSON.stringify(HELP_TOPICS)).not.toContain('—');
    expect(searchHelpTopics('compound breakpoint').map((topic) => topic.id)).toContain('debugger-arm');
    expect(searchHelpTopics('IndexedDB', 'Start').map((topic) => topic.id)).toContain('rom-import');
    expect(searchHelpTopics('installed header SHA-256').map((topic) => topic.id)).toContain('sdk-document-navigation');
    expect(searchHelpTopics('direct callers callees JSR').map((topic) => topic.id)).toContain('call-hierarchy');
    expect(searchHelpTopics('prototype typedef Ctrl+F12').map((topic) => topic.id)).toContain('c-source-relationships');
  });
  it('references only rooted maintained screenshot paths with text alternatives', () => {
    for (const screenshot of HELP_TOPICS.flatMap((topic) => topic.screenshot ? [topic.screenshot] : [])) {
      expect(screenshot.src).toMatch(/^\/help\/[a-z0-9-]+\.png$/);
      expect(screenshot.alt.length).toBeGreaterThan(20);
      expect(screenshot.caption.length).toBeGreaterThan(20);
    }
  });
});
