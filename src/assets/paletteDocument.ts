/* Versioned, editable palette documents and the shared project palette.
 *
 * A BBC display mode has a fixed number of logical colours, and VDU 19 maps each
 * logical colour onto one of sixteen physical colours: eight steady colours and
 * eight that flash between a colour and its complement. A palette document
 * records that mapping for one mode, generates the exact VDU 19 sequence for it,
 * and gives the pixel and map editors real colours to preview with instead of a
 * hard-coded guess.
 *
 * A flashing physical colour genuinely alternates on the machine. A still
 * preview cannot show that, so the model exposes both phases and labels the
 * entry as flashing rather than pretending the first phase is the whole truth. */
import { sha256Hex } from '../build/digest';

export const PALETTE_SCHEMA = '8bit-net.palette' as const;

export type PaletteModeId = 'bbc-mode-0' | 'bbc-mode-1' | 'bbc-mode-2' | 'bbc-mode-4' | 'bbc-mode-5';

export interface PaletteModeProfile {
  id: PaletteModeId;
  label: string;
  /** VDU 22 mode number. */
  mode: number;
  logicalColours: number;
  bitsPerPixel: number;
  detail: string;
}

export const PALETTE_MODES: readonly PaletteModeProfile[] = Object.freeze([
  { id: 'bbc-mode-0', label: 'MODE 0', mode: 0, logicalColours: 2, bitsPerPixel: 1, detail: '640 by 256, two logical colours' },
  { id: 'bbc-mode-1', label: 'MODE 1', mode: 1, logicalColours: 4, bitsPerPixel: 2, detail: '320 by 256, four logical colours' },
  { id: 'bbc-mode-2', label: 'MODE 2', mode: 2, logicalColours: 16, bitsPerPixel: 4, detail: '160 by 256, sixteen logical colours' },
  { id: 'bbc-mode-4', label: 'MODE 4', mode: 4, logicalColours: 2, bitsPerPixel: 1, detail: '320 by 256, two logical colours' },
  { id: 'bbc-mode-5', label: 'MODE 5', mode: 5, logicalColours: 4, bitsPerPixel: 2, detail: '160 by 256, four logical colours' },
]);

/** The eight steady physical colours, in the BBC's own order. */
export const STEADY_PHYSICAL_COLOURS: readonly { name: string; rgb: string }[] = Object.freeze([
  { name: 'black', rgb: '#000000' },
  { name: 'red', rgb: '#ff0000' },
  { name: 'green', rgb: '#00ff00' },
  { name: 'yellow', rgb: '#ffff00' },
  { name: 'blue', rgb: '#0000ff' },
  { name: 'magenta', rgb: '#ff00ff' },
  { name: 'cyan', rgb: '#00ffff' },
  { name: 'white', rgb: '#ffffff' },
]);

export interface PhysicalColour {
  index: number;
  name: string;
  flashing: boolean;
  /** First phase, and for a flashing colour the second phase it alternates with. */
  rgb: string;
  alternateRgb: string;
}

/** The sixteen physical colours VDU 19 can select, 0 to 15. */
export function physicalColour(index: number): PhysicalColour {
  const bounded = ((Math.trunc(index) % 16) + 16) % 16;
  if (bounded < 8) {
    const steady = STEADY_PHYSICAL_COLOURS[bounded]!;
    return { index: bounded, name: steady.name, flashing: false, rgb: steady.rgb, alternateRgb: steady.rgb };
  }
  /* A flashing colour alternates between colour n-8 and its complement. */
  const first = STEADY_PHYSICAL_COLOURS[bounded - 8]!;
  const second = STEADY_PHYSICAL_COLOURS[7 - (bounded - 8)]!;
  return { index: bounded, name: `flashing ${first.name}/${second.name}`, flashing: true, rgb: first.rgb, alternateRgb: second.rgb };
}

export interface PaletteDocument {
  schema: typeof PALETTE_SCHEMA;
  version: 1;
  name: string;
  mode: PaletteModeId;
  /** One physical colour, 0 to 15, per logical colour of the mode. */
  entries: number[];
  extensions: Record<string, unknown>;
}

export function paletteModeProfile(mode: PaletteModeId): PaletteModeProfile {
  const profile = PALETTE_MODES.find((candidate) => candidate.id === mode);
  if (!profile) throw new Error(`Unknown palette mode ${mode}`);
  return profile;
}

/** The palette a mode powers up with before any VDU 19 is issued. */
export function defaultPaletteEntries(mode: PaletteModeId): number[] {
  const { logicalColours } = paletteModeProfile(mode);
  if (logicalColours === 2) return [0, 7];
  if (logicalColours === 4) return [0, 1, 3, 7];
  return Array.from({ length: logicalColours }, (_, index) => index);
}

export function createPaletteDocument(name = 'untitled-palette', mode: PaletteModeId = 'bbc-mode-5'): PaletteDocument {
  return { schema: PALETTE_SCHEMA, version: 1, name, mode, entries: defaultPaletteEntries(mode), extensions: {} };
}

export function parsePaletteDocument(value: string | unknown): PaletteDocument {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Palette document must be a JSON object');
  if (parsed.schema !== PALETTE_SCHEMA || parsed.version !== 1) throw new Error('Unsupported palette schema or version');
  if (typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 80) throw new Error('Palette name must contain 1 to 80 characters');
  const profile = PALETTE_MODES.find((candidate) => candidate.id === parsed.mode);
  if (!profile) throw new Error(`Palette mode must be one of ${PALETTE_MODES.map((candidate) => candidate.id).join(', ')}`);
  if (!Array.isArray(parsed.entries) || parsed.entries.length !== profile.logicalColours) {
    throw new Error(`${profile.label} has ${profile.logicalColours} logical colours, so its palette needs exactly ${profile.logicalColours} entries`);
  }
  const entries = parsed.entries.map((entry) => {
    if (!Number.isInteger(entry) || (entry as number) < 0 || (entry as number) > 15) throw new Error('Each palette entry must be a physical colour from 0 to 15');
    return entry as number;
  });
  const extensions = parsed.extensions && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions) ? parsed.extensions as Record<string, unknown> : {};
  return { schema: PALETTE_SCHEMA, version: 1, name: parsed.name.trim(), mode: profile.id, entries, extensions };
}

export function serializePaletteDocument(document: PaletteDocument): string {
  return `${JSON.stringify(parsePaletteDocument(document), null, 2)}\n`;
}

export function setPaletteEntry(document: PaletteDocument, logical: number, physical: number): PaletteDocument {
  const validated = parsePaletteDocument(document);
  if (!Number.isInteger(logical) || logical < 0 || logical >= validated.entries.length) throw new Error('That logical colour is not in this mode');
  return parsePaletteDocument({ ...validated, entries: validated.entries.map((entry, index) => index === logical ? physical : entry) });
}

/** Changing mode keeps the entries that still exist and defaults the rest. */
export function setPaletteMode(document: PaletteDocument, mode: PaletteModeId): PaletteDocument {
  const validated = parsePaletteDocument(document);
  const defaults = defaultPaletteEntries(mode);
  return parsePaletteDocument({ ...validated, mode, entries: defaults.map((fallback, index) => validated.entries[index] ?? fallback) });
}

export function resetPalette(document: PaletteDocument): PaletteDocument {
  const validated = parsePaletteDocument(document);
  return parsePaletteDocument({ ...validated, entries: defaultPaletteEntries(validated.mode) });
}

export interface PaletteOutput {
  /** The exact VDU byte stream: for each logical colour, 19, l, p, 0, 0, 0. */
  bytes: Uint8Array;
  assembly: string;
  basic: string;
  manifest: {
    schema: '8bit-net.generated-palette';
    version: 1;
    sourceSchema: typeof PALETTE_SCHEMA;
    sourceVersion: 1;
    name: string;
    mode: PaletteModeId;
    displayMode: number;
    logicalColours: number;
    byteLength: number;
    sha256: string;
    /** Logical colours whose physical colour flashes on the real machine. */
    flashingLogicalColours: number[];
  };
}

export function paletteLabel(name: string): string {
  return `palette_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
}

export function generatePaletteOutput(document: PaletteDocument): PaletteOutput {
  const validated = parsePaletteDocument(document);
  const profile = paletteModeProfile(validated.mode);
  const bytes = Uint8Array.from(validated.entries.flatMap((physical, logical) => [19, logical, physical, 0, 0, 0]));
  const label = paletteLabel(validated.name);
  const rows = Array.from({ length: validated.entries.length }, (_, logical) => {
    const physical = validated.entries[logical]!;
    const colour = physicalColour(physical);
    return `EQUB 19, ${logical}, ${physical}, 0, 0, 0 ; logical ${logical} becomes ${colour.name}`;
  });
  const assembly = [
    `; Generated palette ${validated.name} for ${profile.label} · ${profile.detail}`,
    `; ${bytes.length} VDU bytes · SHA-256 ${sha256Hex(bytes)}`,
    `; Send these bytes through OSWRCH to apply the palette.`,
    `.${label}`,
    ...rows,
    `.${label}_end`,
  ].join('\n');
  const basic = validated.entries
    .map((physical, logical) => `VDU 19,${logical},${physical},0,0,0`)
    .join('\n');
  return {
    bytes,
    assembly,
    basic,
    manifest: {
      schema: '8bit-net.generated-palette',
      version: 1,
      sourceSchema: PALETTE_SCHEMA,
      sourceVersion: 1,
      name: validated.name,
      mode: validated.mode,
      displayMode: profile.mode,
      logicalColours: profile.logicalColours,
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
      flashingLogicalColours: validated.entries.flatMap((physical, logical) => physicalColour(physical).flashing ? [logical] : []),
    },
  };
}

/* ---- the shared project palette ------------------------------------------ */

/** Fallback preview colours for a 2 bits-per-pixel target with no palette. */
export const DEFAULT_TWO_BIT_PREVIEW = Object.freeze(defaultPaletteEntries('bbc-mode-5').map((physical) => physicalColour(physical).rgb));

export interface ProjectPalette {
  /** The document the colours came from, or null when none was found. */
  document: PaletteDocument | null;
  /** Source filename, for the interface to name what it is previewing with. */
  fileName: string | null;
  /** One CSS colour per logical index, long enough for the caller's bit depth. */
  colours: string[];
  /** Logical indices that flash; a still preview shows only their first phase. */
  flashing: number[];
}

/**
 * Resolve the palette a project previews with.
 *
 * The first palette document whose mode matches the requested colour count wins,
 * then any palette document, then the power-up palette. The result always names
 * where its colours came from so the interface never implies a project palette
 * that does not exist.
 */
export function resolveProjectPalette(
  files: ReadonlyArray<{ name: string; content: string }>,
  logicalColours = 4,
): ProjectPalette {
  const candidates = files.filter((file) => /\.palette\.json$/i.test(file.name));
  const parsed = candidates.flatMap((file) => {
    try { return [{ file, document: parsePaletteDocument(file.content) }]; }
    catch { return []; }
  });
  const exact = parsed.find((entry) => paletteModeProfile(entry.document.mode).logicalColours === logicalColours);
  const chosen = exact ?? parsed[0];
  const entries = chosen ? chosen.document.entries : defaultPaletteEntries(logicalColours === 2 ? 'bbc-mode-4' : logicalColours === 16 ? 'bbc-mode-2' : 'bbc-mode-5');
  const colours = Array.from({ length: logicalColours }, (_, index) => physicalColour(entries[index] ?? index).rgb);
  const flashing = Array.from({ length: logicalColours }, (_, index) => index).filter((index) => physicalColour(entries[index] ?? index).flashing);
  return {
    document: chosen?.document ?? null,
    fileName: chosen?.file.name ?? null,
    colours,
    flashing,
  };
}
