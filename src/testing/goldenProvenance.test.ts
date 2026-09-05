// @vitest-environment node

/* Two failures worth telling apart: a golden that fails because the program
 * changed, and one that fails because the machine underneath it did. And one
 * thing worth refusing: replacing a golden without saying why.
 */
import { describe, expect, it } from 'vitest';
import {
  GoldenApprovalError,
  approveGoldenUpdate,
  goldenDrift,
  goldenIsAuthoritative,
  parseGoldenProvenance,
  proposeGoldenUpdate,
  type GoldenEnvironment,
  type ProvenancedGolden,
} from './goldenProvenance';
import type { ScreenDifference } from './screenAssertion';

const environment: GoldenEnvironment = {
  machineId: 'bbc-b', machineLabel: 'BBC Model B',
  romSetId: 'os12-basic2-dfs', romDigest: 'rom-aaa',
  buildFingerprint: 'build-111',
};

const golden = (overrides: Partial<ProvenancedGolden['provenance']> = {}): ProvenancedGolden => ({
  id: 'title', name: 'Title screen', width: 2, height: 1, rgbaBase64: 'AAAAAP//////',
  provenance: {
    machineId: 'bbc-b', machineLabel: 'BBC Model B',
    romSetId: 'os12-basic2-dfs', romDigest: 'rom-aaa', buildFingerprint: 'build-111',
    approvedAt: '2026-08-01T00:00:00Z', approvedBy: 'pete', reason: 'First accepted title screen.',
    ...overrides,
  },
});

const difference = (overrides: Partial<ScreenDifference> = {}): ScreenDifference => ({
  expectedRgbaBase64: 'AAAAAP//////', actualRgbaBase64: '////AAAAAAAA',
  expectedDigest: 'FNV32:1111', actualDigest: 'FNV32:2222',
  differingPixels: 2, allowedDifferingPixels: 0,
  maximumChannelDelta: 255, allowedChannelDelta: 0, passed: false,
  ...overrides,
});

describe('what has changed since a golden was approved', () => {
  it('finds nothing when nothing has', () => {
    expect(goldenDrift(golden(), environment)).toEqual([]);
  });

  it('names a different machine, and says the golden cannot settle the question', () => {
    const drift = goldenDrift(golden({ machineId: 'master', machineLabel: 'BBC Master 128' }), environment);
    expect(drift[0]!.kind).toBe('machine');
    expect(drift[0]!.detail).toMatch(/cannot settle whether the program is right/);
  });

  it('tells a different firmware set from the same set with different bytes', () => {
    /* A re-release under the same name is a real thing and is not the same
     * firmware. */
    expect(goldenDrift(golden({ romSetId: 'os12-basic2' }), environment)[0]!.kind).toBe('rom-set');
    const rebuilt = goldenDrift(golden({ romDigest: 'rom-bbb' }), environment);
    expect(rebuilt[0]!.kind).toBe('rom-bytes');
    expect(rebuilt[0]!.detail).toMatch(/named the same and its bytes are not the ones/);
  });

  it('treats a rebuild as the ordinary reason for a difference', () => {
    const drift = goldenDrift(golden({ buildFingerprint: 'build-000' }), environment);
    expect(drift[0]!.kind).toBe('build');
    expect(drift[0]!.detail).toMatch(/ordinary reason for a difference/);
  });
});

describe('whether a golden can settle anything', () => {
  it('is authoritative when the machine and firmware match', () => {
    expect(goldenIsAuthoritative(golden(), environment)).toEqual({ authoritative: true, reason: null });
    /* A rebuild does not disqualify it — that is the case it exists for. */
    expect(goldenIsAuthoritative(golden({ buildFingerprint: 'build-000' }), environment).authoritative).toBe(true);
  });

  it('is not authoritative on another machine, and says what it was approved against', () => {
    const standing = goldenIsAuthoritative(golden({ machineId: 'master', machineLabel: 'BBC Master 128' }), environment);
    expect(standing.authoritative).toBe(false);
    expect(standing.reason).toMatch(/approved against BBC Master 128 and this run is BBC Model B/);
  });
});

describe('proposing a replacement', () => {
  it('changes nothing, and says what would be weighed', () => {
    const before = golden();
    const proposal = proposeGoldenUpdate(before, difference(), environment);
    expect(before.rgbaBase64).toBe('AAAAAP//////');
    expect(proposal.currentRgbaBase64).toBe('AAAAAP//////');
    expect(proposal.proposedRgbaBase64).toBe('////AAAAAAAA');
    expect(proposal.summary).toMatch(/2 pixels differ by more than the allowed 0/);
  });

  it('says plainly when nothing in the environment changed, so the program is what differs', () => {
    expect(proposeGoldenUpdate(golden(), difference(), environment).summary)
      .toMatch(/Nothing about the machine, the firmware or the build has changed .* so the program itself is what differs/);
  });

  it('carries the drift into the summary when there is some', () => {
    const proposal = proposeGoldenUpdate(golden({ romDigest: 'rom-bbb' }), difference(), environment);
    expect(proposal.drift).toHaveLength(1);
    expect(proposal.summary).toMatch(/bytes are not the ones this golden was approved against/);
  });
});

describe('approving a replacement', () => {
  it('records who, when, why, and what it replaced', () => {
    const before = golden();
    const proposal = proposeGoldenUpdate(before, difference(), environment);
    const after = approveGoldenUpdate(proposal, before, { approvedBy: 'pete', approvedAt: '2026-08-30T00:00:00Z', reason: 'Title text was deliberately re-centred.' });

    expect(after.rgbaBase64).toBe('////AAAAAAAA');
    expect(after.provenance.approvedBy).toBe('pete');
    expect(after.provenance.reason).toBe('Title text was deliberately re-centred.');
    expect(after.provenance.replacedDigest).toBe('FNV32:1111');
    expect(after.provenance.buildFingerprint).toBe('build-111');
  });

  it('refuses an approval with no reason behind it', () => {
    /* Six months from now the reason is the only thing that distinguishes an
     * approval from nobody having looked. */
    const proposal = proposeGoldenUpdate(golden(), difference(), environment);
    expect(() => approveGoldenUpdate(proposal, golden(), { approvedBy: 'pete', approvedAt: 'now', reason: 'ok' }))
      .toThrow(/needs a reason of at least a few words/);
    expect(() => approveGoldenUpdate(proposal, golden(), { approvedBy: '  ', approvedAt: 'now', reason: 'A good long reason.' }))
      .toThrow(/who approved it/);
  });

  it('refuses a proposal for a different golden', () => {
    const proposal = proposeGoldenUpdate(golden(), difference(), environment);
    const other = { ...golden(), id: 'other' };
    expect(() => approveGoldenUpdate(proposal, other, { approvedBy: 'pete', approvedAt: 'now', reason: 'A good long reason.' }))
      .toThrow(GoldenApprovalError);
  });
});

describe('reading provenance back', () => {
  it('accepts a complete record', () => {
    expect(parseGoldenProvenance(golden().provenance).approvedBy).toBe('pete');
  });

  it('refuses a golden that carries none, rather than treating it as fresh', () => {
    expect(() => parseGoldenProvenance(null)).toThrow(/carries no provenance/);
    expect(() => parseGoldenProvenance({ machineId: 'bbc-b' })).toThrow(/does not say its machineLabel/);
  });
});
