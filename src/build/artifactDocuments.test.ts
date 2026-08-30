// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { artifactListingRows, artifactSymbolReferences, generatedArtifactDocuments } from './artifactDocuments';
import { assembleProject6502 } from './projectAssembler6502';

describe('generated artifact documents and navigation', () => {
  const artifact = assembleProject6502('main', [
    { id: 'main', name: 'main.asm', content: 'ORG &2000\n.start\n JSR helper\n RTS' },
    { id: 'helper', name: 'helper.inc', content: '.helper\n LDA #1\n RTS\n; helper in a comment' },
  ].map((file, index) => index ? file : { ...file, content: `${file.content}\nINCLUDE "helper.inc"` }));

  it('maps listing addresses back to immutable source locations', () => {
    const rows = artifactListingRows(artifact);
    expect(rows.find((row) => row.address === 0x2000)?.source).toEqual({ fileId: 'main', fileName: 'main.asm', line: 3 });
    expect(rows.find((row) => row.address === 0x2004)?.source).toEqual({ fileId: 'helper', fileName: 'helper.inc', line: 2 });
  });

  it('finds real symbol definitions and references but excludes comments', () => {
    expect(artifactSymbolReferences(artifact, 'helper')).toEqual([
      { fileId: 'main', fileName: 'main.asm', line: 3, column: 6, definition: false },
      { fileId: 'helper', fileName: 'helper.inc', line: 1, column: 2, definition: true },
    ]);
  });

  it('emits deterministic read-only listing, symbol, map, memory and provenance documents', () => {
    const documents = generatedArtifactDocuments(artifact);
    expect(documents.map((document) => document.id)).toEqual(['listing', 'symbols', 'source-map', 'memory-map', 'provenance']);
    expect(documents.find((document) => document.id === 'memory-map')?.content).toContain('Origin:    &2000');
    expect(documents.find((document) => document.id === 'source-map')?.content).toContain('helper.inc:2');
  });

  it('turns the linker debug file into records a person can read', () => {
    /* The raw file is retained beside this one and remains the authority. This
     * document answers what people actually ask of it: where a local lives, and
     * which addresses a line of C produced. */
    const content = readFileSync(fileURLToPath(new URL('./fixtures/cc65-debug-info.dbg', import.meta.url)), 'utf8');
    const documents = generatedArtifactDocuments({
      ...artifact,
      retainedDocuments: [{ id: 'debug-info', label: 'ld65 debug data', filename: 'out.dbg', content, bytes: content.length, sha256: 'abc' }],
    });
    expect(documents.map((document) => document.id)).toContain('compiler-records');
    const records = documents.find((document) => document.id === 'compiler-records')!.content;
    expect(records).toContain('debug format 2.0');
    /* The boundary is stated, not left to be inferred from an empty section. */
    expect(records).toContain('This toolchain writes one empty type record');
    expect(records).toMatch(/add at &1923 · 48 bytes/);
    expect(records).toMatch(/local {2,}auto {2,}frame offset -2/);
    expect(records).toMatch(/CODE {2,}&1923/);
    expect(records).toContain('not written to any output file');
  });

  it('says a debug file could not be read rather than quietly producing no document', () => {
    /* No document would read as "this build had no compiler records", which is
     * a different and untrue statement. */
    const documents = generatedArtifactDocuments({
      ...artifact,
      retainedDocuments: [{ id: 'debug-info', label: 'ld65 debug data', filename: 'broken.dbg', content: 'not a debug file\n', bytes: 17, sha256: 'abc' }],
    });
    const records = documents.find((document) => document.id === 'compiler-records')!.content;
    expect(records).toContain('broken.dbg could not be read');
  });
});
