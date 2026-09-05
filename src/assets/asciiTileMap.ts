/*
 * Reading a level map out of the text somebody drew it in.
 *
 * The import already recovers maps from assembled byte runs, which is the form
 * a map takes once it is on its way into the machine. It is not the form most
 * people write one in. A room laid out as characters — a wall is a hash, the
 * floor is a full stop, the player is a P — is a file somebody can read, edit
 * and diff, and it is what the generator that produced the binary was reading
 * from. A project whose rooms live in text files therefore arrived with no maps
 * at all, while the same rooms recovered fine once they had been assembled.
 *
 * The grid is found by shape rather than by name or extension, because these
 * files are called every possible thing — `room01.txt`, `level3.map`,
 * `maze.dat` — and the one property they share is the one that matters: a run
 * of consecutive lines of exactly equal length, drawn from a small alphabet of
 * characters that repeat. Headers, blank lines and notes around the grid have
 * other lengths and fall away on their own, which is why nothing here needs to
 * know a comment marker.
 */

/*
 * The smallest grid worth calling a map, and the largest one worth reading.
 *
 * Six rather than four, and sixty-four cells rather than sixteen, because four
 * consecutive lines of equal length happen by accident all the time: measured
 * against a real forty-room project, a four-line floor matched eleven assembly
 * sources and three generator scripts on nothing but coincidence, and a six by
 * six floor matched none of them while still finding every room.
 */
const MIN_SIDE = 6;
const MIN_AREA = 64;
const MAX_SIDE = 256;
/**
 * A map draws from a small set of tiles. Prose, tables and hex dumps draw from
 * a large one, so this is most of what separates a room from a paragraph that
 * happens to be laid out square.
 */
const MAX_ALPHABET = 24;
/**
 * And a map is mostly floor. A block where no character repeats often is
 * something else laid out in a rectangle.
 */
const MIN_COMMONEST_SHARE = 0.15;

export interface AsciiMapLegendEntry {
  /** What the tile was drawn as. */
  character: string;
  /** The index it becomes in the recovered map. */
  index: number;
  /** How many cells it fills, which is why it has that index. */
  count: number;
}

export interface AsciiMapGrid {
  /** The line the grid starts on, counting from one, for saying where. */
  line: number;
  width: number;
  height: number;
  /** One tile index per cell, row by row. */
  values: number[];
  /** What each index was drawn as, most common first. */
  legend: AsciiMapLegendEntry[];
}

/**
 * Find the map in a text file, or say there is none.
 *
 * The largest qualifying block wins rather than the first, so a file holding a
 * small key or example above the room itself gives up the room.
 */
export function asciiMapGrid(text: string): AsciiMapGrid | null {
  /* Trailing whitespace is invisible and would otherwise make two identical
   * rows different lengths, which is enough to lose the grid entirely. */
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, ''));
  let best: { start: number; height: number; width: number } | null = null;
  let start = 0;
  for (let index = 1; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index]!.length === lines[start]!.length) continue;
    const width = lines[start]!.length;
    const height = index - start;
    const fits = width >= MIN_SIDE && width <= MAX_SIDE && height >= MIN_SIDE && height <= MAX_SIDE && width * height >= MIN_AREA;
    if (fits && (!best || width * height > best.width * best.height)) best = { start, height, width };
    start = index;
  }
  if (!best) return null;

  const rows = lines.slice(best.start, best.start + best.height);
  const counts = new Map<string, number>();
  for (const row of rows) for (const character of row) counts.set(character, (counts.get(character) ?? 0) + 1);
  if (counts.size < 2 || counts.size > MAX_ALPHABET) return null;
  const cells = best.width * best.height;
  const ordered = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (ordered[0]![1] / cells < MIN_COMMONEST_SHARE) return null;

  /* The commonest character takes index zero, because in a room that is the
   * floor, and a tile map's zero is its empty cell. */
  const legend: AsciiMapLegendEntry[] = ordered.map(([character, count], index) => ({ character, index, count }));
  const indexOf = new Map(legend.map((entry) => [entry.character, entry.index]));
  const values: number[] = [];
  for (const row of rows) for (const character of row) values.push(indexOf.get(character)!);
  return { line: best.start + 1, width: best.width, height: best.height, values, legend };
}
