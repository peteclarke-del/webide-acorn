import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectFile } from '../project/project';
import { buildProjectLanguageIndex } from '../language/projectLanguageService';

interface GoToSourceDialogProps {
  open: boolean;
  files: ProjectFile[];
  activeFileId: string;
  currentLine: number;
  sourceLocations?: Record<number, { fileId: string; fileName: string; line: number }>;
  onNavigate: (fileId: string, line: number, column?: number, length?: number) => void;
  onClose: () => void;
}

interface Destination {
  id: string;
  label: string;
  detail: string;
  fileId: string;
  line: number;
  column?: number;
  length?: number;
}

export function GoToSourceDialog({ open, files, activeFileId, currentLine, sourceLocations = {}, onNavigate, onClose }: GoToSourceDialogProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(() => buildProjectLanguageIndex(files), [files]);
  const activeFile = files.find((file) => file.id === activeFileId);
  /* When nothing matches, why. A blank list reads as "there is no such thing",
   * which is a different statement from "this build carries no debug metadata,
   * so no address can be located" — and only one of them is usually true. */
  const search = useMemo<{ destinations: Destination[]; reason: string }>(() => {
    const nothing = (reason: string) => ({ destinations: [], reason });
    const trimmed = query.trim();
    const addressText = trimmed.startsWith('@') ? trimmed.slice(1) : '';
    if (addressText) {
      const normalized = addressText.replace(/^&|^\$/i, '').replace(/^0x/i, '');
      if (!/^[0-9a-f]+$/i.test(normalized)) return nothing(`${addressText} is not a hexadecimal address. Write an address as @&1900, @$1900 or @0x1900.`);
      const requested = Number.parseInt(normalized, 16);
      const mapped = Object.entries(sourceLocations).map(([address, location]) => ({ address: Number(address), location }));
      if (!mapped.length) return nothing('The active build carries no source-to-address map, so no address can be located. Build the target with debug metadata, then search again.');
      const exact = sourceLocations[requested];
      if (exact) return { destinations: [{ id: `address-${requested}`, label: `&${requested.toString(16).toUpperCase()}`, detail: `exact build address · ${exact.fileName}:${exact.line}`, fileId: exact.fileId, line: exact.line }], reason: '' };
      const preceding = mapped.filter(({ address }) => address <= requested).sort((left, right) => right.address - left.address)[0];
      if (!preceding) {
        const lowest = mapped.sort((left, right) => left.address - right.address)[0]!;
        return nothing(`&${requested.toString(16).toUpperCase()} is below &${lowest.address.toString(16).toUpperCase()}, the lowest address this build maps to source.`);
      }
      return { destinations: [{ id: `address-${requested}`, label: `&${requested.toString(16).toUpperCase()}`, detail: `nearest preceding mapped address &${preceding.address.toString(16).toUpperCase()} · ${preceding.location.fileName}:${preceding.location.line}`, fileId: preceding.location.fileId, line: preceding.location.line }], reason: '' };
    }
    const lineText = trimmed.startsWith(':') ? trimmed.slice(1) : trimmed;
    if (/^\d+$/.test(lineText) && activeFile) {
      const line = Number(lineText);
      const maximum = activeFile.content.split('\n').length;
      if (line < 1 || line > maximum) return nothing(`${activeFile.name} has ${maximum} line${maximum === 1 ? '' : 's'}, so there is no physical line ${line}.`);
      return { destinations: [{ id: `line-${activeFile.id}-${line}`, label: `Line ${line}`, detail: `${activeFile.name} · physical line · range 1 to ${maximum}`, fileId: activeFile.id, line }], reason: '' };
    }
    const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    const fileResults: Destination[] = files.filter((file) => terms.length > 0 && terms.every((term) => `${file.name} ${file.language}`.toLowerCase().includes(term))).map((file) => ({ id: `file-${file.id}`, label: file.name, detail: `${file.language} · project file · line 1`, fileId: file.id, line: 1 }));
    const symbolResults = index.symbols.filter((symbol) => {
      const haystack = `${symbol.token} ${symbol.signature} ${symbol.kind} ${symbol.fileName}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).sort((left, right) => left.token.localeCompare(right.token) || left.fileName.localeCompare(right.fileName) || left.line - right.line).slice(0, 100).map((symbol) => ({
      id: `symbol-${symbol.fileId}-${symbol.line}-${symbol.column}-${symbol.token}`,
      label: symbol.token,
      detail: `${symbol.kind} · ${symbol.signature} · ${symbol.fileName}:${symbol.line}:${symbol.column}`,
      fileId: symbol.fileId,
      line: symbol.line,
      column: symbol.column,
      length: symbol.length,
    }));
    const destinations = [...fileResults, ...symbolResults].slice(0, 100);
    if (destinations.length) return { destinations, reason: '' };
    return nothing(terms.length
      ? `No file or parsed symbol matches ${terms.map((term) => `"${term}"`).join(' and ')}. Use :line for the active file, or @&address for the current build map.`
      : 'Type a file, a symbol, :line for the active file, or @&address for the current build map.');
  }, [activeFile, files, index, query, sourceLocations]);

  const results = search.destinations;

  useEffect(() => {
    if (!open) return;
    setQuery(`:${currentLine}`);
    setActiveIndex(0);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, [currentLine, open]);
  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;
  const activate = (destination: Destination | undefined) => {
    if (!destination) return;
    onNavigate(destination.fileId, destination.line, destination.column, destination.length);
    onClose();
  };
  return <div className="go-to-source-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="go-to-source-dialog" role="dialog" aria-modal="true" aria-labelledby="go-to-source-title">
      <header><strong id="go-to-source-title">Go to file, symbol, line or address</strong><button type="button" onClick={onClose} aria-label="Close go to source">×</button></header>
      <label><span className="visually-hidden">File, symbol, line or address</span><input ref={inputRef} aria-label="File, symbol, line or address" role="combobox" aria-controls="go-to-source-results" aria-expanded="true" aria-activedescendant={results[activeIndex]?.id} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        else if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); setActiveIndex((value) => (value + 1) % results.length); }
        else if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); setActiveIndex((value) => (value - 1 + results.length) % results.length); }
        else if (event.key === 'Enter') { event.preventDefault(); activate(results[activeIndex]); }
      }} placeholder=":line, @&address, symbol, kind or file" /></label>
      <div id="go-to-source-results" className="go-to-source-results" role="listbox" aria-label="Go to source results">{results.length ? results.map((destination, resultIndex) => <button id={destination.id} className={resultIndex === activeIndex ? 'active' : ''} type="button" role="option" aria-selected={resultIndex === activeIndex} key={destination.id} onMouseEnter={() => setActiveIndex(resultIndex)} onClick={() => activate(destination)}><strong>{destination.label}</strong><small>{destination.detail}</small></button>) : <p role="status">{search.reason}</p>}</div>
      <footer><span><kbd>↑↓</kbd> select</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span>Ctrl G</span></footer>
    </section>
  </div>;
}
