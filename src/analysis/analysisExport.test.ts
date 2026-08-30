// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { emptyAnalysisAnnotations, withEntryPoint, withIndirectTarget } from './analysisAnnotations';
import { ANALYSIS_FORMAT, createAnalysisDocument, sha256Hex } from './analysisExport';
import { disassemble6502 } from './disassembler6502';

/* A jump through a pointer at &1902 into a tail at &1905, so the annotations
 * under test are the ones reachability alone could not have derived. */
const BYTES = Uint8Array.from([0xa9, 0x00, 0x6c, 0x10, 0x19, 0xa9, 0x42, 0x60]);
const file = () => ({
  name: 'CODE', bytes: BYTES,
  analysis: disassemble6502(BYTES, 0x1900, 0x1900, '6502' as const),
  metadata: { source: 'manual-default' as const, warnings: [] },
});

describe('structured analysis export', () => {
  it('hashes the exact source bytes with SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('exports versioned provenance, configuration, metadata and user labels', async () => {
    const bytes = Uint8Array.from([0x60]);
    const analysis = disassemble6502(bytes, 0x2000, 0x2000, '6502');
    const result = await createAnalysisDocument({
      name: 'CODE', bytes, analysis,
      metadata: { source: 'sidecar', load: 0xffff2000, execute: 0xffff2000, warnings: [] },
    }, '6502', { 0x2000: 'start_here' });

    expect(result.format).toBe(ANALYSIS_FORMAT);
    expect(result.source.sha256).toHaveLength(64);
    expect(result.source.metadata.source).toBe('sidecar');
    expect(result.configuration).toEqual({ processor: '6502', origin: 0x2000, entryPoint: 0x2000 });
    expect(result.userLabels).toEqual({ 0x2000: 'start_here' });
  });
  it('carries the recorded annotations, so the document reproduces the listing rather than only describing it', async () => {
    const digest = await sha256Hex(BYTES);
    let annotations = withEntryPoint(emptyAnalysisAnnotations(digest), 0x1905);
    annotations = withIndirectTarget(annotations, { from: 0x1902, targets: [0x1905] });
    const document = await createAnalysisDocument(file(), '6502', {}, annotations);
    expect(document.annotations).toEqual(annotations);
  });

  it('omits an empty annotation set rather than carrying an empty object', async () => {
    const digest = await sha256Hex(BYTES);
    const document = await createAnalysisDocument(file(), '6502', {}, emptyAnalysisAnnotations(digest));
    expect('annotations' in document).toBe(false);
  });
});
