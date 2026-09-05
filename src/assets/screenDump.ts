/*
 * Recognising a screen somebody saved straight out of the machine.
 *
 * A loading screen is usually not authored in a screen editor. It is a picture
 * converted by a tool, written out as the exact bytes the video hardware reads,
 * and loaded at &3000 by the game's loader — a `.scr`, a `LOADPIC`, a file with
 * no extension at all. That file is not text, so the importer excluded it and
 * the project arrived with the artwork it opens on missing entirely.
 *
 * There is nothing in the bytes that says which display mode they are for: a
 * BBC frame buffer is twenty kilobytes in modes 0, 1 and 2 alike, and ten in
 * modes 4 and 5. So the length says how many modes it could be, the filename is
 * read for one it names, and where the answer is still open the person is
 * offered the choice rather than given a guess. Reading a mode 1 screen as
 * mode 2 produces a recognisable but wrong picture, which is exactly the kind
 * of wrong that gets believed.
 */
import { screenGeometry } from './screenDocument';
import { PALETTE_MODES, type PaletteModeId } from './paletteDocument';

export interface ScreenDumpCandidate {
  id: string;
  /** The path in the imported folder, for saying where it came from. */
  sourceFile: string;
  /** What the recovered screen document will be called. */
  sourceLabel: string;
  byteLength: number;
  /**
   * Every display mode whose frame buffer is exactly this long, the one the
   * filename names first when it names one.
   */
  modes: PaletteModeId[];
  /** Whether the filename settled it, so a dialog can say so. */
  namedByFilename: boolean;
  bytes: Uint8Array;
}

/** The mode a filename names, if it names one: `..._mode2_...`, `mode 5`, `m1`. */
export function modeFromFilename(path: string): PaletteModeId | null {
  const name = (path.split('/').pop() ?? path).toLowerCase();
  const found = /(?:^|[^a-z0-9])(?:mode|m)[ _-]?([0-9])(?:[^0-9]|$)/.exec(name);
  if (!found) return null;
  const mode = PALETTE_MODES.find((profile) => profile.mode === Number(found[1]));
  return mode ? mode.id : null;
}

/**
 * Offer a file as a screen, or decide it is not one.
 *
 * Length alone is the test, because a frame buffer has no header to check and
 * nothing else about the bytes distinguishes a picture from any other block of
 * data of that size. That is loose enough that a twenty-kilobyte lump of level
 * data would be offered too, which is why this only ever offers: the person
 * decides, and an offer nobody takes costs nothing.
 */
export function screenDumpCandidate(path: string, bytes: Uint8Array): ScreenDumpCandidate | null {
  const matching = PALETTE_MODES.filter((profile) => screenGeometry(profile.id).byteLength === bytes.length).map((profile) => profile.id);
  if (!matching.length) return null;
  const named = modeFromFilename(path);
  const namedByFilename = !!named && matching.includes(named);
  const modes = namedByFilename ? [named!, ...matching.filter((mode) => mode !== named)] : matching;
  const base = path.split('/').pop() ?? path;
  return {
    id: `${path}:screen`,
    sourceFile: path,
    sourceLabel: base.replace(/\.[^.]+$/, '') || base,
    byteLength: bytes.length,
    modes,
    namedByFilename,
    bytes,
  };
}
