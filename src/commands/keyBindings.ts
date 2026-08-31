/* Canonical keyboard-binding model shared by the workbench window handler, the
 * source-editor handler and the Settings keyboard panel. It is the single
 * source of truth for every shortcut the product claims to provide: nothing
 * dispatches a shortcut that is not declared here, and the settings surface
 * lists exactly what is dispatched. */

export type BindingScope = 'workbench' | 'editor';

export interface KeyBindingDefinition {
  /** Stable binding identity. A command may own more than one binding. */
  id: string;
  commandId: string;
  label: string;
  category: string;
  scope: BindingScope;
  defaultChord: string;
  /** Honest note about host or browser ownership; never a claim of capture. */
  note?: string;
}

export interface ResolvedKeyBinding extends KeyBindingDefinition {
  /** Effective chord, or null when the user has deliberately unbound it. */
  chord: string | null;
  source: 'default' | 'custom' | 'unbound';
  /** Other binding ids in the same scope that claim the same chord. */
  conflicts: string[];
  /** Workbench binding ids this editor binding hides while the editor has focus. */
  shadows: string[];
  /** True when a mainstream browser commonly claims the chord first. */
  browserReserved: boolean;
}

export type KeyBindingOverrides = Record<string, string | null>;

export const KEY_BINDINGS_STORAGE_KEY = '8bit-net-dev-key-bindings-1';

const NAMED_KEYS = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Space', 'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
] as const;

const NAMED_KEY_LOOKUP = new Map(NAMED_KEYS.map((name) => [name.toLowerCase(), name as string]));
/* Long-hand spellings accepted from typed input and stored overrides. */
for (const [alias, canonical] of [
  ['esc', 'Escape'], ['del', 'Delete'], ['ins', 'Insert'], ['return', 'Enter'],
  ['spacebar', 'Space'], ['pgup', 'PageUp'], ['pgdn', 'PageDown'], ['pagedown', 'PageDown'],
  ['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight'],
] as const) NAMED_KEY_LOOKUP.set(alias, canonical);

const PUNCTUATION = new Set(['/', '\\', '[', ']', ',', '.', '-', '=', ';', "'", '`']);

/* Physical-key codes are preferred over event.key so that shifted punctuation
 * (Ctrl+Shift+/ arriving as "?") and non-US layouts still resolve to the chord
 * the user configured. Environments that omit code fall back to key. */
const CODE_TO_KEY = new Map<string, string>([
  ['Space', 'Space'], ['Slash', '/'], ['Backslash', '\\'], ['BracketLeft', '['], ['BracketRight', ']'],
  ['Comma', ','], ['Period', '.'], ['Minus', '-'], ['Equal', '='], ['Semicolon', ';'],
  ['Quote', "'"], ['Backquote', '`'],
]);

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS', 'Hyper', 'Super', 'Dead', 'Unidentified']);

export interface KeyChordEventLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function canonicalKeyName(raw: string): string | null {
  if (!raw) return null;
  const named = NAMED_KEY_LOOKUP.get(raw.toLowerCase());
  if (named) return named;
  if (raw === ' ') return 'Space';
  if (raw.length !== 1) return null;
  if (/[a-z]/i.test(raw)) return raw.toUpperCase();
  if (/[0-9]/.test(raw)) return raw;
  return PUNCTUATION.has(raw) ? raw : null;
}

function keyFromCode(code: string | undefined): string | null {
  if (!code) return null;
  const mapped = CODE_TO_KEY.get(code);
  if (mapped) return mapped;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED_KEY_LOOKUP.get(code.toLowerCase()) ?? null;
}

function composeChord(ctrl: boolean, alt: boolean, shift: boolean, key: string, command = false): string {
  return `${command ? 'Cmd+' : ''}${ctrl ? 'Ctrl+' : ''}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`;
}

/** Canonical chord for a keyboard event, or null for bare modifier presses. */
export function chordFromEvent(event: KeyChordEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = keyFromCode(event.code) ?? canonicalKeyName(event.key);
  if (!key) return null;
  /* Command on macOS and Control elsewhere occupy the same role throughout the
   * workbench, so both normalize to Ctrl. `chordCandidates` is what a
   * dispatcher uses when a binding wants to tell them apart. */
  return composeChord(!!event.ctrlKey || !!event.metaKey, !!event.altKey, !!event.shiftKey, key);
}

/**
 * Every chord one key press could be, most specific first.
 *
 * Command and Control share a role by default, which is what a person moving
 * between an Apple keyboard and any other expects. But they are different keys,
 * and a binding that wants one of them specifically — because the other is
 * taken, or because the machine below needs it — has no way to say so while
 * they are collapsed into one name on the way in.
 *
 * So a press of Command produces `Cmd+X` first and `Ctrl+X` second: a binding
 * that named Command wins, and one that named Control still answers, which is
 * exactly the behaviour that was there before this existed. A press of Control
 * produces only `Ctrl+X`, because Control is not Command anywhere.
 */
export function chordCandidates(event: KeyChordEventLike): string[] {
  if (MODIFIER_KEYS.has(event.key)) return [];
  const key = keyFromCode(event.code) ?? canonicalKeyName(event.key);
  if (!key) return [];
  const alt = !!event.altKey;
  const shift = !!event.shiftKey;
  if (event.metaKey) {
    const command = composeChord(!!event.ctrlKey, alt, shift, key, true);
    const shared = composeChord(true, alt, shift, key);
    return command === shared ? [shared] : [command, shared];
  }
  return [composeChord(!!event.ctrlKey, alt, shift, key)];
}

/** Canonical chord for typed or stored text such as "ctrl shift p" or "Cmd+/". */
export function parseChord(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const parts = text.trim().split(/[\s+]+/).filter(Boolean);
  if (!parts.length) return null;
  let ctrl = false, alt = false, shift = false, command = false;
  let key: string | null = null;
  for (const part of parts) {
    const token = part.toLowerCase();
    /* `Cmd` names the Command key itself. `Ctrl` keeps meaning "the Control
     * role", which is Command on an Apple keyboard and Control everywhere
     * else — every binding written before Command could be named on its own
     * means that, and has to keep meaning it. */
    if (token === 'cmd' || token === 'command' || token === 'meta' || token === 'super') { command = true; continue; }
    if (token === 'ctrl' || token === 'control') { ctrl = true; continue; }
    if (token === 'alt' || token === 'option' || token === 'opt') { alt = true; continue; }
    if (token === 'shift') { shift = true; continue; }
    if (key !== null) return null;
    key = canonicalKeyName(part);
    if (!key) return null;
  }
  return key ? composeChord(ctrl, alt, shift, key, command) : null;
}

/*
 * Two-stroke sequences, separated by a comma.
 *
 * A comma rather than a space, which is what most editors use, because the
 * single-chord parser above already accepts a space between modifiers — "ctrl
 * shift p" is one chord — so a space cannot also mean "then" without making
 * every existing binding ambiguous.
 */
export const CHORD_SEQUENCE_SEPARATOR = ',';
/** How long a first stroke waits for its second before it is abandoned. */
export const CHORD_SEQUENCE_TIMEOUT_MS = 2000;

/** The strokes of a chord, which is one for all but a sequence. */
export function chordSteps(chord: string | null): string[] {
  return chord ? chord.split(CHORD_SEQUENCE_SEPARATOR).map((step) => step.trim()).filter(Boolean) : [];
}

/**
 * Canonical form of a one- or two-stroke sequence, or null.
 *
 * Two strokes is the limit on purpose: a third is not a shortcut any more, it
 * is a command nobody can remember, and every stroke a sequence adds is a
 * stroke during which the workbench is holding a key press back from whatever
 * else wanted it.
 */
export function parseChordSequence(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const steps = text.split(CHORD_SEQUENCE_SEPARATOR).map((step) => step.trim()).filter(Boolean);
  if (steps.length < 1 || steps.length > 2) return null;
  const parsed = steps.map(parseChord);
  if (parsed.some((step) => step === null)) return null;
  return parsed.join(`${CHORD_SEQUENCE_SEPARATOR} `);
}

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

/** Display form; only the Ctrl role is renamed, the chord itself is unchanged. */
export function formatChord(chord: string | null, platform?: string): string {
  if (!chord) return 'Unbound';
  const apple = APPLE_PLATFORM.test(platform ?? (typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent));
  return apple ? chord.replace(/^Ctrl\+/, 'Cmd+') : chord;
}

/* Chords a mainstream browser normally consumes before the page sees them.
 * They stay assignable, because some browsers and kiosk modes do deliver them,
 * but the interface says which host is likely to win rather than promising
 * capture the product cannot guarantee. */
const BROWSER_RESERVED: Record<string, string> = {
  'Ctrl+N': 'Browsers usually open a new window first.',
  'Ctrl+Shift+N': 'Browsers usually open a private window first.',
  'Ctrl+T': 'Browsers usually open a new tab first.',
  'Ctrl+Shift+T': 'Browsers may reopen the last closed tab first.',
  'Ctrl+W': 'Browsers may close the tab first.',
  'Ctrl+Shift+W': 'Browsers usually close the window first.',
  'Ctrl+Q': 'Some browsers quit the application.',
  'Ctrl+Shift+Q': 'Some browsers quit the application.',
  'Ctrl+Tab': 'Browsers switch tabs first.',
  'Ctrl+Shift+Tab': 'Browsers switch tabs first.',
  'F11': 'Browsers usually toggle full screen first.',
  'Ctrl+Shift+I': 'Browsers usually open developer tools first.',
  'Ctrl+Shift+J': 'Browsers usually open the developer console first.',
  'Alt+F4': 'The operating system closes the window.',
};

/*
 * What the emulated machine does with a chord aimed at the workbench.
 *
 * The emulator runs in its own frame, and while a machine is running its
 * keyboard handler takes every key press: `keyDown` in the pinned jsbeeb's
 * `src/keyboard.js` calls `evt.preventDefault()` before it has looked at any
 * modifier, and then hands the key to the machine as
 * `keyInterface.keyDown(code, evt.shiftKey)` — carrying Shift and nothing
 * else. So a chord pressed while the machine has focus does two things nobody
 * would guess: it does not reach the workbench at all, and the machine
 * receives it as the *unmodified* key. Ctrl+S over a BASIC prompt types S.
 *
 * That is worth saying about every chord rather than about a chosen few,
 * because the surprising part is not which chords collide — they all do — but
 * what the machine types instead. A chord whose key the Acorn keyboard does
 * not have is still swallowed, and saying so is the honest answer.
 *
 * A paused machine takes nothing: the same handler returns early on
 * `!this.running`.
 */
const ACORN_KEY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Enter: 'RETURN', Backspace: 'DELETE', Escape: 'ESCAPE', Space: 'SPACE',
  ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193',
  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6', F7: 'f7', F8: 'f8', F9: 'f9',
  F10: 'f0', F11: 'COPY',
});

export interface EmulatedKeyboardConflict {
  /** What the Acorn keyboard receives, or null when it has no such key. */
  machineKey: string | null;
  note: string;
}

/**
 * What a running machine would do with this chord, in the words a person needs.
 *
 * Reported rather than prevented. A chord that is unusable over a running
 * machine is perfectly usable everywhere else in the workbench, and refusing to
 * assign it would take away a shortcut to solve a problem the person may never
 * have.
 */
export function emulatedKeyboardConflict(chord: string | null): EmulatedKeyboardConflict | null {
  const steps = chordSteps(chord);
  const first = steps[0];
  if (!first) return null;
  const key = first.split('+').pop()!;
  const machineKey = ACORN_KEY_NAMES[key] ?? (/^[A-Z0-9]$/.test(key) ? key : null);
  const swallowed = steps.length > 1
    ? `While the machine is running and has focus, the first stroke of this sequence never reaches the workbench.`
    : 'While the machine is running and has focus, this chord never reaches the workbench.';
  return {
    machineKey,
    note: machineKey === null
      ? `${swallowed} The machine takes the key and does nothing with it, because the Acorn keyboard has no ${key}.`
      : `${swallowed} The machine receives ${machineKey} instead — modifiers other than Shift are not passed on — so this types ${machineKey} into whatever is running.`,
  };
}

export function browserReservedNote(chord: string | null): string | null {
  return chord ? BROWSER_RESERVED[chord] ?? null : null;
}

/** Rejects chords that would swallow ordinary typing or cannot be represented. */
export function chordAssignmentError(chord: string | null): string | null {
  if (!chord) return null;
  const canonical = parseChordSequence(chord);
  if (!canonical || canonical !== chord) return 'Enter a supported key with Ctrl, Alt or a function key.';
  const steps = chordSteps(canonical);
  if (steps.length > 2) return 'A sequence is at most two strokes; a third is not a shortcut any more.';
  for (const [index, step] of steps.entries()) {
    const key = step.split('+').pop()!;
    const hasCtrl = step.includes('Ctrl+') || step.includes('Cmd+');
    const hasAlt = step.includes('Alt+');
    const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key);
    /* Only the first stroke has to keep clear of ordinary typing. A second
     * stroke is only ever read while a prefix is held open, so a bare letter
     * there captures nothing — which is what makes a sequence worth having. */
    if (index === 0 && !hasCtrl && !hasAlt && !isFunctionKey) return 'Use Ctrl, Alt or a function key so the chord cannot capture ordinary typing.';
    if (key === 'Tab' && (hasCtrl || hasAlt)) return 'Tab chords are reserved for focus movement.';
  }
  return null;
}

/* The complete dispatched inventory. Every entry is handled by real code in the
 * workbench window handler or the source-editor handler. */
export const DEFAULT_KEY_BINDINGS: readonly KeyBindingDefinition[] = Object.freeze([
  { id: 'workbench.palette.f1', commandId: 'palette-open', label: 'Open command palette', category: 'Workbench', scope: 'workbench', defaultChord: 'F1' },
  { id: 'workbench.palette.chord', commandId: 'palette-open', label: 'Open command palette (alternate)', category: 'Workbench', scope: 'workbench', defaultChord: 'Ctrl+Shift+P' },
  { id: 'workbench.file-save', commandId: 'file-save', label: 'Save current source in browser', category: 'File', scope: 'workbench', defaultChord: 'Ctrl+S' },
  { id: 'workbench.project-save-all', commandId: 'project-save-all', label: 'Save all project files in browser', category: 'Project', scope: 'workbench', defaultChord: 'Ctrl+Shift+S' },
  { id: 'workbench.file-close-editor', commandId: 'file-close-editor', label: 'Close current source editor', category: 'File', scope: 'workbench', defaultChord: 'Ctrl+W' },
  { id: 'workbench.file-reopen-editor', commandId: 'file-reopen-editor', label: 'Reopen recently closed source editor', category: 'File', scope: 'workbench', defaultChord: 'Ctrl+Shift+T' },
  { id: 'workbench.file-revert-editor', commandId: 'file-revert-editor', label: 'Revert current source to last save', category: 'File', scope: 'workbench', defaultChord: 'Ctrl+Alt+R' },
  { id: 'workbench.editor-search-project', commandId: 'editor-search-project', label: 'Search and replace project', category: 'Editor', scope: 'workbench', defaultChord: 'Ctrl+Shift+F' },
  { id: 'workbench.editor-go-line', commandId: 'editor-go-line', label: 'Go to line or project symbol', category: 'Editor', scope: 'workbench', defaultChord: 'Ctrl+G' },
  { id: 'workbench.build-active', commandId: 'build-active', label: 'Build selected target', category: 'Build', scope: 'workbench', defaultChord: 'F7' },
  { id: 'workbench.run-active', commandId: 'run-active', label: 'Build and run selected target', category: 'Run', scope: 'workbench', defaultChord: 'F5' },
  { id: 'workbench.debug-active', commandId: 'debug-active', label: 'Build and debug selected target', category: 'Debug', scope: 'workbench', defaultChord: 'Shift+F5' },
  { id: 'workbench.debug-restart', commandId: 'debug-restart', label: 'Debugger: restart bound machine', category: 'Debug', scope: 'workbench', defaultChord: 'Ctrl+F5' },
  { id: 'workbench.debug-pause', commandId: 'debug-pause', label: 'Debugger: pause', category: 'Debug', scope: 'workbench', defaultChord: 'F6' },
  { id: 'workbench.debug-stop', commandId: 'debug-stop', label: 'Debugger: stop session', category: 'Debug', scope: 'workbench', defaultChord: 'Shift+F6' },
  { id: 'workbench.debug-step-instruction', commandId: 'debug-step-instruction', label: 'Debugger: step one instruction', category: 'Debug', scope: 'workbench', defaultChord: 'Alt+F11' },
  { id: 'workbench.debug-step-source-in', commandId: 'debug-step-source-in', label: 'Debugger: source step into', category: 'Debug', scope: 'workbench', defaultChord: 'F11' },
  { id: 'workbench.debug-step-source-over', commandId: 'debug-step-source-over', label: 'Debugger: source step over', category: 'Debug', scope: 'workbench', defaultChord: 'F10' },
  { id: 'workbench.debug-step-source-out', commandId: 'debug-step-source-out', label: 'Debugger: source step out', category: 'Debug', scope: 'workbench', defaultChord: 'Shift+F11' },
  { id: 'workbench.debug-run-cursor', commandId: 'debug-run-cursor', label: 'Debugger: run to cursor', category: 'Debug', scope: 'workbench', defaultChord: 'Ctrl+F10' },

  { id: 'editor.save', commandId: 'editor-save', label: 'Save current source', category: 'File', scope: 'editor', defaultChord: 'Ctrl+S' },
  { id: 'editor.save-all', commandId: 'editor-save-all', label: 'Save all project files', category: 'File', scope: 'editor', defaultChord: 'Ctrl+Shift+S' },
  { id: 'editor.close', commandId: 'editor-close', label: 'Close editor', category: 'File', scope: 'editor', defaultChord: 'Ctrl+W' },
  { id: 'editor.reopen-closed', commandId: 'editor-reopen-closed', label: 'Reopen closed editor', category: 'File', scope: 'editor', defaultChord: 'Ctrl+Shift+T' },
  { id: 'editor.revert', commandId: 'editor-revert', label: 'Revert to last save', category: 'File', scope: 'editor', defaultChord: 'Ctrl+Alt+R' },
  { id: 'editor.split-toggle', commandId: 'editor-split-toggle', label: 'Split or close split view', category: 'View', scope: 'editor', defaultChord: 'Ctrl+\\' },
  { id: 'editor.find', commandId: 'editor-find', label: 'Find in current file', category: 'Editor', scope: 'editor', defaultChord: 'Ctrl+F' },
  { id: 'editor.replace', commandId: 'editor-replace', label: 'Replace in current file', category: 'Editor', scope: 'editor', defaultChord: 'Ctrl+H' },
  { id: 'editor.completion', commandId: 'editor-completion', label: 'Request completion', category: 'Assistance', scope: 'editor', defaultChord: 'Ctrl+Space' },
  { id: 'editor.signature-help', commandId: 'editor-signature-help', label: 'Request signature help', category: 'Assistance', scope: 'editor', defaultChord: 'Ctrl+Shift+Space' },
  { id: 'editor.goto-definition', commandId: 'editor-goto-definition', label: 'Go to definition', category: 'Navigation', scope: 'editor', defaultChord: 'F12' },
  { id: 'editor.goto-declaration', commandId: 'editor-goto-declaration', label: 'Go to declaration', category: 'Navigation', scope: 'editor', defaultChord: 'Ctrl+F12' },
  { id: 'editor.goto-implementation', commandId: 'editor-goto-implementation', label: 'Go to implementation', category: 'Navigation', scope: 'editor', defaultChord: 'Ctrl+Shift+F12' },
  { id: 'editor.goto-type-definition', commandId: 'editor-goto-type-definition', label: 'Go to type definition', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+F12' },
  { id: 'editor.find-references', commandId: 'editor-find-references', label: 'Find references', category: 'Navigation', scope: 'editor', defaultChord: 'Shift+F12' },
  { id: 'editor.call-hierarchy', commandId: 'editor-call-hierarchy', label: 'Show call hierarchy', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+Shift+H' },
  { id: 'editor.navigate-back', commandId: 'editor-navigate-back', label: 'Navigate back', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+ArrowLeft' },
  { id: 'editor.navigate-forward', commandId: 'editor-navigate-forward', label: 'Navigate forward', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+ArrowRight' },
  { id: 'editor.diagnostic-next', commandId: 'editor-diagnostic-next', label: 'Next diagnostic', category: 'Navigation', scope: 'editor', defaultChord: 'F8' },
  { id: 'editor.diagnostic-previous', commandId: 'editor-diagnostic-previous', label: 'Previous diagnostic', category: 'Navigation', scope: 'editor', defaultChord: 'Shift+F8' },
  { id: 'editor.change-next', commandId: 'editor-change-next', label: 'Next saved change', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+F8' },
  { id: 'editor.change-previous', commandId: 'editor-change-previous', label: 'Previous saved change', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+Shift+F8' },
  { id: 'editor.enclosing-start', commandId: 'editor-enclosing-start', label: 'Go to enclosing range start', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+[' },
  { id: 'editor.enclosing-end', commandId: 'editor-enclosing-end', label: 'Go to enclosing range end', category: 'Navigation', scope: 'editor', defaultChord: 'Alt+]' },
  { id: 'editor.bookmark-toggle', commandId: 'editor-bookmark-toggle', label: 'Toggle source bookmark', category: 'Navigation', scope: 'editor', defaultChord: 'Ctrl+Alt+B' },
  { id: 'editor.bookmark-previous', commandId: 'editor-bookmark-previous', label: 'Previous source bookmark', category: 'Navigation', scope: 'editor', defaultChord: 'Ctrl+Alt+PageUp' },
  { id: 'editor.bookmark-next', commandId: 'editor-bookmark-next', label: 'Next source bookmark', category: 'Navigation', scope: 'editor', defaultChord: 'Ctrl+Alt+PageDown' },
  { id: 'editor.undo', commandId: 'editor-undo', label: 'Undo editor command', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Z', note: 'Falls through to the browser text undo when no command history remains.' },
  { id: 'editor.redo', commandId: 'editor-redo', label: 'Redo editor command', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Y' },
  { id: 'editor.redo-alternate', commandId: 'editor-redo', label: 'Redo editor command (alternate)', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Shift+Z' },
  { id: 'editor.toggle-comment', commandId: 'editor-toggle-comment', label: 'Toggle line comment', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+/' },
  { id: 'editor.toggle-block-comment', commandId: 'editor-toggle-block-comment', label: 'Toggle block comment', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Shift+/' },
  { id: 'editor.split-line', commandId: 'editor-split-line', label: 'Split line at caret', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Shift+Enter' },
  { id: 'editor.join-lines', commandId: 'editor-join-lines', label: 'Join lines', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+J' },
  { id: 'editor.duplicate-lines', commandId: 'editor-duplicate-lines', label: 'Duplicate lines', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Shift+D' },
  { id: 'editor.delete-lines', commandId: 'editor-delete-lines', label: 'Delete lines', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Shift+K' },
  { id: 'editor.move-lines-up', commandId: 'editor-move-lines-up', label: 'Move lines up', category: 'Edit', scope: 'editor', defaultChord: 'Alt+ArrowUp' },
  { id: 'editor.move-lines-down', commandId: 'editor-move-lines-down', label: 'Move lines down', category: 'Edit', scope: 'editor', defaultChord: 'Alt+ArrowDown' },
  { id: 'editor.tabs-to-spaces', commandId: 'editor-tabs-to-spaces', label: 'Convert tabs to spaces', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Alt+T' },
  { id: 'editor.uppercase', commandId: 'editor-uppercase', label: 'Convert selection to upper case', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Alt+U' },
  { id: 'editor.lowercase', commandId: 'editor-lowercase', label: 'Convert selection to lower case', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Alt+L' },
  { id: 'editor.trim-trailing', commandId: 'editor-trim-trailing', label: 'Trim trailing whitespace', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Alt+W' },
  { id: 'editor.format-selection', commandId: 'editor-format-selection', label: 'Format selection', category: 'Edit', scope: 'editor', defaultChord: 'Ctrl+Alt+F' },
  { id: 'editor.format-document', commandId: 'editor-format-document', label: 'Format document', category: 'Edit', scope: 'editor', defaultChord: 'Alt+Shift+F' },
]);

export function normalizeKeyBindingOverrides(value: unknown, definitions: readonly KeyBindingDefinition[] = DEFAULT_KEY_BINDINGS): KeyBindingOverrides {
  const known = new Map(definitions.map((definition) => [definition.id, definition]));
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? ((value as { overrides?: unknown }).overrides ?? value)
    : null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const overrides: KeyBindingOverrides = {};
  for (const [id, raw] of Object.entries(source as Record<string, unknown>)) {
    const definition = known.get(id);
    if (!definition) continue;
    if (raw === null) { overrides[id] = null; continue; }
    const chord = parseChordSequence(raw);
    if (!chord || chordAssignmentError(chord)) continue;
    if (chord === definition.defaultChord) continue;
    overrides[id] = chord;
  }
  return overrides;
}

export function resolveKeyBindings(overrides: KeyBindingOverrides = {}, definitions: readonly KeyBindingDefinition[] = DEFAULT_KEY_BINDINGS): ResolvedKeyBinding[] {
  const safe = normalizeKeyBindingOverrides(overrides, definitions);
  const resolved = definitions.map((definition) => {
    const override = Object.prototype.hasOwnProperty.call(safe, definition.id) ? safe[definition.id]! : undefined;
    const chord = override === undefined ? definition.defaultChord : override;
    return {
      ...definition,
      chord,
      source: override === undefined ? 'default' : chord === null ? 'unbound' : 'custom',
      conflicts: [] as string[],
      shadows: [] as string[],
      browserReserved: !!browserReservedNote(chord),
    } satisfies ResolvedKeyBinding;
  });
  for (const binding of resolved) {
    if (!binding.chord) continue;
    binding.conflicts = resolved
      .filter((other) => other !== binding && other.scope === binding.scope && other.chord === binding.chord && other.commandId !== binding.commandId)
      .map((other) => other.id);
    if (binding.scope === 'editor') {
      binding.shadows = resolved
        .filter((other) => other.scope === 'workbench' && other.chord === binding.chord)
        .map((other) => other.id);
    }
  }
  return resolved;
}

/** Chord to command lookup for one scope. Editor bindings win inside the editor. */
export function keyBindingLookup(resolved: readonly ResolvedKeyBinding[], scope: BindingScope): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const binding of resolved) {
    if (binding.scope !== scope || !binding.chord) continue;
    if (!lookup.has(binding.chord)) lookup.set(binding.chord, binding.commandId);
  }
  return lookup;
}

/** First strokes that begin a two-stroke sequence in one scope. */
export function chordPrefixes(resolved: readonly ResolvedKeyBinding[], scope: BindingScope): Set<string> {
  const prefixes = new Set<string>();
  for (const binding of resolved) {
    const steps = chordSteps(binding.scope === scope ? binding.chord : null);
    if (steps.length === 2) prefixes.add(steps[0]!);
  }
  return prefixes;
}

export type KeyBindingMatch =
  | { kind: 'command'; commandId: string; chord: string }
  /* The first stroke of a sequence landed. The dispatcher holds it, and the
   * next key press either completes a binding or cancels — a held prefix that
   * swallowed unrelated keys forever would be worse than no sequences. */
  | { kind: 'pending'; chord: string }
  | { kind: 'none' };

/**
 * What one key press means, given what was pressed before it.
 *
 * `candidates` is what `chordCandidates` returned, so a binding that named
 * Command is preferred over one that named the shared Control role.
 */
export function matchKeyBinding(
  lookup: ReadonlyMap<string, string>,
  prefixes: ReadonlySet<string>,
  candidates: readonly string[],
  pending: string | null = null,
): KeyBindingMatch {
  for (const candidate of candidates) {
    if (pending) {
      const sequence = `${pending}${CHORD_SEQUENCE_SEPARATOR} ${candidate}`;
      const commandId = lookup.get(sequence);
      if (commandId) return { kind: 'command', commandId, chord: sequence };
    }
  }
  /* A pending prefix is spent by the press that follows it, whether or not
   * that press completed anything. Otherwise a mistyped second stroke would
   * leave the prefix open and the next unrelated key would complete it. */
  if (pending) return { kind: 'none' };
  for (const candidate of candidates) {
    const commandId = lookup.get(candidate);
    if (commandId) return { kind: 'command', commandId, chord: candidate };
    if (prefixes.has(candidate)) return { kind: 'pending', chord: candidate };
  }
  return { kind: 'none' };
}

/** Space-separated `aria-keyshortcuts` value for one scope, in ARIA key names. */
export function ariaKeyShortcuts(resolved: readonly ResolvedKeyBinding[], scope: BindingScope): string {
  const seen = new Set<string>();
  for (const binding of resolved) {
    if (binding.scope !== scope || !binding.chord) continue;
    /* ARIA has no notation for a two-stroke sequence, so only the strokes a
     * browser could announce are listed; a sequence would otherwise be
     * advertised as a chord that does nothing on its own. */
    if (chordSteps(binding.chord).length > 1) continue;
    seen.add(binding.chord.replace(/^Ctrl\+/, 'Control+').replace(/^Cmd\+/, 'Meta+'));
  }
  return [...seen].join(' ');
}

export function readKeyBindingOverrides(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): KeyBindingOverrides {
  if (!storage) return {};
  try { return normalizeKeyBindingOverrides(JSON.parse(storage.getItem(KEY_BINDINGS_STORAGE_KEY) ?? 'null')); }
  catch { return {}; }
}

export function writeKeyBindingOverrides(overrides: KeyBindingOverrides, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): boolean {
  if (!storage) return false;
  try { storage.setItem(KEY_BINDINGS_STORAGE_KEY, JSON.stringify({ version: 1, overrides: normalizeKeyBindingOverrides(overrides) })); return true; }
  catch { return false; }
}
