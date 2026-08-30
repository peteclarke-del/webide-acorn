export interface ReplayConfig { checkpointInterval: number; checkpointCapacity: number }
export interface ReplayVerificationState { pc: number; a: number; x: number; y: number; s: number; p: number; cycle: number; writeDigest: number }

export const DEFAULT_REPLAY_CONFIG: ReplayConfig = { checkpointInterval: 64, checkpointCapacity: 16 };

export function validateReplayConfig(input: Record<string, unknown>): ReplayConfig {
  const checkpointInterval = Number(input.checkpointInterval ?? DEFAULT_REPLAY_CONFIG.checkpointInterval);
  const checkpointCapacity = Number(input.checkpointCapacity ?? DEFAULT_REPLAY_CONFIG.checkpointCapacity);
  if (!Number.isInteger(checkpointInterval) || checkpointInterval < 1 || checkpointInterval > 4096) throw new Error('Replay checkpoint interval must be 1–4,096 instructions');
  if (!Number.isInteger(checkpointCapacity) || checkpointCapacity < 2 || checkpointCapacity > 64) throw new Error('Replay checkpoint capacity must be 2–64');
  if (checkpointInterval * checkpointCapacity > 65536) throw new Error('Replay history is limited to 65,536 instruction boundaries');
  return { checkpointInterval, checkpointCapacity };
}

export function appendReplayWriteDigest(current: number, address: number, value: number) {
  let digest = current >>> 0;
  for (const byte of [address & 0xff, address >>> 8 & 0xff, value & 0xff]) { digest ^= byte; digest = Math.imul(digest, 0x01000193) >>> 0; }
  return digest;
}

export function replayVerificationMatches(expected: ReplayVerificationState, actual: ReplayVerificationState) {
  const verificationKeys = ['pc', 'a', 'x', 'y', 's', 'p', 'cycle', 'writeDigest'] as const;
  return verificationKeys.every((key) => expected[key] === actual[key]);
}
