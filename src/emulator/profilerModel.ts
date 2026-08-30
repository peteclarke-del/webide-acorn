export interface ProfilerConfig {
  maxAddresses: number;
  frameCapacity: number;
  captureBus: boolean;
}

export interface ProfileMetric {
  instructions: number;
  cycles: number;
}

export interface ProfileDelta extends ProfileMetric {
  instructionDelta: number;
  cycleDelta: number;
}

export const DEFAULT_PROFILER_CONFIG: ProfilerConfig = { maxAddresses: 4096, frameCapacity: 256, captureBus: false };

export function validateProfilerConfig(input: Record<string, unknown>): ProfilerConfig {
  const maxAddresses = Number(input.maxAddresses ?? DEFAULT_PROFILER_CONFIG.maxAddresses);
  const frameCapacity = Number(input.frameCapacity ?? DEFAULT_PROFILER_CONFIG.frameCapacity);
  if (!Number.isInteger(maxAddresses) || maxAddresses < 256 || maxAddresses > 16384) throw new Error('Profiler address capacity must be 256–16,384');
  if (!Number.isInteger(frameCapacity) || frameCapacity < 16 || frameCapacity > 1024) throw new Error('Profiler frame capacity must be 16–1,024');
  return { maxAddresses, frameCapacity, captureBus: Boolean(input.captureBus) };
}

export function profilerMemoryRegion(address: number) {
  const normalized = address & 0xffff;
  if (normalized < 0x8000) return 'Main RAM';
  if (normalized < 0xc000) return 'Sideways ROM/RAM';
  if (normalized < 0xfc00) return 'OS ROM';
  if (normalized < 0xff00) return 'I/O and expansion';
  return 'OS ROM and vectors';
}

export function profileBuildFingerprint(bytes: number[], origin: number) {
  let hash = 0x811c9dc5;
  const values = [origin & 0xff, (origin >>> 8) & 0xff, ...bytes];
  for (const value of values) { hash ^= value & 0xff; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${(origin & 0xffff).toString(16).padStart(4, '0')}-${bytes.length.toString(16)}-${hash.toString(16).padStart(8, '0')}`;
}

export function compareProfileMetric(current: ProfileMetric, baseline?: ProfileMetric): ProfileDelta {
  return { ...current, instructionDelta: current.instructions - (baseline?.instructions ?? 0), cycleDelta: current.cycles - (baseline?.cycles ?? 0) };
}
