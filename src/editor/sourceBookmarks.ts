import type { ProjectFile, SourceBookmark } from '../project/project';

export function createSourceBookmark(file: ProjectFile, line: number, column = 1, name?: string, description = '', scope: SourceBookmark['scope'] = 'project'): SourceBookmark {
  const boundedLine = Math.max(1, Math.min(line, file.content.split('\n').length));
  return {
    id: crypto.randomUUID(), fileId: file.id, line: boundedLine, column: Math.max(1, column),
    name: name?.trim().slice(0, 120) || `${file.name}:${boundedLine}`,
    description: description.trim().slice(0, 1000), scope,
    enabled: true, anchor: lineAt(file.content, boundedLine).trim().slice(0, 240),
  };
}

export function trackSourceBookmarks(bookmarks: SourceBookmark[], fileId: string, before: string, after: string): SourceBookmark[] {
  if (before === after) return bookmarks;
  const beforeLines = before.split('\n'); const afterLines = after.split('\n');
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) suffix++;
  const beforeChangedEnd = beforeLines.length - suffix;
  const afterChangedEnd = afterLines.length - suffix;
  const delta = afterLines.length - beforeLines.length;
  return bookmarks.map((bookmark) => {
    if (bookmark.fileId !== fileId) return bookmark;
    const zeroLine = bookmark.line - 1;
    if (zeroLine < prefix) return bookmark;
    if (zeroLine >= beforeChangedEnd) return { ...bookmark, line: Math.max(1, bookmark.line + delta), orphaned: false };
    const anchorMatches = bookmark.anchor ? afterLines.flatMap((line, index) => line.trim() === bookmark.anchor ? [index] : []) : [];
    if (anchorMatches.length) {
      const expected = Math.max(prefix, Math.min(afterChangedEnd - 1, zeroLine + delta));
      const closest = anchorMatches.sort((left, right) => Math.abs(left - expected) - Math.abs(right - expected))[0]!;
      return { ...bookmark, line: closest + 1, orphaned: false };
    }
    const line = Math.max(1, Math.min(afterLines.length, prefix + 1));
    return { ...bookmark, line, orphaned: true };
  });
}

export function orderedSourceBookmarks(bookmarks: SourceBookmark[], files: ProjectFile[]) {
  const order = new Map(files.map((file, index) => [file.id, index]));
  return [...bookmarks].sort((left, right) => (order.get(left.fileId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.fileId) ?? Number.MAX_SAFE_INTEGER) || left.line - right.line || left.column - right.column || left.name.localeCompare(right.name));
}

export function adjacentSourceBookmark(bookmarks: SourceBookmark[], files: ProjectFile[], fileId: string, line: number, direction: 1 | -1) {
  const enabled = orderedSourceBookmarks(bookmarks.filter((bookmark) => bookmark.enabled && !bookmark.orphaned), files);
  if (!enabled.length) return undefined;
  const current = enabled.findIndex((bookmark) => bookmark.fileId === fileId && bookmark.line >= line);
  if (direction === 1) return enabled[current >= 0 ? (current + (enabled[current]!.fileId === fileId && enabled[current]!.line === line ? 1 : 0)) % enabled.length : 0];
  const previousBase = enabled.findIndex((bookmark) => bookmark.fileId === fileId && bookmark.line >= line);
  return enabled[(previousBase < 0 ? enabled.length : previousBase) - 1] ?? enabled.at(-1);
}

function lineAt(content: string, line: number) { return content.split('\n')[line - 1] ?? ''; }
