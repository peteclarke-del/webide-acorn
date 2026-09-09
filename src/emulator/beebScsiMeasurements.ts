/*
 * What a real Acorn ADFS said when it was pointed at this BeebSCSI board.
 *
 * The board here is written from BeebSCSI's published documentation rather than
 * ported from another emulator, so every claim about it is a claim about code
 * written for this product. The way to make such a claim worth anything is to
 * put a real ADFS ROM in front of it and record what the machine said, which is
 * what these are. `scripts/measureBeebScsi.mjs` reproduces all of it against a
 * firmware vault.
 *
 * Four answers, each of which a wrong board would get visibly wrong.
 */

export const BEEBSCSI_MEASUREMENT_SOURCE =
  'Measured by booting a BBC Model B with Acorn ADFS and a BeebSCSI board on the 1 MHz bus, and asking ADFS at its own keyboard.';

/** The firmware the measurement was taken with. */
export const BEEBSCSI_MEASURED_FIRMWARE = ['os.rom', 'BASIC.ROM', 'b1770/zADFS.ROM', 'b1770/dfs1770.rom'] as const;

/**
 * What ADFS printed at startup, with the card empty and then with an
 * unformatted LUN on it.
 *
 * The first is the whole of the error path in one line. ADFS tried to read the
 * root directory, the drive had no image for LUN 0 and could not start it, and
 * the failing status sent ADFS to Request Sense. `2C` is the sense byte the
 * drive assembled from error class 2 and error code &1C, of which the byte
 * carries the low nibble, as the ACB-4000 layout says. ADFS printed it
 * verbatim, which is only possible if the status phase, the message phase and
 * the sense command all behaved.
 *
 * The second is the success path reaching a disc that has nothing on it. The
 * read of five sectors from block 2 completed with good status and returned the
 * zeros of an image that has never been written, and ADFS correctly called that
 * a broken directory rather than a fault.
 */
export const BEEBSCSI_ADFS_STARTUP = [
  {
    card: 'no LUN image at all',
    printed: 'BBC Computer 32K\n\nAcorn ADFS\n\nDisc error 2C at :0/000000',
    establishes: 'ADFS found the host adapter, selected the drive, was refused, and printed back the sense byte the drive returned.',
  },
  {
    card: 'one 32 track LUN, never formatted',
    printed: 'BBC Computer 32K\n\nAcorn ADFS\n\nBroken directory',
    establishes: 'The read of the root directory completed with good status and returned unwritten space, which is a broken directory and not a disc fault.',
  },
] as const;

/**
 * A sector read and a sector written, through the operating system.
 *
 * Both go through OSWORD &72, which is the call BeebSCSI's own documentation
 * uses in its BASIC examples, so this is the interface the board is documented
 * against rather than one picked for convenience. The image carries a pattern
 * whose value depends on both the block number and the offset within it, so a
 * read of the wrong block or from the wrong offset gives a wrong answer instead
 * of a plausible one.
 */
export const BEEBSCSI_SECTOR_TRANSFERS = [
  {
    typed: 'a one block read of block 3, then PRINT of bytes 0, 1, 2 and 255',
    printed: '        30        31        32        2F',
    establishes: 'The command block carried the block number, the data-in phase moved 256 bytes, and every one of them was the byte the image holds.',
  },
  {
    typed: 'a one block write of block 9, the buffer cleared, then the same block read back',
    printed: '        FF        FE         0',
    establishes: 'The data-out phase took all 256 bytes and put them in the image, and reading them back returned them.',
  },
] as const;

/** What the LUN image held once the machine had finished with it. */
export const BEEBSCSI_IMAGE_AFTER_WRITE = {
  revision: 1,
  block: 9,
  firstBytes: [255, 254] as const,
  lastByte: 0,
} as const;

/** The last thing on the bus, and the state the board was left in. */
export const BEEBSCSI_FINAL_STATE = {
  phase: 'busfree',
  startedLuns: [0] as const,
  /* Read, LUN 0, block 9, one block. */
  lastCommand: [0x08, 0x00, 0x00, 0x09, 0x01, 0x00] as const,
  lastStatus: 0x00,
} as const;
