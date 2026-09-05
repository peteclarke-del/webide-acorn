/* Which ADFS disc an image is, from the shape of the image itself.
 *
 * These geometries are not written from memory. They are the loader table in
 * the pinned Arculator core — `loaders[]` in `src/disc.c` and the
 * `adf_loadex(drive, file, sectors, size, sides, dblstep, density, offset)`
 * calls beside it — which is the code that will actually be asked to read
 * whatever this build mounts. Taking them from anywhere else would mean this
 * build and the machine disagreeing about what a file is, and the machine
 * would be right.
 *
 * The distinction that matters here is between mounting an image and reading
 * its catalogue. They are different capabilities and this build has them to
 * different extents: the core can read the sectors of every geometry below,
 * while this build's own catalogue reader understands only the 800 KiB D and E
 * discs. Refusing to mount an image because the catalogue cannot be listed
 * would withhold a disc the machine could have read perfectly well, which is
 * the more useful of the two things by far.
 */

export interface AdfsGeometry {
  id: string;
  label: string;
  /** Exact image length in bytes. An ADFS image is a whole number of tracks. */
  bytes: number;
  sectorsPerTrack: number;
  sectorBytes: number;
  sides: 1 | 2;
  tracks: number;
  /** The filename extensions the core will accept this image under. */
  extensions: string[];
  /**
   * Whether this build can list the catalogue, and why not when it cannot.
   *
   * Named rather than left as an absence: somebody with a 640 KiB L disc that
   * mounts and boots but does not appear in the browser is owed the reason.
   */
  /*
   * A `note` is not a `reason`. A reason says why a disc cannot be listed; a
   * note says something a reader should know about a disc that can be. Keeping
   * them apart stops a caveat being displayed as a refusal.
   */
  catalogue: { readable: true; note?: string } | { readable: false; reason: string };
}

/* The old map — a free-space table in the first two sectors, and directories of
 * a different shape from the new-map ones — is what the S, M, L and D discs
 * share and what this build's reader does not implement. The one exception is
 * the 800 KiB D disc, whose old map the reader does handle, because the E disc
 * it shares a size with forced both to be told apart anyway. */
/*
 * S and M are read with the structure L was measured with.
 *
 * The three share one catalogue — an old free-space map and a 47-entry old
 * directory — and differ only in how much disc there is and whether it has two
 * sides. L is the one that could be measured: RISC OS 3.11 formats F, E, D and
 * L and no others, which its own `*Help Format` says, so no S or M disc could be
 * produced on the machine this build runs. What makes reading them credible is
 * that nothing is assumed of a particular disc — both directory signatures, the
 * sequence number at each end and the map's own checksums are all verified, so
 * a disc that is not this shape is refused rather than misread.
 */
const OLD_MAP_UNMEASURED = 'This structure was measured on an ADFS L disc formatted by RISC OS 3.11, which offers no S or M format. It is read here with the same reader, and a disc that is not this shape is refused rather than guessed at.';

export const ADFS_GEOMETRIES: readonly AdfsGeometry[] = Object.freeze([
  {
    id: 'adfs-s',
    label: 'ADFS S · 160 KiB',
    bytes: 160 * 1024,
    sectorsPerTrack: 16, sectorBytes: 256, sides: 1, tracks: 40,
    extensions: ['adf', 'ads'],
    catalogue: { readable: true, note: OLD_MAP_UNMEASURED },
  },
  {
    id: 'adfs-m',
    label: 'ADFS M · 320 KiB',
    bytes: 320 * 1024,
    sectorsPerTrack: 16, sectorBytes: 256, sides: 1, tracks: 80,
    extensions: ['adf', 'adm'],
    catalogue: { readable: true, note: OLD_MAP_UNMEASURED },
  },
  {
    id: 'adfs-l',
    label: 'ADFS L · 640 KiB',
    bytes: 640 * 1024,
    sectorsPerTrack: 16, sectorBytes: 256, sides: 2, tracks: 80,
    extensions: ['adl', 'adf'],
    catalogue: { readable: true, note: OLD_MAP_UNMEASURED },
  },
  {
    id: 'adfs-de',
    label: 'ADFS D or E · 800 KiB',
    bytes: 800 * 1024,
    sectorsPerTrack: 5, sectorBytes: 1024, sides: 2, tracks: 80,
    extensions: ['adf'],
    catalogue: { readable: true },
  },
  {
    id: 'adfs-f',
    label: 'ADFS F · 1600 KiB',
    bytes: 1600 * 1024,
    sectorsPerTrack: 10, sectorBytes: 1024, sides: 2, tracks: 80,
    extensions: ['adf'],
    /* F is a multi-zone new-map disc. The reader's zone arithmetic is written
     * for the one zone an 800 KiB floppy has, and it refuses anything else
     * rather than reading the first zone and presenting a partial catalogue as
     * a whole one. */
    catalogue: { readable: false, reason: 'An ADFS F disc has more than one allocation zone, and this build\'s reader is written for the single zone an 800 KiB floppy has. It refuses rather than reading the first zone and presenting part of a catalogue as all of it.' },
  },
]);

/** The extensions a disc chooser should offer, including the DFS ones. */
export const ADFS_EXTENSIONS: readonly string[] = Object.freeze(
  [...new Set(ADFS_GEOMETRIES.flatMap((geometry) => geometry.extensions))].sort(),
);

/**
 * Which geometry an image is, from its name and its length.
 *
 * Length decides, and the extension only narrows: `.adf` covers four different
 * discs, and a file's name is a thing somebody typed while its length is a
 * thing that is true.
 */
export function adfsGeometryFor(name: string, byteLength: number): AdfsGeometry | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const bySize = ADFS_GEOMETRIES.filter((geometry) => geometry.bytes === byteLength);
  if (!bySize.length) return null;
  if (!extension) return bySize[0]!;
  return bySize.find((geometry) => geometry.extensions.includes(extension)) ?? null;
}

/**
 * Why an image cannot be mounted, or null when it can.
 *
 * The refusal names the length the file has and the lengths that would work,
 * because "unsupported image" tells somebody nothing they can act on.
 */
export function adfsMountRefusal(name: string, byteLength: number): string | null {
  const geometry = adfsGeometryFor(name, byteLength);
  if (geometry) return null;
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const sizes = ADFS_GEOMETRIES
    .filter((candidate) => !extension || candidate.extensions.includes(extension))
    .map((candidate) => candidate.label);
  if (!sizes.length) {
    return `${name} is not a disc image this build mounts. ADFS images are named ${ADFS_EXTENSIONS.map((item) => `.${item}`).join(', ')}.`;
  }
  return `${name} is ${byteLength.toLocaleString()} bytes, which is not a whole ADFS disc. The geometries the pinned core reads are ${sizes.join(', ')}.`;
}
