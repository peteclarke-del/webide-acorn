export interface ArmSourceLocation { fileId: string; fileName: string; line: number }

export function armSourceLocationKey(location: ArmSourceLocation | undefined): string | null {
  return location ? `${location.fileId}:${location.line}` : null;
}

export function armSourceStepOverTarget(currentAddress: number, locations: Record<number, ArmSourceLocation>): number | null {
  const current = locations[currentAddress];
  if (!current) return null;
  const next = Object.keys(locations).map(Number).filter((address) => Number.isInteger(address) && address > currentAddress && !(address & 3) && armSourceLocationKey(locations[address]) !== armSourceLocationKey(current)).sort((left, right) => left - right)[0];
  return next ?? null;
}

export function validateArmSourceLocations(locations: Record<number, ArmSourceLocation>, origin: number, byteLength: number): Record<number, ArmSourceLocation> {
  const end = origin + byteLength;
  const entries = Object.entries(locations);
  if (entries.length > 262144 || entries.some(([rawAddress, location]) => { const address = Number(rawAddress); return !Number.isInteger(address) || address < origin || address >= end || (address & 3) !== 0 || !location || typeof location.fileId !== 'string' || typeof location.fileName !== 'string' || !Number.isInteger(location.line) || location.line < 1; })) throw new Error('ARM source locations must be aligned, bounded build addresses with valid file and line metadata');
  return Object.fromEntries(entries.map(([address, location]) => [Number(address), { ...location }]));
}
