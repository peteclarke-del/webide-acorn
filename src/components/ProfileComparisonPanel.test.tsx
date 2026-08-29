import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ProfileComparisonPanel } from './ProfileComparisonPanel';
import { machineProfiles } from '../data/machines';

afterEach(cleanup);

const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('comparing two machines before choosing one', () => {
  it('offers every machine this build registers on both sides', () => {
    render(<ProfileComparisonPanel />);
    for (const side of ['first machine', 'second machine']) {
      const options = within(screen.getByLabelText(side) as HTMLElement).getAllByRole('option');
      expect(options, side).toHaveLength(machineProfiles.length);
    }
  });

  it('says plainly when two configurations do not differ, rather than showing an empty table', () => {
    render(<ProfileComparisonPanel />);
    const [first] = machineProfiles;
    choose('first machine', first!.id);
    choose('second machine', first!.id);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('the same in every respect');
    expect(screen.getByText('Nothing, because nothing differs.')).toBeInTheDocument();
  });

  it('names what differs between two genuinely different machines', () => {
    render(<ProfileComparisonPanel />);
    choose('first machine', 'bbc-b');
    choose('second machine', 'archimedes-a300');
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('machine');
    expect(table).toHaveTextContent('Acorn BBC Model B');
    expect(table).toHaveTextContent('Acorn Archimedes A300');
  });

  it('warns that compiled code will not move between processor families', () => {
    /* The warning that matters most: a person moving a 6502 project to an ARM
     * machine has to know before they do it, not after it will not build. */
    render(<ProfileComparisonPanel />);
    choose('first machine', 'bbc-b');
    choose('second machine', 'archimedes-a300');
    expect(screen.getByText(/compiled code will not transfer/i)).toBeInTheDocument();
  });

  it('does not invent a warning when two machines differ but work still moves', () => {
    /* A panel that always found something to warn about would be one nobody
     * reads. Where the differences are real and none of them stops the move,
     * it says exactly that. */
    render(<ProfileComparisonPanel />);
    choose('first machine', 'bbc-b');
    choose('second machine', 'bbc-b');
    const variants = within(screen.getByLabelText('second variant') as HTMLElement).getAllByRole('option');
    if (variants.length > 1) {
      choose('second variant', (variants[1] as HTMLOptionElement).value);
      expect(screen.getByRole('table')).toHaveTextContent('variant');
    }
    expect(screen.queryByText(/compiled code will not transfer/i)).not.toBeInTheDocument();
  });

  it('re-offers only the variants and firmware the chosen machine actually has', () => {
    render(<ProfileComparisonPanel />);
    choose('first machine', 'bbc-b');
    const machine = machineProfiles.find((candidate) => candidate.id === 'bbc-b')!;
    const variants = within(screen.getByLabelText('first variant') as HTMLElement).getAllByRole('option').map((option) => option.textContent);
    expect(variants).toEqual(machine.variants);
    const roms = within(screen.getByLabelText('first firmware') as HTMLElement).getAllByRole('option').map((option) => option.textContent);
    expect(roms).toEqual(machine.roms.map((rom) => rom.label));
  });

  it('summarises each side so the comparison is readable without the controls', () => {
    render(<ProfileComparisonPanel />);
    choose('first machine', 'bbc-b');
    const panel = screen.getByLabelText('Compare machine profiles');
    expect(panel).toHaveTextContent('Acorn BBC Model B');
  });

  it('says it is the same comparison the project-open warning raises', () => {
    /* Two surfaces answering the same question differently would be worse than
     * one, so this says which answer it is showing. */
    render(<ProfileComparisonPanel />);
    expect(screen.getByLabelText('Compare machine profiles'))
      .toHaveTextContent('raised when a project is opened against a different machine');
  });
});
