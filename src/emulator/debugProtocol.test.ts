import { describe, expect, it } from 'vitest';
import { acceptDebugEvent, commandBelongsToSession } from './debugProtocol';

describe('isolated debug session protocol', () => {
  it('binds production commands to the exact session value', () => {
    expect(commandBelongsToSession('session-a', 'session-a')).toBe(true);
    expect(commandBelongsToSession('session-a', 'session-b')).toBe(false);
    expect(commandBelongsToSession('session-a', undefined)).toBe(false);
  });

  it('accepts only increasing response envelopes from the current session', () => {
    expect(acceptDebugEvent({ sessionId: 'session-a', eventSequence: 4 }, 'session-a', 3)).toBe(4);
    expect(acceptDebugEvent({ sessionId: 'session-a', eventSequence: 3 }, 'session-a', 3)).toBeNull();
    expect(acceptDebugEvent({ sessionId: 'session-b', eventSequence: 5 }, 'session-a', 3)).toBeNull();
    expect(acceptDebugEvent({ sessionId: 'session-a', eventSequence: 1.5 }, 'session-a', 0)).toBeNull();
  });

  it('retains an explicit no-token mode for isolated harnesses', () => {
    expect(commandBelongsToSession('', undefined)).toBe(true);
    expect(commandBelongsToSession('', 'unexpected')).toBe(false);
  });
});
