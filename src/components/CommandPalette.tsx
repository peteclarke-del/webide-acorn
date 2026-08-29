import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCommands, type WorkbenchCommand } from '../commands/commandModel';
import { Icon } from './Icon';

interface CommandPaletteProps {
  open: boolean;
  commands: WorkbenchCommand[];
  onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(''); setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => previousFocusRef.current?.focus();
  }, [open]);
  useEffect(() => { if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1)); }, [activeIndex, filtered.length]);

  if (!open) return null;
  const execute = (command: WorkbenchCommand | undefined) => {
    if (!command?.enabled) return;
    onClose(); command.run();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => filtered.length ? (current + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length : 0);
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); execute(filtered[activeIndex]); }
  };
  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(paletteRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? []);
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" onKeyDown={trapFocus}>
      <h2 id="command-palette-title" className="visually-hidden">Command palette</h2>
      <div className="command-palette-input"><Icon name="terminal" size={17} /><input ref={inputRef} role="combobox" aria-label="Search commands" aria-controls="command-palette-results" aria-expanded="true" aria-activedescendant={filtered[activeIndex] ? `command-${filtered[activeIndex]!.id}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onKeyDown} placeholder="Type a command or action" /><kbd>Esc</kbd></div>
      <div className="command-palette-results" id="command-palette-results" role="listbox" aria-label="Available commands">{filtered.length ? filtered.map((command, index) => <button id={`command-${command.id}`} type="button" role="option" aria-selected={index === activeIndex} aria-disabled={!command.enabled} disabled={!command.enabled} className={index === activeIndex ? 'active' : ''} key={command.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => execute(command)}><Icon name={command.enabled ? 'chevron' : 'close'} size={12} /><span><strong>{command.label}</strong><small>{command.enabled ? command.category : command.disabledReason ?? 'Unavailable in the current context'}</small></span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>) : <div className="command-palette-empty">No commands match “{query}”.</div>}</div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Run</span><span>{commands.filter((command) => command.enabled).length} of {commands.length} commands available</span></footer>
    </section>
  </div>;
}
