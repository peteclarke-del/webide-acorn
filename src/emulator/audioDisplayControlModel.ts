export type EmulatorDisplayFilter = 'nearest' | 'linear';

export function validateMachineVolume(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) throw new Error('Machine volume must be a whole percentage from 0 to 100');
  return Number(value);
}

export function isEmulatorDisplayFilter(value: unknown): value is EmulatorDisplayFilter {
  return value === 'nearest' || value === 'linear';
}

export function validateEmulatorDisplayFilter(value: unknown): EmulatorDisplayFilter {
  if (!isEmulatorDisplayFilter(value)) throw new Error('Display filter must be nearest-neighbour or linear');
  return value;
}
