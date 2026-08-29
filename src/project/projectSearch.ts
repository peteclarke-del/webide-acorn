import { projectFileIsModified, type ProjectFile } from './project';

export interface ProjectSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regularExpression?: boolean;
}

export interface ProjectSearchMatch {
  fileId: string;
  fileName: string;
  line: number;
  column: number;
  start: number;
  length: number;
  preview: string;
}

export interface ProjectSearchResult {
  matches: ProjectSearchMatch[];
  scannedFiles: number;
  scannedCharacters: number;
  truncated: boolean;
  error?: string;
}

export interface ProjectReplaceResult {
  files: ProjectFile[];
  replacements: number;
  changedFiles: number;
}

export const MAX_PROJECT_SEARCH_QUERY = 256;
export const MAX_PROJECT_SEARCH_MATCHES = 2_000;
export const MAX_PROJECT_SEARCH_CHARACTERS = 16 * 1024 * 1024;

export function searchProject(files: ProjectFile[], rawQuery: string, options: ProjectSearchOptions): ProjectSearchResult {
  const query = boundedQuery(rawQuery);
  if (!query) return { matches: [], scannedFiles: 0, scannedCharacters: 0, truncated: false };
  let expression: RegExp;
  try { expression = searchExpression(query, options); }
  catch (error) { return { matches: [], scannedFiles: 0, scannedCharacters: 0, truncated: false, error: error instanceof Error ? error.message : String(error) }; }
  const matches: ProjectSearchMatch[] = [];
  let scannedFiles = 0;
  let scannedCharacters = 0;
  let truncated = false;

  for (const file of files) {
    if (scannedCharacters + file.content.length > MAX_PROJECT_SEARCH_CHARACTERS) { truncated = true; break; }
    scannedFiles += 1;
    scannedCharacters += file.content.length;
    let offset = 0;
    const lines = file.content.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      expression.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(line))) {
        if (!match[0].length) return { matches: [], scannedFiles, scannedCharacters, truncated: false, error: 'Regular expressions that match empty text are not supported' };
        matches.push({ fileId: file.id, fileName: file.name, line: lineIndex + 1, column: match.index + 1, start: offset + match.index, length: match[0].length, preview: line.slice(0, 240) });
        if (matches.length >= MAX_PROJECT_SEARCH_MATCHES) { truncated = true; return { matches, scannedFiles, scannedCharacters, truncated }; }
      }
      offset += line.length + 1;
    }
  }
  return { matches, scannedFiles, scannedCharacters, truncated };
}

export function replaceProjectMatches(files: ProjectFile[], rawQuery: string, replacement: string, options: ProjectSearchOptions): ProjectReplaceResult {
  const search = searchProject(files, rawQuery, options);
  if (search.error) throw new Error(search.error);
  if (search.truncated) throw new Error('Replace all is disabled because the bounded project search was truncated');
  const changed = new Set(search.matches.map((match) => match.fileId));
  const expression = searchExpression(boundedQuery(rawQuery), options);
  let changedFiles = 0;
  const nextFiles = files.map((file) => {
    if (!changed.has(file.id)) return file;
    changedFiles += 1;
    const content = file.content.split('\n').map((line) => { expression.lastIndex = 0; return line.replace(expression, replacement); }).join('\n');
    return { ...file, content, modified: projectFileIsModified(file, file.name, content) };
  });
  return { files: nextFiles, replacements: search.matches.length, changedFiles };
}

function boundedQuery(query: string): string {
  if (query.length > MAX_PROJECT_SEARCH_QUERY) throw new Error(`Project searches are limited to ${MAX_PROJECT_SEARCH_QUERY} characters`);
  return query;
}

function searchExpression(query: string, options: ProjectSearchOptions): RegExp {
  const source = options.regularExpression ? query : escapeRegExp(query);
  const bounded = options.wholeWord ? `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])` : source;
  return new RegExp(bounded, options.caseSensitive ? 'g' : 'gi');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
