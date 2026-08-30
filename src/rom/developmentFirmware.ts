import type { RomRequirement } from './romProfiles';

export interface DevelopmentFirmwareInventory {
  id: string;
  machineIds: string[];
  capabilityId: string;
  label: string;
  supportStatus: 'development';
  sourceProject: string;
  runtimeStatus: string;
  requirements: RomRequirement[];
}

/**
 * Firmware known to the project but not yet connected to a qualified emulator
 * adapter. Keeping this separate from ROM_SETS prevents an inventory entry from
 * accidentally making a machine runnable.
 */
export const DEVELOPMENT_FIRMWARE: DevelopmentFirmwareInventory[] = [
  {
    id: 'electron-1mhzpi',
    machineIds: ['electron'],
    capabilityId: '1mhzpi',
    label: 'Electron Plus 1 · 1MHzPi / ElkWiFi development firmware',
    supportStatus: 'development',
    sourceProject: '1MHzPi',
    runtimeStatus: 'Stored and validated only. Electron Plus 1 hardware and the external 1 MHz bus are not yet connected to a qualified browser emulator.',
    requirements: [
      {
        id: 'plus1-rh',
        label: 'Plus 1 RH support ROM 1.33',
        emulatorPath: 'development/RHPLUS133.rom',
        acceptedSizes: [16384],
        purpose: 'extension',
        required: true,
        supportStatus: 'development',
        provenanceNote: 'Supplied by the 1MHzPi project for the Electron Plus 1 configuration. This support ROM is a separate dependency from ElkWiFi.',
      },
      {
        id: 'elkwifi',
        label: 'Modified ElkWiFi development ROM',
        emulatorPath: 'development/ElkWiFi-current.rom',
        acceptedSizes: [16384],
        purpose: 'extension',
        required: true,
        supportStatus: 'development',
        provenanceNote: 'Modified firmware from the active 1MHzPi project. Import the raw 16 KiB ROM payload, not the 16,406-byte Acorn file-header form, and re-import after firmware rebuilds.',
      },
    ],
  },
];

export function developmentFirmwareFor(machineId: string, enabledCapabilities: string[] = []): DevelopmentFirmwareInventory[] {
  return DEVELOPMENT_FIRMWARE.filter((inventory) => inventory.machineIds.includes(machineId) && enabledCapabilities.includes(inventory.capabilityId));
}

export function developmentFirmwareStorageKey(inventoryId: string, requirement: RomRequirement): string {
  return `inventory/${inventoryId}/${requirement.emulatorPath}`;
}
