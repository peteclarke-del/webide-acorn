import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PaletteWorkspace } from './PaletteWorkspace';
import { parsePaletteDocument } from '../assets/paletteDocument';

afterEach(() => { cleanup(); localStorage.clear(); });

function renderWorkspace(projectFiles: Array<{ name: string; content: string }> = []) {
  const props = { projectFiles, onAddSource: vi.fn(), onAddLivePalette: vi.fn(), onNotice: vi.fn() };
  render(<PaletteWorkspace {...props} />);
  return props;
}

const stored = () => parsePaletteDocument(localStorage.getItem('8bit-net-dev:palette')!);
const row = (logical: number) => screen.getByRole('row', { name: new RegExp(`^${logical} `) });

describe('PaletteWorkspace', () => {
  it('starts from the MODE 5 power-up palette and recovers it from browser storage', () => {
    renderWorkspace();
    expect(stored().mode).toBe('bbc-mode-5');
    expect(stored().entries).toEqual([0, 1, 3, 7]);
    expect(screen.getAllByRole('row')).toHaveLength(5);
  });

  it('maps a logical colour onto a physical colour and generates the VDU stream', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Physical colour for logical 2'), { target: { value: '6' } });
    expect(stored().entries).toEqual([0, 1, 6, 7]);
    expect(screen.getByLabelText('Generated palette assembler source')).toHaveTextContent('EQUB 19, 2, 6, 0, 0, 0 ; logical 2 becomes cyan');
    expect(screen.getByLabelText('Generated palette BASIC statements')).toHaveTextContent('VDU 19,2,6,0,0,0');
  });

  it('says a chosen colour flashes rather than implying the shown phase is all of it', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Physical colour for logical 1'), { target: { value: '9' } });
    expect(within(row(1)).getByText(/flashes on the machine/)).toBeInTheDocument();
    expect(screen.getByLabelText('Generated palette assembler source')).toHaveTextContent('logical 1 becomes flashing red/cyan');
  });

  it('changes mode, keeping the entries that still exist', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Physical colour for logical 1'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Display mode'), { target: { value: 'bbc-mode-2' } });
    expect(stored().entries).toHaveLength(16);
    expect(stored().entries.slice(0, 4)).toEqual([0, 4, 3, 7]);
    fireEvent.change(screen.getByLabelText('Display mode'), { target: { value: 'bbc-mode-4' } });
    expect(stored().entries).toEqual([0, 4]);
  });

  it('restores the power-up palette and undoes the last change', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Physical colour for logical 0'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to power-up' }));
    expect(stored().entries).toEqual([0, 1, 3, 7]);
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/restored to its power-up palette/));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(stored().entries[0]).toBe(5);
  });

  it('says the editors preview with the power-up palette when the project has none', () => {
    renderWorkspace();
    expect(screen.getByRole('status')).toHaveTextContent('This project has no palette document');
    expect(screen.getByText(/Add this palette to the project/)).toBeInTheDocument();
  });

  it('names the project palette the editors are actually previewing with', () => {
    renderWorkspace([{
      name: 'level.palette.json',
      content: JSON.stringify({ schema: '8bit-net.palette', version: 1, name: 'level', mode: 'bbc-mode-5', entries: [0, 2, 4, 6], extensions: {} }),
    }]);
    expect(screen.getByRole('status')).toHaveTextContent('preview 4-colour work with level.palette.json');
    const strip = screen.getByLabelText('Colours the editors currently preview with');
    expect(within(strip).getAllByText(/^\d/)).toHaveLength(4);
  });

  it('offers the generated source and a live palette build target', () => {
    const { onAddSource, onAddLivePalette } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Palette name'), { target: { value: 'level one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add generated source' }));
    expect(onAddSource).toHaveBeenCalledWith('level-one.asm', expect.stringContaining('.palette_level_one'));
    fireEvent.click(screen.getByRole('button', { name: 'Add live palette build target' }));
    expect(onAddLivePalette).toHaveBeenCalledWith('level-one', expect.stringContaining('"schema": "8bit-net.palette"'));
  });

  it('reports a refused change without altering the document', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Palette name'), { target: { value: 'x'.repeat(90) } });
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/1 to 80 characters/));
    expect(stored().name).toBe('untitled-palette');
  });
});
