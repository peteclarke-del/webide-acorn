/* Deciding whether a golden that failed should be replaced.
 *
 * The two easy answers are both wrong. Replacing it automatically means the
 * test agrees with whatever the program does next, for ever. Never replacing it
 * means the test becomes noise people learn to scroll past. So the panel puts
 * the decision in front of somebody with what they need to make it: both
 * pictures, where they differ, and — the part that is usually missing — what
 * has changed about the machine, the firmware and the build since the golden
 * was approved.
 *
 * That last part is why a failure here is not one question but two. A
 * difference with nothing else changed is about the program. A difference after
 * a firmware change may be about the firmware, and the panel says so rather
 * than letting somebody approve away a real regression because the picture
 * looked plausible.
 */
import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import {
  approveGoldenUpdate,
  goldenIsAuthoritative,
  type GoldenEnvironment,
  type GoldenUpdateProposal,
  type ProvenancedGolden,
} from '../testing/goldenProvenance';
import { locateDifference } from '../testing/goldenReport';

interface GoldenApprovalPanelProps {
  golden: ProvenancedGolden;
  proposal: GoldenUpdateProposal;
  environment: GoldenEnvironment;
  onApproved: (golden: ProvenancedGolden) => void;
  onNotice: (message: string) => void;
  /** Who is approving. Supplied by the host rather than typed in each time. */
  approver: string;
  now?: () => string;
}

export function GoldenApprovalPanel({ golden, proposal, environment, onApproved, onNotice, approver, now }: GoldenApprovalPanelProps) {
  const [reason, setReason] = useState('');
  const clock = now ?? (() => new Date().toISOString());
  const standing = useMemo(() => goldenIsAuthoritative(golden, environment), [golden, environment]);
  const located = useMemo(() => {
    try {
      return locateDifference(proposal.currentRgbaBase64, proposal.proposedRgbaBase64, golden.width, golden.height, proposal.difference.allowedChannelDelta);
    } catch {
      /* Sizes that disagree are a real condition and not this panel's to
       * diagnose; the difference report above still stands. */
      return null;
    }
  }, [proposal, golden.width, golden.height]);

  const approve = () => {
    try {
      onApproved(approveGoldenUpdate(proposal, golden, { approvedBy: approver, approvedAt: clock(), reason }));
      onNotice(`${golden.name} was replaced. The reason and what it replaced are recorded with it.`);
      setReason('');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="golden-approval panel-surface" aria-label={`Approve a replacement for ${golden.name}`}>
      <div className="panel-heading">
        <div><span className="eyebrow">GOLDEN DIFFERS</span><h2>{golden.name}</h2></div>
        <small>{proposal.difference.differingPixels.toLocaleString()} pixels differ</small>
      </div>

      {!standing.authoritative && (
        <p className="dfs-warning" role="status">{standing.reason}</p>
      )}

      <p className="binding-note">{proposal.summary}</p>
      {located && <p className="binding-note">{located.summary}</p>}

      <div>
        <h3>What has changed since this golden was approved</h3>
        {proposal.drift.length ? (
          <ul className="system-status-unmet">
            {proposal.drift.map((entry) => (
              <li key={entry.kind}>
                <strong>{entry.kind}</strong>
                <span>{entry.detail} It was {entry.was}; it is now {entry.now}.</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="binding-note">
            Nothing. Same machine, same firmware bytes, same build fingerprint — so this difference is the program,
            and approving it accepts a change somebody made.
          </p>
        )}
      </div>

      <dl className="golden-provenance">
        <div><dt>Approved</dt><dd>{golden.provenance.approvedAt} by {golden.provenance.approvedBy}</dd></div>
        <div><dt>Against</dt><dd>{golden.provenance.machineLabel}, {golden.provenance.romSetId}</dd></div>
        <div><dt>Reason given then</dt><dd>{golden.provenance.reason}</dd></div>
      </dl>

      <label className="golden-reason">
        <span>Why this replacement is right</span>
        <textarea
          aria-label="Reason for replacing this golden"
          value={reason}
          rows={2}
          placeholder="What changed, and why the new picture is the correct expectation"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      <div className="reference-actions">
        <button type="button" disabled={reason.trim().length < 8} onClick={approve}>
          <Icon name="check" size={14} /> Replace the golden
        </button>
        <span className="honest-note">
          {reason.trim().length < 8
            ? 'A reason of at least a few words is required. Six months from now it is the only thing that distinguishes an approval from nobody having looked.'
            : 'The reason, who approved it and what it replaced are all recorded with the new golden.'}
        </span>
      </div>
    </section>
  );
}
