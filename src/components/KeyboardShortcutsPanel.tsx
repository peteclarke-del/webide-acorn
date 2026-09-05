import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import {
  browserReservedNote, chordAssignmentError, chordFromEvent, chordSteps, emulatedKeyboardConflict,
  formatChord, parseChordSequence,
  type KeyBindingOverrides, type ResolvedKeyBinding,
} from '../commands/keyBindings';

interface KeyboardShortcutsPanelProps {
  bindings: readonly ResolvedKeyBinding[];
  overrides: KeyBindingOverrides;
  onChangeOverrides: (overrides: KeyBindingOverrides) => void;
  onNotice: (message: string) => void;
}

const SCOPE_LABEL: Record<string, string> = {
  workbench: 'Workbench',
  editor: 'Source editor',
};

const SCOPE_DESCRIPTION: Record<string, string> = {
  workbench: 'Dispatched from the window while the workbench has focus.',
  editor: 'Dispatched by the focused source editor before the workbench sees the chord.',
};

export function KeyboardShortcutsPanel({ bindings, overrides, onChangeOverrides, onNotice }: KeyboardShortcutsPanelProps) {
  const [filter, setFilter] = useState('');
  const [recordingId, setRecordingId] = useState<string>();
  const [recordedChord, setRecordedChord] = useState<string>();

  const terms = filter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = useMemo(() => bindings.filter((binding) => terms.every((term) =>
    binding.label.toLocaleLowerCase().includes(term)
    || binding.category.toLocaleLowerCase().includes(term)
    || binding.commandId.includes(term)
    || (binding.chord ?? 'unbound').toLocaleLowerCase().includes(term))), [bindings, filter]);

  const customCount = bindings.filter((binding) => binding.source !== 'default').length;
  const conflictCount = bindings.filter((binding) => binding.conflicts.length).length;

  const stopRecording = () => { setRecordingId(undefined); setRecordedChord(undefined); };

  const assign = (binding: ResolvedKeyBinding, chord: string) => {
    const error = chordAssignmentError(chord);
    if (error) { onNotice(`${formatChord(chord)} cannot be assigned. ${error}`); return; }
    const next = { ...overrides };
    if (chord === binding.defaultChord) delete next[binding.id]; else next[binding.id] = chord;
    onChangeOverrides(next);
    const clash = bindings.find((other) => other.id !== binding.id && other.scope === binding.scope && other.chord === chord && other.commandId !== binding.commandId);
    onNotice(clash
      ? `${binding.label} is now ${formatChord(chord)}, which still conflicts with ${clash.label}. The first declared binding wins until one is changed.`
      : `${binding.label} is now ${formatChord(chord)}`);
    stopRecording();
  };

  const unbind = (binding: ResolvedKeyBinding) => {
    onChangeOverrides({ ...overrides, [binding.id]: null });
    onNotice(`${binding.label} is unbound and no longer dispatches a chord`);
    stopRecording();
  };

  const reset = (binding: ResolvedKeyBinding) => {
    const next = { ...overrides };
    delete next[binding.id];
    onChangeOverrides(next);
    onNotice(`${binding.label} restored to ${formatChord(binding.defaultChord)}`);
    stopRecording();
  };

  const resetAll = () => {
    if (!customCount) { onNotice('Every shortcut already matches its default'); return; }
    onChangeOverrides({});
    onNotice(`Restored ${customCount} shortcut${customCount === 1 ? '' : 's'} to their defaults`);
    stopRecording();
  };

  const scopes: Array<ResolvedKeyBinding['scope']> = ['workbench', 'editor'];

  return (
    <section className="keyboard-shortcuts-panel panel-surface" aria-label="Keyboard shortcuts">
      <header>
        <h3><Icon name="terminal" size={15} /> Keyboard shortcuts</h3>
        <p>
          Every chord listed here is dispatched by real workbench or editor code; nothing is listed that the
          product does not actually handle. Command on macOS and Control elsewhere share the same role.
        </p>
        <div className="keyboard-shortcuts-summary" role="status">
          {customCount ? `${customCount} customised binding${customCount === 1 ? '' : 's'}` : 'All bindings are at their defaults'}
          {conflictCount ? ` · ${conflictCount} conflicting binding${conflictCount === 1 ? '' : 's'}` : ''}
        </div>
        <div className="keyboard-shortcuts-controls">
          <label>
            <span className="visually-hidden">Filter shortcuts</span>
            <Icon name="search" size={13} />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter command, category or chord" aria-label="Filter shortcuts" />
          </label>
          <button type="button" onClick={resetAll} disabled={!customCount}>Reset all to defaults</button>
        </div>
      </header>

      {scopes.map((scope) => {
        const rows = visible.filter((binding) => binding.scope === scope);
        if (!rows.length) return null;
        return (
          <div className="keyboard-shortcuts-scope" key={scope}>
            <h4>{SCOPE_LABEL[scope]}</h4>
            <p className="keyboard-shortcuts-scope-note">{SCOPE_DESCRIPTION[scope]}</p>
            <table className="keyboard-shortcuts-table">
              <thead>
                <tr><th scope="col">Command</th><th scope="col">Chord</th><th scope="col">Default</th><th scope="col">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((binding) => {
                  const recording = recordingId === binding.id;
                  const reservedNote = browserReservedNote(binding.chord);
                  /* Every chord is taken by a running machine, so this is
                   * shown on demand rather than as a warning on all sixty-four
                   * rows, which would say nothing by saying it everywhere. */
                  const machineNote = emulatedKeyboardConflict(binding.chord);
                  const pendingError = recording && recordedChord ? chordAssignmentError(recordedChord) : null;
                  return (
                    <tr key={binding.id} className={binding.conflicts.length ? 'binding-conflict' : undefined}>
                      <th scope="row">
                        <span>{binding.label}</span>
                        {binding.note && <small className="binding-note">{binding.note}</small>}
                        {!!binding.conflicts.length && <small className="binding-warning">Also claimed by {binding.conflicts.map((id) => bindings.find((other) => other.id === id)?.label ?? id).join(', ')}. The first declared binding wins.</small>}
                        {!!binding.shadows.length && <small className="binding-note">Hides the workbench chord while the editor has focus.</small>}
                        {reservedNote && <small className="binding-warning">{reservedNote}</small>}
                        {machineNote && (
                          <details className="binding-machine">
                            <summary>While the machine is running{machineNote.machineKey ? ` this types ${machineNote.machineKey}` : ''}</summary>
                            <small>{machineNote.note}</small>
                          </details>
                        )}
                      </th>
                      <td>
                        {recording
                          ? (
                            <span className="binding-recorder">
                              <input
                                autoFocus
                                readOnly
                                aria-label={`Press the new chord for ${binding.label}`}
                                value={recordedChord ? formatChord(recordedChord) : 'Press a chord…'}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') { event.preventDefault(); stopRecording(); return; }
                                  event.preventDefault();
                                  const chord = chordFromEvent(event.nativeEvent);
                                  if (!chord) return;
                                  /* A second press extends the recording into a
                                   * two-stroke sequence, which is the only way
                                   * to enter one: typing a comma into a field
                                   * that is capturing key presses is not
                                   * something a person can do. Pressing again
                                   * after two starts over, so a mistake is one
                                   * key away from being fixed. */
                                  setRecordedChord((current) => {
                                    const steps = chordSteps(current ?? null);
                                    return steps.length === 1 ? parseChordSequence(`${steps[0]}, ${chord}`) ?? chord : chord;
                                  });
                                }}
                              />
                              <button type="button" disabled={!recordedChord || !!pendingError} onClick={() => recordedChord && assign(binding, recordedChord)}>Apply</button>
                              <button type="button" onClick={stopRecording}>Cancel</button>
                              {pendingError && <small className="binding-warning">{pendingError}</small>}
                            </span>
                          )
                          : <kbd className={binding.chord ? undefined : 'binding-unbound'}>{formatChord(binding.chord)}</kbd>}
                      </td>
                      <td><code>{formatChord(binding.defaultChord)}</code></td>
                      <td className="keyboard-shortcuts-actions">
                        <button type="button" onClick={() => { setRecordingId(binding.id); setRecordedChord(undefined); }} disabled={recording}>Change</button>
                        <button type="button" onClick={() => unbind(binding)} disabled={!binding.chord}>Unbind</button>
                        <button type="button" onClick={() => reset(binding)} disabled={binding.source === 'default'}>Reset</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {!visible.length && <p className="honest-empty">No declared shortcut matches that filter.</p>}
    </section>
  );
}
