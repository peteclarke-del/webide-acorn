import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../project/project';
import { GoToSourceDialog } from './GoToSourceDialog';

const files: ProjectFile[] = [
  { id: 'main', name: 'main.asm', content: 'INCLUDE "lib.asm"\n.start\n JSR draw', language: '6502', modified: false },
  { id: 'lib', name: 'lib.asm', content: '.draw\n RTS', language: '6502', modified: false },
];

afterEach(cleanup);

describe('go to source dialog', () => {
  it('opens an exact physical line from colon notation', () => {
    const navigate = vi.fn();
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={2} onNavigate={navigate} onClose={() => undefined} />);
    fireEvent.keyDown(screen.getByLabelText('File, symbol, line or address'), { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('main', 2, undefined, undefined);
  });

  it('filters parsed project symbols by independent terms and opens the exact range', () => {
    const navigate = vi.fn(); const close = vi.fn();
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={1} onNavigate={navigate} onClose={close} />);
    const input = screen.getByLabelText('File, symbol, line or address');
    fireEvent.change(input, { target: { value: 'draw lib' } });
    expect(screen.getByRole('option', { name: /draw/ })).toHaveTextContent('lib.asm:1:2');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('lib', 1, 2, 4);
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports an invalid line and closes with Escape', () => {
    const close = vi.fn();
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={1} onNavigate={() => undefined} onClose={close} />);
    const input = screen.getByLabelText('File, symbol, line or address');
    fireEvent.change(input, { target: { value: ':99' } });
    expect(screen.getByText(/has \d+ lines?, so there is no physical line 99/)).toBeVisible();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('opens files without requiring a declaration and resolves current build addresses', () => {
    const navigate = vi.fn();
    render(<GoToSourceDialog open files={[...files, { id: 'notes', name: 'hardware-notes.txt', content: 'notes', language: 'text', modified: false }]} activeFileId="main" currentLine={1} sourceLocations={{ 0x1900: { fileId: 'lib', fileName: 'lib.asm', line: 2 } }} onNavigate={navigate} onClose={() => undefined} />);
    const input = screen.getByLabelText('File, symbol, line or address');
    fireEvent.change(input, { target: { value: 'hardware-notes' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenLastCalledWith('notes', 1, undefined, undefined);
    fireEvent.change(input, { target: { value: '@&1902' } });
    expect(screen.getByRole('option', { name: /&1902/ })).toHaveTextContent('nearest preceding mapped address &1900');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenLastCalledWith('lib', 2, undefined, undefined);
  });
});

describe('what the dialog says when nothing matches', () => {
  /* An empty list reads as "there is no such thing". That is a different
   * statement from "this build carries no address map", and only one of them
   * is usually true, so the dialog says which. */
  it('says the build has no address map rather than showing an empty list', () => {
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={1} onNavigate={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('File, symbol, line or address'), { target: { value: '@&1900' } });
    expect(screen.getByRole('status')).toHaveTextContent('no source-to-address map');
    expect(screen.getByRole('status')).toHaveTextContent('Build the target with debug metadata');
  });

  it('says an address is below everything the build maps, naming the lowest', () => {
    const locations = { 0x1900: { fileId: 'main', fileName: 'main.asm', line: 2 } };
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={1} sourceLocations={locations} onNavigate={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('File, symbol, line or address'), { target: { value: '@&1000' } });
    expect(screen.getByRole('status')).toHaveTextContent('&1000 is below &1900');
  });

  it('says an address that is not hexadecimal is not one, and how to write one', () => {
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={1} onNavigate={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('File, symbol, line or address'), { target: { value: '@nineteen' } });
    expect(screen.getByRole('status')).toHaveTextContent('nineteen is not a hexadecimal address');
    expect(screen.getByRole('status')).toHaveTextContent('@&1900');
  });

  it('repeats the terms that matched nothing, rather than saying only that nothing did', () => {
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={1} onNavigate={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('File, symbol, line or address'), { target: { value: 'absent thing' } });
    expect(screen.getByRole('status')).toHaveTextContent('"absent" and "thing"');
  });

  it('finds an exact build address and a nearest preceding one, with the difference stated', () => {
    const locations = {
      0x1900: { fileId: 'main', fileName: 'main.asm', line: 2 },
      0x1910: { fileId: 'lib', fileName: 'lib.asm', line: 1 },
    };
    const navigate = vi.fn();
    render(<GoToSourceDialog open files={files} activeFileId="main" currentLine={1} sourceLocations={locations} onNavigate={navigate} onClose={() => undefined} />);
    const input = screen.getByLabelText('File, symbol, line or address');
    fireEvent.change(input, { target: { value: '@&1910' } });
    expect(screen.getByRole('option', { name: /1910/ })).toHaveTextContent('exact build address');
    fireEvent.change(input, { target: { value: '@0x1918' } });
    expect(screen.getByRole('option', { name: /1918/ })).toHaveTextContent('nearest preceding mapped address &1910');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('lib', 1, undefined, undefined);
  });
});

describe('every declaration the index parses is reachable from this dialog', () => {
  const rich: ProjectFile[] = [
    { id: 'asm', name: 'main.asm', content: 'screen_base = &7C00\n.macro plot_tile\n  RTS\n.endmacro\n.start\n  RTS', language: '6502', modified: false },
    { id: 'c', name: 'support.c', content: '#define TILE_WIDTH 8\n#define SQUARE(x) ((x) * (x))\ntypedef struct sprite_state sprite_state;\nvoid draw_sprite(int x, int y) {\n}\nint frame_counter = 0;\n', language: 'c', modified: false },
    { id: 'bas', name: 'menu.bas', content: '10 PRINT "HI"\n20 DEF PROCdraw(x, y)\n30 ENDPROC', language: 'bbc-basic', modified: false },
  ];

  const found = (term: string) => {
    render(<GoToSourceDialog open files={rich} activeFileId="asm" currentLine={1} onNavigate={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('File, symbol, line or address'), { target: { value: term } });
    const options = screen.queryAllByRole('option').map((option) => option.textContent ?? '');
    cleanup();
    return options;
  };

  it('finds an assembly constant and macro', () => {
    expect(found('screen_base').join(' ')).toContain('constant');
    expect(found('plot_tile').join(' ')).toContain('macro');
  });

  it('finds a C object-like define, a function-like define, a type, a function and a file-scope variable', () => {
    expect(found('TILE_WIDTH').join(' ')).toContain('constant');
    expect(found('SQUARE').join(' ')).toContain('macro');
    expect(found('sprite_state').join(' ')).toContain('type');
    expect(found('draw_sprite').join(' ')).toContain('function');
    expect(found('frame_counter').join(' ')).toContain('variable');
  });

  it('finds a BASIC procedure and a numbered line', () => {
    expect(found('PROCdraw').join(' ')).toContain('procedure');
    expect(found('10 menu').join(' ')).toContain('line');
  });

  it('searches by kind, so every constant in the project can be listed at once', () => {
    expect(found('constant').length).toBeGreaterThanOrEqual(2);
    expect(found('macro').length).toBeGreaterThanOrEqual(2);
  });
});
