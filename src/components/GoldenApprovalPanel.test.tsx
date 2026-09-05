import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { GoldenApprovalPanel } from './GoldenApprovalPanel';
import { proposeGoldenUpdate, type GoldenEnvironment, type ProvenancedGolden } from '../testing/goldenProvenance';
import { bytesToBase64 } from '../testing/screenAssertion';
import type { ScreenDifference } from '../testing/screenAssertion';

afterEach(cleanup);

const environment: GoldenEnvironment = {
  machineId: 'bbc-b', machineLabel: 'BBC Model B',
  romSetId: 'os12-basic2-dfs', romDigest: 'rom-aaa', buildFingerprint: 'build-222',
};

const picture = (value: number) => bytesToBase64(new Uint8Array(2 * 2 * 4).fill(value));

const golden = (overrides: Partial<ProvenancedGolden['provenance']> = {}): ProvenancedGolden => ({
  id: 'title', name: 'Title screen', width: 2, height: 2, rgbaBase64: picture(0),
  provenance: {
    machineId: 'bbc-b', machineLabel: 'BBC Model B', romSetId: 'os12-basic2-dfs',
    romDigest: 'rom-aaa', buildFingerprint: 'build-111',
    approvedAt: '2026-08-01T00:00:00Z', approvedBy: 'pete', reason: 'First accepted title screen.',
    ...overrides,
  },
});

const difference: ScreenDifference = {
  expectedRgbaBase64: picture(0), actualRgbaBase64: picture(255),
  expectedDigest: 'FNV32:1111', actualDigest: 'FNV32:2222',
  differingPixels: 4, allowedDifferingPixels: 0,
  maximumChannelDelta: 255, allowedChannelDelta: 0, passed: false,
};

function open(held = golden()) {
  const proposal = proposeGoldenUpdate(held, difference, environment);
  const props = { golden: held, proposal, environment, onApproved: vi.fn(), onNotice: vi.fn(), approver: 'pete', now: () => '2026-08-30T00:00:00Z' };
  render(<GoldenApprovalPanel {...props} />);
  return props;
}

describe('what a person is shown before deciding', () => {
  it('says what changed since the golden was approved', () => {
    open();
    expect(screen.getByRole('heading', { name: 'What has changed since this golden was approved' })).toBeInTheDocument();
    /* Only the build differs here, which is the ordinary case. It is said
     * twice on purpose — once in the summary somebody reads first, once
     * itemised beneath — so the assertion is scoped to the itemised list. */
    const drift = screen.getByRole('list');
    expect(within(drift).getByText(/ordinary reason for a difference/)).toBeInTheDocument();
    expect(within(drift).getByText(/It was build-111; it is now build-222\./)).toBeInTheDocument();
  });

  it('says plainly when nothing changed, so approving accepts a change somebody made', () => {
    open(golden({ buildFingerprint: 'build-222' }));
    expect(screen.getByText(/this difference is the program, and approving it accepts a change somebody made/)).toBeInTheDocument();
  });

  it('warns when the golden cannot settle the question at all', () => {
    /* Approved on another machine: showable, but it decides nothing. */
    open(golden({ machineId: 'master', machineLabel: 'BBC Master 128' }));
    expect(screen.getByRole('status')).toHaveTextContent(/approved against BBC Master 128 and this run is BBC Model B/);
  });

  it('locates the difference rather than only counting it', () => {
    open();
    expect(screen.getByText(/4 pixels differ, inside a 2 by 2 box at 0,0/)).toBeInTheDocument();
  });

  it('shows what the golden was originally approved against, and why', () => {
    open();
    expect(screen.getByText('First accepted title screen.')).toBeInTheDocument();
    expect(screen.getByText(/BBC Model B, os12-basic2-dfs/)).toBeInTheDocument();
  });
});

describe('approving', () => {
  it('will not replace a golden without a reason of a few words', () => {
    const props = open();
    const button = screen.getByRole('button', { name: /Replace the golden/ });
    expect(button).toBeDisabled();
    expect(screen.getByText(/only thing that distinguishes an approval from nobody having looked/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reason for replacing this golden'), { target: { value: 'ok' } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason for replacing this golden'), { target: { value: 'Title text was deliberately re-centred.' } });
    expect(button).toBeEnabled();
    expect(props.onApproved).not.toHaveBeenCalled();
  });

  it('records the reason, the approver and what it replaced', () => {
    const props = open();
    fireEvent.change(screen.getByLabelText('Reason for replacing this golden'), { target: { value: 'Title text was deliberately re-centred.' } });
    fireEvent.click(screen.getByRole('button', { name: /Replace the golden/ }));

    expect(props.onApproved).toHaveBeenCalledTimes(1);
    const replaced = props.onApproved.mock.calls[0]![0] as ProvenancedGolden;
    expect(replaced.rgbaBase64).toBe(picture(255));
    expect(replaced.provenance).toMatchObject({
      approvedBy: 'pete',
      approvedAt: '2026-08-30T00:00:00Z',
      reason: 'Title text was deliberately re-centred.',
      replacedDigest: 'FNV32:1111',
      buildFingerprint: 'build-222',
    });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/what it replaced are recorded with it/));
  });
});
