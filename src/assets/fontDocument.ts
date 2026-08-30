/* Versioned, editable character-set documents.
 *
 * A BBC user-defined character is eight bytes, one per pixel row, most
 * significant bit leftmost. VDU 23 installs one at a chosen character code, and
 * codes 224 to 255 are the ones the machine reserves for user definitions with
 * no extra memory claim.
 *
 * This build does not ship the machine's own character ROM, so a code this
 * document does not define cannot be previewed. The preview reports those codes
 * as undefined rather than drawing a substitute shape and calling it the
 * machine's font. */
import { sha256Hex } from '../build/digest';

export const FONT_SCHEMA = '8bit-net.font' as const;

export const GLYPH_ROWS = 8;
export const GLYPH_COLUMNS = 8;
export const FIRST_DEFINABLE_CODE = 32;
export const LAST_DEFINABLE_CODE = 255;
/** Codes the BBC reserves for user-defined characters without extra memory. */
export const FIRST_RESERVED_UDG_CODE = 224;
export const MAX_GLYPHS = 224;

export interface FontGlyph {
  /** Character code this glyph is installed at. */
  code: number;
  /** Eight rows, most significant bit leftmost. */
  rows: number[];
}

export interface FontDocument {
  schema: typeof FONT_SCHEMA;
  version: 1;
  name: string;
  glyphs: FontGlyph[];
  /** Sample text the editor previews with, stored with the document. */
  sampleText: string;
  extensions: Record<string, unknown>;
}

export function emptyGlyphRows(): number[] {
  return Array(GLYPH_ROWS).fill(0);
}

export function createFontDocument(name = 'untitled-font'): FontDocument {
  return {
    schema: FONT_SCHEMA,
    version: 1,
    name,
    glyphs: [{ code: FIRST_RESERVED_UDG_CODE, rows: emptyGlyphRows() }],
    sampleText: String.fromCharCode(FIRST_RESERVED_UDG_CODE),
    extensions: {},
  };
}

function glyphCode(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < FIRST_DEFINABLE_CODE || (value as number) > LAST_DEFINABLE_CODE) {
    throw new Error(`A character code must be a whole number from ${FIRST_DEFINABLE_CODE} to ${LAST_DEFINABLE_CODE}`);
  }
  return value as number;
}

export function parseFontDocument(value: string | unknown): FontDocument {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Font document must be a JSON object');
  if (parsed.schema !== FONT_SCHEMA || parsed.version !== 1) throw new Error('Unsupported font schema or version');
  if (typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 80) throw new Error('Font name must contain 1 to 80 characters');
  const source = Array.isArray(parsed.glyphs) ? parsed.glyphs : [];
  if (!source.length) throw new Error('A font must define at least one character');
  if (source.length > MAX_GLYPHS) throw new Error(`A font is limited to ${MAX_GLYPHS} characters`);
  const seen = new Set<number>();
  const glyphs: FontGlyph[] = source.map((candidate) => {
    const glyph = candidate as Partial<FontGlyph>;
    const code = glyphCode(glyph.code);
    if (seen.has(code)) throw new Error(`Character code ${code} is defined twice`);
    seen.add(code);
    if (!Array.isArray(glyph.rows) || glyph.rows.length !== GLYPH_ROWS) throw new Error(`Character ${code} must contain exactly ${GLYPH_ROWS} rows`);
    const rows = glyph.rows.map((row) => {
      if (!Number.isInteger(row) || (row as number) < 0 || (row as number) > 255) throw new Error(`Character ${code} has a row that is not a byte`);
      return row as number;
    });
    return { code, rows };
  }).sort((left, right) => left.code - right.code);
  const sampleText = typeof parsed.sampleText === 'string' ? parsed.sampleText.slice(0, 240) : '';
  const extensions = parsed.extensions && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions) ? parsed.extensions as Record<string, unknown> : {};
  return { schema: FONT_SCHEMA, version: 1, name: parsed.name.trim(), glyphs, sampleText, extensions };
}

export function serializeFontDocument(document: FontDocument): string {
  return `${JSON.stringify(parseFontDocument(document), null, 2)}\n`;
}

/* ---- editing ------------------------------------------------------------- */

export function glyphAt(document: FontDocument, code: number): FontGlyph | undefined {
  return document.glyphs.find((glyph) => glyph.code === code);
}

/** Read a glyph as one boolean per pixel, row by row. */
export function glyphPixels(glyph: FontGlyph): boolean[] {
  return glyph.rows.flatMap((row) => Array.from({ length: GLYPH_COLUMNS }, (_, column) => ((row >> (7 - column)) & 1) === 1));
}

export function setGlyphPixel(document: FontDocument, code: number, x: number, y: number, on: boolean): FontDocument {
  const validated = parseFontDocument(document);
  const glyph = glyphAt(validated, code);
  if (!glyph) throw new Error(`This font does not define character ${code}`);
  if (!Number.isInteger(x) || x < 0 || x >= GLYPH_COLUMNS || !Number.isInteger(y) || y < 0 || y >= GLYPH_ROWS) throw new Error('That pixel is outside the character');
  const rows = [...glyph.rows];
  const mask = 1 << (7 - x);
  rows[y] = on ? (rows[y]! | mask) : (rows[y]! & ~mask & 0xff);
  return parseFontDocument({ ...validated, glyphs: validated.glyphs.map((candidate) => candidate.code === code ? { code, rows } : candidate) });
}

export function addGlyph(document: FontDocument, code: number): FontDocument {
  const validated = parseFontDocument(document);
  if (glyphAt(validated, code)) throw new Error(`Character ${code} is already defined`);
  return parseFontDocument({ ...validated, glyphs: [...validated.glyphs, { code: glyphCode(code), rows: emptyGlyphRows() }] });
}

export function removeGlyph(document: FontDocument, code: number): FontDocument {
  const validated = parseFontDocument(document);
  if (validated.glyphs.length === 1) throw new Error('A font must retain at least one character');
  if (!glyphAt(validated, code)) throw new Error(`This font does not define character ${code}`);
  return parseFontDocument({ ...validated, glyphs: validated.glyphs.filter((glyph) => glyph.code !== code) });
}

export function clearGlyph(document: FontDocument, code: number): FontDocument {
  const validated = parseFontDocument(document);
  if (!glyphAt(validated, code)) throw new Error(`This font does not define character ${code}`);
  return parseFontDocument({ ...validated, glyphs: validated.glyphs.map((glyph) => glyph.code === code ? { code, rows: emptyGlyphRows() } : glyph) });
}

export type GlyphTransform = 'flip-horizontal' | 'flip-vertical' | 'rotate-right' | 'invert' | 'shift-left' | 'shift-right' | 'shift-up' | 'shift-down';

export function transformGlyph(document: FontDocument, code: number, transform: GlyphTransform): FontDocument {
  const validated = parseFontDocument(document);
  const glyph = glyphAt(validated, code);
  if (!glyph) throw new Error(`This font does not define character ${code}`);
  const rows = glyph.rows;
  const reverseBits = (row: number) => Array.from({ length: 8 }, (_, bit) => ((row >> bit) & 1) << (7 - bit)).reduce((total, bit) => total | bit, 0);
  const next = transform === 'flip-horizontal' ? rows.map(reverseBits)
    : transform === 'flip-vertical' ? [...rows].reverse()
    : transform === 'invert' ? rows.map((row) => ~row & 0xff)
    : transform === 'shift-left' ? rows.map((row) => (row << 1) & 0xff)
    : transform === 'shift-right' ? rows.map((row) => (row >> 1) & 0xff)
    : transform === 'shift-up' ? [...rows.slice(1), 0]
    : transform === 'shift-down' ? [0, ...rows.slice(0, -1)]
    /* Rotating right turns column x into row x, reading the source bottom-up. */
    : Array.from({ length: GLYPH_ROWS }, (_, y) => Array.from({ length: GLYPH_COLUMNS }, (_, x) =>
        (((rows[GLYPH_ROWS - 1 - x]! >> (7 - y)) & 1) << (7 - x))).reduce((total, bit) => total | bit, 0));
  return parseFontDocument({ ...validated, glyphs: validated.glyphs.map((candidate) => candidate.code === code ? { code, rows: next } : candidate) });
}

export function setSampleText(document: FontDocument, text: string): FontDocument {
  return parseFontDocument({ ...parseFontDocument(document), sampleText: text.slice(0, 240) });
}

/* ---- preview ------------------------------------------------------------- */

export interface PreviewCharacter {
  code: number;
  /** The pixels to draw, or null when this font does not define the code. */
  pixels: boolean[] | null;
}

/**
 * Resolve a sample string to previewable characters.
 *
 * A code the font does not define resolves to null. The machine's own character
 * ROM is not shipped with this build, so drawing a stand-in for those codes
 * would be inventing the machine's font.
 */
export function previewCharacters(document: FontDocument, text = document.sampleText): PreviewCharacter[] {
  return Array.from(text).map((character) => {
    const code = character.charCodeAt(0);
    const glyph = glyphAt(document, code);
    return { code, pixels: glyph ? glyphPixels(glyph) : null };
  });
}

export interface FontOutput {
  /** The VDU byte stream: for each glyph, 23, code and its eight rows. */
  bytes: Uint8Array;
  assembly: string;
  basic: string;
  manifest: {
    schema: '8bit-net.generated-font';
    version: 1;
    sourceSchema: typeof FONT_SCHEMA;
    sourceVersion: 1;
    name: string;
    glyphCount: number;
    codes: number[];
    /** Defined codes outside the range the machine reserves for user characters. */
    codesOutsideReservedRange: number[];
    byteLength: number;
    sha256: string;
  };
}

export function fontLabel(name: string): string {
  return `font_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
}

export function generateFontOutput(document: FontDocument): FontOutput {
  const validated = parseFontDocument(document);
  const bytes = Uint8Array.from(validated.glyphs.flatMap((glyph) => [23, glyph.code, ...glyph.rows]));
  const label = fontLabel(validated.name);
  const assembly = [
    `; Generated character set ${validated.name} · ${validated.glyphs.length} character(s)`,
    `; ${bytes.length} VDU bytes · SHA-256 ${sha256Hex(bytes)}`,
    '; Send these bytes through OSWRCH to install the characters.',
    `.${label}`,
    ...validated.glyphs.map((glyph) => `EQUB 23, ${glyph.code}, ${glyph.rows.map((row) => `&${row.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`),
    `.${label}_end`,
  ].join('\n');
  const basic = validated.glyphs.map((glyph) => `VDU 23,${glyph.code},${glyph.rows.join(',')}`).join('\n');
  return {
    bytes,
    assembly,
    basic,
    manifest: {
      schema: '8bit-net.generated-font',
      version: 1,
      sourceSchema: FONT_SCHEMA,
      sourceVersion: 1,
      name: validated.name,
      glyphCount: validated.glyphs.length,
      codes: validated.glyphs.map((glyph) => glyph.code),
      codesOutsideReservedRange: validated.glyphs.map((glyph) => glyph.code).filter((code) => code < FIRST_RESERVED_UDG_CODE),
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
    },
  };
}
