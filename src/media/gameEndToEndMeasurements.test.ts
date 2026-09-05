import { describe, expect, it } from 'vitest';
import {
  GAME_END_TO_END_RUNS, GAME_END_TO_END_TITLE, GAME_END_TO_END_ASSET_BYTES,
  GAME_END_TO_END_MEASUREMENT_SOURCE, GAME_END_TO_END_MODEL_B_NOTE,
} from './gameEndToEndMeasurements';

describe('a game, played off a tape this build wrote', () => {
  it('was played by every machine it was given to', () => {
    expect(GAME_END_TO_END_RUNS.length).toBeGreaterThan(1);
    for (const run of GAME_END_TO_END_RUNS) {
      expect(run.transcript, `${run.machine} printed the title`).toContain(GAME_END_TO_END_TITLE);
    }
  });

  it('was loaded by the machine rather than placed in its memory', () => {
    for (const run of GAME_END_TO_END_RUNS) {
      /* The machine's own loader said what it was doing, block by block. */
      expect(run.transcript, `${run.machine} searched`).toContain('Searching');
      expect(run.transcript, `${run.machine} loaded`).toContain('Loading');
      expect(run.transcript, `${run.machine} read two blocks`).toContain('GAME       01');
      expect(run.transcript, `${run.machine} was asked with *RUN`).toContain('*RUN GAME');
    }
  });

  it('proves the artwork and the music were in the binary, not beside it', () => {
    for (const run of GAME_END_TO_END_RUNS) {
      expect(run.transcript, `${run.machine} printed its asset bytes`).toContain(GAME_END_TO_END_ASSET_BYTES);
    }
    /* Two distinct bytes: one from the sprite, one from the song. If the two
     * were the same the test would pass on a program that read one twice. */
    const [artwork, music] = GAME_END_TO_END_ASSET_BYTES.split(' ');
    expect(artwork).not.toBe(music);
  });

  it('left every machine usable', () => {
    for (const run of GAME_END_TO_END_RUNS) expect(run.basicAnsweredAfterwards, run.machine).toBe(true);
  });

  it('explains the one machine that had something extra to say', () => {
    const modelB = GAME_END_TO_END_RUNS.find((run) => run.machine === 'BBC Model B')!;
    const master = GAME_END_TO_END_RUNS.find((run) => run.machine === 'BBC Master')!;
    expect(modelB.transcript).toContain('Bad program');
    expect(master.transcript).not.toContain('Bad program');
    expect(GAME_END_TO_END_MODEL_B_NOTE).toContain('PAGE');
    /* And it is explained as the machine being right, not as a defect. */
    expect(GAME_END_TO_END_MODEL_B_NOTE).toContain('Both machines ran the game');
  });

  it('says how it was measured', () => {
    expect(GAME_END_TO_END_MEASUREMENT_SOURCE).toContain('*RUN');
    expect(GAME_END_TO_END_MEASUREMENT_SOURCE).toContain('acornTape.ts');
  });
});
