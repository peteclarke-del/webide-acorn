import { describe, expect, it } from 'vitest';
import { developmentFirmwareFor, developmentFirmwareStorageKey } from './developmentFirmware';
import { validateRom } from './romProfiles';

describe('development firmware inventory', () => {
  it('exposes the two independent Electron requirements only when 1MHzPi is selected', () => {
    expect(developmentFirmwareFor('electron')).toEqual([]);
    const [inventory] = developmentFirmwareFor('electron', ['plus1', '1mhzpi']);
    expect(inventory?.requirements.map((item) => item.id)).toEqual(['plus1-rh', 'elkwifi']);
    expect(inventory?.runtimeStatus).toContain('not yet connected');
  });

  it('keeps inventory storage outside a qualified emulator ROM-set namespace', () => {
    const inventory = developmentFirmwareFor('electron', ['1mhzpi'])[0]!;
    expect(developmentFirmwareStorageKey(inventory.id, inventory.requirements[1]!)).toBe('inventory/electron-1mhzpi/development/ElkWiFi-current.rom');
  });

  it('accepts a raw ROM and rejects the file-header form', () => {
    const requirement = developmentFirmwareFor('electron', ['1mhzpi'])[0]!.requirements[1]!;
    const raw = new Uint8Array(16384); raw[0] = 0x4c;
    expect(validateRom(requirement, raw).valid).toBe(true);
    expect(validateRom(requirement, new Uint8Array(16406)).errors[0]).toContain('must be 16 KiB');
  });
});
