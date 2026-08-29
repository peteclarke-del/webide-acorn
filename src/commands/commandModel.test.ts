import { describe, expect, it, vi } from 'vitest';
import { filterCommands, type WorkbenchCommand } from './commandModel';

const command = (id: string, label: string, category: string, keywords: string[] = []): WorkbenchCommand => ({ id, label, category, keywords, enabled: true, run: vi.fn() });

describe('command model', () => {
  const commands = [
    command('build', 'Build active source', 'Build', ['compile', 'assemble']),
    command('search', 'Search project', 'Navigation', ['find']),
    command('settings', 'Open target settings', 'Workspace', ['rom', 'firmware']),
  ];

  it('returns the declared order for an empty query', () => {
    expect(filterCommands(commands, '').map((item) => item.id)).toEqual(['build', 'search', 'settings']);
  });

  it('matches labels, categories, and keywords with useful ranking', () => {
    expect(filterCommands(commands, 'build').map((item) => item.id)).toEqual(['build']);
    expect(filterCommands(commands, 'navigation').map((item) => item.id)).toEqual(['search']);
    expect(filterCommands(commands, 'firmware').map((item) => item.id)).toEqual(['settings']);
  });

  it('requires every query term to match', () => {
    expect(filterCommands(commands, 'build source').map((item) => item.id)).toEqual(['build']);
    expect(filterCommands(commands, 'build firmware')).toEqual([]);
  });
});
