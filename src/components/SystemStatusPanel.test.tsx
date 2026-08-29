import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SystemStatusPanel } from './SystemStatusPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function answer(body: unknown, status = 200, correlationId = 'abc-123') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': correlationId },
  })));
}

const READY = {
  status: 'ready',
  unmet: [],
  toolchains: [
    { id: 'cc65.ca65-ld65', label: 'ca65 + ld65', ready: true, language: '6502', packageVersion: '2.19-1', licence: { spdx: 'LicenseRef-cc65' }, readiness: [{ check: 'ca65', ok: true, detail: '' }, { check: 'ld65', ok: true, detail: '' }] },
  ],
};

describe('what the build service says about itself', () => {
  it('reports a ready service and the identifier the answer was recorded under', () => {
    answer(READY);
    render(<SystemStatusPanel />);
    return waitFor(() => {
      expect(screen.getByText(/Every pinned toolchain this service needs is present/)).toBeInTheDocument();
      expect(screen.getByText('abc-123')).toBeInTheDocument();
      expect(screen.getByText('2 of 2 passed')).toBeInTheDocument();
    });
  });

  it('shows each unmet check with the remedy the service gave for it', async () => {
    /* A `ready: false` a person cannot act on is the situation this panel
     * exists to end, so the detail is what is displayed, not a summary of it. */
    answer({
      status: 'not-ready',
      unmet: [{ toolchain: 'stardot.beebasm', check: 'beebasm', detail: 'beebasm was not found as an executable at /usr/local/bin/beebasm. Run `npm run toolchains` from the service root.' }],
      toolchains: [{ id: 'stardot.beebasm', label: 'BeebAsm 1.11', ready: false, language: '6502', readiness: [{ check: 'beebasm', ok: false, detail: 'missing' }] }],
    }, 503);
    render(<SystemStatusPanel />);
    await waitFor(() => expect(screen.getByText(/at least one toolchain it needs is not usable/)).toBeInTheDocument());
    expect(screen.getByText(/npm run toolchains/)).toBeInTheDocument();
    expect(screen.getByText('stardot.beebasm · beebasm')).toBeInTheDocument();
    expect(screen.getByText('0 of 1 passed')).toBeInTheDocument();
  });

  it('says the service did not answer rather than that it is not ready', async () => {
    /* Two different situations, and only one of them is about a toolchain. */
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    render(<SystemStatusPanel />);
    await waitFor(() => expect(screen.getByText(/did not answer, so nothing is known about the toolchains/)).toBeInTheDocument());
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
    expect(screen.queryByText(/not usable/)).toBeNull();
  });

  it('does not imply that anything here is restricted by role', async () => {
    /* This build has no accounts to restrict it to, and a status page that
     * looked administrative would suggest otherwise. */
    answer(READY);
    render(<SystemStatusPanel />);
    await waitFor(() => expect(screen.getByText(/It is not an\s+administrative surface/)).toBeInTheDocument());
  });
});
