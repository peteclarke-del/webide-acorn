import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TargetModePreview } from './TargetModePreview';
import { resolveProjectPalette } from '../assets/paletteDocument';

afterEach(cleanup);

const palette = () => resolveProjectPalette([], 16);
const solid = (colour: number, count: number) => Array.from({ length: count }, () => colour);

describe('showing artwork the way the machine will', () => {
  it('describes the pixel shape to a screen reader, not only by drawing it', () => {
    /* The whole point of the panel is a shape difference, and a shape drawn
     * without being described is a panel that only works for some people. */
    render(<TargetModePreview pixels={solid(0, 16)} width={4} height={4} palette={palette()} preferredMode="bbc-mode-5" />);
    const canvas = screen.getByRole('img');
    expect(canvas).toHaveAccessibleName(/MODE 5/);
    expect(canvas).toHaveAccessibleName(/4 times as wide/);
  });

  it('reports what a frame costs and how much screen it takes', () => {
    render(<TargetModePreview pixels={solid(0, 256)} width={16} height={16} palette={palette()} preferredMode="bbc-mode-5" />);
    expect(screen.getByText('64 bytes at 2 bpp')).toBeInTheDocument();
    expect(screen.getByText(/10% across/)).toBeInTheDocument();
  });

  it('switches mode and recomputes what it says', () => {
    render(<TargetModePreview pixels={solid(0, 256)} width={16} height={16} palette={palette()} preferredMode="bbc-mode-5" />);
    expect(screen.getByText('64 bytes at 2 bpp')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /MODE 0/ }));
    expect(screen.getByText('32 bytes at 1 bpp')).toBeInTheDocument();
    expect(screen.getByText('square')).toBeInTheDocument();
  });
});

describe('colours the mode cannot show', () => {
  it('names them with the pixel counts rather than substituting something', () => {
    const pixels = [...solid(0, 10), ...solid(7, 3), ...solid(12, 3)];
    render(<TargetModePreview pixels={pixels} width={4} height={4} palette={palette()} preferredMode="bbc-mode-5" />);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: '7' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: '12' })).toBeInTheDocument();
    expect(screen.getByText(/left empty above rather than substituted/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is clamped for you/)).toBeInTheDocument();
  });

  it('says in the accessible name that every colour fits when it does', () => {
    render(<TargetModePreview pixels={solid(1, 16)} width={4} height={4} palette={palette()} preferredMode="bbc-mode-5" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/Every colour in this artwork can be shown/);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('marks on each mode button how many colours that mode would lose', () => {
    const pixels = Array.from({ length: 16 }, (_, index) => index);
    render(<TargetModePreview pixels={pixels} width={4} height={4} palette={palette()} />);
    expect(screen.getByRole('button', { name: /MODE 2 16 colours/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MODE 5.*colours missing/ })).toBeInTheDocument();
  });

  it('opens on a mode that can show the artwork when the project names none', () => {
    const pixels = Array.from({ length: 16 }, (_, index) => index);
    render(<TargetModePreview pixels={pixels} width={4} height={4} palette={palette()} />);
    expect(screen.getByRole('button', { name: /MODE 2/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
