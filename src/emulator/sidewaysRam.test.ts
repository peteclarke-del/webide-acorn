import { describe, expect, it } from 'vitest';
import {
  SIDEWAYS_BANK_BYTES,
  SIDEWAYS_BANK_COUNT,
  SIDEWAYS_RAM_LIMITATION,
  SIDEWAYS_RAM_MEASUREMENTS,
  sidewaysRamKilobytes,
} from './sidewaysRamMeasurements';
import { SIDEWAYS_BANKS, SIDEWAYS_BANK_BYTES as SLOT_BANK_BYTES } from '../rom/sidewaysSlots';
import { machineProfiles } from '../data/machines';

/*
 * How much sideways RAM the emulated machines were measured having, and
 * whether the product says so.
 *
 * The capability used to say only that there were writable banks at &8000. How
 * many there are is the number a game is written against, and the emulated
 * machine has more than the board the game is for, so the capability has to say
 * both things.
 */

const measurement = (model: string) => SIDEWAYS_RAM_MEASUREMENTS.find((entry) => entry.model === model)!;
const capability = (machineId: string, id: string) =>
  machineProfiles.find((profile) => profile.id === machineId)!.capabilities.find((item) => item.id === id)!;

describe('the sideways RAM each machine was measured having', () => {
  it('agrees with the slot model about how many banks there are and how big one is', () => {
    /* Two statements about the same hardware, checked against each other. */
    expect(SIDEWAYS_BANK_COUNT).toBe(SIDEWAYS_BANKS);
    expect(SIDEWAYS_BANK_BYTES).toBe(SLOT_BANK_BYTES);
  });

  it('found eight banks on a Model B, whichever disc controller it has', () => {
    for (const model of ['B', 'B1770']) {
      expect(measurement(model).writableBanks, model).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(sidewaysRamKilobytes(measurement(model)), model).toBe(128);
    }
  });

  it('found four on a Master, and they are not the same four', () => {
    /* The Master's own firmware occupies the low banks, so its RAM is higher up.
     * A program that assumes bank 0 is RAM works on one machine and not the
     * other, which is why the banks are recorded and not only the count. */
    expect(measurement('Master').writableBanks).toEqual([4, 5, 6, 7]);
    expect(sidewaysRamKilobytes(measurement('Master'))).toBe(64);
    expect(measurement('Master').writableBanks).not.toEqual(measurement('B').writableBanks);
  });

  it('keeps every measured bank inside the sixteen the register can select', () => {
    for (const entry of SIDEWAYS_RAM_MEASUREMENTS) {
      for (const bank of entry.writableBanks) {
        expect(bank, `${entry.model} bank ${bank}`).toBeGreaterThanOrEqual(0);
        expect(bank, `${entry.model} bank ${bank}`).toBeLessThan(SIDEWAYS_BANK_COUNT);
      }
    }
  });
});

describe('what the product says about sideways RAM', () => {
  it('tells a Model B user how many banks there are, and that a real board has fewer', () => {
    const described = capability('bbc-b', 'sideways').description;
    expect(described.toLowerCase()).toContain('eight');
    expect(described).toContain('128');
    /* The difference from a real board is the part that would otherwise be
     * discovered by a game failing on hardware. */
    expect(described.toLowerCase()).toContain('board');
  });

  it('tells a Master user that its RAM starts at bank 4', () => {
    expect(capability('master', 'sideways').description).toContain('4');
  });

  it('names the limitation in one place, so it can be quoted rather than restated', () => {
    expect(SIDEWAYS_RAM_LIMITATION).toContain('128 KB');
    expect(SIDEWAYS_RAM_LIMITATION).toContain('not selectable');
  });
});
