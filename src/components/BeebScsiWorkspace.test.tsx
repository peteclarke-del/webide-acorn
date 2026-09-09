import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BeebScsiWorkspace } from './BeebScsiWorkspace';

afterEach(cleanup);

const noop = () => undefined;

describe('the BeebSCSI card section', () => {
  it('is not there at all when no board is fitted', () => {
    const { container } = render(<BeebScsiWorkspace fitted={false} connected mounted={[]} onCommand={noop} onNotice={noop} />);
    expect(container.firstChild).toBeNull();
  });

  it('offers all eight LUNs and says which four ADFS can reach', () => {
    render(<BeebScsiWorkspace fitted connected mounted={[]} onCommand={noop} onNotice={noop} />);
    const options = Array.from(screen.getByLabelText('LUN number').querySelectorAll('option')).map((option) => option.textContent);
    expect(options).toHaveLength(8);
    expect(options[3]).toBe('LUN 3');
    expect(options[4]).toBe('LUN 4 · VFS only');
  });

  it('will not put an image on the card before the machine is running', () => {
    render(<BeebScsiWorkspace fitted connected={false} mounted={[]} onCommand={noop} onNotice={noop} />);
    expect(screen.getByRole('button', { name: /Put on card/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create blank LUN' })).toBeDisabled();
    expect(screen.getByText(/Start the machine before putting an image on the card/)).toBeTruthy();
  });

  it('creates a blank LUN with the descriptor an ACB-4000 would carry and no sectors yet', () => {
    const onCommand = vi.fn();
    render(<BeebScsiWorkspace fitted connected mounted={[]} onCommand={onCommand} onNotice={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create blank LUN' }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    const command = onCommand.mock.calls[0]![0] as { type: string; lun: number; name: string; bytes: number[]; descriptor: number[] };
    expect(command.type).toBe('load-scsi-lun');
    expect(command.lun).toBe(0);
    expect(command.name).toBe('scsi0.dat');
    /* Nothing is written until the host writes it, so the image starts empty
     * and the descriptor is what says how big the drive is. */
    expect(command.bytes).toEqual([]);
    expect(command.descriptor).toHaveLength(22);
    expect(command.descriptor[15]).toBe(16); // heads
    expect((command.descriptor[13]! << 8) | command.descriptor[14]!).toBe(496); // cylinders, from 7,936 tracks
  });

  it('creates the blank LUN for the LUN that is selected', () => {
    const onCommand = vi.fn();
    render(<BeebScsiWorkspace fitted connected mounted={[]} onCommand={onCommand} onNotice={noop} />);
    fireEvent.change(screen.getByLabelText('LUN number'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create blank LUN' }));
    const command = onCommand.mock.calls[0]![0] as { lun: number; name: string };
    expect(command.lun).toBe(2);
    expect(command.name).toBe('scsi2.dat');
  });

  it('offers every documented size, labelled with what it really holds', () => {
    render(<BeebScsiWorkspace fitted connected mounted={[]} onCommand={noop} onNotice={noop} />);
    const sizes = Array.from(screen.getByLabelText('Blank LUN size').querySelectorAll('option')).map((option) => option.textContent);
    expect(sizes).toHaveLength(7);
    /* A track is 8,448 bytes, so none of these is a round number and the label
     * says so rather than rounding it away. */
    expect(sizes[0]).toBe('7.99 MB');
    expect(sizes.at(-1)).toBe('511.9 MB');
  });

  it('says the card is empty when it is, and lists what is on it when it is not', () => {
    const { rerender } = render(<BeebScsiWorkspace fitted connected mounted={[]} onCommand={noop} onNotice={noop} />);
    expect(screen.getByText('The card holds no LUN images in this session.')).toBeTruthy();
    rerender(<BeebScsiWorkspace fitted connected mounted={[{ lun: 1, name: 'scsi1.dat', size: 8448, revision: 3 }]} onCommand={noop} onNotice={noop} />);
    expect(screen.getByText(/scsi1.dat · GUEST MODIFIED/)).toBeTruthy();
    expect(screen.getByText(/LUN 1 · write revision 3 · 8,448 bytes held/)).toBeTruthy();
  });

  it('exports and takes off the card by LUN number, not by drive', () => {
    const onCommand = vi.fn();
    render(<BeebScsiWorkspace fitted connected mounted={[{ lun: 2, name: 'scsi2.dat', size: 0 }]} onCommand={onCommand} onNotice={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export current' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take off card' }));
    expect(onCommand.mock.calls.map((call) => call[0])).toEqual([
      { type: 'export-scsi-lun', lun: 2 },
      { type: 'eject-scsi-lun', lun: 2 },
    ]);
  });
});
