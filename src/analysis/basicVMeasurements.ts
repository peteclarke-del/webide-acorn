/*
 * What a real BBC BASIC V actually emitted, and how it came to be here.
 *
 * The BASIC V table in `basicDialects.ts` is read out of a ROM like the others,
 * but that table alone does not say what BASIC writes: an ARM BASIC gives some
 * keywords two bytes, and which prefix each takes is carried in a flag byte
 * whose encoding no reading of the bits settled. The obvious reading put
 * `APPEND` and `SUM` in the same group under the same token, so it was wrong.
 *
 * So it was measured. RISC OS 3.11 was booted on this build's own pinned A310
 * core, its keyboard was driven to a BASIC prompt, each of these lines was
 * typed, and the tokenised program was read back out of the machine's memory at
 * `&8F00`. Every distinct flag value in the table is represented, both sides of
 * every pseudo-variable, both forms of `ELSE`, and ten line numbers chosen to
 * exercise every carried bit of their encoding.
 *
 * They are kept because a measurement nobody can repeat is a claim. The decoder
 * is held to reproducing every one of them, so the rule cannot drift from what
 * the machine did, and the rule can be checked without a ROM, a browser or an
 * emulator.
 *
 * These are token values, not firmware: they are the encoding of text that was
 * typed in, which is the same kind of thing as the token tables themselves.
 */

/** The line as it was typed, against the bytes BASIC V stored for it. */
export const BASIC_V_MEASUREMENTS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["A=HIMEM", [0x41, 0x3d, 0x93]],
  ["A=LOMEM", [0x41, 0x3d, 0x92]],
  ["A=PAGE", [0x41, 0x3d, 0x90]],
  ["A=PTR", [0x41, 0x3d, 0x8f]],
  ["A=TIME", [0x41, 0x3d, 0x91]],
  ["ABS", [0x94]],
  ["AND", [0x80]],
  ["APPEND", [0xc7, 0x8e]],
  ["AUTO", [0xc7, 0x8f]],
  ["BEAT", [0xc6, 0x8f]],
  ["BEATS", [0xc8, 0x9e]],
  ["BGET", [0x9a]],
  ["BPUT", [0xd5]],
  ["CASE", [0xc8, 0x8e]],
  ["CIRCLE", [0xc8, 0x8f]],
  ["CRUNCH", [0xc7, 0x90]],
  ["DATA", [0xdc]],
  ["DELETE", [0xc7, 0x91]],
  ["EDIT", [0xc7, 0x92]],
  ["ELLIPSE", [0xc8, 0x9d]],
  ["ELSE", [0xcc]],
  ["ERROR", [0x85]],
  ["FILL", [0xc8, 0x90]],
  ["GOSUB", [0xe4]],
  ["GOSUB910", [0xe4, 0x8d, 0x74, 0x4e, 0x43]],
  ["GOTO", [0xe5]],
  ["GOTO1", [0xe5, 0x8d, 0x54, 0x41, 0x40]],
  ["GOTO16383", [0xe5, 0x8d, 0x64, 0x7f, 0x7f]],
  ["GOTO16384", [0xe5, 0x8d, 0x50, 0x40, 0x40]],
  ["GOTO255", [0xe5, 0x8d, 0x64, 0x7f, 0x40]],
  ["GOTO256", [0xe5, 0x8d, 0x54, 0x40, 0x41]],
  ["GOTO32767", [0xe5, 0x8d, 0x60, 0x7f, 0x7f]],
  ["GOTO63", [0xe5, 0x8d, 0x54, 0x7f, 0x40]],
  ["GOTO64", [0xe5, 0x8d, 0x44, 0x40, 0x40]],
  ["GOTO8191", [0xe5, 0x8d, 0x64, 0x7f, 0x5f]],
  ["GOTO8192", [0xe5, 0x8d, 0x54, 0x40, 0x60]],
  ["GOTO900", [0xe5, 0x8d, 0x74, 0x44, 0x43]],
  ["HELP", [0xc7, 0x93]],
  ["HIMEM", [0xd3]],
  ["HIMEM=1", [0xd3, 0x3d, 0x31]],
  ["IFA=1THEN920ELSE930", [0xe7, 0x41, 0x3d, 0x31, 0x8c, 0x8d, 0x74, 0x58, 0x43, 0x8b, 0x8d, 0x74, 0x62, 0x43]],
  ["INSTALL", [0xc7, 0x9f]],
  ["INSTR(", [0xa7]],
  ["LEFT$(", [0xc0]],
  ["LIBRARY", [0xc8, 0x9b]],
  ["LIST", [0xc7, 0x94]],
  ["LOAD", [0xc7, 0x95]],
  ["LOMEM", [0xd2]],
  ["LOMEM=1", [0xd2, 0x3d, 0x31]],
  ["LOMEM=HIMEM", [0xd2, 0x3d, 0x93]],
  ["LVAR", [0xc7, 0x96]],
  ["MID$(", [0xc1]],
  ["MOUSE", [0xc8, 0x97]],
  ["NEW", [0xc7, 0x97]],
  ["OF", [0xca]],
  ["OLD", [0xc7, 0x98]],
  ["OPENIN", [0x8e]],
  ["ORIGIN", [0xc8, 0x91]],
  ["OVERLAY", [0xc8, 0xa3]],
  ["PAGE", [0xd0]],
  ["PAGE=1", [0xd0, 0x3d, 0x31]],
  ["POINT", [0xc8, 0x92]],
  ["PRINTHIMEM", [0xf1, 0x93]],
  ["PRINTPAGE", [0xf1, 0x90]],
  ["PTR", [0xcf]],
  ["PTR=1", [0xcf, 0x3d, 0x31]],
  ["QUIT", [0xc8, 0x98]],
  ["RECTANGLE", [0xc8, 0x93]],
  ["RENUMBER", [0xc7, 0x99]],
  ["RESTORE940", [0xf7, 0x8d, 0x74, 0x6c, 0x43]],
  ["RIGHT$(", [0xc2]],
  ["SAVE", [0xc7, 0x9a]],
  ["SPC", [0x89]],
  ["STEP", [0x88]],
  ["STEREO", [0xc8, 0xa2]],
  ["STRING$(", [0xc4]],
  ["SUM", [0xc6, 0x8e]],
  ["SWAP", [0xc8, 0x94]],
  ["SYS", [0xc8, 0x99]],
  ["TAB(", [0x8a]],
  ["TEMPO", [0xc8, 0x9f]],
  ["TEXTLOAD", [0xc7, 0x9b]],
  ["TEXTSAVE", [0xc7, 0x9c]],
  ["THEN", [0x8c]],
  ["TIME", [0xd1]],
  ["TIME=1", [0xd1, 0x3d, 0x31]],
  ["TINT", [0xc8, 0x9c]],
  ["TO", [0xb8]],
  ["TWIN", [0xc7, 0x9d]],
  ["TWINO", [0xc7, 0x9e]],
  ["VOICE", [0xc8, 0xa1]],
  ["VOICES", [0xc8, 0xa0]],
  ["WAIT", [0xc8, 0x96]],
  ["WHILE", [0xc8, 0x95]],
];

/** Where the measurement was taken, so the claim can be traced to a machine. */
export const BASIC_V_MEASUREMENT_SOURCE = Object.freeze({
  machine: 'Acorn Archimedes A310, 4 MiB, on the pinned Arculator WebAssembly core this build ships',
  firmware: 'RISC OS 3.11 (29 Sep 1992), carrying BBC BASIC V 1.05 (10 Apr 1992)',
  sha256: 'e916a0b84a2c8d96d43731ec9a02c9dff31312c95bca725b2b60e7eb3bfe7384',
  method: 'Typed through the emulated keyboard on the machine\u2019s own clock, then read back from the BASIC program area at &8F00.',
});
