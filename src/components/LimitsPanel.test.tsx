import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { LimitsPanel } from './LimitsPanel';
import { PRODUCT_LIMITS } from '../project/limits';

afterEach(cleanup);

describe('the limits panel', () => {
  it('shows every limit the product enforces, grouped by kind', () => {
    render(<LimitsPanel />);
    for (const kind of ['Size', 'Count', 'Retention', 'Concurrency']) {
      expect(screen.getByRole('region', { name: `${kind} limits` })).toBeInTheDocument();
    }
    const rows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('rowheader').length);
    expect(rows).toHaveLength(PRODUCT_LIMITS.length);
  });

  it('gives every limit its value, its reason and what happens on reaching it', () => {
    /* The last column is the one that matters: a limit that says only that it
     * fails leaves someone with nothing to act on. */
    render(<LimitsPanel />);
    const row = screen.getByRole('row', { name: /Files kept in the project trash/ });
    expect(row).toHaveTextContent('25 files');
    expect(row).toHaveTextContent('travels inside the project document');
    expect(row).toHaveTextContent('reports exactly which ones it dropped');
  });

  it('writes a byte limit in the unit a person reads', () => {
    render(<LimitsPanel />);
    expect(screen.getByRole('row', { name: /One source file/ })).toHaveTextContent('1 MiB');
  });

  it('narrows to what was searched for, and says so when nothing matches', () => {
    render(<LimitsPanel />);
    const search = screen.getByLabelText('Search limits');
    fireEvent.change(search, { target: { value: 'archive' } });
    expect(screen.queryByRole('region', { name: 'Retention limits' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Size limits' })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'nothing matches this' } });
    expect(screen.getByRole('status')).toHaveTextContent('No limit matches');
  });

  it('states that nothing is truncated silently, which is the promise the numbers rest on', () => {
    render(<LimitsPanel />);
    expect(screen.getByLabelText('Limits')).toHaveTextContent('nothing is truncated silently, and nothing is left half applied');
  });
});
