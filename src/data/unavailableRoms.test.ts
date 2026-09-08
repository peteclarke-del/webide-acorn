import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { machineProfiles } from './machines';

/*
 * A firmware set this build cannot start, and how it says so.
 *
 * The A310 offers six Archimedes releases and starts five of them. RISC OS 2.00
 * reaches `RISC OS 1024K / Acorn ADFS`, raises two address exceptions during
 * boot and drops to a supervisor prompt that does not echo anything typed at
 * it. Arthur 1.20, RISC OS 2.01, 3.00, 3.10 and 3.11 all boot to their desktops
 * on the same core, from the same vault, driven the same way — which is what
 * makes it this build's fault rather than the firmware's.
 *
 * It is offered and refused rather than removed. Removing it would leave
 * somebody hunting for a release this build lists everywhere else; refusing it
 * says the machine exists, that this build cannot start it, and why.
 *
 * What this holds is that saying so is not optional: an entry that carries a
 * reason has to be unselectable and has to put the reason where a pointer or a
 * screen reader can reach it, or the reason is decoration.
 */
const APP = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

const romsWithReason = machineProfiles.flatMap((profile) =>
  profile.roms.filter((rom) => rom.unavailableReason).map((rom) => ({ machine: profile.id, ...rom })));

describe('a firmware set this build cannot start', () => {
  it('names RISC OS 2.00 on the A310, and names it alone', () => {
    const a310 = machineProfiles.find((profile) => profile.id === 'archimedes-a300')!;
    const refused = a310.roms.filter((rom) => rom.unavailableReason).map((rom) => rom.id);
    expect(refused).toEqual(['riscos200']);
    /* The five that do start are the evidence that the sixth is this build's
     * fault, so they must stay selectable. */
    for (const id of ['arthur120', 'riscos201', 'riscos300', 'riscos310', 'riscos311']) {
      expect(a310.roms.find((rom) => rom.id === id)?.unavailableReason, id).toBeUndefined();
    }
  });

  it('gives a reason that says what happens rather than that something is wrong', () => {
    for (const rom of romsWithReason) {
      const reason = rom.unavailableReason!;
      expect(reason.length, `${rom.machine}/${rom.id} says too little`).toBeGreaterThan(60);
      expect(reason, `${rom.machine}/${rom.id} ends mid-sentence`).toMatch(/[.]$/);
    }
  });

  it('has such a set to check, so the rules below are not vacuous', () => {
    expect(romsWithReason.length).toBeGreaterThan(0);
  });

  it('makes the option unselectable and puts the reason on it', () => {
    /*
     * Read from the workbench rather than restated: a reason that renders as a
     * label suffix and nothing else leaves the option still choosable, which is
     * how this was before.
     */
    expect(APP).toMatch(/disabled=\{Boolean\(item\.unavailableReason\)\}/);
    expect(APP).toMatch(/title=\{item\.unavailableReason\}/);
    expect(APP).toContain('not currently available');
  });
});
