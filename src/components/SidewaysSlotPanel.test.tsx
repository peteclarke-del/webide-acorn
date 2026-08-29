import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { SidewaysSlotPanel } from './SidewaysSlotPanel';
import { SIDEWAYS_BANK_BYTES, type SidewaysAssignment } from '../rom/sidewaysSlots';

afterEach(cleanup);

function image(bytes = SIDEWAYS_BANK_BYTES): File {
  const data = new Uint8Array(bytes);
  for (let index = 0; index < data.length; index += 1) data[index] = (index * 7) & 0xff;
  data[0] = 0x4c; data[3] = 0x4c; data[6] = 0xc2; data[7] = 0x09; data[8] = 0x01; data[9] = 0x00;
  const file = new File([data], 'toolkit.rom');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => data.buffer });
  return file;
}

const choose = (file: File) => {
  const input = screen.getByLabelText('Choose a sideways ROM image') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
};

describe('the sideways banks', () => {
  it('shows all sixteen, filled or not, because an empty bank is where the next ROM goes', () => {
    render(<SidewaysSlotPanel available layout={[]} onChange={() => {}} onNotice={() => {}} />);
    const rows = within(screen.getByRole('table')).getAllByRole('rowheader');
    expect(rows.map((row) => row.textContent)).toEqual(Array.from({ length: 16 }, (_, bank) => String(bank)));
    expect(screen.getAllByText('empty')).toHaveLength(16);
  });

  it('says why the number matters, rather than leaving it to be known', () => {
    render(<SidewaysSlotPanel available layout={[]} onChange={() => {}} onNotice={() => {}} />);
    expect(screen.getByLabelText('Sideways ROM banks')).toHaveTextContent(/offers a call to bank 15\s*first and bank 0 last/);
  });

  it('places a valid image in the bank that was chosen', async () => {
    const onChange = vi.fn();
    const onNotice = vi.fn();
    render(<SidewaysSlotPanel available layout={[]} onChange={onChange} onNotice={onNotice} />);
    fireEvent.change(screen.getByLabelText('Bank to fill'), { target: { value: '9' } });
    choose(image());
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![0]).toEqual([expect.objectContaining({ bank: 9, label: 'toolkit.rom' })]);
    expect(onNotice).toHaveBeenCalledWith('toolkit.rom placed in bank 9');
  });

  it('refuses an image that is not exactly one bank, and says a combined one must be split', async () => {
    const onChange = vi.fn();
    const onNotice = vi.fn();
    render(<SidewaysSlotPanel available layout={[]} onChange={onChange} onNotice={onNotice} />);
    choose(image(SIDEWAYS_BANK_BYTES * 4));
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(onNotice.mock.calls[0]![0]).toMatch(/split into its banks/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not offer a bank that is already filled', () => {
    const layout: SidewaysAssignment[] = [{ bank: 4, romId: 'dfs', label: 'DFS' }];
    render(<SidewaysSlotPanel available layout={layout} onChange={() => {}} onNotice={() => {}} />);
    const options = within(screen.getByLabelText('Bank to fill') as HTMLElement).getAllByRole('option') as HTMLOptionElement[];
    expect(options[4]!.disabled).toBe(true);
    expect(options[4]!.textContent).toContain('DFS');
    expect(options[5]!.disabled).toBe(false);
  });

  it('empties a bank the person filled', () => {
    const onChange = vi.fn();
    const layout: SidewaysAssignment[] = [{ bank: 4, romId: 'dfs', label: 'DFS' }];
    render(<SidewaysSlotPanel available layout={layout} onChange={onChange} onNotice={() => {}} />);
    fireEvent.click(screen.getByLabelText('Empty bank 4'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('offers no way to empty a bank the machine’s own firmware occupies', () => {
    const layout: SidewaysAssignment[] = [{ bank: 15, romId: 'basic', label: 'BASIC II', reserved: true }];
    render(<SidewaysSlotPanel available layout={layout} onChange={() => {}} onNotice={() => {}} />);
    expect(screen.queryByLabelText('Empty bank 15')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent("part of this machine's own firmware");
  });

  it('states the service-call order once more than one ROM is fitted', () => {
    const layout: SidewaysAssignment[] = [
      { bank: 2, romId: 'low', label: 'Low' },
      { bank: 14, romId: 'high', label: 'High' },
    ];
    render(<SidewaysSlotPanel available layout={layout} onChange={() => {}} onNotice={() => {}} />);
    expect(screen.getByLabelText('Sideways ROM banks')).toHaveTextContent('High (bank 14), then Low (bank 2)');
  });

  it('says why there are no banks on a machine that has none, rather than showing an empty table', () => {
    render(<SidewaysSlotPanel available={false} unavailableReason="The Electron has no sideways ROM in this build." layout={[]} onChange={() => {}} onNotice={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('The Electron has no sideways ROM in this build.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says ROM images stay in the browser, which is the claim that matters for firmware', () => {
    render(<SidewaysSlotPanel available layout={[]} onChange={() => {}} onNotice={() => {}} />);
    expect(screen.getByLabelText('Sideways ROM banks')).toHaveTextContent('never uploaded');
  });
});
