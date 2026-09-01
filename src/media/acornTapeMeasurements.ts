/*
 * What real Acorn machines did with tapes this build wrote.
 *
 * Everything here was measured, not looked up. Each image was produced by
 * `acornTape.ts`, mounted on a machine booted from this build's own pinned
 * jsbeeb core with the ROM set the workbench ships against, and loaded by
 * typing at the machine the way somebody would. The transcripts are the
 * machines' own words, captured at WRCHV; the block bytes are what those
 * machines accepted.
 *
 * They are here because the tape block format belongs to the operating system
 * rather than to any emulator: no reader validates it, so a tape with a wrong
 * checksum or a misplaced address does not fail, it simply never finishes
 * loading. Freezing what worked is the only way a test on a machine without
 * copyright ROMs can still hold the encoder to what the hardware accepts.
 *
 * Three things were found this way and could not have been assumed:
 *
 *  - The Atom's block checksum covers the four synchronising asterisks. Leaving
 *    them out gives SUM ERROR 6 after the bytes are already correctly in
 *    memory.
 *  - Every Atom block carries its own load address. The BBC's blocks all repeat
 *    the file's, and the MOS advances; the Atom writes each block where its own
 *    header says, so repeating the file's address loads the file on top of
 *    itself.
 *  - The Atom needs a full leader before every block, not just the first. At
 *    0.5s and at 0.2s it read the first block and then waited in its pulse loop
 *    for ever.
 */

/** How the payloads under test are generated, so a test can rebuild them. */
export function measurementPayload(length: number, step: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * step + (i >> 8) * 3 + seed) & 0xff;
  return bytes;
}

export interface TapeLoadMeasurement {
  /** The machine, as this build's jsbeeb adapter names it. */
  model: string;
  /** What was typed at it. */
  typed: readonly string[];
  /** What it printed back, taken at WRCHV. */
  transcript: string;
  /** Whether every byte of the file arrived at its load address. */
  loaded: boolean;
}

export const BBC_B_TAPE_LOAD: TapeLoadMeasurement = {
  model: 'B',
  typed: ['*TAPE', '*LOAD GAME'],
  transcript: "*LOAD GAME\nSearching\n\nLoading\n\nGAME       00GAME       01 0140\n>",
  loaded: true,
};

export const MASTER_TAPE_LOAD: TapeLoadMeasurement = {
  model: 'Master',
  typed: ['*TAPE', '*LOAD GAME'],
  transcript: "*LOAD GAME\nSearching\n\nLoading\n\nGAME       00GAME       01 0140\n>",
  loaded: true,
};

export const ATOM_TAPE_LOAD: TapeLoadMeasurement = {
  model: 'Atom-Tape',
  /* The empty string is RETURN on its own: the Atom prints PLAY TAPE and then
   * waits for a key before it starts listening. */
  typed: ['*LOAD"GAME"', ''],
  transcript: "*LOAD\"GAME\"\nPLAY TAPE\n>",
  loaded: true,
};

/** A BBC BASIC program written here, saved to tape, and CHAINed on a BBC B. */
export const BBC_B_TAPE_CHAIN = {
  model: 'B',
  source: "10 PRINT \"TAPE LOADED\"\n20 PRINT \"DONE\"\n",
  typed: ['*TAPE', 'CHAIN"HELLO"'],
  transcript: "CHAIN\"HELLO\"\nSearching\n\nLoading\n\nHELLO      00 0023\nTAPE LOADED\nDONE\n>",
} as const;

/** The tokenised program that went onto that tape, as jsbeeb's tokeniser made it. */
export const BBC_B_TAPE_CHAIN_PROGRAM =
  "0d000a1420f1202254415045204c4f41444544220d00140d20f12022444f4e45220dff";

/** The file the BBC and the Master loaded: 320 bytes at &3000, named GAME. */
export const BBC_MEASURED_FILE = { name: 'GAME', loadAddress: 0x3000, executionAddress: 0x3000, length: 320, step: 7, seed: 3 } as const;

/** Its blocks, as those machines accepted them. */
export const BBC_MEASURED_BLOCKS: readonly string[] = [
  [
    "2a47414d45000030000000300000000000010000000000c762030a11181f262d343b424950575e656c737a81" +
    "888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5" +
    "bcc3cad1d8dfe6edf4fb020910171e252c333a41484f565d646b727980878e959ca3aab1b8bfc6cdd4dbe2e9" +
    "f0f7fe050c131a21282f363d444b525960676e757c838a91989fa6adb4bbc2c9d0d7dee5ecf3fa01080f161d" +
    "242b323940474e555c636a71787f868d949ba2a9b0b7bec5ccd3dae1e8eff6fd040b121920272e353c434a51" +
    "585f666d747b828990979ea5acb3bac1c8cfd6dde4ebf2f900070e151c232a31383f464d545b626970777e85" +
    "8c939aa1a8afb6bdc4cbd2d9e0e7eef5fcbc45",
  ].join(''),
  [
    "2a47414d4500003000000030000001004000800000000096dd060d141b222930373e454c535a61686f767d84" +
    "8b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020910171e252c333a41484f565d646b727980878e959ca3aab1b8" +
    "bf2816",
  ].join(''),
];

/** And the whole image, byte for byte. */
export const BBC_MEASURED_IMAGE =
  "5545462046696c6521000a00000019000000386269742d6e65742041636f726e20576f726b62656e6368001001020000" +
  "00c01200011b0100002a47414d45000030000000300000000000010000000000c762030a11181f262d343b424950575e" +
  "656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7ae" +
  "b5bcc3cad1d8dfe6edf4fb020910171e252c333a41484f565d646b727980878e959ca3aab1b8bfc6cdd4dbe2e9f0f7fe" +
  "050c131a21282f363d444b525960676e757c838a91989fa6adb4bbc2c9d0d7dee5ecf3fa01080f161d242b323940474e" +
  "555c636a71787f868d949ba2a9b0b7bec5ccd3dae1e8eff6fd040b121920272e353c434a51585f666d747b828990979e" +
  "a5acb3bac1c8cfd6dde4ebf2f900070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9e0e7ee" +
  "f5fcbc45160104000000cdcc4c3e100102000000700800015b0000002a47414d45000030000000300000010040008000" +
  "00000096dd060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020910171e252c" +
  "333a41484f565d646b727980878e959ca3aab1b8bf2816160104000000cdcccc3e";

/** The file the Atom loaded: 600 bytes at &2900 in three blocks, named GAME. */
export const ATOM_MEASURED_FILE = { name: 'GAME', loadAddress: 0x2900, executionAddress: 0x2900, length: 600, step: 7, seed: 11 } as const;

/** Its blocks, as the Atom accepted them. */
export const ATOM_MEASURED_BLOCKS: readonly string[] = [
  [
    "2a2a2a2a47414d450dc00000ff290029000b121920272e353c434a51585f666d747b828990979ea5acb3bac1" +
    "c8cfd6dde4ebf2f900070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9e0e7eef5" +
    "fc030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d141b2229" +
    "30373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020910171e252c333a41484f565d" +
    "646b727980878e959ca3aab1b8bfc6cdd4dbe2e9f0f7fe050c131a21282f363d444b525960676e757c838a91" +
    "989fa6adb4bbc2c9d0d7dee5ecf3fa01080f161d242b323940474e555c636a71787f868d949ba2a9b0b7bec5" +
    "ccd3dae1e8eff6fd0460",
  ].join(''),
  [
    "2a2a2a2a47414d450de00001ff29002a000e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4" +
    "cbd2d9e0e7eef5fc030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8" +
    "ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020910171e252c" +
    "333a41484f565d646b727980878e959ca3aab1b8bfc6cdd4dbe2e9f0f7fe050c131a21282f363d444b525960" +
    "676e757c838a91989fa6adb4bbc2c9d0d7dee5ecf3fa01080f161d242b323940474e555c636a71787f868d94" +
    "9ba2a9b0b7bec5ccd3dae1e8eff6fd040b121920272e353c434a51585f666d747b828990979ea5acb3bac1c8" +
    "cfd6dde4ebf2f9000782",
  ].join(''),
  [
    "2a2a2a2a47414d450d6000025729002b0011181f262d343b424950575e656c737a81888f969da4abb2b9c0c7" +
    "ced5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb" +
    "020910171e252c333a41484f565d646b7260",
  ].join(''),
];

/** And the whole image, byte for byte. */
export const ATOM_MEASURED_IMAGE =
  "5545462046696c6521000a00000019000000386269742d6e65742041636f726e20576f726b62656e6368001001020000" +
  "00c0120001120100002a2a2a2a47414d450dc00000ff290029000b121920272e353c434a51585f666d747b828990979e" +
  "a5acb3bac1c8cfd6dde4ebf2f900070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9e0e7ee" +
  "f5fc030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d141b222930373e" +
  "454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020910171e252c333a41484f565d646b727980878e" +
  "959ca3aab1b8bfc6cdd4dbe2e9f0f7fe050c131a21282f363d444b525960676e757c838a91989fa6adb4bbc2c9d0d7de" +
  "e5ecf3fa01080f161d242b323940474e555c636a71787f868d949ba2a9b0b7bec5ccd3dae1e8eff6fd04601001020000" +
  "00c0120001120100002a2a2a2a47414d450de00001ff29002a000e151c232a31383f464d545b626970777e858c939aa1" +
  "a8afb6bdc4cbd2d9e0e7eef5fc030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1" +
  "f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020910171e252c333a41" +
  "484f565d646b727980878e959ca3aab1b8bfc6cdd4dbe2e9f0f7fe050c131a21282f363d444b525960676e757c838a91" +
  "989fa6adb4bbc2c9d0d7dee5ecf3fa01080f161d242b323940474e555c636a71787f868d949ba2a9b0b7bec5ccd3dae1" +
  "e8eff6fd040b121920272e353c434a51585f666d747b828990979ea5acb3bac1c8cfd6dde4ebf2f90007821001020000" +
  "00c01200016a0000002a2a2a2a47414d450d6000025729002b0011181f262d343b424950575e656c737a81888f969da4" +
  "abb2b9c0c7ced5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4" +
  "fb020910171e252c333a41484f565d646b72601601040000000000003f";

/** Where these came from, for anyone reading a failure. */
export const ACORN_TAPE_MEASUREMENT_SOURCE =
  'Measured by mounting images written by src/media/acornTape.ts on BBC B, BBC Master and Acorn Atom machines ' +
  'booted under the pinned jsbeeb core this build ships, typing the load commands, and reading the transcripts at WRCHV ' +
  'and the loaded bytes out of machine memory.';
