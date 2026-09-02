export interface EditorPreferences {
  fontSize: number;
  lineHeight: number;
  tabSize: 2 | 4 | 8;
  wordWrap: boolean;
  /*
   * Whether authoritative type hints are decorated beside the source as well as
   * listed in their panel. Off by default, because a decoration nobody asked
   * for is clutter in a column somebody is reading code in.
   */
  inlayHints: boolean;
}

/* The code column is the text somebody reads most and for longest, so its
 * default matches the interface floor in `src/theme.css` rather than sitting
 * below it, and the range reaches far enough up to suit poor eyesight. */
export const DEFAULT_EDITOR_PREFERENCES: Readonly<EditorPreferences> = Object.freeze({ fontSize: 15, lineHeight: 26, tabSize: 2, wordWrap: false, inlayHints: false });
export const EDITOR_PREFERENCES_KEY = '8bit-net-dev-editor-preferences-1';

export function normalizeEditorPreferences(value: unknown): EditorPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_EDITOR_PREFERENCES };
  const candidate = value as Partial<EditorPreferences>;
  const fontSize = Number.isInteger(candidate.fontSize) && candidate.fontSize! >= 12 && candidate.fontSize! <= 24 ? candidate.fontSize! : DEFAULT_EDITOR_PREFERENCES.fontSize;
  const lineHeight = Number.isInteger(candidate.lineHeight) && candidate.lineHeight! >= Math.max(16, fontSize + 4) && candidate.lineHeight! <= 44 ? candidate.lineHeight! : Math.max(DEFAULT_EDITOR_PREFERENCES.lineHeight, fontSize + 4);
  const tabSize = candidate.tabSize === 2 || candidate.tabSize === 4 || candidate.tabSize === 8 ? candidate.tabSize : DEFAULT_EDITOR_PREFERENCES.tabSize;
  return { fontSize, lineHeight, tabSize, wordWrap: candidate.wordWrap === true, inlayHints: candidate.inlayHints === true };
}

export function readEditorPreferences(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): EditorPreferences {
  if (!storage) return { ...DEFAULT_EDITOR_PREFERENCES };
  try { return normalizeEditorPreferences(JSON.parse(storage.getItem(EDITOR_PREFERENCES_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_EDITOR_PREFERENCES }; }
}

export function writeEditorPreferences(preferences: EditorPreferences, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {
  if (!storage) return false;
  try { storage.setItem(EDITOR_PREFERENCES_KEY, JSON.stringify(normalizeEditorPreferences(preferences))); return true; }
  catch { return false; }
}
