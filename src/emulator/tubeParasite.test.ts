import { describe, expect, it } from 'vitest';
import { findModel, TubeModel, TurboTubeModel } from 'jsbeeb/src/models.js';
import { TUBE_CAPABILITY, TUBE_PARASITES, TURBO_CAPABILITY, parasiteFor, parasiteIdentity } from './tubeParasite';
import { TUBE_PARASITE_BOOTS, TUBE_PARASITE_PROGRAM_BYTES } from './tubeParasiteMeasurements';
import { machineProfiles } from '../data/machines';
import { romSetFor } from '../rom/romProfiles';

const modelB = findModel('B')!;
const master = findModel('Master')!;
const capability = (machineId: string, id: string) =>
  machineProfiles.find((profile) => profile.id === machineId)!.capabilities.find((item) => item.id === id);

describe('choosing the second processor', () => {
  it('fits none when neither capability is on', () => {
    expect(parasiteFor(modelB, [])).toBeNull();
    expect(parasiteFor(modelB, ['sideways', 'beebsid'])).toBeNull();
  });

  it('fits what the machine was sold with when the plain capability is on', () => {
    expect(parasiteFor(modelB, [TUBE_CAPABILITY])).toBe(TubeModel);
    /* The Master was sold with the Turbo board, so its plain Tube is one. */
    expect(parasiteFor(master, [TUBE_CAPABILITY])).toBe(TurboTubeModel);
  });

  it('fits a 65C102 to a Model B when asked, which is what a PiTube Direct is', () => {
    expect(parasiteFor(modelB, [TURBO_CAPABILITY])).toBe(TurboTubeModel);
  });

  it('gives the Turbo to a machine that asks for both, because it has one Tube', () => {
    expect(parasiteFor(modelB, [TUBE_CAPABILITY, TURBO_CAPABILITY])).toBe(TurboTubeModel);
  });

  it('names the parasite it resolved, and nothing when there is none', () => {
    expect(parasiteIdentity(null)).toBeNull();
    expect(parasiteIdentity(parasiteFor(modelB, [TUBE_CAPABILITY]))).toBe(TUBE_PARASITES['6502']);
    expect(parasiteIdentity(parasiteFor(modelB, [TURBO_CAPABILITY]))).toBe(TUBE_PARASITES['65c102']);
  });

  it('gives each parasite the ROM path and clock the engine gives it', () => {
    expect(TUBE_PARASITES['6502'].romPath).toBe('tube/6502Tube.rom');
    expect(TUBE_PARASITES['65c102'].romPath).toBe('tube/65C102Tube.rom');
    expect(TUBE_PARASITES['65c102'].clockMhz).toBeGreaterThan(TUBE_PARASITES['6502'].clockMhz);
  });
});

describe('what each parasite was measured saying', () => {
  it('was booted behind both hosts, so the choice is not a claim about one machine', () => {
    expect(TUBE_PARASITE_BOOTS.map((boot) => `${boot.host} ${boot.parasite}`)).toEqual([
      'B Tube65C02', 'B Tube65C102', 'Master Tube65C02', 'Master Tube65C102',
    ]);
  });

  it('printed its own name, which is the one thing that cannot be mistaken', () => {
    for (const boot of TUBE_PARASITE_BOOTS) {
      const expected = boot.parasite === 'Tube65C102' ? 'Acorn TUBE 65C102 Co-Processor' : 'Acorn TUBE 6502 64K';
      expect(boot.printed, `${boot.host} ${boot.parasite}`).toBe(expected);
    }
  });

  it('handed the language over in every case, which is what PAGE on the far side says', () => {
    for (const boot of TUBE_PARASITE_BOOTS) {
      expect(boot.page, `${boot.host} ${boot.parasite}`).toBe('800');
      expect(boot.himem, `${boot.host} ${boot.parasite}`).toBe('8000');
    }
    expect(TUBE_PARASITE_PROGRAM_BYTES).toBe(30 * 1024);
  });
});

describe('what the product offers', () => {
  it('offers a 65C102 on the machines it was measured on, and asks for its ROM', () => {
    for (const [machineId, romSetId] of [['bbc-b', 'os12-basic2-dfs'], ['bbc-bplus', 'bplus-os']] as const) {
      expect(capability(machineId, TURBO_CAPABILITY)?.state, machineId).toBe('supported');
      const requirement = romSetFor(machineId, romSetId)!.requirements.find((item) => item.id === 'tube65c102');
      expect(requirement?.requiredByCapability, machineId).toBe(TURBO_CAPABILITY);
      expect(requirement?.emulatorPath, machineId).toBe(TUBE_PARASITES['65c102'].romPath);
    }
  });

  it('does not offer one to the Master, whose Tube is already a 65C102', () => {
    expect(capability('master', TURBO_CAPABILITY)).toBeUndefined();
    expect(capability('master', TUBE_CAPABILITY)?.state).toBe('supported');
  });
});
