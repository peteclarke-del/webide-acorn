import { describe, expect, it } from 'vitest';
import {
  BeebScsi,
  BeebScsiCard,
  SCSI_DATA_ADDRESS,
  SCSI_DESCRIPTOR_SIZE,
  SCSI_IRQ_ADDRESS,
  SCSI_SECTORS_PER_TRACK,
  SCSI_SECTOR_SIZE,
  SCSI_SELECT_ADDRESS,
  SCSI_STATUS_ADDRESS,
  SCSI_STATUS_BUSY,
  SCSI_STATUS_COMMAND,
  SCSI_STATUS_INPUT,
  SCSI_STATUS_IRQ,
  SCSI_STATUS_MESSAGE,
  SCSI_STATUS_REQUEST,
  lunDescriptorFor,
  lunSectorsFromDescriptor,
} from './beebScsi';

/** An image of a whole number of ACB-4000 tracks, which is what the card holds. */
function lunImage(tracks: number): Uint8Array {
  return new Uint8Array(tracks * SCSI_SECTORS_PER_TRACK * SCSI_SECTOR_SIZE);
}

/** Drive one command through the adapter and hand back what came out. */
function runCommand(board: BeebScsi, cdb: number[], dataOut: number[] = []): { data: number[]; status: number; message: number } {
  board.write(SCSI_SELECT_ADDRESS, 0x01);
  for (const byte of cdb) board.write(SCSI_DATA_ADDRESS, byte);
  for (const byte of dataOut) board.write(SCSI_DATA_ADDRESS, byte);
  const data: number[] = [];
  /* Data in runs until the drive puts the bus into the status phase. */
  while ((board.status() & SCSI_STATUS_INPUT) !== 0 && (board.status() & SCSI_STATUS_COMMAND) === 0) {
    data.push(board.read(SCSI_DATA_ADDRESS));
  }
  const status = board.read(SCSI_DATA_ADDRESS);
  const message = board.read(SCSI_DATA_ADDRESS);
  return { data, status, message };
}

/** A card with one started LUN 0, which is where most of these start. */
function startedBoard(tracks = 4): BeebScsi {
  const card = new BeebScsiCard();
  card.mount(0, lunImage(tracks));
  const board = new BeebScsi(card);
  runCommand(board, [0x1b, 0x00, 0x00, 0x00, 0x01, 0x00]); // start unit
  return board;
}

describe('BeebSCSI LUN descriptors', () => {
  it('derives an ACB-4000 geometry from an image that arrives without one', () => {
    /* 33 sectors of 256 bytes to a track, and the head count is the largest of
     * sixteen or fewer that divides the track count exactly. */
    const descriptor = lunDescriptorFor(lunImage(32).length);
    expect(descriptor).toHaveLength(SCSI_DESCRIPTOR_SIZE);
    expect(descriptor[3]).toBe(8); // extent descriptor list length
    expect((descriptor[9]! << 16) | (descriptor[10]! << 8) | descriptor[11]!).toBe(SCSI_SECTOR_SIZE);
    expect(descriptor[12]).toBe(1); // list format code
    expect(descriptor[15]).toBe(16); // heads
    expect((descriptor[13]! << 8) | descriptor[14]!).toBe(2); // cylinders
    expect(descriptor[17]).toBe(128);
    expect(descriptor[19]).toBe(128);
  });

  it('drops the head count until it divides the tracks rather than rounding the size', () => {
    const descriptor = lunDescriptorFor(lunImage(7).length);
    expect(descriptor[15]).toBe(7);
    expect((descriptor[13]! << 8) | descriptor[14]!).toBe(1);
    expect(lunSectorsFromDescriptor(descriptor)).toBe(7 * SCSI_SECTORS_PER_TRACK);
  });
});

describe('BeebSCSI host adapter registers', () => {
  it('reads back what was written to the data register while the drive is not driving the bus', () => {
    /* This is how ADFS decides a host adapter is fitted, so it has to work
     * from bus free with no drive answering. */
    const board = new BeebScsi();
    board.write(SCSI_DATA_ADDRESS, 0xa5);
    expect(board.read(SCSI_DATA_ADDRESS)).toBe(0xa5);
    board.write(SCSI_DATA_ADDRESS, 0x5a);
    expect(board.read(SCSI_DATA_ADDRESS)).toBe(0x5a);
  });

  it('is idle until SEL, and then busy and asking for a command byte', () => {
    const board = new BeebScsi();
    expect(board.status()).toBe(0);
    board.write(SCSI_SELECT_ADDRESS, 0x01);
    expect(board.status() & SCSI_STATUS_BUSY).toBe(SCSI_STATUS_BUSY);
    expect(board.status() & SCSI_STATUS_REQUEST).toBe(SCSI_STATUS_REQUEST);
    /* Command phase is C/D asserted with I/O clear: the host is doing the talking. */
    expect(board.status() & SCSI_STATUS_COMMAND).toBe(SCSI_STATUS_COMMAND);
    expect(board.status() & SCSI_STATUS_INPUT).toBe(0);
  });

  it('walks command, status and message and then lets the bus go', () => {
    const board = startedBoard();
    board.write(SCSI_SELECT_ADDRESS, 0x01);
    for (const byte of [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) board.write(SCSI_DATA_ADDRESS, byte);
    expect(board.status() & (SCSI_STATUS_COMMAND | SCSI_STATUS_INPUT)).toBe(SCSI_STATUS_COMMAND | SCSI_STATUS_INPUT);
    expect(board.status() & SCSI_STATUS_MESSAGE).toBe(0);
    expect(board.read(SCSI_DATA_ADDRESS)).toBe(0x00); // good status
    expect(board.status() & SCSI_STATUS_MESSAGE).toBe(SCSI_STATUS_MESSAGE);
    expect(board.read(SCSI_DATA_ADDRESS)).toBe(0x00); // command complete
    expect(board.status()).toBe(0); // bus free
  });

  it('interrupts only once the host has enabled it, and drops it when the host clears it', () => {
    const board = new BeebScsi();
    board.write(SCSI_SELECT_ADDRESS, 0x01);
    expect(board.irq).toBe(false);
    board.write(SCSI_IRQ_ADDRESS, 0x01);
    expect(board.irq).toBe(true);
    expect(board.status() & SCSI_STATUS_IRQ).toBe(SCSI_STATUS_IRQ);
    board.write(SCSI_IRQ_ADDRESS, 0x00);
    expect(board.irq).toBe(false);
  });

  it('answers the status address rather than the data register', () => {
    const board = new BeebScsi();
    board.write(SCSI_DATA_ADDRESS, 0xff);
    expect(board.read(SCSI_STATUS_ADDRESS)).toBe(0);
  });
});

describe('BeebSCSI group 0 commands', () => {
  it('reports a LUN with no image as not ready, and says why when asked', () => {
    const board = new BeebScsi();
    const unready = runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(unready.status).toBe(0x02);
    const sense = runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    expect(sense.status).toBe(0x00);
    expect(sense.data[0]).toBe(0x02); // class 0, code 2: unit not ready
  });

  it('reports no error at all once the sense has been read', () => {
    const board = new BeebScsi();
    runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    const second = runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    expect(second.data).toEqual([0, 0, 0, 0]);
  });

  it('keeps sense per LUN rather than one store for the board', () => {
    const card = new BeebScsiCard();
    card.mount(1, lunImage(1));
    const board = new BeebScsi(card);
    runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // LUN 0, not ready
    const lun1 = runCommand(board, [0x03, 0x20, 0x00, 0x00, 0x04, 0x00]);
    expect(lun1.data[0]).toBe(0x00);
    const lun0 = runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    expect(lun0.data[0]).toBe(0x02);
  });

  it('starts a LUN that has an image and refuses one that does not', () => {
    const card = new BeebScsiCard();
    card.mount(0, lunImage(1));
    const board = new BeebScsi(card);
    expect(runCommand(board, [0x1b, 0x00, 0x00, 0x00, 0x01, 0x00]).status).toBe(0x00);
    expect(runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x00);
    /* LUN 1 has no image, and the failing status carries the LUN in its top bits. */
    expect(runCommand(board, [0x1b, 0x20, 0x00, 0x00, 0x01, 0x00]).status).toBe(0x22);
  });

  it('stops a LUN and keeps it stopped over a host reset', () => {
    const board = startedBoard();
    expect(runCommand(board, [0x1b, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x00);
    expect(runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x02);
    board.reset();
    expect(runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x02);
  });

  it('auto-starts a stopped LUN on a read, the way the Adaptec card did', () => {
    const card = new BeebScsiCard();
    card.mount(0, lunImage(1));
    const board = new BeebScsi(card);
    expect(runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x02);
    const read = runCommand(board, [0x08, 0x00, 0x00, 0x00, 0x01, 0x00]);
    expect(read.status).toBe(0x00);
    expect(read.data).toHaveLength(SCSI_SECTOR_SIZE);
    expect(runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x00);
  });

  it('writes a sector and reads the same bytes back', () => {
    const board = startedBoard();
    const sector = Array.from({ length: SCSI_SECTOR_SIZE }, (_entry, index) => (index * 7) & 0xff);
    expect(runCommand(board, [0x0a, 0x00, 0x00, 0x05, 0x01, 0x00], sector).status).toBe(0x00);
    const read = runCommand(board, [0x08, 0x00, 0x00, 0x05, 0x01, 0x00]);
    expect(read.data).toEqual(sector);
    /* And the sector next door is untouched. */
    expect(runCommand(board, [0x08, 0x00, 0x00, 0x06, 0x01, 0x00]).data.every((byte) => byte === 0)).toBe(true);
  });

  it('reads and writes runs of sectors, with a count of zero meaning 256', () => {
    const board = startedBoard(16);
    const run = Array.from({ length: 4 * SCSI_SECTOR_SIZE }, (_entry, index) => index & 0xff);
    expect(runCommand(board, [0x0a, 0x00, 0x00, 0x10, 0x04, 0x00], run).status).toBe(0x00);
    expect(runCommand(board, [0x08, 0x00, 0x00, 0x10, 0x04, 0x00]).data).toEqual(run);
    expect(runCommand(board, [0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).data).toHaveLength(256 * SCSI_SECTOR_SIZE);
  });

  it('takes the twenty-one bit block address from three bytes of the command block', () => {
    const board = startedBoard(64);
    /* Byte 1 carries the LUN in its top three bits and the top five bits of the
     * block address in the rest, so a LUN and a high address share a byte. */
    const sector = Array.from({ length: SCSI_SECTOR_SIZE }, () => 0x2a);
    runCommand(board, [0x0a, 0x00, 0x01, 0x00, 0x01, 0x00], sector);
    expect(runCommand(board, [0x08, 0x00, 0x01, 0x00, 0x01, 0x00]).data).toEqual(sector);
    expect(runCommand(board, [0x08, 0x00, 0x00, 0x00, 0x01, 0x00]).data.every((byte) => byte === 0)).toBe(true);
  });

  it('refuses a block address past the end of the LUN and reports it with the address', () => {
    const board = startedBoard(1);
    const past = runCommand(board, [0x08, 0x00, 0x00, 0xfe, 0x04, 0x00]);
    expect(past.status).toBe(0x02);
    const sense = runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    expect(sense.data[0]).toBe(0xa1); // address valid, class 2, code 0x21
    expect((sense.data[1]! << 16) | (sense.data[2]! << 8) | sense.data[3]!).toBe(0xfe);
  });

  it('hands back the descriptor on mode sense and takes a new one on mode select', () => {
    const board = startedBoard(4);
    const sense = runCommand(board, [0x1a, 0x00, 0x00, 0x00, SCSI_DESCRIPTOR_SIZE, 0x00]);
    expect(sense.data).toHaveLength(SCSI_DESCRIPTOR_SIZE);
    expect(sense.data[15]).toBe(4); // heads, from a four track image

    const replacement = Array.from(lunDescriptorFor(lunImage(9).length));
    expect(runCommand(board, [0x15, 0x00, 0x00, 0x00, SCSI_DESCRIPTOR_SIZE, 0x00], replacement).status).toBe(0x00);
    expect(runCommand(board, [0x1a, 0x00, 0x00, 0x00, SCSI_DESCRIPTOR_SIZE, 0x00]).data).toEqual(replacement);
  });

  it('rejects a parameter list that is not the twenty-two bytes of a soft-sectored drive', () => {
    const board = startedBoard();
    expect(runCommand(board, [0x1a, 0x00, 0x00, 0x00, 0x0c, 0x00]).status).toBe(0x02);
    const sense = runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    expect(sense.data[0]).toBe(0x24); // class 2, code 4: bad argument
  });

  it('creates a LUN image on format, so Superform has something to format', () => {
    const card = new BeebScsiCard();
    const board = new BeebScsi(card);
    const descriptor = Array.from(lunDescriptorFor(lunImage(4).length));
    runCommand(board, [0x15, 0x00, 0x00, 0x00, SCSI_DESCRIPTOR_SIZE, 0x00], descriptor);
    expect(runCommand(board, [0x04, 0x00, 0x6c, 0x00, 0x00, 0x00]).status).toBe(0x00);
    expect(card.present()).toEqual([0]);
    expect(runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x00);
  });

  it('reads and discards a defect list when the format options ask for one', () => {
    const board = startedBoard();
    /* Option 28 means a defect list follows: a four byte header whose last two
     * bytes give the length, then that many bytes of records. */
    const result = runCommand(board, [0x04, 0x1c, 0x6c, 0x00, 0x00, 0x00], [0x00, 0x00, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.status).toBe(0x00);
  });

  it('translates a block address into the cylinder, head and offset an ACB-4000 would give', () => {
    const board = startedBoard(4); // 4 tracks, so 4 heads and 1 cylinder
    const lba = SCSI_SECTORS_PER_TRACK * 2 + 5;
    const translated = runCommand(board, [0x0f, 0x00, 0x00, lba, 0x00, 0x00]);
    expect(translated.status).toBe(0x00);
    expect(translated.data).toHaveLength(8);
    expect((translated.data[0]! << 16) | (translated.data[1]! << 8) | translated.data[2]!).toBe(0);
    expect(translated.data[3]).toBe(2);
    const bytesFromIndex = (translated.data[4]! << 24) | (translated.data[5]! << 16) | (translated.data[6]! << 8) | translated.data[7]!;
    expect(bytesFromIndex).toBe(5 * SCSI_SECTOR_SIZE);
  });

  it('accepts seek and re-zero unit, which a solid state drive has nothing to do about', () => {
    const board = startedBoard();
    expect(runCommand(board, [0x0b, 0x00, 0x00, 0x10, 0x00, 0x00]).status).toBe(0x00);
    expect(runCommand(board, [0x01, 0x00, 0x00, 0x00, 0x00, 0x00]).status).toBe(0x00);
  });
});

describe('BeebSCSI group 1 and group 6 commands', () => {
  it('verifies a range inside the LUN and refuses one that runs off the end', () => {
    const board = startedBoard(1);
    /* The Master welcome disc's *VERIFY sends this. A group 1 block carries ten
     * bytes, with four of block address and two of block count. */
    expect(runCommand(board, [0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00]).status).toBe(0x00);
    expect(runCommand(board, [0x2f, 0x00, 0x00, 0x00, 0x00, 0xfe, 0x00, 0x00, 0x40, 0x00]).status).toBe(0x02);
  });

  it('reports its own state through the BeebSCSI sense command', () => {
    const board = startedBoard();
    const sense = runCommand(board, [0xd0, 0x00, 0x00, 0x00, 0x01, 0x00]);
    expect(sense.status).toBe(0x00);
    expect(sense.data).toHaveLength(8);
    expect(sense.data[0]).toBe(0x01); // LUN 0 started, and nothing else
    expect(sense.data[1]).toBe(0); // LUN directory zero
    expect(sense.data[2]).toBe(0); // external bus: a fixed drive
    expect(sense.data.slice(5)).toEqual([0, 0, 0]);
  });

  it('changes LUN directory only while every LUN is stopped', () => {
    const card = new BeebScsiCard();
    card.mount(0, lunImage(1), undefined, 0);
    card.mount(0, lunImage(2), undefined, 1);
    const board = new BeebScsi(card);
    runCommand(board, [0x1b, 0x00, 0x00, 0x00, 0x01, 0x00]);
    expect(runCommand(board, [0xd1, 0x00, 0x00, 0x00, 0x01, 0x00], [1, 0, 0, 0, 0, 0, 0, 0]).status).toBe(0x02);
    expect(card.directory).toBe(0);

    runCommand(board, [0x1b, 0x00, 0x00, 0x00, 0x00, 0x00]); // stop LUN 0
    expect(runCommand(board, [0xd1, 0x00, 0x00, 0x00, 0x01, 0x00], [1, 0, 0, 0, 0, 0, 0, 0]).status).toBe(0x00);
    expect(card.directory).toBe(1);
    /* The other directory's image is a different size, which is how you can
     * tell the jukebox moved. */
    runCommand(board, [0x1b, 0x00, 0x00, 0x00, 0x01, 0x00]);
    expect(runCommand(board, [0x1a, 0x00, 0x00, 0x00, SCSI_DESCRIPTOR_SIZE, 0x00]).data[15]).toBe(2);
  });

  it('refuses an opcode it does not implement rather than hanging the bus', () => {
    const board = startedBoard();
    const result = runCommand(board, [0x1f, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(result.status).toBe(0x02);
    expect(runCommand(board, [0x03, 0x00, 0x00, 0x00, 0x04, 0x00]).data[0]).toBe(0x20); // invalid command
  });
});

describe('BeebSCSI debugger state', () => {
  it('reports the phase, the started LUNs and the last command block', () => {
    const board = startedBoard();
    runCommand(board, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const state = board.snapshotState();
    expect(state.phase).toBe('busfree');
    expect(state.busy).toBe(false);
    expect(state.startedLuns).toEqual([0]);
    expect(state.presentLuns).toEqual([0]);
    expect(state.lastCommand).toEqual([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(state.lastStatus).toBe(0x00);
  });

  it('records the configuration byte the host sent, which is not a SCSI command', () => {
    const board = new BeebScsi();
    board.write(0xfc44, 12); // SCSI command tracing on
    expect(board.snapshotState().configuration).toBe(12);
    expect(board.status()).toBe(0); // and the bus never moved
  });
});
