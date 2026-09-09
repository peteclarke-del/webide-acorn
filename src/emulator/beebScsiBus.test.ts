import { describe, expect, it } from 'vitest';
import { BeebScsiCard, SCSI_SECTORS_PER_TRACK, SCSI_SECTOR_SIZE } from './beebScsi';
import { SCSI_IRQ_BIT, fitBeebScsi, scsiHandlesRead, scsiHandlesWrite } from './beebScsiBus';

/** A stand-in for jsbeeb's processor, recording what reached the base class. */
class FakeBus {
  readonly deviceWrites: Array<[number, number]> = [];
  readonly deviceReads: number[] = [];
  resets: boolean[] = [];
  interrupt = 0;
  readDevice(address: number): number { this.deviceReads.push(address); return 0xaa; }
  writeDevice(address: number, value: number): void { this.deviceWrites.push([address, value]); }
  reset(hard: boolean): void { this.resets.push(hard); }
}

describe('BeebSCSI on the 1 MHz bus', () => {
  it('claims the five addresses the adapter decodes and no more', () => {
    /* jsbeeb groups &FC40 to &FC5F into one case, but the CPLD compares the
     * whole low byte, so the rest of the block is not this board's. */
    expect(scsiHandlesRead(0xfc40)).toBe(true);
    expect(scsiHandlesRead(0xfc41)).toBe(true);
    expect(scsiHandlesRead(0xfc42)).toBe(false);
    expect(scsiHandlesRead(0xfc45)).toBe(false);
    expect(scsiHandlesWrite(0xfc40)).toBe(true);
    expect(scsiHandlesWrite(0xfc41)).toBe(false);
    expect(scsiHandlesWrite(0xfc42)).toBe(true);
    expect(scsiHandlesWrite(0xfc43)).toBe(true);
    expect(scsiHandlesWrite(0xfc44)).toBe(true);
    expect(scsiHandlesWrite(0xfc45)).toBe(false);
  });

  it('takes its own addresses and passes every other one to the machine', () => {
    const cpu = new FakeBus();
    const board = fitBeebScsi(cpu);
    cpu.writeDevice(0xfc42, 0x01);
    cpu.writeDevice(0xfe21, 0x07);
    expect(board.snapshotState().phase).toBe('command');
    expect(cpu.deviceWrites).toEqual([[0xfe21, 0x07]]);
    expect(cpu.readDevice(0xfc41)).toBe(board.status());
    expect(cpu.readDevice(0xfc45)).toBe(0xaa);
    expect(cpu.deviceReads).toEqual([0xfc45]);
  });

  it('raises and drops the machine interrupt as the adapter does', () => {
    const cpu = new FakeBus();
    fitBeebScsi(cpu);
    cpu.writeDevice(0xfc43, 0x01); // enable the interrupt while the bus is free
    expect(cpu.interrupt & SCSI_IRQ_BIT).toBe(0);
    cpu.writeDevice(0xfc42, 0x01); // select, so the drive asks for a command byte
    expect(cpu.interrupt & SCSI_IRQ_BIT).toBe(SCSI_IRQ_BIT);
    cpu.writeDevice(0xfc43, 0x00);
    expect(cpu.interrupt & SCSI_IRQ_BIT).toBe(0);
  });

  it('leaves the rest of the interrupt word alone', () => {
    const cpu = new FakeBus();
    cpu.interrupt = 0x0d;
    fitBeebScsi(cpu);
    cpu.writeDevice(0xfc43, 0x01);
    cpu.writeDevice(0xfc42, 0x01);
    expect(cpu.interrupt).toBe(0x0d | SCSI_IRQ_BIT);
    cpu.writeDevice(0xfc43, 0x00);
    expect(cpu.interrupt).toBe(0x0d);
  });

  it('reaches the board on BREAK as well as on power-on, because the reset line is wired through', () => {
    const cpu = new FakeBus();
    const board = fitBeebScsi(cpu);
    cpu.writeDevice(0xfc42, 0x01);
    expect(board.snapshotState().phase).toBe('command');
    cpu.reset(false);
    expect(board.snapshotState().phase).toBe('busfree');
    expect(cpu.resets).toEqual([false]);
  });

  it('keeps a started LUN started across a reset', () => {
    const card = new BeebScsiCard();
    card.mount(0, new Uint8Array(SCSI_SECTORS_PER_TRACK * SCSI_SECTOR_SIZE));
    const cpu = new FakeBus();
    const board = fitBeebScsi(cpu, card);
    for (const byte of [0x1b, 0x00, 0x00, 0x00, 0x01, 0x00]) {
      if (byte === 0x1b) cpu.writeDevice(0xfc42, 0x01);
      cpu.writeDevice(0xfc40, byte);
    }
    cpu.readDevice(0xfc40); // status
    cpu.readDevice(0xfc40); // message
    expect(board.snapshotState().startedLuns).toEqual([0]);
    cpu.reset(true);
    expect(board.snapshotState().startedLuns).toEqual([0]);
  });

  it('fits one board to a machine however many times it is asked', () => {
    const cpu = new FakeBus();
    const first = fitBeebScsi(cpu);
    const second = fitBeebScsi(cpu);
    expect(second).toBe(first);
    cpu.writeDevice(0xfc42, 0x01);
    expect(cpu.deviceWrites).toEqual([]);
  });
});
