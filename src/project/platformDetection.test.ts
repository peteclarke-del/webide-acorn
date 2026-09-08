import { describe, expect, it } from 'vitest';
import { detectPlatform, FALLBACK_MACHINE } from './platformDetection';

const file = (name: string, content: string) => ({ name, content });

describe('working out which Acorn a codebase is for', () => {
  it('reads exclusive hardware as the machine that has it', () => {
    const found = detectPlatform([file('main.asm', 'LDA #12\nSTA &FE40\nRTS\n')]);
    expect(found.machineId).toBe('bbc-b');
    expect(found.guessed).toBe(false);
    expect(found.machineEvidence[0]).toMatchObject({ file: 'main.asm', line: 2 });
    expect(found.machineEvidence[0]!.what).toContain('System VIA');
  });

  it('does not read shared address space as either machine', () => {
    /*
     * &FE00 is the Electron's ULA and the BBC's 6845 CRTC alike. The first
     * version of this called it decisive Electron evidence and read a BBC game
     * that blanks its display through the CRTC as an Electron game, the source
     * it misread said "CRTC display skew 3 blanks the BBC display" two lines
     * above the match.
     */
    const found = detectPlatform([file('loader.asm', '; CRTC display skew 3\nLDA #8\nSTA &FE00\nSTA &FE01\n')]);
    expect(found.guessed, 'shared hardware proves nothing').toBe(true);
    expect(found.machineId).toBe(FALLBACK_MACHINE);
  });

  it('takes a build switch over an address, because that is the author saying it', () => {
    const found = detectPlatform([
      file('Makefile', 'TARGET_ELECTRON := 1\n'),
      file('main.asm', 'STA &FE40\n'),
    ]);
    expect(found.machineId).toBe('electron');
    expect(found.machineEvidence[0]!.what).toContain('build switch');
  });

  it('sets up the least equipped machine when a codebase builds for several', () => {
    /* The rule asked for: a program built for the smaller machine runs on the
     * larger one, and one built for the larger will not run on the smaller. */
    const found = detectPlatform([file('Makefile', 'BBC_MAIN := grave-bbc\nELECTRON_MAIN := grave-electron\n')]);
    expect(found.machineId).toBe('electron');
    expect(found.alsoEvidenced.map((entry) => entry.machineId)).toEqual(['bbc-b']);
    expect(found.summary).toContain('the least equipped is set up');
  });

  it('does not call a passing mention a second target', () => {
    /* A roadmap that mentions the Master is not a codebase written for one. */
    const found = detectPlatform([
      file('main.asm', 'STA &FE40\n'),
      file('PLAN.md', 'One day we might support the Master 128.\n'),
    ]);
    expect(found.machineId).toBe('bbc-b');
    expect(found.alsoEvidenced).toEqual([]);
    expect(found.summary).not.toContain('also written for');
  });

  it('says what the code needs rather than claiming it was fitted', () => {
    /*
     * The summary said "with plus3, sideways fitted" for a codebase whose
     * machine cannot be given either, because the firmware vault holds no ROM
     * for them. Whether a requirement can be met belongs to the caller that
     * knows; this only reports what the code asks for.
     */
    const found = detectPlatform([file('main.asm', 'TARGET_ELECTRON=1\nLDA &FEC0\n')]);
    expect(found.summary).toContain('It needs');
    expect(found.summary).not.toContain('fitted');
  });

  it('names a fitting the way the machine names it', () => {
    const found = detectPlatform([file('main.asm', 'STA &FE40\nJSR &FEE0\n')]);
    /* "Tube second processor", which is what the Model B calls it, not "tube". */
    expect(found.summary).toContain('Tube second processor');
  });

  it('falls back to the lowest configuration when nothing names a machine', () => {
    const found = detectPlatform([file('main.asm', 'LDA #0\nRTS\n')]);
    expect(found.guessed).toBe(true);
    expect(found.capabilities, 'nothing is fitted that was not evidenced').toEqual([]);
    expect(found.summary).toContain('Change it if that is wrong');
  });

  it('fits only what the code shows it needs', () => {
    const found = detectPlatform([
      file('main.asm', 'STA &FE40\nORG &1900\nLDA &FEC0\nJSR &FEE0\n'),
    ]);
    const fitted = found.capabilities.map((entry) => entry.id);
    expect(fitted).toContain('dfs');
    expect(fitted).toContain('joystick');
    expect(fitted).toContain('tube');
    /* And nothing a Model B merely could have. */
    expect(fitted).not.toContain('econet');
    expect(fitted).not.toContain('speech');
  });

  it('does not fit the cassette interface, because it is part of the machine', () => {
    const found = detectPlatform([file('main.asm', '*TAPE\nSTA &FE40\n')]);
    expect(found.capabilities.map((entry) => entry.id)).not.toContain('cassette');
  });

  it('shows where every conclusion came from', () => {
    /* An inference nobody can check is worse than no inference. */
    const found = detectPlatform([file('src/game.asm', 'ORG &1900\nSTA &FE40\n')]);
    for (const signal of [...found.machineEvidence, ...found.capabilities.map((entry) => entry.because)]) {
      expect(signal.file, 'names the file').toBeTruthy();
      expect(signal.line, 'names the line').toBeGreaterThan(0);
      expect(signal.quote, 'quotes what matched').toBeTruthy();
      expect(signal.what, 'says what it means').toBeTruthy();
    }
  });

  it('knows the Atom by its own hardware and its own hex', () => {
    const found = detectPlatform([file('game.asm', 'LDA #10\nSTA #B002\n')]);
    expect(found.machineId).toBe('atom');
  });

  it('knows an ARM codebase by its operating system calls', () => {
    const found = detectPlatform([file('main.s', 'MOV R0, #1\nSWI "OS_WriteC"\n')]);
    expect(found.machineId).toBe('archimedes-a300');
  });
});
