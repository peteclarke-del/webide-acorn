import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HELP_TOPICS } from '../help/helpTopics';
import { HelpWorkspace } from './HelpWorkspace';

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('HelpWorkspace', () => {
  it('searches full procedures and selects the first matching technical topic', () => {
    render(<HelpWorkspace />);
    fireEvent.change(screen.getByLabelText('Search in-app help'), { target: { value: 'compound breakpoint' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Debug ARM2 and RISC OS code' })).toBeInTheDocument();
    expect(location.hash).toBe('#help/debugger-arm');
    expect(screen.getByText(/Every condition must match/)).toBeInTheDocument();
  });

  it('filters by category and follows related topic links', () => {
    render(<HelpWorkspace />);
    fireEvent.change(screen.getByLabelText('Filter help category'), { target: { value: 'Build' } });
    /* Counted from the content rather than hard-coded, so adding a topic does not
     * make this assertion say something untrue about the filter. */
    expect(screen.getByRole('navigation', { name: 'Help topics' }).querySelectorAll('button'))
      .toHaveLength(HELP_TOPICS.filter((topic) => topic.category === 'Build').length);
    fireEvent.click(screen.getByRole('button', { name: 'List BASIC and disassemble machine code' }));
    expect(location.hash).toBe('#help/analysis');
    fireEvent.click(screen.getByRole('button', { name: 'Create, inspect and mount media' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Create, inspect and mount media' })).toBeInTheDocument();
  });

  it('opens a valid deep link and exposes screenshot alternatives', () => {
    history.replaceState(null, '', '#help/debugger-6502');
    render(<HelpWorkspace />);
    expect(screen.getByRole('heading', { level: 1, name: 'Debug Atom, Electron and BBC family code' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /BBC family debugger/ })).toBeInTheDocument();
  });
});
