import { describe, expect, it } from 'vitest';
import { createRuntimeRunRecord } from './runtimeRunRecord';

describe('runtime run record', () => {
  const session = { fingerprint: 'a'.repeat(64) } as never;
  const program = { sessionFingerprint: 'a'.repeat(64), fingerprint: 'b'.repeat(64) } as never;

  it('fingerprints one session and program binding', () => {
    const record = createRuntimeRunRecord(session, program, '2026-08-25T10:00:00.000Z');
    expect(record).toMatchObject({ schema: '8bit-net.runtime-run', version: 1, exportedAt: '2026-08-25T10:00:00.000Z' });
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('rejects cross-session and invalid time records', () => {
    expect(() => createRuntimeRunRecord(session, { ...(program as object), sessionFingerprint: 'c'.repeat(64) } as never, '2026-08-25T10:00:00.000Z')).toThrow(/same run/);
    expect(() => createRuntimeRunRecord(session, program, 'not-a-date')).toThrow(/ISO date/);
  });
});
