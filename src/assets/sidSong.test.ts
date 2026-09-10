import { describe, expect, it } from 'vitest';
import { MEASURED_REGISTERS, MEASURED_SONG, expectedSidRegisters, measuredSongDocument } from './sidSongMeasurements';
import { generateSongOutput, SID_WAVEFORM_BITS, songLabel } from './songDocument';

/*
 * The generated BeebSID player, held to what the chip held.
 *
 * scripts/measureSidSong.mjs ran the player on a Model B with BeebSID fitted
 * and read the register file back after reset and after each row. These hold
 * three things to each other: the measurement, the model the player is
 * written to, and the source the generator emits now.
 */
describe('a generated BeebSID player on the machine', () => {
  const document = measuredSongDocument();

  it('left the chip exactly as the model says it should, after reset and after every row', () => {
    expect(MEASURED_REGISTERS['after reset']).toEqual(expectedSidRegisters(document, 0));
    for (let row = 0; row < MEASURED_SONG.rows; row += 1) {
      expect(MEASURED_REGISTERS[`after row ${row}`], `row ${row}`).toEqual(expectedSidRegisters(document, row + 1));
    }
  });

  it('opened the gate for a note and closed it for a level of zero, keeping the waveform', () => {
    /* Voice 2 sounds on row 0 and is released on row 1: the same pulse bit, gate bit off. */
    expect(MEASURED_REGISTERS['after row 0']![7 + 4]).toBe(SID_WAVEFORM_BITS.pulse | 1);
    expect(MEASURED_REGISTERS['after row 1']![7 + 4]).toBe(SID_WAVEFORM_BITS.pulse);
    /* And its frequency stays, so the release sounds at the note's pitch. */
    expect(MEASURED_REGISTERS['after row 1']!.slice(7, 9)).toEqual([0x6b, 0x0e]);
    /* Voice 3 was never used: waveform set at reset, nothing else, ever. */
    expect(MEASURED_REGISTERS['after row 2']!.slice(14, 21)).toEqual([0, 0, 0, 0, SID_WAVEFORM_BITS.pulse, 0, 0]);
  });

  it('is what the generator still emits: the same constants the chip was written with', () => {
    const output = generateSongOutput(document);
    const label = songLabel(document.name);
    /* Voice 1's envelope, pulse width and gate sequence, as immediates in the source. */
    expect(output.assembly).toContain('ORA #&06\n  STA &FC26');
    expect(output.assembly).toContain('LDA #&29\n  STA &FC25');
    expect(output.assembly).toContain('LDA #&00\n  STA &FC22\n  LDA #&08\n  STA &FC23');
    expect(output.assembly).toContain('LDA #&20\n  STA &FC24\n  LDA #&21\n  STA &FC24');
    /* Voice 2's, seven registers on. */
    expect(output.assembly).toContain('ORA #&03\n  STA &FC2D');
    expect(output.assembly).toContain('LDA #&40\n  STA &FC2B\n  LDA #&41\n  STA &FC2B');
    /* The reset writes the waveforms and the master volume the chip showed. */
    expect(output.assembly).toContain(`.${label}_reset\n  LDA #0\n  STA ${label}_row\n  LDA #&0F\n  STA &FC38\n  LDA #&20\n  STA &FC24\n  LDA #&40\n  STA &FC2B\n  LDA #&40\n  STA &FC32`);
    /* The data rows the player indexed: A-4 at level 12, A-3 at level 15. */
    expect(Array.from(output.bytes.slice(3, 11))).toEqual([57, 12, 45, 15, 0, 0, 0, 0]);
  });
});
