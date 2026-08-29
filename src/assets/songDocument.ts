/* Versioned, editable song documents for the BBC's SN76489 sound chip.
 *
 * The chip has three tone channels and one noise channel, and the machine's own
 * SOUND interface addresses them as channel 0 for noise and 1 to 3 for tone.
 * A song is a grid of rows by those four channels; each cell carries a pitch
 * and a volume in exactly the units OSWORD 7 takes, so nothing has to be
 * translated between what is composed and what is played.
 *
 * This build ships no verified pitch-to-frequency table for the machine, so the
 * editor does not synthesise a preview in the browser. It generates the song
 * data and a working player, and the real machine plays it. */
import { sha256Hex } from '../build/digest';

export const SONG_SCHEMA = '8bit-net.song' as const;

/** Noise on channel 0, tone on 1 to 3, exactly as the machine numbers them. */
export const SONG_CHANNELS = 4;
/** The Acorn Atom has one speaker bit and no volume control, so it has one
 * channel and cannot be given the BBC's four however the editor is used. */
export const ATOM_CHANNELS = 1;
export const MAX_ATOM_ROWS = 128;
export const MAX_SONG_ROWS = 256;
export const MIN_SONG_ROWS = 1;
export const MAX_PITCH = 255;
export const MAX_VOLUME = 15;
export const MIN_ROW_DURATION = 1;
export const MAX_ROW_DURATION = 254;

export interface SongCell {
  /** OSWORD 7 pitch: 0 to 255 for tone, 0 to 7 for the noise channel. */
  pitch: number;
  /** 0 is silence; 1 to 15 become amplitudes -1 to -15. */
  volume: number;
}

export type SongTarget = 'bbc-sn76489' | 'atom-speaker';

export interface SongTargetProfile {
  id: SongTarget;
  label: string;
  channels: number;
  maxRows: number;
  /** Largest volume the hardware can actually produce. */
  maxVolume: number;
  channelLabels: readonly string[];
  detail: string;
}

export const SONG_TARGETS: readonly SongTargetProfile[] = Object.freeze([
  {
    id: 'bbc-sn76489', label: 'BBC · SN76489', channels: SONG_CHANNELS, maxRows: 256, maxVolume: 15,
    channelLabels: ['Noise', 'Tone 1', 'Tone 2', 'Tone 3'],
    detail: 'Three tone channels and one noise channel, played through OSWORD 7',
  },
  {
    id: 'atom-speaker', label: 'Atom · 1-bit speaker', channels: ATOM_CHANNELS, maxRows: MAX_ATOM_ROWS, maxVolume: 1,
    channelLabels: ['Speaker'],
    detail: 'One speaker bit toggled through the PPIA; on or off, with no volume and no second voice',
  },
]);

export function songTargetProfile(target: SongTarget): SongTargetProfile {
  const profile = SONG_TARGETS.find((candidate) => candidate.id === target);
  if (!profile) throw new Error(`Unknown song target ${target}`);
  return profile;
}

export interface SongDocument {
  schema: typeof SONG_SCHEMA;
  version: 1;
  name: string;
  target: SongTarget;
  /** Duration passed to OSWORD 7 for every note, in twentieths of a second. */
  rowDuration: number;
  /** Zero-page pair and scratch byte the generated player may use. */
  zeroPageBase: number;
  /** rows[row][channel]. */
  rows: SongCell[][];
  extensions: Record<string, unknown>;
}

export const CHANNEL_LABELS = SONG_TARGETS[0]!.channelLabels;

export function emptyRow(target: SongTarget = 'bbc-sn76489'): SongCell[] {
  return Array.from({ length: songTargetProfile(target).channels }, () => ({ pitch: 0, volume: 0 }));
}

export function createSongDocument(name = 'untitled-song', rowCount = 16, target: SongTarget = 'bbc-sn76489'): SongDocument {
  return {
    schema: SONG_SCHEMA,
    version: 1,
    name,
    target,
    rowDuration: 10,
    zeroPageBase: 0x70,
    rows: Array.from({ length: Math.min(rowCount, songTargetProfile(target).maxRows) }, () => emptyRow(target)),
    extensions: {},
  };
}

/**
 * Largest pitch a channel accepts.
 *
 * On the BBC the noise channel takes 0 to 7 and a tone channel the full range.
 * On the Atom the number is the speaker half-period delay count, not a musical
 * pitch, and it must be at least one for the delay loop to terminate sensibly.
 */
export function maximumPitch(channel: number, target: SongTarget = 'bbc-sn76489'): number {
  if (target === 'atom-speaker') return MAX_PITCH;
  return channel === 0 ? 7 : MAX_PITCH;
}

export function parseSongDocument(value: string | unknown): SongDocument {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Song document must be a JSON object');
  if (parsed.schema !== SONG_SCHEMA || parsed.version !== 1) throw new Error('Unsupported song schema or version');
  if (typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 80) throw new Error('Song name must contain 1 to 80 characters');
  const target = (parsed.target ?? 'bbc-sn76489') as SongTarget;
  const profile = songTargetProfile(target);
  if (!Number.isInteger(parsed.rowDuration) || (parsed.rowDuration as number) < MIN_ROW_DURATION || (parsed.rowDuration as number) > MAX_ROW_DURATION) {
    throw new Error(`Row duration must be a whole number from ${MIN_ROW_DURATION} to ${MAX_ROW_DURATION} twentieths of a second`);
  }
  const zeroPageBase = parsed.zeroPageBase ?? 0x70;
  /* The player needs three consecutive zero-page bytes it can own. */
  if (!Number.isInteger(zeroPageBase) || (zeroPageBase as number) < 0 || (zeroPageBase as number) > 0xfc) throw new Error('The player zero-page base must leave room for four bytes below &100');
  if (!Array.isArray(parsed.rows) || parsed.rows.length < MIN_SONG_ROWS || parsed.rows.length > profile.maxRows) {
    throw new Error(`A ${profile.label} song must have ${MIN_SONG_ROWS} to ${profile.maxRows} rows`);
  }
  const rows = parsed.rows.map((candidate, rowIndex) => {
    if (!Array.isArray(candidate) || candidate.length !== profile.channels) throw new Error(`Row ${rowIndex + 1} must have exactly ${profile.channels} channel${profile.channels === 1 ? '' : 's'} for ${profile.label}`);
    return candidate.map((cellCandidate, channel) => {
      const cell = cellCandidate as Partial<SongCell>;
      const limit = maximumPitch(channel, target);
      const label = profile.channelLabels[channel];
      if (!Number.isInteger(cell.pitch) || (cell.pitch as number) < 0 || (cell.pitch as number) > limit) {
        throw new Error(`Row ${rowIndex + 1} ${label} pitch must be a whole number from 0 to ${limit}`);
      }
      if (!Number.isInteger(cell.volume) || (cell.volume as number) < 0 || (cell.volume as number) > profile.maxVolume) {
        throw new Error(`Row ${rowIndex + 1} ${label} volume must be a whole number from 0 to ${profile.maxVolume}`);
      }
      return { pitch: cell.pitch as number, volume: cell.volume as number };
    });
  });
  const extensions = parsed.extensions && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions) ? parsed.extensions as Record<string, unknown> : {};
  return { schema: SONG_SCHEMA, version: 1, name: parsed.name.trim(), target, rowDuration: parsed.rowDuration as number, zeroPageBase: zeroPageBase as number, rows, extensions };
}

export function serializeSongDocument(document: SongDocument): string {
  return `${JSON.stringify(parseSongDocument(document), null, 2)}\n`;
}

/* ---- editing ------------------------------------------------------------- */

export function setSongCell(document: SongDocument, row: number, channel: number, cell: Partial<SongCell>): SongDocument {
  const validated = parseSongDocument(document);
  if (!Number.isInteger(row) || row < 0 || row >= validated.rows.length) throw new Error('That row is not in this song');
  if (!Number.isInteger(channel) || channel < 0 || channel >= songTargetProfile(validated.target).channels) throw new Error('That channel is not in this song');
  const current = validated.rows[row]![channel]!;
  const next = { pitch: cell.pitch ?? current.pitch, volume: cell.volume ?? current.volume };
  return parseSongDocument({
    ...validated,
    rows: validated.rows.map((candidate, index) => index !== row ? candidate : candidate.map((entry, position) => position === channel ? next : entry)),
  });
}

export function setSongLength(document: SongDocument, rowCount: number): SongDocument {
  const validated = parseSongDocument(document);
  const profile = songTargetProfile(validated.target);
  if (!Number.isInteger(rowCount) || rowCount < MIN_SONG_ROWS || rowCount > profile.maxRows) throw new Error(`A ${profile.label} song must have ${MIN_SONG_ROWS} to ${profile.maxRows} rows`);
  /* Shortening drops the trailing rows outright rather than folding them in. */
  const rows = Array.from({ length: rowCount }, (_, index) => validated.rows[index] ?? emptyRow(validated.target));
  return parseSongDocument({ ...validated, rows });
}

export function clearSongRow(document: SongDocument, row: number): SongDocument {
  const validated = parseSongDocument(document);
  if (!Number.isInteger(row) || row < 0 || row >= validated.rows.length) throw new Error('That row is not in this song');
  return parseSongDocument({ ...validated, rows: validated.rows.map((candidate, index) => index === row ? emptyRow(validated.target) : candidate) });
}

/* ---- generation ---------------------------------------------------------- */

export interface SongOutput {
  /** Header then one pitch and volume byte per channel per row. */
  bytes: Uint8Array;
  assembly: string;
  basic: string;
  manifest: {
    schema: '8bit-net.generated-song';
    version: 1;
    sourceSchema: typeof SONG_SCHEMA;
    sourceVersion: 1;
    name: string;
    target: SongTarget;
    rowCount: number;
    channels: number;
    rowDuration: number;
    /** Zero-page bytes the generated player claims. */
    zeroPage: number[];
    /** Rows on which every channel is silent. */
    silentRows: number[];
    byteLength: number;
    sha256: string;
  };
}

export function songLabel(name: string): string {
  return `song_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
}

function hex(value: number): string {
  return `&${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function generateSongOutput(document: SongDocument): SongOutput {
  const validated = parseSongDocument(document);
  const profile = songTargetProfile(validated.target);
  const label = songLabel(validated.name);
  const header = [validated.rows.length, profile.channels, validated.rowDuration];
  const data = validated.rows.flatMap((row) => row.flatMap((cell) => [cell.pitch, cell.volume]));
  const bytes = Uint8Array.from([...header, ...data]);
  const pointer = validated.zeroPageBase;
  const pointerHigh = validated.zeroPageBase + 1;
  const channelCounter = validated.zeroPageBase + 2;
  const offsetHigh = validated.zeroPageBase + 3;
  const stride = profile.channels * 2;

  const preamble = [
    `; Generated song ${validated.name} · ${validated.rows.length} rows for ${profile.label}`,
    `; ${profile.detail}.`,
    `; ${bytes.length} data bytes · SHA-256 ${sha256Hex(bytes)}`,
    `; The player owns zero page ${hex(pointer)} to ${hex(offsetHigh)}.`,
    `.${label}`,
    `EQUB ${header.map(hex).join(', ')} ; rows, channels, row duration`,
    `.${label}_data`,
    ...validated.rows.map((row, index) => `EQUB ${row.flatMap((cell) => [hex(cell.pitch), hex(cell.volume)]).join(', ')} ; row ${index}`),
    '',
    '; Rewind to the first row.',
    `.${label}_reset`,
    '  LDA #0',
    `  STA ${label}_row`,
    '  RTS',
    '',
  ];

  /* The row offset is row * stride, which passes 255 well before the last row,
   * so it is accumulated as a sixteen-bit value rather than in the accumulator
   * alone. */
  const pointerSetup = [
    `  LDA #0`,
    `  STA ${hex(offsetHigh)}`,
    `  LDA ${label}_row`,
    ...Array.from({ length: Math.log2(stride) }, () => [`  ASL A`, `  ROL ${hex(offsetHigh)}`]).flat(),
    '  CLC',
    `  ADC #<${label}_data`,
    `  STA ${hex(pointer)}`,
    `  LDA ${hex(offsetHigh)}`,
    `  ADC #>${label}_data`,
    `  STA ${hex(pointerHigh)}`,
  ];

  const bbcPlayer = [
    '; Play the current row and advance. Carry set means the song has finished.',
    `.${label}_play_row`,
    `  LDA ${label}_row`,
    `  CMP ${label}`,
    `  BCC ${label}_play_go`,
    '  SEC',
    '  RTS',
    `.${label}_play_go`,
    ...pointerSetup,
    '  LDA #0',
    `  STA ${hex(channelCounter)}`,
    `.${label}_play_channel`,
    `  LDA ${hex(channelCounter)}`,
    '  ASL A',
    '  TAY',
    `  LDA (${hex(pointer)}),Y`,
    `  STA ${label}_block + 4`,
    '  INY',
    `  LDA (${hex(pointer)}),Y`,
    `  BEQ ${label}_play_next`,
    '  EOR #&FF',
    '  CLC',
    '  ADC #1',
    `  STA ${label}_block + 2`,
    '  LDA #&FF',
    `  STA ${label}_block + 3`,
    `  LDA ${hex(channelCounter)}`,
    `  STA ${label}_block`,
    '  LDA #0',
    `  STA ${label}_block + 1`,
    `  STA ${label}_block + 5`,
    `  STA ${label}_block + 7`,
    `  LDA ${label} + 2`,
    `  STA ${label}_block + 6`,
    `  LDX #<${label}_block`,
    `  LDY #>${label}_block`,
    '  LDA #7',
    '  JSR &FFF1',
    `.${label}_play_next`,
    `  INC ${hex(channelCounter)}`,
    `  LDA ${hex(channelCounter)}`,
    `  CMP #${profile.channels}`,
    `  BNE ${label}_play_channel`,
    `  INC ${label}_row`,
    '  CLC',
    '  RTS',
    '',
    `.${label}_row`,
    '  SKIP 1',
    `.${label}_block`,
    '  SKIP 8',
  ];

  /* The Atom has one speaker bit and no volume, so its player toggles that bit
   * through the PPIA control register rather than pretending there is a chip to
   * program. Bit set/reset writes &05 to raise the speaker line and &04 to drop
   * it; the pitch byte is the half-period delay count, not a musical pitch. */
  const atomPlayer = [
    '; Play the current row and advance. Carry set means the song has finished.',
    '; The speaker is port C bit 2 of the 8255 PPIA at &B000; &B003 takes the',
    '; bit set/reset command that raises or lowers it.',
    `.${label}_play_row`,
    `  LDA ${label}_row`,
    `  CMP ${label}`,
    `  BCC ${label}_play_go`,
    '  SEC',
    '  RTS',
    `.${label}_play_go`,
    ...pointerSetup,
    '  LDY #0',
    `  LDA (${hex(pointer)}),Y`,
    `  STA ${label}_period`,
    '  INY',
    `  LDA (${hex(pointer)}),Y`,
    `  BEQ ${label}_play_rest`,
    `  LDX ${label} + 2`,
    `.${label}_play_cycle`,
    '  LDA #&05',
    '  STA &B003',
    `  JSR ${label}_delay`,
    '  LDA #&04',
    '  STA &B003',
    `  JSR ${label}_delay`,
    '  DEX',
    `  BNE ${label}_play_cycle`,
    `  JMP ${label}_play_done`,
    `.${label}_play_rest`,
    `  LDX ${label} + 2`,
    `.${label}_play_silence`,
    `  JSR ${label}_delay`,
    `  JSR ${label}_delay`,
    '  DEX',
    `  BNE ${label}_play_silence`,
    `.${label}_play_done`,
    `  INC ${label}_row`,
    '  CLC',
    '  RTS',
    '',
    '; Busy-wait for the current half period.',
    `.${label}_delay`,
    `  LDY ${label}_period`,
    `.${label}_delay_loop`,
    '  DEY',
    `  BNE ${label}_delay_loop`,
    '  RTS',
    '',
    `.${label}_row`,
    '  SKIP 1',
    `.${label}_period`,
    '  SKIP 1',
  ];

  const assembly = [...preamble, ...(validated.target === 'atom-speaker' ? atomPlayer : bbcPlayer)].join('\n');

  const basic = validated.target === 'atom-speaker'
    ? '; The Atom has no SOUND statement; use the generated machine-code player.'
    : validated.rows
      .flatMap((row, index) => {
        const played = row.flatMap((cell, channel) => cell.volume ? [`SOUND ${channel},${-cell.volume},${cell.pitch},${validated.rowDuration}`] : []);
        return played.length ? [`REM row ${index}`, ...played] : [];
      })
      .join('\n');

  return {
    bytes,
    assembly,
    basic,
    manifest: {
      schema: '8bit-net.generated-song',
      version: 1,
      sourceSchema: SONG_SCHEMA,
      sourceVersion: 1,
      name: validated.name,
      target: validated.target,
      rowCount: validated.rows.length,
      channels: profile.channels,
      rowDuration: validated.rowDuration,
      zeroPage: [pointer, pointerHigh, channelCounter, offsetHigh],
      silentRows: validated.rows.flatMap((row, index) => row.every((cell) => cell.volume === 0) ? [index] : []),
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
    },
  };
}
