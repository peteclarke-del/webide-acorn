import { describe, expect, it } from 'vitest';
import { machineHoldsArtifact } from './breakpointArming';

const artifact = { origin: 0x1900, byteLength: 0x55 };

describe('when a breakpoint is armed on the machine', () => {
  it('arms as soon as the machine says it holds the program', () => {
    /* The case that was broken: the first breakpoint anybody sets is on their
     * program's entry, set before running, when the machine is still in the
     * operating system. */
    expect(machineHoldsArtifact(artifact, { origin: 0x1900, bytes: 0x55 }, 0xe581)).toBe(true);
  });

  it('stays armed while the program is inside an operating-system call', () => {
    /* A program calls OSWRCH and the program counter leaves it. Asking where
     * the program counter is would drop every breakpoint added at that moment,
     * which is most of the time in any program that prints anything. */
    expect(machineHoldsArtifact(artifact, { origin: 0x1900, bytes: 0x55 }, 0xffee)).toBe(true);
  });

  it('still recognises a program that arrived without a manifest', () => {
    expect(machineHoldsArtifact(artifact, null, 0x1910)).toBe(true);
    expect(machineHoldsArtifact(artifact, undefined, 0x1900)).toBe(true);
  });

  it('does not arm for a different program than the one that is loaded', () => {
    /* A machine holding somebody else's program is not holding this one, and
     * arming this build's addresses on it would stop in the wrong place. */
    expect(machineHoldsArtifact(artifact, { origin: 0x2000, bytes: 0x55 }, 0xe581)).toBe(false);
    expect(machineHoldsArtifact(artifact, { origin: 0x1900, bytes: 0x40 }, 0xe581)).toBe(false);
  });

  it('does not arm when nothing is loaded and the machine is elsewhere', () => {
    expect(machineHoldsArtifact(artifact, null, 0xe581)).toBe(false);
    expect(machineHoldsArtifact(artifact, null, null)).toBe(false);
  });

  it('has nothing to arm without a build', () => {
    expect(machineHoldsArtifact(null, { origin: 0x1900, bytes: 0x55 }, 0x1900)).toBe(false);
  });

  it('treats the byte after the program as outside it', () => {
    expect(machineHoldsArtifact(artifact, null, 0x1900 + 0x55 - 1)).toBe(true);
    expect(machineHoldsArtifact(artifact, null, 0x1900 + 0x55)).toBe(false);
  });
});
