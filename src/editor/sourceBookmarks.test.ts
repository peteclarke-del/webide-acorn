import { describe, expect, it, vi } from 'vitest';
import type { ProjectFile, SourceBookmark } from '../project/project';
import { adjacentSourceBookmark, createSourceBookmark, trackSourceBookmarks } from './sourceBookmarks';

const file = (id: string, content: string): ProjectFile => ({ id, name: `${id}.asm`, content, language: '6502', modified: false });

describe('source bookmarks', () => {
  it('creates a named anchor and tracks lines inserted before it', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const source = file('main', '.start\n LDA #1\n RTS');
    const bookmark = createSourceBookmark(source, 3, 2, 'Return path');
    expect(bookmark).toMatchObject({ name: 'Return path', description: '', scope: 'project', line: 3, column: 2, anchor: 'RTS', enabled: true });
    expect(trackSourceBookmarks([bookmark], 'main', source.content, '; heading\n' + source.content)[0]).toMatchObject({ line: 4, orphaned: false });
  });

  it('recovers moved anchors and explicitly marks deleted anchors orphaned', () => {
    const bookmark: SourceBookmark = { id: 'b', fileId: 'main', line: 2, column: 1, name: 'Load', description: '', scope: 'project', enabled: true, anchor: 'LDA #1' };
    expect(trackSourceBookmarks([bookmark], 'main', '.start\n LDA #1\n RTS', '.start\n RTS\n LDA #1')[0]).toMatchObject({ line: 3, orphaned: false });
    expect(trackSourceBookmarks([bookmark], 'main', '.start\n LDA #1\n RTS', '.start\n RTS')[0]).toMatchObject({ line: 2, orphaned: true });
  });

  it('navigates enabled bookmarks project-wide with wraparound', () => {
    const files = [file('a', '1\n2'), file('b', '1\n2')];
    const bookmarks: SourceBookmark[] = [
      { id: '1', fileId: 'a', line: 2, column: 1, name: 'A', description: '', scope: 'project', enabled: true, anchor: '2' },
      { id: '2', fileId: 'b', line: 1, column: 1, name: 'B', description: '', scope: 'project', enabled: true, anchor: '1' },
    ];
    expect(adjacentSourceBookmark(bookmarks, files, 'a', 2, 1)?.id).toBe('2');
    expect(adjacentSourceBookmark(bookmarks, files, 'a', 2, -1)?.id).toBe('2');
    expect(adjacentSourceBookmark(bookmarks, files, 'b', 1, 1)?.id).toBe('1');
  });
});
