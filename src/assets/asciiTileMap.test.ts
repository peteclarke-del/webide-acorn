import { describe, expect, it } from 'vitest';
import { asciiMapGrid } from './asciiTileMap';

/* The room this was written against is one of forty in a real project, and it
 * is reproduced here rather than read off disk so the test says what it means
 * and runs anywhere. */
const ROOM = `; NAME: Sub-Basement
; SHIFTS: 5
; SOLUTION: JR S S S L JL S S

################
#......F.......#
#..............#
#...====.......#
#............F.#
#......##......#
#......##......#
#......####....#
#...........#..#
#......%%#.Z...#
#...########...#
#.F............#
#P.........E...#
################
`;

describe('a map drawn as characters', () => {
  it('finds the room under the notes somebody wrote above it', () => {
    const grid = asciiMapGrid(ROOM);
    expect(grid).not.toBeNull();
    expect(grid!.width).toBe(16);
    expect(grid!.height).toBe(14);
    expect(grid!.values).toHaveLength(16 * 14);
    /* The header lines are three lines and a blank one, so the grid starts on
     * the fifth. */
    expect(grid!.line).toBe(5);
  });

  it('gives the floor index zero, because that is what a map means by empty', () => {
    const grid = asciiMapGrid(ROOM)!;
    expect(grid.legend[0]!.character).toBe('.');
    expect(grid.legend[0]!.index).toBe(0);
    /* And the wall, which is the next most of the room. */
    expect(grid.legend[1]!.character).toBe('#');
    expect(grid.values[0]).toBe(1);
  });

  it('reads every cell as the character that was drawn there', () => {
    const grid = asciiMapGrid(ROOM)!;
    const drawn = ROOM.split('\n').slice(4, 18);
    const back = grid.legend.reduce<Record<number, string>>((all, entry) => ({ ...all, [entry.index]: entry.character }), {});
    const rebuilt: string[] = [];
    for (let row = 0; row < grid.height; row += 1) {
      rebuilt.push(grid.values.slice(row * grid.width, (row + 1) * grid.width).map((value) => back[value]).join(''));
    }
    expect(rebuilt).toEqual(drawn);
  });

  it('keeps the larger grid when a file shows a key above the room', () => {
    const key = ['..#...', '.#.#..', '..#...', '..#...', '......', '..##..'];
    const withKey = [...key, '', ...Array.from({ length: 8 }, () => '#........#')].join('\n');
    const grid = asciiMapGrid(withKey)!;
    expect(grid.width).toBe(10);
    expect(grid.height).toBe(8);
  });

  it('refuses a four-line block, which happens by accident in ordinary source', () => {
    /* Four consecutive lines of equal length matched eleven assembly sources
     * and three generator scripts in a real project, and every one of those
     * was a coincidence rather than a room. */
    expect(asciiMapGrid(['#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#'].join('\n'))).toBeNull();
  });

  it('refuses prose, which is not a grid however square it looks', () => {
    /* Every line the same length, and every line a different set of letters:
     * the alphabet is what says this is writing rather than a room. */
    const prose = [
      'the quick brown fox jumps',
      'over a lazy dog and then',
      'walks back again to rest',
      'beside the warm hearth of',
      'a house that knows nobody',
      'and forgets every visitor',
    ].join('\n');
    expect(asciiMapGrid(prose)).toBeNull();
  });

  it('refuses a block of one repeated character, which draws nothing', () => {
    expect(asciiMapGrid(Array.from({ length: 8 }, () => '........').join('\n'))).toBeNull();
  });

  it('refuses a file with no equal-length run long enough to be a room', () => {
    expect(asciiMapGrid('one\ntwo\nthree\nfour\nfive\n')).toBeNull();
  });

  it('is not fooled by trailing spaces, which are invisible in an editor', () => {
    const padded = ['##########   ', ...Array.from({ length: 6 }, () => '#........#'), '##########  '].join('\n');
    const grid = asciiMapGrid(padded);
    expect(grid).not.toBeNull();
    expect(grid!.width).toBe(10);
    expect(grid!.height).toBe(8);
  });
});
