import { useEffect, useMemo, useState } from 'react';
import type { ProjectFile } from '../project/project';
import { MAX_PROJECT_SEARCH_QUERY, searchProject, type ProjectSearchOptions, type ProjectSearchResult } from '../project/projectSearch';
import { Icon } from './Icon';

interface ProjectSearchWorkspaceProps {
  files: ProjectFile[];
  activeFileId: string;
  onNavigate: (fileId: string, line: number, column: number, length: number) => void;
  onReplaceAll: (query: string, replacement: string, options: ProjectSearchOptions, fileIds: string[]) => number;
}

const emptyResult = (): ProjectSearchResult => ({ matches: [], scannedFiles: 0, scannedCharacters: 0, truncated: false });

export function ProjectSearchWorkspace({ files, activeFileId, onNavigate, onReplaceAll }: ProjectSearchWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState<'project' | 'current'>('project');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regularExpression, setRegularExpression] = useState(false);
  const [workerResult, setWorkerResult] = useState<ProjectSearchResult>(emptyResult);
  const [searching, setSearching] = useState(false);
  const options = useMemo(() => ({ caseSensitive, wholeWord, regularExpression }), [caseSensitive, wholeWord, regularExpression]);
  const scopeFiles = useMemo(() => scope === 'current' ? files.filter((file) => file.id === activeFileId) : files, [scope, files, activeFileId]);
  const literalResult = useMemo(() => regularExpression ? emptyResult() : searchProject(scopeFiles, query, options), [scopeFiles, query, options, regularExpression]);

  useEffect(() => {
    if (!regularExpression) { setSearching(false); return; }
    if (!query) { setWorkerResult(emptyResult()); setSearching(false); return; }
    const worker = new Worker(new URL('../project/projectSearch.worker.ts', import.meta.url), { type: 'module' });
    const id = Date.now();
    setWorkerResult(emptyResult());
    setSearching(true);
    const timer = window.setTimeout(() => {
      worker.terminate();
      setSearching(false);
      setWorkerResult({ ...emptyResult(), error: 'Regular-expression search exceeded the 1 second safety limit. Refine the pattern or scope.' });
    }, 1_000);
    worker.onmessage = (event: MessageEvent<{ id: number; result?: ProjectSearchResult; error?: string }>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timer);
      worker.terminate();
      setSearching(false);
      setWorkerResult(event.data.result ?? { ...emptyResult(), error: event.data.error ?? 'Regular-expression worker failed' });
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      setSearching(false);
      setWorkerResult({ ...emptyResult(), error: 'Regular-expression worker failed safely' });
    };
    worker.postMessage({ id, files: scopeFiles, query, options });
    return () => { window.clearTimeout(timer); worker.terminate(); };
  }, [regularExpression, query, options, scopeFiles]);

  const result = regularExpression ? workerResult : literalResult;
  const groups = useMemo(() => scopeFiles.map((file) => ({ file, matches: result.matches.filter((match) => match.fileId === file.id) })).filter((group) => group.matches.length), [scopeFiles, result.matches]);

  const replaceAll = () => {
    if (!result.matches.length || result.truncated || result.error || searching) return;
    const accepted = window.confirm(`Replace ${result.matches.length} occurrence${result.matches.length === 1 ? '' : 's'} across ${groups.length} file${groups.length === 1 ? '' : 's'}?`);
    if (accepted) onReplaceAll(query, replacement, options, scopeFiles.map((file) => file.id));
  };

  return <div className="project-search-workspace" aria-busy={searching}>
    <div className="runtime-heading"><div><span className="eyebrow">LOCAL PROJECT INDEX</span><h2>Search and replace across files</h2></div><div className="project-search-summary" aria-live="polite"><strong>{searching ? '…' : `${result.matches.length}${result.truncated ? '+' : ''}`}</strong><span>{searching ? 'searching safely' : `matches in ${groups.length} files`}</span></div></div>
    <div className="project-search-controls" role="search">
      <label><span>Find</span><input autoFocus aria-label="Find in project" maxLength={MAX_PROJECT_SEARCH_QUERY} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Command, label, address or expression" /></label>
      <label><span>Replace with</span><input aria-label="Replace in project with" value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
      <label className="project-search-scope"><span>Scope</span><select aria-label="Search scope" value={scope} onChange={(event) => setScope(event.target.value as 'project' | 'current')}><option value="project">Entire project</option><option value="current">Current file</option></select></label>
      <label className="project-search-option"><input aria-label="Match case in project" type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /><span>Aa</span></label>
      <label className="project-search-option"><input aria-label="Match whole word in project" type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} /><span>Word</span></label>
      <label className="project-search-option"><input aria-label="Use regular expression" type="checkbox" checked={regularExpression} onChange={(event) => setRegularExpression(event.target.checked)} /><span>.*</span></label>
      <button type="button" disabled={!result.matches.length || result.truncated || !!result.error || searching} onClick={replaceAll}><Icon name="reset" size={14} /> Replace all</button>
    </div>
    {result.error && <div className="project-search-warning" role="alert">{result.error} Replacement is disabled.</div>}
    {result.truncated && <div className="project-search-warning" role="alert">Results reached the safe project search limit. Refine the query; replacement is disabled while results are incomplete.</div>}
    {!query ? <div className="honest-empty runtime-empty">Search the current file or every editable project file. Results retain exact file, line and column locations and never leave this browser.</div> : searching ? <div className="honest-empty runtime-empty">Evaluating the regular expression in a disposable worker…</div> : result.error ? <div className="honest-empty runtime-empty">The expression was stopped without changing project files.</div> : !result.matches.length ? <div className="honest-empty runtime-empty">No {scope === 'project' ? 'project' : 'current-file'} matches for “{query}”.</div> : <div className="project-search-results" aria-label="Project search results">{groups.map(({ file, matches }) => <section key={file.id}><h3><Icon name="file" size={13} /><span>{file.name}</span><small>{matches.length}</small></h3>{matches.map((match) => <button type="button" key={`${match.start}-${match.length}`} onClick={() => onNavigate(match.fileId, match.line, match.column, match.length)}><code>{match.line}:{match.column}</code><span>{match.preview.slice(0, match.column - 1)}<mark>{match.preview.slice(match.column - 1, match.column - 1 + match.length)}</mark>{match.preview.slice(match.column - 1 + match.length)}</span></button>)}</section>)}</div>}
    <footer className="project-search-facts"><span>{result.scannedFiles} of {scopeFiles.length} scoped files scanned</span><span>{result.scannedCharacters.toLocaleString()} characters</span><span>{regularExpression ? 'regular expression · timed worker' : 'literal search'} · bounded locally</span></footer>
  </div>;
}
