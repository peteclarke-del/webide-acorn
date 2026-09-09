import { describe, expect, it } from 'vitest';
import {
  BEEBSCSI_ADFS_STARTUP,
  BEEBSCSI_FINAL_STATE,
  BEEBSCSI_IMAGE_AFTER_WRITE,
  BEEBSCSI_MEASURED_FIRMWARE,
  BEEBSCSI_SECTOR_TRANSFERS,
} from './beebScsiMeasurements';
import { BeebScsi, BeebScsiCard, SCSI_DATA_ADDRESS, SCSI_SECTOR_SIZE, SCSI_SELECT_ADDRESS } from './beebScsi';
import { createBlankLunImage } from '../media/beebScsiLun';

/*
 * The board, held to what ADFS actually said.
 *
 * `scripts/measureBeebScsi.mjs` boots a real Model B with a real Acorn ADFS
 * ROM. What it printed is recorded in `beebScsiMeasurements.ts`. These check
 * that the board still produces the bytes those answers were made of, so a
 * change that would make ADFS say something different fails here rather than
 * the next time somebody runs the script.
 */

/** The same pattern the measurement put in the image. */
const patternByte = (sector: number, offset: number) => (sector * 16 + offset) & 0xff;

/** Drive one command through the adapter, as the host adapter's registers do. */
function runCommand(board: BeebScsi, cdb: number[], dataOut: number[] = []): { data: number[]; status: number } {
  board.write(SCSI_SELECT_ADDRESS, 0x01);
  for (const byte of [...cdb, ...dataOut]) board.write(SCSI_DATA_ADDRESS, byte);
  const data: number[] = [];
  while ((board.status() & 0x40) !== 0 && (board.status() & 0x80) === 0) data.push(board.read(SCSI_DATA_ADDRESS));
  const status = board.read(SCSI_DATA_ADDRESS);
  board.read(SCSI_DATA_ADDRESS); // message
  return { data, status };
}

function patternedBoard(): { board: BeebScsi; card: BeebScsiCard } {
  const blank = createBlankLunImage(32);
  const data = new Uint8Array(blank.geometry.sectors * SCSI_SECTOR_SIZE);
  for (let sector = 0; sector < 8; sector++) {
    for (let offset = 0; offset < SCSI_SECTOR_SIZE; offset++) data[sector * SCSI_SECTOR_SIZE + offset] = patternByte(sector, offset);
  }
  const card = new BeebScsiCard();
  card.mount(0, data, blank.descriptor);
  return { board: new BeebScsi(card), card };
}

describe('what ADFS was measured saying about this board', () => {
  it('was measured against the ADFS ROM set this build offers, not a stand-in', () => {
    expect(BEEBSCSI_MEASURED_FIRMWARE).toContain('b1770/zADFS.ROM');
    expect(BEEBSCSI_ADFS_STARTUP.map((entry) => entry.printed.split('\n').at(-1))).toEqual([
      'Disc error 2C at :0/000000',
      'Broken directory',
    ]);
  });

  it('still assembles the &2C sense byte that ADFS printed for an empty card', () => {
    /* ADFS reads the root directory, the drive has no image for LUN 0, and the
     * failing status sends it to Request Sense. The byte it gets back is the
     * one it prints. */
    const board = new BeebScsi();
    expect(runCommand(board, [0x08, 0x00, 0x00, 0x02, 0x05, 0x00]).status).toBe(0x02);
    expect(runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]).data[0]).toBe(0x2c);
  });

  it('still completes the root directory read that made ADFS say the directory was broken', () => {
    const blank = createBlankLunImage(32);
    const card = new BeebScsiCard();
    card.mount(0, blank.data, blank.descriptor);
    const board = new BeebScsi(card);
    /* Five blocks from block 2 is the old-format ADFS root directory, and an
     * unwritten image returns them as zeros with good status. */
    const read = runCommand(board, [0x08, 0x00, 0x00, 0x02, 0x05, 0x00]);
    expect(read.status).toBe(0x00);
    expect(read.data).toHaveLength(5 * SCSI_SECTOR_SIZE);
    expect(read.data.every((byte) => byte === 0)).toBe(true);
  });

  it('still returns the bytes ADFS printed for the block it read', () => {
    const { board } = patternedBoard();
    const read = runCommand(board, [0x08, 0x00, 0x00, 0x03, 0x01, 0x00]);
    const printed = [read.data[0]!, read.data[1]!, read.data[2]!, read.data[255]!]
      .map((byte) => byte.toString(16).toUpperCase())
      .join(' ');
    expect(printed).toBe('30 31 32 2F');
    expect(BEEBSCSI_SECTOR_TRANSFERS[0]!.printed.split(/\s+/).filter(Boolean).join(' ')).toBe(printed);
  });

  it('still takes the block ADFS wrote and gives it back', () => {
    const { board, card } = patternedBoard();
    const payload = Array.from({ length: SCSI_SECTOR_SIZE }, (unused, index) => 255 - index);
    expect(runCommand(board, [0x0a, 0x00, 0x00, 0x09, 0x01, 0x00], payload).status).toBe(0x00);
    const read = runCommand(board, [0x08, 0x00, 0x00, 0x09, 0x01, 0x00]);
    const printed = [read.data[0]!, read.data[1]!, read.data[255]!].map((byte) => byte.toString(16).toUpperCase()).join(' ');
    expect(printed).toBe('FF FE 0');
    expect(BEEBSCSI_SECTOR_TRANSFERS[1]!.printed.split(/\s+/).filter(Boolean).join(' ')).toBe(printed);

    const image = card.image(0)!;
    expect(image.revision).toBe(BEEBSCSI_IMAGE_AFTER_WRITE.revision);
    const block = BEEBSCSI_IMAGE_AFTER_WRITE.block * SCSI_SECTOR_SIZE;
    expect([image.data[block], image.data[block + 1]]).toEqual([...BEEBSCSI_IMAGE_AFTER_WRITE.firstBytes]);
    expect(image.data[block + 255]).toBe(BEEBSCSI_IMAGE_AFTER_WRITE.lastByte);
  });

  it('still ends where the measurement found it, with the bus free and the LUN started', () => {
    const { board } = patternedBoard();
    runCommand(board, [...BEEBSCSI_FINAL_STATE.lastCommand]);
    const state = board.snapshotState();
    expect(state.phase).toBe(BEEBSCSI_FINAL_STATE.phase);
    expect(state.startedLuns).toEqual([...BEEBSCSI_FINAL_STATE.startedLuns]);
    expect(state.lastCommand).toEqual([...BEEBSCSI_FINAL_STATE.lastCommand]);
    expect(state.lastStatus).toBe(BEEBSCSI_FINAL_STATE.lastStatus);
  });
});
