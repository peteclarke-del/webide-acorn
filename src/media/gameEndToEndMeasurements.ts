/*
 * A game, built here, played by the machine off a tape written here.
 *
 * Everything else measured in this build measures a part: that a program
 * written here runs, that a machine loads an image written here, that the
 * editors generate source that assembles. None of those is the claim the
 * product makes. A chain of working parts is not a working chain, and the only
 * way to know which one you have is to run the whole thing.
 *
 * So: a program was assembled with artwork from the sprite editor and music
 * from the song editor compiled into it, written to a cassette by this build's
 * tape authoring, mounted on a real BBC Model B and a real BBC Master, and
 * loaded with the machine's own `*RUN`. Nothing placed a byte in either
 * machine's memory. Then the machine was asked what it printed.
 *
 * It printed the game's own title, and two bytes it had read out of the artwork
 * and the music — so those were really in the binary the machine loaded, rather
 * than merely in the project the binary was built from.
 *
 * `scripts/measureGameEndToEnd.mjs` reproduces it.
 */

export const GAME_END_TO_END_MEASUREMENT_SOURCE =
  'Measured by assembling a program with generated artwork and music, writing it to a UEF with src/media/acornTape.ts, ' +
  'mounting that on machines booted under the pinned jsbeeb core, and typing *RUN at them.';

export interface GamePlayedMeasurement {
  machine: string;
  /** What the machine printed, from its own write vector. */
  transcript: string;
  /** Whether the machine was still usable afterwards. */
  basicAnsweredAfterwards: boolean;
}

/** The title the game prints, which is how the chain is known to have held. */
export const GAME_END_TO_END_TITLE = 'TAPE GAME LIVES';

/**
 * The two bytes the game reads out of itself and prints: the first byte of the
 * artwork and the first byte of the music. They are printed as hexadecimal, and
 * they are the evidence that the assets are in the binary rather than beside it.
 */
export const GAME_END_TO_END_ASSET_BYTES = '6D 08';

export const GAME_END_TO_END_RUNS: readonly GamePlayedMeasurement[] = Object.freeze([
  {
    machine: 'BBC Model B',
    transcript: '*RUN GAME\nSearching\n\nLoading\n\nGAME       00GAME       01 0174\nTAPE GAME LIVES\n6D 08\n\nNo such variable\n\nBad program\n>',
    basicAnsweredAfterwards: true,
  },
  {
    machine: 'BBC Master',
    transcript: '*RUN GAME\nSearching\n\nLoading\n\nGAME       00GAME       01 0174\nTAPE GAME LIVES\n6D 08\n>',
    basicAnsweredAfterwards: true,
  },
]);

/**
 * Why the Model B says something the Master does not, and why it is right to.
 *
 * On a Model B with DFS, PAGE is &1900 — which is where the game loads. So
 * loading it destroys whatever BASIC program was there, and when the game
 * returns, BASIC finds machine code where its program should be and says so.
 * The Master's PAGE is &E00, so nothing collides.
 *
 * That is the machine behaving correctly, and it is why a real game is entered
 * with `*RUN` and does not come back. It is recorded rather than hidden because
 * somebody starting from one of the shipped starters — which do return to
 * BASIC, being starters — will see it, and should find it written down here
 * rather than think they broke something.
 */
export const GAME_END_TO_END_MODEL_B_NOTE =
  'On a Model B with DFS the program loads at PAGE, so returning to BASIC leaves BASIC looking at machine code where its '
  + 'program used to be. The Master loads clear of PAGE and says nothing. Both machines ran the game and both were usable after it.';
