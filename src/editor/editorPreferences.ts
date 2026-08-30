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

export const DEFAULT_EDITOR_PREFERENCES: Readonly<EditorPreferences> = Object.freeze({ fontSize: 11, lineHeight: 22, tabSize: 2, wordWrap: false, inlayHints: false });
export const EDITOR_PREFERENCES_KEY = '8bit-net-dev-editor-preferences-1';

export function normalizeEditorPreferences(value: unknown): EditorPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_EDITOR_PREFERENCES };
  const candidate = value as Partial<EditorPreferences>;
  const fontSize = Number.isInteger(candidate.fontSize) && candidate.fontSize! >= 10 && candidate.fontSize! <= 18 ? candidate.fontSize! : DEFAULT_EDITOR_PREFERENCES.fontSize;
  const lineHeight = Number.isInteger(candidate.lineHeight) && candidate.lineHeight! >= Math.max(16, fontSize + 4) && candidate.lineHeight! <= 36 ? candidate.lineHeight! : Math.max(DEFAULT_EDITOR_PREFERENCES.lineHeight, fontSize + 4);
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
