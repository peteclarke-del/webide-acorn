import { searchProject, type ProjectSearchOptions } from './projectSearch';
import type { ProjectFile } from './project';

interface SearchRequest { id: number; files: ProjectFile[]; query: string; options: ProjectSearchOptions }
const context = self as unknown as { onmessage: ((event: MessageEvent<SearchRequest>) => void) | null; postMessage: (message: unknown) => void };

context.onmessage = (event) => {
  const { id, files, query, options } = event.data;
  try { context.postMessage({ id, result: searchProject(files, query, options) }); }
  catch (error) { context.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
