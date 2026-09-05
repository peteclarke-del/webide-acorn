import { FONT_SCHEMA } from '../assets/fontDocument';
import { PIXEL_ASSET_SCHEMA } from '../assets/pixelAssetDocument';
import { PALETTE_SCHEMA } from '../assets/paletteDocument';
import { SCREEN_SCHEMA } from '../assets/screenDocument';
import { SONG_SCHEMA } from '../assets/songDocument';
import { TILE_MAP_SCHEMA } from '../assets/tileMapDocument';
import { VIDC_SAMPLE_SCHEMA } from '../assets/vidcSampleDocument';
import type { ProjectFile } from './project';

/*
 * The editable documents a project holds, offered to the editor that can open
 * them.
 *
 * Every asset editor could open a document from disk and none of them could
 * open one from the project it was sitting in. That is a strange thing to
 * discover after importing a codebase and being told twenty-seven sprites were
 * recovered from it: the documents exist, in the file tree, and the sprite
 * editor still starts on an empty untitled one with a file dialog as the only
 * way to reach them.
 *
 * The kind is read from the document itself rather than guessed from its name,
 * because a name is a convention and the schema is a fact. The name is used
 * only to find the candidates cheaply.
 */

export type ProjectDocumentKind =
  | 'character' | 'sprite' | 'tile'
  | 'map' | 'screen' | 'font' | 'palette' | 'song' | 'sample';

export interface ProjectDocument {
  /** The project file's own id, which is what opening one needs. */
  id: string;
  name: string;
  kind: ProjectDocumentKind;
  /** What it is, in the words the editor's own summary would use. */
  detail: string;
}

/*
 * The schema each editable document actually carries.
 *
 * These were written out as string literals and every one of them was the
 * wrong string: `8bit-net.generated-map` is the manifest a build emits, not the
 * map somebody edits, and the same was true of all six. So a project could hold
 * sixty-one maps and a screen and the editors that open them offered nothing,
 * while the sprite editor worked because its one literal happened to be right.
 * They are imported now, so the mapping cannot drift from the documents again.
 */
const SCHEMA_KINDS: Record<string, ProjectDocumentKind> = {
  [TILE_MAP_SCHEMA]: 'map',
  [SCREEN_SCHEMA]: 'screen',
  [FONT_SCHEMA]: 'font',
  [PALETTE_SCHEMA]: 'palette',
  [SONG_SCHEMA]: 'song',
  [VIDC_SAMPLE_SCHEMA]: 'sample',
};

const PIXEL_KINDS = new Set<ProjectDocumentKind>(['character', 'sprite', 'tile']);

function described(kind: ProjectDocumentKind, parsed: Record<string, unknown>): string {
  const width = typeof parsed.width === 'number' ? parsed.width : null;
  const height = typeof parsed.height === 'number' ? parsed.height : null;
  const size = width !== null && height !== null ? `${width}×${height}` : '';
  if (PIXEL_KINDS.has(kind)) {
    const frames = Array.isArray((parsed.sprite as { frames?: unknown[] } | undefined)?.frames)
      ? (parsed.sprite as { frames: unknown[] }).frames.length
      : 0;
    return [size, frames > 1 ? `${frames} frames` : ''].filter(Boolean).join(' · ');
  }
  /*
   * Nothing else in this list carries a width and a height, so before this each
   * of them was offered with an empty description and two documents of the same
   * kind could only be told apart by their filenames. Each says the one thing
   * that distinguishes it from its neighbours.
   */
  const mode = typeof parsed.mode === 'string' ? parsed.mode.replace(/^bbc-mode-/, 'MODE ') : '';
  if (kind === 'screen') return mode;
  if (kind === 'palette') {
    const entries = Array.isArray(parsed.entries) ? parsed.entries.length : 0;
    return [mode, entries ? `${entries} colours` : ''].filter(Boolean).join(' · ');
  }
  if (kind === 'font') {
    const glyphs = Array.isArray(parsed.glyphs) ? parsed.glyphs.length : 0;
    return glyphs ? `${glyphs} glyph${glyphs === 1 ? '' : 's'}` : '';
  }
  if (kind === 'song') {
    const rows = Array.isArray(parsed.rows) ? parsed.rows.length : 0;
    const target = typeof parsed.target === 'string' ? parsed.target : '';
    return [target, rows ? `${rows} row${rows === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  }
  if (kind === 'sample') {
    const period = typeof parsed.periodMicroseconds === 'number' ? parsed.periodMicroseconds : 0;
    const channels = typeof parsed.channelMode === 'string' ? parsed.channelMode : '';
    return [channels, period ? `${period} µs` : ''].filter(Boolean).join(' · ');
  }
  return size;
}

/**
 * Every document in the project, or only those of the kinds asked for.
 *
 * A file that carries one of these schemas but cannot be parsed is left out
 * rather than offered: an editor cannot open it, and listing it would promise
 * something that does not work.
 */
export function projectDocuments(files: readonly ProjectFile[], kinds?: readonly ProjectDocumentKind[]): ProjectDocument[] {
  const wanted = kinds ? new Set(kinds) : null;
  const documents: ProjectDocument[] = [];
  for (const file of files) {
    if (!/\.json$/i.test(file.name)) continue;
    let parsed: Record<string, unknown>;
    try {
      const candidate: unknown = JSON.parse(file.content);
      if (!candidate || typeof candidate !== 'object') continue;
      parsed = candidate as Record<string, unknown>;
    } catch { continue; }
    const schema = typeof parsed.schema === 'string' ? parsed.schema : '';
    let kind: ProjectDocumentKind | undefined;
    if (schema === PIXEL_ASSET_SCHEMA) {
      const declared = typeof parsed.kind === 'string' ? parsed.kind : '';
      if (declared === 'character' || declared === 'sprite' || declared === 'tile') kind = declared;
    } else {
      kind = SCHEMA_KINDS[schema];
    }
    if (!kind || (wanted && !wanted.has(kind))) continue;
    documents.push({ id: file.id, name: file.name, kind, detail: described(kind, parsed) });
  }
  return documents.sort((left, right) => left.name.localeCompare(right.name));
}
