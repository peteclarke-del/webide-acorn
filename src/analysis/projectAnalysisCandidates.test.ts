import { describe, expect, it } from 'vitest';
import { analysisCandidates, candidateReference, projectFileBytes } from './projectAnalysisCandidates';
import type { ProjectFile } from '../project/project';

const file = (over: Partial<ProjectFile>): ProjectFile => ({
  id: 'f1', name: 'main.s', content: 'LDA #1\n', language: '6502', modified: false, ...over,
});

describe('what the project can offer the analyser', () => {
  it('offers built output before anything somebody typed', () => {
    const offered = analysisCandidates(
      [file({ id: 'f1', name: 'main.s' })],
      [{ targetId: 't1', targetName: 'Tape build', outputName: 'GAME', byteLength: 432 }],
    );
    expect(offered.map((candidate) => candidate.id)).toEqual(['artifact:t1', 'file:f1']);
    expect(offered[0]!.detail).toBe('built by Tape build · 432 bytes');
  });

  it('sorts files by name and says what each one is', () => {
    const offered = analysisCandidates(
      [file({ id: 'b', name: 'zebra.bas', language: 'bbc-basic' }), file({ id: 'a', name: 'alpha.s' })],
      [],
    );
    expect(offered.map((candidate) => candidate.name)).toEqual(['alpha.s', 'zebra.bas']);
    expect(offered[1]!.detail).toContain('BBC BASIC');
  });

  it('marks generated files so nobody mistakes one for their own', () => {
    const [offered] = analysisCandidates([file({ kind: 'generated', name: 'sprites.s' })], []);
    expect(offered!.detail).toContain('generated 6502 assembly');
  });

  it('measures a file as the bytes it would be written as, not its characters', () => {
    /* A line ending is a byte too, and a project that writes CRLF writes more
     * of them than the character count suggests. */
    const crlf = file({ content: 'one\ntwo\n', lineEnding: 'crlf' });
    expect(projectFileBytes(crlf)).toHaveLength(10);
    expect(analysisCandidates([crlf], [])[0]!.detail).toContain('10 bytes');
  });

  it('keeps a build target and a file from colliding on identity', () => {
    expect(candidateReference('artifact:t1')).toEqual({ origin: 'artifact', key: 't1' });
    expect(candidateReference('file:f1')).toEqual({ origin: 'file', key: 'f1' });
    expect(candidateReference('file:')).toBeNull();
    expect(candidateReference('t1')).toBeNull();
    expect(candidateReference('rom:t1')).toBeNull();
  });
});
