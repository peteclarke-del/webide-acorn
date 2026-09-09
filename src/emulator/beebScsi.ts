/*
 * BeebSCSI: an Acorn SCSI host adapter and the SCSI-1 drive behind it.
 *
 * Written from the project's own documentation rather than from any existing
 * emulator. The register map and the signal behaviour come from the CPLD
 * Verilog that BeebSCSI publishes as its host adapter (hostAdapter.v and
 * hostAdapterAddressDecoder.v), and the command set comes from the BeebSCSI
 * Technical Guide. Both are at https://github.com/simoninns/BeebSCSI and
 * https://www.domesday86.com. Where the guide cites the Adaptec ACB-4000
 * manual for a byte layout, so does this file.
 *
 * What the host sees, on the external 1 MHz bus:
 *
 *   &FC40 read   read a byte from the SCSI data bus
 *   &FC40 write  write a byte to the SCSI data bus
 *   &FC41 read   the status byte
 *   &FC42 write  assert SEL, which selects the drive
 *   &FC43 write  bit 0 enables the host interrupt
 *   &FC44 write  a BeebSCSI configuration byte, which is not a SCSI command
 *
 * Nothing else in the &FCxx page belongs to the board. &FC45 upwards is not
 * decoded and is left to whatever else is on the bus.
 *
 * Two details in that Verilog are easy to miss and both matter. Every access
 * to &FC40, read or write, clocks ACK, so a read during a phase where the
 * drive is expecting a byte hands the drive whatever was last written. And
 * when the drive is not driving the bus the adapter loops its own data-in
 * latch back to the host, which is how ADFS decides the board is fitted: it
 * writes a byte to &FC40 and reads it back.
 */

/** The five addresses the host adapter decodes, plus the BeebSCSI extra. */
export const SCSI_DATA_ADDRESS = 0xfc40;
export const SCSI_STATUS_ADDRESS = 0xfc41;
export const SCSI_SELECT_ADDRESS = 0xfc42;
export const SCSI_IRQ_ADDRESS = 0xfc43;
export const SCSI_CONFIG_ADDRESS = 0xfc44;

/** Status byte bits, as the CPLD assembles them for the external bus. */
export const SCSI_STATUS_MESSAGE = 0x01;
export const SCSI_STATUS_BUSY = 0x02;
export const SCSI_STATUS_IRQ = 0x10;
export const SCSI_STATUS_REQUEST = 0x20;
export const SCSI_STATUS_INPUT = 0x40;
export const SCSI_STATUS_COMMAND = 0x80;

/**
 * Acorn SCSI geometry. The sector is 256 bytes and a track holds 33 of them,
 * because that is what the ACB-4000 card Acorn shipped did, and Acorn's own
 * formatters still expect it. ADFS carries a 21 bit sector number, which is
 * where the 512 MB ceiling on one LUN comes from.
 */
export const SCSI_SECTOR_SIZE = 256;
export const SCSI_SECTORS_PER_TRACK = 33;
export const SCSI_DESCRIPTOR_SIZE = 22;
export const SCSI_MAX_LUN_SECTORS = 0x1fffff;
export const SCSI_MAX_LUN_BYTES = SCSI_MAX_LUN_SECTORS * SCSI_SECTOR_SIZE;

/** ADFS reaches four LUNs; VFS reaches eight, and the drive answers for eight. */
export const SCSI_LUN_COUNT = 8;

/** Jukeboxing selects a LUN directory on the card, numbered from zero. */
export const SCSI_MAX_LUN_DIRECTORY = 9;

/** The firmware revision the board reports through its own sense command. */
export const BEEBSCSI_FIRMWARE_MAJOR = 2;
export const BEEBSCSI_FIRMWARE_MINOR = 3;

export type ScsiPhase = 'busfree' | 'command' | 'dataout' | 'datain' | 'status' | 'message';

/** One LUN image and the descriptor that says what shape it is. */
export interface ScsiLunImage {
  /* Sectors actually written. A LUN image is sparse in exactly the way the
   * board's own is: the file grows as sectors are written and a read past the
   * end is a read of unwritten space, not an error. */
  data: Uint8Array;
  descriptor: Uint8Array;
  /* How many write commands have landed on this image since it was mounted.
   * Zero means the bytes are still the ones that arrived, which is what tells
   * the workbench whether an export is worth offering. */
  revision: number;
}

/**
 * The descriptor a LUN gets when it arrives without one.
 *
 * The Technical Guide describes this under Mode Select: an image copied to the
 * card without its .dsc gets one built from its size, on the assumption of an
 * ACB-4000. Byte layout is that manual's figures 5-18, 5-19 and 5-20.
 */
export function lunDescriptorFor(byteLength: number): Uint8Array {
  const tracks = Math.floor(byteLength / (SCSI_SECTOR_SIZE * SCSI_SECTORS_PER_TRACK));
  let heads = 16;
  while (heads > 1 && tracks % heads !== 0) heads -= 1;
  const cylinders = heads === 0 ? 0 : Math.floor(tracks / heads);

  const descriptor = new Uint8Array(SCSI_DESCRIPTOR_SIZE);
  descriptor[3] = 8; // length of the extent descriptor list
  descriptor[10] = 1; // block size, 0x000100 = 256
  descriptor[12] = 1; // list format code
  descriptor[13] = (cylinders >> 8) & 0xff;
  descriptor[14] = cylinders & 0xff;
  descriptor[15] = heads & 0xff;
  descriptor[17] = 128; // reduced write current cylinder
  descriptor[19] = 128; // write pre-compensation cylinder
  return descriptor;
}

/** The size a descriptor claims, in sectors: heads by cylinders by 33. */
export function lunSectorsFromDescriptor(descriptor: Uint8Array): number {
  const cylinders = ((descriptor[13] ?? 0) << 8) | (descriptor[14] ?? 0);
  const heads = descriptor[15] ?? 0;
  return cylinders * heads * SCSI_SECTORS_PER_TRACK;
}

/**
 * The card. One BeebSCSI board reads one micro SD card, and the card holds
 * numbered LUN directories, each with up to eight LUN images in it.
 */
export class BeebScsiCard {
  private readonly images = new Map<string, ScsiLunImage>();

  /** Which LUN directory the board is reading, as the Select command sets it. */
  directory = 0;

  private key(lun: number, directory = this.directory): string {
    return `${directory}:${lun}`;
  }

  /** Put a LUN image on the card. Without a descriptor, one is derived. */
  mount(lun: number, data: Uint8Array, descriptor?: Uint8Array, directory = this.directory): void {
    this.images.set(this.key(lun, directory), {
      data,
      descriptor: descriptor ? Uint8Array.from(descriptor) : lunDescriptorFor(data.length),
      revision: 0,
    });
  }

  /** Take a LUN image off the card. */
  eject(lun: number, directory = this.directory): void {
    this.images.delete(this.key(lun, directory));
  }

  /** The image for a LUN in the current directory, or null when there is none. */
  image(lun: number): ScsiLunImage | null {
    return this.images.get(this.key(lun)) ?? null;
  }

  /** Which LUNs in the current directory hold an image. */
  present(): number[] {
    const found: number[] = [];
    for (let lun = 0; lun < SCSI_LUN_COUNT; lun++) if (this.image(lun)) found.push(lun);
    return found;
  }
}

/** Request sense state, kept per LUN as the VP415 does rather than once for the board. */
interface SenseRecord {
  errorFlag: boolean;
  validAddress: boolean;
  errorClass: number;
  errorCode: number;
  logicalBlockAddress: number;
}

function emptySense(): SenseRecord {
  return { errorFlag: false, validAddress: false, errorClass: 0, errorCode: 0, logicalBlockAddress: 0 };
}

/** What the debugger is shown. */
export interface BeebScsiState {
  phase: ScsiPhase;
  busy: boolean;
  request: boolean;
  irqEnabled: boolean;
  irq: boolean;
  statusByte: number;
  lunDirectory: number;
  startedLuns: number[];
  presentLuns: number[];
  lastCommand: number[];
  lastStatus: number;
  transferRemaining: number;
  configuration: number;
}

export class BeebScsi {
  private phase: ScsiPhase = 'busfree';

  /* The adapter's data-in latch. It holds the last byte the host wrote to
   * &FC40 and is what a read returns while the drive is not driving the bus. */
  private dataLatch = 0;

  private irqEnabled = false;
  private irqLatched = false;

  private readonly command = new Uint8Array(10);
  private commandLength = 0;
  private commandFilled = 0;

  /* Bytes going to the host in a data-in phase, and bytes arriving from it in
   * a data-out phase. Only one is ever live. */
  private transfer: Uint8Array | null = null;
  private transferIndex = 0;
  private onDataOut: ((payload: Uint8Array) => void) | null = null;

  private statusByte = 0;
  private messageByte = 0;

  private readonly sense: SenseRecord[] = Array.from({ length: SCSI_LUN_COUNT }, emptySense);

  /** One byte of the command block, which is zero where the block is shorter. */
  private cdb(index: number): number {
    return this.command[index] ?? 0;
  }

  /** The sense record for a LUN, which every LUN in range has. */
  private senseFor(lun: number): SenseRecord {
    return (this.sense[lun] ??= emptySense());
  }
  private readonly started: boolean[] = new Array(SCSI_LUN_COUNT).fill(false);

  private configuration = 0;
  private lastCommand: number[] = [];

  constructor(readonly card: BeebScsiCard = new BeebScsiCard()) {}

  /* ------------------------------------------------------------------ *
   * The host adapter registers
   * ------------------------------------------------------------------ */

  /** True while the drive is waiting for the host to move a byte. */
  private get request(): boolean {
    return this.phase !== 'busfree';
  }

  /** True while the drive is driving the data bus rather than the host. */
  private get driving(): boolean {
    return this.phase === 'datain' || this.phase === 'status' || this.phase === 'message';
  }

  /** The status byte, assembled as the CPLD assembles it for the external bus. */
  status(): number {
    let value = 0;
    if (this.phase === 'message') value |= SCSI_STATUS_MESSAGE;
    if (this.phase !== 'busfree') value |= SCSI_STATUS_BUSY;
    if (this.irqLatched) value |= SCSI_STATUS_IRQ;
    if (this.request) value |= SCSI_STATUS_REQUEST;
    if (this.driving) value |= SCSI_STATUS_INPUT;
    if (this.phase === 'command' || this.phase === 'status' || this.phase === 'message') value |= SCSI_STATUS_COMMAND;
    return value;
  }

  /** Whether the board is pulling the host's interrupt line down. */
  get irq(): boolean {
    return this.irqLatched;
  }

  read(address: number): number {
    if (address === SCSI_STATUS_ADDRESS) return this.status();
    if (address !== SCSI_DATA_ADDRESS) return address >>> 8;

    /* A read of &FC40 clocks ACK whatever the phase. When the drive is not
     * driving the bus the host reads its own latch back, and the drive still
     * takes a byte if it was waiting for one. */
    const driving = this.driving;
    const value = driving ? this.nextByteToHost() : this.dataLatch;
    if (!driving) this.acceptByteFromHost(this.dataLatch);
    this.raiseIrqIfWaiting();
    return value;
  }

  write(address: number, value: number): void {
    const byte = value & 0xff;
    if (address === SCSI_DATA_ADDRESS) {
      this.dataLatch = byte;
      /* A write clocks ACK too. In a phase where the drive is talking, the
       * host has thrown a byte away; in one where it is listening, this is the
       * byte. */
      if (this.driving) this.nextByteToHost();
      else this.acceptByteFromHost(byte);
      this.raiseIrqIfWaiting();
      return;
    }
    if (address === SCSI_SELECT_ADDRESS) {
      this.select();
      return;
    }
    if (address === SCSI_IRQ_ADDRESS) {
      this.irqEnabled = (byte & 0x01) !== 0;
      /* The second stage is a NAND latch reset by the enable going away, so
       * clearing the enable is how the host's handler drops the interrupt. */
      if (!this.irqEnabled) this.irqLatched = false;
      else this.raiseIrqIfWaiting();
      return;
    }
    if (address === SCSI_CONFIG_ADDRESS) {
      /* Not a SCSI command. On a real board this steers the serial tracing,
       * which has nowhere to go here, so the byte is recorded and no more. */
      this.configuration = byte;
    }
  }

  /**
   * The host's reset line, which the adapter passes straight to the drive.
   *
   * The bus goes free and the interrupt logic clears, but which LUNs are
   * started does not change: the Technical Guide is explicit that a stopped
   * LUN stays stopped across a host reset, the same as a real drive.
   */
  reset(): void {
    this.phase = 'busfree';
    this.transfer = null;
    this.transferIndex = 0;
    this.onDataOut = null;
    this.commandFilled = 0;
    this.commandLength = 0;
    this.irqEnabled = false;
    this.irqLatched = false;
    for (const record of this.sense) Object.assign(record, emptySense());
  }

  private raiseIrqIfWaiting(): void {
    if (this.irqEnabled && this.request) this.irqLatched = true;
  }

  private select(): void {
    /* SEL only means anything from bus free. The drive answers by asserting
     * BSY and moving to the command phase; the byte on the bus is the host
     * identifier, which a single-target board has no use for. */
    if (this.phase !== 'busfree') return;
    this.phase = 'command';
    this.commandFilled = 0;
    this.commandLength = 0;
    this.raiseIrqIfWaiting();
  }

  /* ------------------------------------------------------------------ *
   * Moving bytes
   * ------------------------------------------------------------------ */

  private nextByteToHost(): number {
    if (this.phase === 'status') {
      this.phase = 'message';
      return this.statusByte;
    }
    if (this.phase === 'message') {
      this.phase = 'busfree';
      return this.messageByte;
    }
    const payload = this.transfer;
    if (!payload) {
      this.enterStatus();
      return 0;
    }
    const value = payload[this.transferIndex++] ?? 0;
    if (this.transferIndex >= payload.length) {
      this.transfer = null;
      this.transferIndex = 0;
      this.enterStatus();
    }
    return value;
  }

  private acceptByteFromHost(byte: number): void {
    if (this.phase === 'command') {
      this.command[this.commandFilled] = byte;
      if (this.commandFilled === 0) {
        /* Group 0 and the vendor group 6 are six byte blocks; group 1 is ten.
         * Anything else is not a command this drive knows how to size. */
        const group = (byte & 0xe0) >> 5;
        this.commandLength = group === 1 ? 10 : 6;
      }
      this.commandFilled += 1;
      if (this.commandFilled >= this.commandLength) {
        this.lastCommand = Array.from(this.command.slice(0, this.commandLength));
        this.dispatch();
      }
      return;
    }
    if (this.phase === 'dataout') {
      const payload = this.transfer;
      if (!payload) {
        this.enterStatus();
        return;
      }
      payload[this.transferIndex++] = byte;
      if (this.transferIndex >= payload.length) {
        const complete = this.onDataOut;
        this.transfer = null;
        this.transferIndex = 0;
        this.onDataOut = null;
        /* Status is where a data-out command ends unless the handler asks for
         * another phase, which is what a format with a defect list does. */
        this.phase = 'status';
        complete?.(payload);
        this.raiseIrqIfWaiting();
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Commands
   * ------------------------------------------------------------------ */

  private get targetLun(): number {
    return (this.cdb(1) & 0xe0) >> 5;
  }

  private good(): void {
    this.statusByte = 0x00;
    this.messageByte = 0x00;
    this.enterStatus();
  }

  private fail(errorClass: number, errorCode: number, logicalBlockAddress = 0, validAddress = false): void {
    const lun = this.targetLun;
    this.statusByte = (lun << 5) | 0x02;
    this.messageByte = 0x00;
    this.sense[lun] = { errorFlag: true, validAddress, errorClass, errorCode, logicalBlockAddress };
    this.enterStatus();
  }

  private enterStatus(): void {
    this.phase = 'status';
    this.raiseIrqIfWaiting();
  }

  private sendToHost(payload: Uint8Array): void {
    this.transfer = payload;
    this.transferIndex = 0;
    this.phase = 'datain';
    this.raiseIrqIfWaiting();
  }

  private receiveFromHost(length: number, complete: (payload: Uint8Array) => void): void {
    this.transfer = new Uint8Array(length);
    this.transferIndex = 0;
    this.onDataOut = complete;
    this.phase = 'dataout';
    this.raiseIrqIfWaiting();
  }

  private dispatch(): void {
    const group = (this.cdb(0) & 0xe0) >> 5;
    const opcode = this.cdb(0) & 0x1f;
    if (group === 0) {
      switch (opcode) {
        case 0x00: return this.testUnitReady();
        case 0x01: return this.good(); // re-zero unit: nothing to move
        case 0x03: return this.requestSense();
        case 0x04: return this.format();
        case 0x08: return this.read6();
        case 0x0a: return this.write6();
        case 0x0b: return this.good(); // seek: nothing to move
        case 0x0f: return this.translate();
        case 0x15: return this.modeSelect();
        case 0x1a: return this.modeSense();
        case 0x1b: return this.startStop();
        default: break;
      }
    }
    if (group === 1 && opcode === 0x0f) return this.verify();
    if (group === 6) {
      if (opcode === 0x10) return this.beebScsiSense();
      if (opcode === 0x11) return this.beebScsiSelect();
    }
    /* An opcode this drive does not implement. Class 2, code 0x20 is the
     * ACB-4000's invalid command. */
    this.fail(0x02, 0x20);
  }

  /** Whether a LUN can be started, which is whether the card holds its image. */
  private startLun(lun: number): boolean {
    if (this.started[lun]) return true;
    if (!this.card.image(lun)) return false;
    this.started[lun] = true;
    return true;
  }

  private testUnitReady(): void {
    if (this.started[this.targetLun]) return this.good();
    this.fail(0x00, 0x02); // unit not ready
  }

  private requestSense(): void {
    /* Available even when the LUN is not, since its whole job is to explain
     * why the last command failed. The ACB-4000 manual floors the count at
     * four and there is no case that produces more. */
    const lun = this.targetLun;
    const record = this.senseFor(lun);
    const payload = new Uint8Array(Math.max(4, this.cdb(4)));
    if (record.errorFlag) {
      payload[0] = (record.validAddress ? 0x80 : 0x00) | ((record.errorClass & 0x07) << 4) | (record.errorCode & 0x0f);
      payload[1] = (record.logicalBlockAddress >> 16) & 0x1f;
      payload[2] = (record.logicalBlockAddress >> 8) & 0xff;
      payload[3] = record.logicalBlockAddress & 0xff;
    }
    this.sense[lun] = emptySense();
    this.statusByte = 0x00;
    this.messageByte = 0x00;
    this.sendToHost(payload);
  }

  private format(): void {
    const lun = this.targetLun;
    if (!this.startLun(lun)) {
      /* No image on the card, so make one. It starts empty and grows as
       * sectors are written, which is what the board's own file system does
       * rather than laying down half a gigabyte of fill. */
      this.card.mount(lun, new Uint8Array(0), this.card.image(lun)?.descriptor);
      this.started[lun] = true;
    }
    const image = this.card.image(lun);
    if (!image) return this.fail(0x02, 0x1c); // bad format

    /* The fill pattern in byte 2 has no effect for the same reason it has none
     * on the board: no bytes are written when the image is created. */
    this.statusByte = 0x00;
    this.messageByte = 0x00;
    const formatOptions = this.cdb(1) & 0x1f;
    if (formatOptions === 28 || formatOptions === 30) {
      /* The host follows with a defect list. It is read and discarded: a LUN
       * image has no defects to map out. The header is four bytes and says how
       * many bytes of eight byte records follow. */
      return this.receiveFromHost(4, (header) => {
        const length = ((header[2] ?? 0) << 8) | (header[3] ?? 0);
        if (length > 0) this.receiveFromHost(length, () => undefined);
      });
    }
    this.good();
  }

  private read6(): void {
    const lun = this.targetLun;
    /* Firmware 2.2 and later auto-start a stopped but present LUN on a read,
     * because the Adaptec card Acorn shipped did. */
    if (!this.startLun(lun)) return this.fail(0x02, 0x1c);
    const image = this.card.image(lun);
    if (!image) return this.fail(0x02, 0x1c);

    const lba = ((this.cdb(1) & 0x1f) << 16) | (this.cdb(2) << 8) | this.cdb(3);
    const blocks = this.cdb(4) === 0 ? 256 : this.cdb(4);
    if (lba + blocks > lunSectorsFromDescriptor(image.descriptor)) {
      return this.fail(0x02, 0x21, lba, true); // illegal block address
    }

    const payload = new Uint8Array(blocks * SCSI_SECTOR_SIZE);
    const offset = lba * SCSI_SECTOR_SIZE;
    /* A sector past the end of the stored image has never been written, so it
     * reads as the zeros the array already holds. */
    const available = Math.max(0, Math.min(payload.length, image.data.length - offset));
    if (available > 0) payload.set(image.data.subarray(offset, offset + available));
    this.statusByte = 0x00;
    this.messageByte = 0x00;
    this.sendToHost(payload);
  }

  private write6(): void {
    const lun = this.targetLun;
    if (!this.startLun(lun)) return this.fail(0x02, 0x1c);
    const image = this.card.image(lun);
    if (!image) return this.fail(0x02, 0x1c);

    const lba = ((this.cdb(1) & 0x1f) << 16) | (this.cdb(2) << 8) | this.cdb(3);
    const blocks = this.cdb(4) === 0 ? 256 : this.cdb(4);
    if (lba + blocks > lunSectorsFromDescriptor(image.descriptor)) {
      return this.fail(0x02, 0x21, lba, true);
    }

    this.receiveFromHost(blocks * SCSI_SECTOR_SIZE, (payload) => {
      const end = (lba + blocks) * SCSI_SECTOR_SIZE;
      if (image.data.length < end) {
        const grown = new Uint8Array(end);
        grown.set(image.data);
        image.data = grown;
      }
      image.data.set(payload, lba * SCSI_SECTOR_SIZE);
      image.revision += 1;
      this.statusByte = 0x00;
      this.messageByte = 0x00;
    });
  }

  private translate(): void {
    const lun = this.targetLun;
    if (!this.started[lun]) return this.fail(0x00, 0x04); // drive not ready
    const image = this.card.image(lun);
    if (!image) return this.fail(0x00, 0x04);

    const lba = ((this.cdb(1) & 0x1f) << 16) | (this.cdb(2) << 8) | this.cdb(3);
    const heads = image.descriptor[15] || 1;
    /* The drive has no physical geometry, so the translation is the one an
     * ACB-4000 formatted drive would have given, which is what Acorn's
     * utilities are checking against. */
    const cylinder = Math.floor(lba / (heads * SCSI_SECTORS_PER_TRACK));
    const head = Math.floor(lba / SCSI_SECTORS_PER_TRACK) % heads;
    const sector = lba % SCSI_SECTORS_PER_TRACK;
    const bytesFromIndex = sector * SCSI_SECTOR_SIZE;

    const payload = Uint8Array.from([
      (cylinder >> 16) & 0xff,
      (cylinder >> 8) & 0xff,
      cylinder & 0xff,
      head & 0xff,
      (bytesFromIndex >> 24) & 0xff,
      (bytesFromIndex >> 16) & 0xff,
      (bytesFromIndex >> 8) & 0xff,
      bytesFromIndex & 0xff,
    ]);
    this.statusByte = 0x00;
    this.messageByte = 0x00;
    this.sendToHost(payload);
  }

  private modeSelect(): void {
    const lun = this.targetLun;
    const length = this.cdb(4);
    /* Only soft-sectored drives are emulated, and their parameter list is
     * twenty-two bytes. Anything else is a bad argument. */
    if (length !== SCSI_DESCRIPTOR_SIZE) return this.fail(0x02, 0x24);
    this.receiveFromHost(length, (payload) => {
      const image = this.card.image(lun);
      if (image) image.descriptor = Uint8Array.from(payload);
      /* A descriptor can arrive before the image does, which is the order
       * Superform works in: mode select, then format. */
      else this.card.mount(lun, new Uint8Array(0), payload);
      this.statusByte = 0x00;
      this.messageByte = 0x00;
    });
  }

  private modeSense(): void {
    /* Answered without checking whether the LUN is started, because at this
     * point the card may hold only a descriptor. */
    if (this.cdb(4) !== SCSI_DESCRIPTOR_SIZE) return this.fail(0x02, 0x24);
    const image = this.card.image(this.targetLun);
    if (!image) return this.fail(0x02, 0x24);
    this.statusByte = 0x00;
    this.messageByte = 0x00;
    this.sendToHost(Uint8Array.from(image.descriptor));
  }

  private startStop(): void {
    const lun = this.targetLun;
    if (this.cdb(4) === 0) {
      this.started[lun] = false;
      return this.good();
    }
    if (!this.startLun(lun)) return this.fail(0x02, 0x24); // bad argument
    this.good();
  }

  private verify(): void {
    const lun = this.targetLun;
    if (!this.started[lun]) {
      this.statusByte = (lun << 5) | 0x02;
      this.messageByte = 0x00;
      return this.enterStatus();
    }
    const image = this.card.image(lun);
    if (!image) return this.fail(0x02, 0x24);

    /* A group 1 command carries four bytes of block address and two of count,
     * and a count of zero means the full 65,536. */
    const lba = (this.cdb(2) << 24) | (this.cdb(3) << 16) | (this.cdb(4) << 8) | this.cdb(5);
    const blocks = ((this.cdb(7) << 8) | this.cdb(8)) || 65_536;
    if (lba + blocks > lunSectorsFromDescriptor(image.descriptor)) return this.fail(0x02, 0x21, lba, true);
    /* There is no error correction code to check, so a block address inside
     * the LUN is the whole of what this can verify. */
    this.good();
  }

  private beebScsiSense(): void {
    let lunStatus = 0;
    for (let lun = 0; lun < SCSI_LUN_COUNT; lun++) if (this.started[lun]) lunStatus |= 1 << lun;
    const payload = new Uint8Array(8);
    payload[0] = lunStatus;
    payload[1] = this.card.directory;
    payload[2] = 0; // external bus: a fixed drive, not a laser disc player
    payload[3] = BEEBSCSI_FIRMWARE_MAJOR;
    payload[4] = BEEBSCSI_FIRMWARE_MINOR;
    this.statusByte = 0x00;
    this.messageByte = 0x00;
    this.sendToHost(payload);
  }

  private beebScsiSelect(): void {
    this.receiveFromHost(8, (payload) => {
      /* Changing directory while a LUN is started would pull the card out
       * from under ADFS, so the board refuses. */
      if (this.started.some(Boolean)) {
        this.statusByte = 0x02;
        this.messageByte = 0x00;
        return;
      }
      this.card.directory = Math.min(payload[0] ?? 0, SCSI_MAX_LUN_DIRECTORY);
      this.statusByte = 0x00;
      this.messageByte = 0x00;
    });
  }

  /* ------------------------------------------------------------------ */

  snapshotState(): BeebScsiState {
    return {
      phase: this.phase,
      busy: this.phase !== 'busfree',
      request: this.request,
      irqEnabled: this.irqEnabled,
      irq: this.irqLatched,
      statusByte: this.status(),
      lunDirectory: this.card.directory,
      startedLuns: this.started.flatMap((on, lun) => (on ? [lun] : [])),
      presentLuns: this.card.present(),
      lastCommand: this.lastCommand.slice(),
      lastStatus: this.statusByte,
      transferRemaining: this.transfer ? this.transfer.length - this.transferIndex : 0,
      configuration: this.configuration,
    };
  }
}
