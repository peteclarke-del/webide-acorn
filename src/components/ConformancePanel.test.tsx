import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConformancePanel } from './ConformancePanel';
import { CONFORMANCE_CASES } from '../testing/conformanceSuite';

afterEach(cleanup);

describe('what this build has evidence for', () => {
  it('leads with the areas nothing checks, rather than with what passes', () => {
    /* A list of passing cases answers the wrong question: what somebody needs
     * to know is where a fault would go unnoticed. */
    render(<ConformancePanel machineId="bbc-b" capabilities={[]} />);
    const uncovered = screen.getByRole('heading', { name: 'Areas with no conformance cases' }).parentElement!;
    expect(within(uncovered).getAllByText(/not known to be wrong and it is not known to be right/).length).toBeGreaterThan(0);
  });

  it('says how many areas have cases and how many do not', () => {
    render(<ConformancePanel machineId="bbc-b" capabilities={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent(/areas have conformance cases/);
    expect(screen.getByRole('status')).toHaveTextContent(/not a passing area; it is one where a fault would go unnoticed/);
  });

  it('shows a case that has not been run as not run, rather than as anything else', () => {
    render(<ConformancePanel machineId="bbc-b" capabilities={[]} />);
    expect(screen.getAllByText('not run').length).toBeGreaterThan(0);
    expect(screen.queryByText('passed')).toBeNull();
  });

  it('shows a result once there is one', () => {
    const first = CONFORMANCE_CASES.find((item) => !item.requires.machines.length)!;
    render(<ConformancePanel machineId="bbc-b" capabilities={[]} results={{ [first.id]: { passed: true, detail: 'Ran in 43 cycles.' } }} />);
    expect(screen.getByText('passed')).toBeInTheDocument();
    expect(screen.getByText('Ran in 43 cycles.')).toBeInTheDocument();
  });

  it('marks a case that cannot apply here as not applicable rather than as passing', () => {
    render(<ConformancePanel machineId="atom" capabilities={[]} />);
    expect(screen.getAllByText('not applicable').length).toBeGreaterThan(0);
  });

  it('says a case is one somebody can also run by hand', () => {
    render(<ConformancePanel machineId="bbc-b" capabilities={[]} />);
    expect(screen.getByText(/same hardware-test path as any other test in this workbench/)).toBeInTheDocument();
  });
});
