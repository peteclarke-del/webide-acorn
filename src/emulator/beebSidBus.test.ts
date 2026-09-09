import { describe, expect, it } from 'vitest';
import { SID_ADDRESS_FIRST, SID_ADDRESS_LAST, sidHandles, withBeebSid } from './beebSidBus';

/** A stand-in for jsbeeb's processor, recording what reached the base class. */
class FakeBus {
  readonly deviceWrites: Array<[number, number]> = [];
  readonly deviceReads: number[] = [];
  resets: boolean[] = [];
  readDevice(address: number): number { this.deviceReads.push(address); return 0xaa; }
  writeDevice(address: number, value: number): void { this.deviceWrites.push([address, value]); }
  reset(hard: boolean): void { this.resets.push(hard); }
}

const FittedBus = withBeebSid(FakeBus);

describe('BeebSID on the 1 MHz bus', () => {
  it('claims exactly the range jsbeeb decodes and answers with a bare break', () => {
    expect(SID_ADDRESS_FIRST).toBe(0xfc20);
    expect(SID_ADDRESS_LAST).toBe(0xfc3f);
    expect(sidHandles(0xfc1f)).toBe(false);
    expect(sidHandles(0xfc20)).toBe(true);
    expect(sidHandles(0xfc3f)).toBe(true);
    expect(sidHandles(0xfc40)).toBe(false);
  });

  it('takes the writes meant for the chip and passes every other address to the machine', () => {
    const cpu = new FittedBus();
    cpu.writeDevice(0xfc20 + 0x18, 0x0f);
    cpu.writeDevice(0xfe21, 0x07);
    expect(cpu.beebSid.snapshotState().registers[0x18]).toBe(0x0f);
    expect(cpu.deviceWrites).toEqual([[0xfe21, 0x07]]);
  });

  it('answers reads in its range from the chip rather than the undecoded bus', () => {
    const cpu = new FittedBus();
    expect(cpu.readDevice(0xfc20 + 0x19)).toBe(0);
    expect(cpu.deviceReads).toEqual([]);
    expect(cpu.readDevice(0xfe40)).toBe(0xaa);
    expect(cpu.deviceReads).toEqual([0xfe40]);
  });

  it('silences the chip on a hard reset and leaves it alone on BREAK', () => {
    const cpu = new FittedBus();
    cpu.writeDevice(0xfc20 + 0x18, 0x0f);
    cpu.reset(false);
    expect(cpu.beebSid.snapshotState().registers[0x18]).toBe(0x0f);
    cpu.reset(true);
    expect(cpu.beebSid.snapshotState().registers[0x18]).toBe(0);
    /* The machine's own reset still happens either way. */
    expect(cpu.resets).toEqual([false, true]);
  });
});
