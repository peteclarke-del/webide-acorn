/*
 * Putting BeebSCSI on the 1 MHz bus.
 *
 * `beebScsi.ts` is the board; this is the wire. It is the same shape as
 * `beebSidBus.ts`: jsbeeb reaches every 1 MHz bus device through `readDevice`
 * and `writeDevice`, and its handler for the &FC40 block is a bare `break`, so
 * answering the adapter's own addresses and deferring everything else is the
 * whole of what is needed. Nothing in the engine is patched on disk.
 *
 * The adapter decodes five addresses and no more. jsbeeb groups the whole of
 * &FC40 to &FC5F into one switch case, but the CPLD compares the full low byte,
 * so &FC45 upwards is left alone here and still reads as open bus.
 *
 * The interrupt is a real one. The adapter pulls nIRQ down when the drive
 * raises REQ and the host has enabled it, so this claims a bit in jsbeeb's
 * interrupt word and keeps it in step after every access.
 */
import {
  BeebScsi,
  BeebScsiCard,
  SCSI_CONFIG_ADDRESS,
  SCSI_DATA_ADDRESS,
  SCSI_IRQ_ADDRESS,
  SCSI_SELECT_ADDRESS,
  SCSI_STATUS_ADDRESS,
} from './beebScsi';

/**
 * The bit this board owns in jsbeeb's interrupt word.
 *
 * The engine already spends bit 0 on the system VIA, 1 on the user VIA, 2 on
 * the ACIA, 3 on the Tube ULA and 5 on the teletext adaptor. Bit 4 is free.
 */
export const SCSI_IRQ_BIT = 0x10;

export const SCSI_ADDRESS_FIRST = SCSI_DATA_ADDRESS;
export const SCSI_ADDRESS_LAST = SCSI_CONFIG_ADDRESS;

/** Reads land on the two readable addresses only. */
export function scsiHandlesRead(address: number): boolean {
  return address === SCSI_DATA_ADDRESS || address === SCSI_STATUS_ADDRESS;
}

/** Writes land on the data register, SEL, the interrupt enable and the config byte. */
export function scsiHandlesWrite(address: number): boolean {
  return (
    address === SCSI_DATA_ADDRESS ||
    address === SCSI_SELECT_ADDRESS ||
    address === SCSI_IRQ_ADDRESS ||
    address === SCSI_CONFIG_ADDRESS
  );
}

/** What a processor has to offer for a BeebSCSI board to be fitted to it. */
export interface ScsiHost {
  readDevice(address: number): number;
  writeDevice(address: number, value: number): void;
  reset(hard: boolean): void;
  interrupt: number;
  beebScsi?: BeebScsi;
}

/**
 * Fit a BeebSCSI board to a machine, and hand back the board.
 *
 * Fitting twice returns the board already fitted rather than stacking a second
 * one, for the same reason as the SID: a machine has one 1 MHz bus and a second
 * wrap would answer the same addresses twice.
 */
export function fitBeebScsi(host: ScsiHost, card: BeebScsiCard = new BeebScsiCard()): BeebScsi {
  if (host.beebScsi) return host.beebScsi;
  const board = new BeebScsi(card);
  const read = host.readDevice.bind(host);
  const write = host.writeDevice.bind(host);
  const reset = host.reset.bind(host);

  const syncIrq = () => {
    if (board.irq) host.interrupt |= SCSI_IRQ_BIT;
    else host.interrupt &= ~SCSI_IRQ_BIT;
  };

  host.readDevice = (address: number) => {
    if (!scsiHandlesRead(address)) return read(address);
    const value = board.read(address);
    syncIrq();
    return value;
  };
  host.writeDevice = (address: number, value: number) => {
    if (!scsiHandlesWrite(address)) {
      write(address, value);
      return;
    }
    board.write(address, value);
    syncIrq();
  };
  /*
   * The adapter passes the host's reset line straight through to the drive, so
   * BREAK reaches the board as much as power-on does. Which LUNs are started
   * survives it: that state lives in the drive, which the host cannot reset,
   * and the documentation is explicit that a stopped LUN stays stopped.
   */
  host.reset = (hard: boolean) => {
    reset(hard);
    board.reset();
    syncIrq();
  };

  host.beebScsi = board;
  return board;
}
