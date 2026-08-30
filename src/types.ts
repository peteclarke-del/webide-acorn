export type PlatformClassId = '8-16-bit' | '32-bit';
export type CapabilityState = 'supported' | 'preview' | 'planned';

export interface RomProfile {
  id: string;
  label: string;
  detail: string;
}

export interface MachineCapability {
  id: string;
  label: string;
  description: string;
  state: CapabilityState;
  defaultEnabled?: boolean;
  /** Free prose about what this capability still needs, shown to the reader. */
  requirement?: string;
  /**
   * The exact variant this capability is fitted to, when it is fitted to one.
   * Naming the variant rather than describing it in prose lets resolution
   * refuse the capability on a variant that does not have the hardware, instead
   * of claiming a peripheral that is not there.
   */
  requiresVariant?: string;
}

export interface MachineProfile {
  id: string;
  platformClass: PlatformClassId;
  family: string;
  label: string;
  shortLabel: string;
  generation: string;
  cpu: string;
  memory: string;
  variants: string[];
  roms: RomProfile[];
  capabilities: MachineCapability[];
  accent: string;
}

export interface PlatformClass {
  id: PlatformClassId;
  label: string;
  detail: string;
}

export interface ResolvedTarget {
  platformClass: PlatformClassId;
  machine: MachineProfile;
  variant: string;
  rom: RomProfile;
  enabledCapabilities: string[];
}
