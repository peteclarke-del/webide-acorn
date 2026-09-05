import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AnalysisWorkspace, type AnalysisWorkspaceProps } from '../App';
import { emptyAnalysisAnnotations } from '../analysis/analysisAnnotations';
import { createAnnotationHistory } from '../analysis/annotationHistory';
import { disassemble6502 } from '../analysis/disassembler6502';
import { correlateRuntimeCoverage } from '../analysis/runtimeCoverage';

/* Eight rows, enough to exercise paging and end-of-list movement. */
const BYTES = Uint8Array.from([
  0xa9, 0x00, 0xa2, 0x01, 0xa0, 0x02, 0xe8, 0xc8,
  0xca, 0x88, 0x18, 0x38, 0xea, 0x60,
]);
const DIGEST = '3'.repeat(64);
const analysis = disassemble6502(BYTES, 0x1900, 0x1900, '6502');

function renderWorkspace(overrides: Partial<AnalysisWorkspaceProps> = {}) {
  const props: AnalysisWorkspaceProps = {
    file: { name: 'probe.bin', bytes: BYTES, analysis, metadata: { source: 'manual-default', warnings: [] } },
    origin: '&1900', entryPoint: '&1900', processor: '6502',
    activity: { status: 'idle', message: '' },
    onOriginChange: vi.fn(), onEntryChange: vi.fn(), onProcessorChange: vi.fn(),
    onOpen: vi.fn(), candidates: [], onChooseCandidate: vi.fn(), onReanalyse: vi.fn(), onCancel: vi.fn(), onAddSource: vi.fn(), onResearch: vi.fn(),
    debugAvailable: false, onDebugAddress: vi.fn(), onNotice: vi.fn(),
    annotations: emptyAnalysisAnnotations(DIGEST),
    history: createAnnotationHistory(emptyAnalysisAnnotations(DIGEST)),
    onAnnotationsChange: vi.fn(), onHistoryMove: vi.fn(),
    coverage: null,
    ...overrides,
  };
  return { props, ...render(<AnalysisWorkspace {...props} />) };
}

const rows = () => screen.getAllByRole('row').filter((row) => row.hasAttribute('data-analysis-address'));

afterEach(cleanup);

describe('analysis listing accessibility', () => {
  it('presents the listing as a grid with named columns rather than an unlabelled list', () => {
    renderWorkspace();
    const grid = screen.getByRole('grid', { name: 'Disassembly listing' });
    const headers = within(grid).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Label / address', 'Bytes', 'Instruction', 'Analysis']);
    expect(grid).toHaveAttribute('aria-rowcount', String(rows().length + 1));
  });

  it('puts exactly one row in the tab order, so a long listing is not thousands of tab stops', () => {
    renderWorkspace();
    const tabbable = rows().filter((row) => row.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(rows()[0]);
  });

  it('moves between rows with the arrow keys and reports the selected row', () => {
    renderWorkspace();
    const listing = rows();
    fireEvent.keyDown(listing[0]!, { key: 'ArrowDown' });
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true');
    expect(rows()[0]).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(rows()[1]!, { key: 'ArrowUp' });
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('reaches the ends of the listing with Home and End', () => {
    renderWorkspace();
    fireEvent.keyDown(rows()[0]!, { key: 'End' });
    expect(rows().at(-1)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rows().at(-1)!, { key: 'Home' });
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('does not run past either end of the listing', () => {
    renderWorkspace();
    fireEvent.keyDown(rows()[0]!, { key: 'ArrowUp' });
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rows()[0]!, { key: 'End' });
    fireEvent.keyDown(rows().at(-1)!, { key: 'ArrowDown' });
    expect(rows().at(-1)).toHaveAttribute('aria-selected', 'true');
  });

  it('pages by a screenful without leaving the listing', () => {
    renderWorkspace();
    fireEvent.keyDown(rows()[0]!, { key: 'PageDown' });
    expect(rows().at(-1)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rows().at(-1)!, { key: 'PageUp' });
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('activates a row from the keyboard and describes it in the inspector', () => {
    renderWorkspace();
    fireEvent.keyDown(rows()[2]!, { key: 'Enter' });
    const inspector = screen.getByLabelText('Selected disassembly row');
    expect(within(inspector).getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(inspector.textContent).toContain('&1904');
  });

  it('offers a branch target as a real button with an accessible name', () => {
    const branching = Uint8Array.from([0xa9, 0x00, 0xd0, 0xfc, 0x60]);
    renderWorkspace({ file: { name: 'branch.bin', bytes: branching, analysis: disassemble6502(branching, 0x1900, 0x1900, '6502'), metadata: { source: 'manual-default', warnings: [] } } });
    expect(screen.getByRole('button', { name: 'Go to &1900' })).toBeInTheDocument();
  });

  it('keeps the observed-execution column out of the grid until coverage is bound', () => {
    const { unmount } = renderWorkspace();
    expect(screen.queryByRole('columnheader', { name: 'Observed' })).not.toBeInTheDocument();
    unmount();

    const bound = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST,
      programManifest: { outputSha256: DIGEST, origin: 0x1900, bytes: BYTES.length, name: 'probe.bin' },
      profiler: { enabled: true, instructions: 4, untrackedInstructions: 0, uniqueAddresses: 1, source: 'live jsbeeb instruction hook', addresses: [{ address: 0x1900, instructions: 4, cycles: 8 }] },
    });
    renderWorkspace({ coverage: bound });
    expect(screen.getByRole('columnheader', { name: 'Observed' })).toBeInTheDocument();
    expect(screen.getByText('4 × · 8 cycles')).toBeInTheDocument();
    expect(screen.getAllByText('not observed executing').length).toBeGreaterThan(0);
  });

  it('states why coverage is absent rather than showing an empty column', () => {
    const refused = correlateRuntimeCoverage({ analysis, analysedSha256: DIGEST, programManifest: null, profiler: null });
    renderWorkspace({ coverage: refused });
    expect(screen.getByText(/No machine is attached/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Observed' })).not.toBeInTheDocument();
  });

  it('names the annotation controls so they can be reached and understood without sight', () => {
    renderWorkspace();
    fireEvent.click(rows()[0]!);
    const inspector = screen.getByLabelText('Selected disassembly row');
    expect(within(inspector).getByRole('button', { name: 'Treat as an entry point' })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'Mark data' })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'Record flow' })).toBeInTheDocument();
    expect(within(inspector).getByText('Observed execution')).toBeInTheDocument();
  });
});

describe('reaching the analyser from the project', () => {
  const candidates = [
    { id: 'artifact:t1', name: 'GAME', origin: 'artifact' as const, detail: 'built by Tape build · 432 bytes', byteLength: 432 },
    { id: 'file:f1', name: 'main.s', origin: 'file' as const, detail: '6502 assembly · 7 bytes', byteLength: 7 },
  ];

  it('offers what the project holds beside the host file picker', () => {
    renderWorkspace({ candidates });
    const picker = screen.getByRole('combobox', { name: 'Analyse a file from this project' });
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a file…',
      'GAME · built by Tape build · 432 bytes',
      'main.s · 6502 assembly · 7 bytes',
    ]);
    expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument();
  });

  it('analyses what was chosen, and stays choosable afterwards', () => {
    const onChooseCandidate = vi.fn();
    renderWorkspace({ candidates, onChooseCandidate });
    const picker = screen.getByRole('combobox', { name: 'Analyse a file from this project' });
    fireEvent.change(picker, { target: { value: 'file:f1' } });
    expect(onChooseCandidate).toHaveBeenCalledWith('file:f1');
    /* The control returns to its prompt so the same file can be chosen again
     * after somebody has changed the load address and wants a fresh read. */
    expect((picker as HTMLSelectElement).value).toBe('');
  });

  it('says nothing at all when the project has nothing to offer', () => {
    renderWorkspace({ candidates: [] });
    expect(screen.queryByRole('combobox', { name: 'Analyse a file from this project' })).toBeNull();
  });

  it('offers the project from the empty state too, so a first read needs no disk', () => {
    renderWorkspace({ candidates, file: null });
    expect(screen.getByRole('combobox', { name: 'Analyse a file from this project' })).toBeInTheDocument();
  });
});
