import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FontWorkspace } from './FontWorkspace';
import { createFontDocument, glyphAt, parseFontDocument, serializeFontDocument } from '../assets/fontDocument';
import { resolveProjectPalette } from '../assets/paletteDocument';

afterEach(() => { cleanup(); localStorage.clear(); });

function renderWorkspace(projectFiles: ReturnType<typeof projectHolding> = []) {
  const props = { projectFiles, projectPalette: resolveProjectPalette([], 4), onAddSource: vi.fn(), onAddLiveFont: vi.fn(), onNotice: vi.fn() };
  render(<FontWorkspace {...props} />);
  return props;
}

/* A project holding one of these documents, so the editor can be asked whether
 * it offers what the person already has. */
function projectHolding(name: string, content: string) {
  return [{
    id: name, name, content, language: 'text' as const, encoding: 'utf-8' as const, lineEnding: 'lf' as const,
    modified: false, saved: true, savedName: name, savedContent: content,
    savedEncoding: 'utf-8' as const, savedLineEnding: 'lf' as const, kind: 'authored' as const, access: 'editable' as const,
  }];
}
const stored = () => parseFontDocument(localStorage.getItem('8bit-net-dev:font')!);

describe('FontWorkspace', () => {
  it('starts with one empty character in the reserved range', () => {
    renderWorkspace();
    expect(stored().glyphs).toEqual([{ code: 224, rows: Array(8).fill(0) }]);
    expect(screen.getByRole('grid', { name: 'Pixels of character 224' }).querySelectorAll('button')).toHaveLength(64);
  });

  it('sets a pixel and shows the row byte it produced', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('gridcell', { name: 'Row 1 column 1, clear' }));
    expect(glyphAt(stored(), 224)!.rows[0]).toBe(0x80);
    expect(within(screen.getByLabelText('Row bytes of the current character')).getByText(/^0: &80/)).toBeInTheDocument();
    expect(screen.getByLabelText('Generated font assembler source')).toHaveTextContent('EQUB 23, 224, &80');
  });

  it('adds, selects and removes characters', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }));
    expect(stored().glyphs.map((glyph) => glyph.code)).toEqual([224, 225]);
    expect(onNotice).toHaveBeenCalledWith('Character 225 added');
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }));
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/already defined/));
    fireEvent.click(screen.getByRole('button', { name: 'Remove character' }));
    expect(stored().glyphs.map((glyph) => glyph.code)).toEqual([225]);
  });

  it('applies a transform to the current character', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('gridcell', { name: 'Row 1 column 1, clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flip down' }));
    expect(glyphAt(stored(), 224)!.rows).toEqual([0, 0, 0, 0, 0, 0, 0, 0x80]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(glyphAt(stored(), 224)!.rows[0]).toBe(0x80);
  });

  it('previews the sample text and names codes it cannot draw', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Sample text'), { target: { value: 'AB' } });
    expect(stored().sampleText).toBe('AB');
    const preview = screen.getByLabelText('Sample text drawn with this character set');
    expect(within(preview).getByText('65')).toBeInTheDocument();
    expect(within(preview).getByText('66')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The sample uses 2 codes this font does not define: 65, 66');
  });

  it('draws a defined character rather than reporting it missing', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Sample text'), { target: { value: String.fromCharCode(224) } });
    const preview = screen.getByLabelText('Sample text drawn with this character set');
    expect(within(preview).getByRole('img', { name: 'Character 224' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns when a code outside the reserved range is redefined', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Character code to add'), { target: { value: '65' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }));
    expect(screen.getByText(/Codes 65 are outside 224 to 255/)).toBeInTheDocument();
  });

  it('offers generated source and a live build target', () => {
    const { onAddSource, onAddLiveFont } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Font name'), { target: { value: 'game font' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add generated source' }));
    expect(onAddSource).toHaveBeenCalledWith('game-font.asm', expect.stringContaining('.font_game_font'));
    fireEvent.click(screen.getByRole('button', { name: 'Add live font build target' }));
    expect(onAddLiveFont).toHaveBeenCalledWith('game-font', expect.stringContaining('"schema": "8bit-net.font"'));
  });
});

describe('a font the project already holds', () => {
  it('is offered beside the file dialog, and opening one loads it', () => {
    const props = renderWorkspace(projectHolding('title.font.json', serializeFontDocument(createFontDocument('title'))));
    fireEvent.change(screen.getByLabelText('Open a font from this project'), { target: { value: 'title.font.json' } });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('opened from this project'));
    expect(screen.getByLabelText('Font name')).toHaveValue('title');
  });

  it('does not offer a picker when the project holds no font', () => {
    renderWorkspace();
    expect(screen.queryByLabelText('Open a font from this project')).toBeNull();
  });
});
