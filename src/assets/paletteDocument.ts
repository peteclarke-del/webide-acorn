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
 * entry as flashing rather than pretending the first phase is the whole truth.
 *
 * A VideoNuLA lets a program redefine any of the sixteen physical colours as
 * one of 4,096, four bits a channel, through two writes to &FE23: the first
 * carries the physical colour's number in its high nibble and red in its low
 * one, the second green and blue. A palette document may carry those
 * definitions beside its VDU 19 mapping. They change what a physical colour
 * looks like, not which physical colour a logical one maps to, so a machine
 * without a NuLA shows the same mapping in the standard colours. A programmed
 * colour in the flashing eight stops flashing, which is what the hardware does. */
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

/** One of the 4,096 colours a VideoNuLA can give a physical colour: four bits a channel. */
export interface NulaColour {
  red: number;
  green: number;
  blue: number;
}

export interface PaletteDocument {
  schema: typeof PALETTE_SCHEMA;
  version: 1;
  name: string;
  mode: PaletteModeId;
  /** One physical colour, 0 to 15, per logical colour of the mode. */
  entries: number[];
  /**
   * What a VideoNuLA redefines each physical colour as, by physical colour 0
   * to 15, or null where the physical colour is left as the machine's own.
   * Always sixteen long once parsed; serialised only when any is set.
   */
  nula: Array<NulaColour | null>;
  extensions: Record<string, unknown>;
}

/** The CSS colour of a NuLA definition: each nibble doubled, which is what the hardware does. */
export function nulaRgb(colour: NulaColour): string {
  const channel = (value: number) => ((value & 0xf) * 17).toString(16).padStart(2, '0');
  return `#${channel(colour.red)}${channel(colour.green)}${channel(colour.blue)}`;
}

/** The two bytes that program one physical colour, in the order they are written to &FE23. */
export function nulaBytesFor(physical: number, colour: NulaColour): [number, number] {
  return [((physical & 0xf) << 4) | (colour.red & 0xf), ((colour.green & 0xf) << 4) | (colour.blue & 0xf)];
}

function parseNulaColour(value: unknown, physical: number): NulaColour | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The NuLA colour for physical colour ${physical} must be an object with red, green and blue`);
  const candidate = value as Record<string, unknown>;
  const channel = (name: 'red' | 'green' | 'blue'): number => {
    const level = candidate[name];
    if (!Number.isInteger(level) || (level as number) < 0 || (level as number) > 15) throw new Error(`The NuLA ${name} level for physical colour ${physical} must be 0 to 15`);
    return level as number;
  };
  return { red: channel('red'), green: channel('green'), blue: channel('blue') };
}

/** What a physical colour looks like in this palette: as the NuLA defines it, or as the machine has it. */
export function physicalColourIn(document: Pick<PaletteDocument, 'nula'>, physical: number): PhysicalColour {
  const standard = physicalColour(physical);
  const defined = document.nula[standard.index];
  if (!defined) return standard;
  const rgb = nulaRgb(defined);
  return { index: standard.index, name: `NuLA ${rgb}`, flashing: false, rgb, alternateRgb: rgb };
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

const NO_NULA = (): Array<NulaColour | null> => Array.from({ length: 16 }, () => null);

export function createPaletteDocument(name = 'untitled-palette', mode: PaletteModeId = 'bbc-mode-5'): PaletteDocument {
  return { schema: PALETTE_SCHEMA, version: 1, name, mode, entries: defaultPaletteEntries(mode), nula: NO_NULA(), extensions: {} };
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
  const nula = NO_NULA();
  if (parsed.nula !== undefined && parsed.nula !== null) {
    if (!Array.isArray(parsed.nula) || parsed.nula.length > 16) throw new Error('NuLA colours must be a list of at most sixteen entries, one per physical colour');
    parsed.nula.forEach((value, physical) => { nula[physical] = parseNulaColour(value, physical); });
  }
  const extensions = parsed.extensions && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions) ? parsed.extensions as Record<string, unknown> : {};
  return { schema: PALETTE_SCHEMA, version: 1, name: parsed.name.trim(), mode: profile.id, entries, nula, extensions };
}

/**
 * Serialised with the NuLA list only when a colour is defined, so a palette
 * that uses none reads as before, and cut after the last defined colour, so a
 * palette that defines four does not carry twelve nulls. The parser pads it.
 */
export function serializePaletteDocument(document: PaletteDocument): string {
  const { schema, version, name, mode, entries, nula, extensions } = parsePaletteDocument(document);
  const last = nula.reduce((found, colour, index) => colour ? index : found, -1);
  const withNula = last >= 0 ? { schema, version, name, mode, entries, nula: nula.slice(0, last + 1), extensions } : { schema, version, name, mode, entries, extensions };
  return `${JSON.stringify(withNula, null, 2)}\n`;
}

/** Define, or with null undefine, what the NuLA makes of one physical colour. */
export function setNulaColour(document: PaletteDocument, physical: number, colour: NulaColour | null): PaletteDocument {
  const validated = parsePaletteDocument(document);
  if (!Number.isInteger(physical) || physical < 0 || physical > 15) throw new Error('A NuLA colour is defined for a physical colour from 0 to 15');
  return parsePaletteDocument({ ...validated, nula: validated.nula.map((entry, index) => index === physical ? colour : entry) });
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
  /** The NuLA writes, two bytes a defined physical colour, in the order they go to &FE23. Empty without a NuLA colour. */
  nulaBytes: Uint8Array;
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
    /** Physical colours the NuLA redefines, in the order they are written. */
    nulaPhysicalColours: number[];
    nulaByteLength: number;
  };
}

export function paletteLabel(name: string): string {
  return `palette_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
}

export function generatePaletteOutput(document: PaletteDocument): PaletteOutput {
  const validated = parsePaletteDocument(document);
  const profile = paletteModeProfile(validated.mode);
  const bytes = Uint8Array.from(validated.entries.flatMap((physical, logical) => [19, logical, physical, 0, 0, 0]));
  const nulaDefined = validated.nula.flatMap((colour, physical) => colour ? [{ physical, colour }] : []);
  const nulaBytes = Uint8Array.from(nulaDefined.flatMap(({ physical, colour }) => nulaBytesFor(physical, colour)));
  const digest = sha256Hex(nulaBytes.length ? Uint8Array.from([...nulaBytes, ...bytes]) : bytes);
  const label = paletteLabel(validated.name);
  const rows = Array.from({ length: validated.entries.length }, (_, logical) => {
    const physical = validated.entries[logical]!;
    const colour = physicalColourIn(validated, physical);
    return `EQUB 19, ${logical}, ${physical}, 0, 0, 0 ; logical ${logical} becomes ${colour.name}`;
  });
  const hex = (value: number) => `&${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const nulaRows = nulaDefined.map(({ physical, colour }) => {
    const [first, second] = nulaBytesFor(physical, colour);
    return `EQUB ${hex(first)}, ${hex(second)} ; physical ${physical} becomes ${nulaRgb(colour)}`;
  });
  const assembly = [
    `; Generated palette ${validated.name} for ${profile.label} · ${profile.detail}`,
    `; ${bytes.length} VDU bytes${nulaBytes.length ? ` and ${nulaBytes.length} NuLA bytes` : ''} · SHA-256 ${digest}`,
    ...(nulaBytes.length ? [
      `; Write each NuLA pair to &FE23 in order, first byte then second, before the VDU bytes.`,
      `.${label}_nula`,
      ...nulaRows,
      `.${label}_nula_end`,
    ] : []),
    `; Send these bytes through OSWRCH to apply the palette.`,
    `.${label}`,
    ...rows,
    `.${label}_end`,
  ].join('\n');
  const basic = [
    ...nulaDefined.map(({ physical, colour }) => {
      const [first, second] = nulaBytesFor(physical, colour);
      return `?&FE23=${hex(first)}:?&FE23=${hex(second)}`;
    }),
    ...validated.entries.map((physical, logical) => `VDU 19,${logical},${physical},0,0,0`),
  ].join('\n');
  return {
    bytes,
    nulaBytes,
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
      sha256: digest,
      flashingLogicalColours: validated.entries.flatMap((physical, logical) => physicalColourIn(validated, physical).flashing ? [logical] : []),
      nulaPhysicalColours: nulaDefined.map(({ physical }) => physical),
      nulaByteLength: nulaBytes.length,
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
  const look = (index: number): PhysicalColour => chosen ? physicalColourIn(chosen.document, entries[index] ?? index) : physicalColour(entries[index] ?? index);
  const colours = Array.from({ length: logicalColours }, (_, index) => look(index).rgb);
  const flashing = Array.from({ length: logicalColours }, (_, index) => index).filter((index) => look(index).flashing);
  return {
    document: chosen?.document ?? null,
    fileName: chosen?.file.name ?? null,
    colours,
    flashing,
  };
}
