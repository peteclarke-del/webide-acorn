/*
 * What each starter template did when it was run on the machine it is for.
 *
 * A starter is the first thing somebody sees of a machine, so being nearly
 * right about it is worse than useless: a program that assembles cleanly and
 * calls the wrong addresses looks like a working example until it is run, and
 * then fails in a way that reads as the person's mistake.
 *
 * So each one was assembled, placed in a real machine's memory, called the way
 * BASIC calls a program, given a key, and then asked — through BASIC — whether
 * the machine still worked. `scripts/measureStarterTemplates.mjs` reproduces
 * the three that run under jsbeeb; the Electron's was run under Elkulator in a
 * browser, which is the only core here that models that machine.
 *
 * Two things were found this way and neither could have been assumed from the
 * BBC. The Atom's OSWRCH is at &FFF4 and its OSRDCH at &FFE3, not the BBC's
 * &FFEE and &FFE0. And on an Atom a carriage return returns to column zero
 * without moving down, so a program that writes one where a BBC would writes
 * its second line straight over its first — which is exactly what the first
 * version of the Atom starter did.
 */

export const STARTER_TEMPLATE_MEASUREMENT_SOURCE =
  'Measured by assembling each starter, writing it into a real machine\'s memory, calling it from BASIC, giving it a key, ' +
  'and then asking BASIC to evaluate 6*7 to establish that the program had returned cleanly.';

export interface StarterTemplateRun {
  templateId: string;
  /** The machine, as the adapter that ran it names it. */
  model: string;
  /** How it was called, in the machine's own language. */
  call: string;
  /** What the machine showed. */
  shown: string;
  /** Whether BASIC answered afterwards, which is what returning cleanly means. */
  basicAnsweredAfterwards: boolean;
}

export const STARTER_TEMPLATE_RUNS: readonly StarterTemplateRun[] = Object.freeze([
  {
    templateId: 'bbc-b-mode7-6502',
    model: 'B',
    call: 'CALL &1900',
    shown: 'CALL &1900\n8BIT-NET DEV\nPress any key.\n>\n>PRINT 6*7\n        42\n>',
    basicAnsweredAfterwards: true,
  },
  {
    templateId: 'master-mode7-6502',
    model: 'Master',
    call: 'CALL &1900',
    shown: 'CALL &1900\n8BIT-NET DEV\nPress any key.\n>\n>PRINT 6*7\n        42\n>',
    basicAnsweredAfterwards: true,
  },
  {
    templateId: 'bbc-bplus-shadow-6502',
    model: 'BPlus',
    call: 'CALL &1900',
    shown: 'CALL &1900\n8BIT-NET DEV\nPress any key.\n>\n>PRINT 6*7\n        42\n>',
    basicAnsweredAfterwards: true,
  },
  {
    templateId: 'atom-text-6502',
    model: 'Atom-Tape',
    call: 'LINK#2900',
    shown: 'ACORN ATOM\n>LINK#2900\n8BIT-NET DEV\nPRESS ANY KEY.\n>\n>PRINT 6*7\n      42>',
    basicAnsweredAfterwards: true,
  },
  {
    templateId: 'electron-mode6-6502',
    model: 'Elkulator Electron',
    call: 'CALL &1900',
    /* The Electron's display is a bitmap rather than characters, and this
     * bridge publishes memory rather than a framebuffer, so what was measured
     * is how much of the screen the program lit: nothing before it ran, and
     * more after each step of it. Reporting the text would mean inventing it. */
    shown: 'screen memory lit 122 bytes at boot, 162 after the program printed, 170 after it took its key, 190 after BASIC printed 42',
    basicAnsweredAfterwards: true,
  },
]);

/**
 * The Electron would not run at all until the way the workbench launches a
 * program was corrected, and the reason is worth keeping.
 *
 * Moving the program counter into a loaded program looks equivalent to calling
 * it and is not: it abandons whatever the operating system was in the middle
 * of, with a stack that no longer describes how to get back. On a BBC under
 * jsbeeb the difference does not show. On an Electron under Elkulator the
 * program printed correctly until it made a blocking OS call, and then the
 * screen cleared and the machine ended up back in ROM with nothing to say why.
 */
export const ELECTRON_LAUNCH_MEASUREMENT = Object.freeze({
  settingTheProgramCounter: 'printed nothing; the screen cleared and the machine ended in ROM',
  callingFromBasic: 'printed the banner, waited for its key, returned, and left BASIC working',
});
