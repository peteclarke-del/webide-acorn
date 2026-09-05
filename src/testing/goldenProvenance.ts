/* Where a golden came from, and what it takes to replace one.
 *
 * A screen golden is a picture somebody once accepted as correct. Without a
 * record of the machine, the firmware and the build it was accepted against, it
 * is only a picture: when it later fails, nobody can tell whether the program
 * changed, the ROM changed, or the golden was wrong from the start. So a golden
 * carries its provenance, and a failure reports what has changed in the
 * environment since it was approved — because a mismatch after a firmware
 * change means something quite different from a mismatch without one.
 *
 * The other half is approval. Silently replacing a golden that fails is how a
 * test stops testing: it will agree with whatever the program does next, for
 * ever. Refusing ever to replace one is how a test becomes noise that people
 * learn to ignore. So a mismatch produces a *proposal* — both images, the
 * difference, and the drift — and replacing the golden takes an explicit
 * approval that records a reason. A reason is required rather than optional,
 * because "approved" with no reason is indistinguishable six months later from
 * nobody having looked.
 */
import type { ScreenDifference, ScreenGolden } from './screenAssertion';

/** What a golden was accepted against. */
export interface GoldenProvenance {
  machineId: string;
  machineLabel: string;
  /** The ROM set identity, as the firmware manifest names it. */
  romSetId: string;
  /** A digest over the exact ROM bytes, so a re-release is not mistaken for the same firmware. */
  romDigest: string;
  /** The build the picture came from. */
  buildFingerprint: string;
  approvedAt: string;
  approvedBy: string;
  /** Why this picture is the right expectation. Required. */
  reason: string;
  /** What it replaced, when it replaced something. */
  replacedDigest?: string;
}

export interface ProvenancedGolden extends ScreenGolden {
  provenance: GoldenProvenance;
}

/** The environment a golden is being checked against now. */
export interface GoldenEnvironment {
  machineId: string;
  machineLabel: string;
  romSetId: string;
  romDigest: string;
  buildFingerprint: string;
}

export type DriftKind = 'machine' | 'rom-set' | 'rom-bytes' | 'build';

export interface GoldenDrift {
  kind: DriftKind;
  was: string;
  now: string;
  /** What this means for reading the failure, in the words a report can use. */
  detail: string;
}

export class GoldenApprovalError extends Error {
  constructor(message: string) { super(message); this.name = 'GoldenApprovalError'; }
}

/**
 * What has changed since the golden was approved.
 *
 * Reported in the order that matters for diagnosis: a different machine or
 * firmware explains a difference that a changed build does not, so it is named
 * first and read first.
 */
export function goldenDrift(golden: ProvenancedGolden, environment: GoldenEnvironment): GoldenDrift[] {
  const drift: GoldenDrift[] = [];
  const { provenance } = golden;
  if (provenance.machineId !== environment.machineId) {
    drift.push({
      kind: 'machine', was: provenance.machineLabel, now: environment.machineLabel,
      detail: 'This golden was approved on a different machine. A difference is expected and this golden cannot settle whether the program is right.',
    });
  }
  if (provenance.romSetId !== environment.romSetId) {
    drift.push({
      kind: 'rom-set', was: provenance.romSetId, now: environment.romSetId,
      detail: 'A different firmware set is in use. Anything the operating system draws may legitimately differ.',
    });
  } else if (provenance.romDigest !== environment.romDigest) {
    drift.push({
      kind: 'rom-bytes', was: provenance.romDigest, now: environment.romDigest,
      detail: 'The firmware set is named the same and its bytes are not the ones this golden was approved against.',
    });
  }
  if (provenance.buildFingerprint !== environment.buildFingerprint) {
    drift.push({
      kind: 'build', was: provenance.buildFingerprint, now: environment.buildFingerprint,
      detail: 'The program has been rebuilt since this golden was approved, which is the ordinary reason for a difference.',
    });
  }
  return drift;
}

export interface GoldenUpdateProposal {
  goldenId: string;
  goldenName: string;
  /** The picture as it stands, and the one the machine produced. */
  currentRgbaBase64: string;
  proposedRgbaBase64: string;
  difference: ScreenDifference;
  drift: GoldenDrift[];
  environment: GoldenEnvironment;
  /** What a person needs to weigh before approving, said plainly. */
  summary: string;
}

/**
 * Offer a replacement without making one.
 *
 * Nothing here changes a golden. The proposal is the whole of what this does,
 * so a report can be read — and ignored — without anything being decided.
 */
export function proposeGoldenUpdate(
  golden: ProvenancedGolden,
  difference: ScreenDifference,
  environment: GoldenEnvironment,
): GoldenUpdateProposal {
  const drift = goldenDrift(golden, environment);
  const scale = `${difference.differingPixels.toLocaleString()} pixel${difference.differingPixels === 1 ? '' : 's'} differ by more than the allowed ${difference.allowedChannelDelta}, and the worst channel is out by ${difference.maximumChannelDelta}`;
  const context = drift.length
    ? ` Since this golden was approved: ${drift.map((entry) => entry.detail).join(' ')}`
    : ' Nothing about the machine, the firmware or the build has changed since this golden was approved, so the program itself is what differs.';
  return {
    goldenId: golden.id,
    goldenName: golden.name,
    currentRgbaBase64: golden.rgbaBase64,
    proposedRgbaBase64: difference.actualRgbaBase64,
    difference,
    drift,
    environment,
    summary: `${golden.name}: ${scale}.${context}`,
  };
}

export interface GoldenApproval {
  approvedBy: string;
  approvedAt: string;
  reason: string;
}

/**
 * Replace a golden, on the record.
 *
 * The reason is required and is checked for being one: "approved" with nothing
 * behind it is indistinguishable, six months later, from nobody having looked.
 * The digest of what was replaced is kept, so a golden that has been approved
 * repeatedly can be seen to have been.
 */
export function approveGoldenUpdate(
  proposal: GoldenUpdateProposal,
  golden: ProvenancedGolden,
  approval: GoldenApproval,
): ProvenancedGolden {
  const reason = approval.reason.trim();
  if (reason.length < 8) {
    throw new GoldenApprovalError('Replacing a golden needs a reason of at least a few words. Six months from now the reason is the only thing that distinguishes an approval from nobody having looked.');
  }
  if (!approval.approvedBy.trim()) {
    throw new GoldenApprovalError('Replacing a golden needs to record who approved it.');
  }
  if (proposal.goldenId !== golden.id) {
    throw new GoldenApprovalError(`This proposal is for ${proposal.goldenId} and the golden given is ${golden.id}.`);
  }
  return {
    ...golden,
    rgbaBase64: proposal.proposedRgbaBase64,
    provenance: {
      machineId: proposal.environment.machineId,
      machineLabel: proposal.environment.machineLabel,
      romSetId: proposal.environment.romSetId,
      romDigest: proposal.environment.romDigest,
      buildFingerprint: proposal.environment.buildFingerprint,
      approvedAt: approval.approvedAt,
      approvedBy: approval.approvedBy.trim(),
      reason,
      replacedDigest: proposal.difference.expectedDigest,
    },
  };
}

/**
 * Whether a golden may be trusted to settle the question it was written for.
 *
 * A golden approved on another machine can still be shown; it simply cannot
 * decide anything, and a report that let it pass or fail silently would be
 * asserting something it has no basis for.
 */
export function goldenIsAuthoritative(golden: ProvenancedGolden, environment: GoldenEnvironment): { authoritative: boolean; reason: string | null } {
  const drift = goldenDrift(golden, environment);
  const disqualifying = drift.find((entry) => entry.kind === 'machine' || entry.kind === 'rom-set' || entry.kind === 'rom-bytes');
  if (!disqualifying) return { authoritative: true, reason: null };
  return {
    authoritative: false,
    reason: `${disqualifying.detail} It was approved against ${disqualifying.was} and this run is ${disqualifying.now}.`,
  };
}

/** Read a golden's provenance back, refusing one that does not carry it. */
export function parseGoldenProvenance(value: unknown): GoldenProvenance {
  const record = value as Partial<GoldenProvenance> | null;
  const required: Array<keyof GoldenProvenance> = ['machineId', 'machineLabel', 'romSetId', 'romDigest', 'buildFingerprint', 'approvedAt', 'approvedBy', 'reason'];
  if (!record || typeof record !== 'object') {
    throw new GoldenApprovalError('This golden carries no provenance, so nothing is known about what it was approved against.');
  }
  for (const field of required) {
    if (typeof record[field] !== 'string' || !(record[field] as string).trim()) {
      throw new GoldenApprovalError(`This golden's provenance does not say its ${field}, so it cannot be told whether it still applies.`);
    }
  }
  return {
    machineId: record.machineId!, machineLabel: record.machineLabel!,
    romSetId: record.romSetId!, romDigest: record.romDigest!,
    buildFingerprint: record.buildFingerprint!, approvedAt: record.approvedAt!,
    approvedBy: record.approvedBy!, reason: record.reason!,
    ...(typeof record.replacedDigest === 'string' ? { replacedDigest: record.replacedDigest } : {}),
  };
}
