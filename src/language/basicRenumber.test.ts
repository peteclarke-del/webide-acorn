import { describe, expect, it } from 'vitest';
import { basicLineReferences, nextBasicLineNumber, previewBasicRenumber, previewBasicRenumberRange } from './basicRenumber';

describe('BBC BASIC numbering and renumbering', () => {
  it('renumbers lines and direct/computed branch lists atomically', () => {
    const preview = previewBasicRenumber('10 ON X GOTO 40, 100\n40 GOSUB 100:RESTORE 40\n100 END', { start: 1000, increment: 20 });
    expect(preview.errors).toEqual([]);
    expect(preview.unresolvedReferences).toEqual([]);
    expect(preview.updatedReferences).toBe(4);
    expect(preview.content).toBe('1000 ON X GOTO 1020, 1040\n1020 GOSUB 1040:RESTORE 1020\n1040 END');
  });

  it('preserves strings, REM tails and DATA payloads while reporting unresolved targets', () => {
    const preview = previewBasicRenumber('10 PRINT "GOTO 90":GOTO 20\n20 DATA 20,GOTO 10:REM GOTO 20\n30 GOTO 999', { start: 100, increment: 10 });
    expect(preview.content).toContain('100 PRINT "GOTO 90":GOTO 110');
    expect(preview.content).toContain('110 DATA 20,GOTO 10:REM GOTO 20');
    expect(preview.unresolvedReferences).toEqual([{ physicalLine: 3, sourceLine: 30, target: 999, command: 'GOTO' }]);
  });

  it('rejects ambiguous or overflowing programs before producing changes', () => {
    expect(previewBasicRenumber('10 A=1\n10 END', { start: 10, increment: 10 }).errors[0]).toMatch(/duplicated/);
    expect(previewBasicRenumber('10 A=1\n20 END', { start: 32760, increment: 10 }).errors[0]).toMatch(/exceed/);
    expect(previewBasicRenumber('PRINT "NO"', { start: 10, increment: 10 }).errors[0]).toMatch(/no BASIC line number/);
  });

  it('uses the configured increment or a safe insertion gap without collisions', () => {
    expect(nextBasicLineNumber('10 A=1\n40 END', 1, { start: 10, increment: 10 })).toEqual({ number: 20, strategy: 'increment' });
    expect(nextBasicLineNumber('10 A=1\n15 END', 1, { start: 10, increment: 10 })).toEqual({ number: 12, strategy: 'gap' });
    expect(nextBasicLineNumber('10 A=1\n11 END', 1, { start: 10, increment: 10 }).reason).toMatch(/No free line/);
    expect(nextBasicLineNumber('10aPRINT "ATOM"\n30bEND', 1, { start: 10, increment: 10 })).toEqual({ number: 20, strategy: 'increment' });
  });

  it('shares protected-text-aware references with editor navigation', () => {
    expect(basicLineReferences('ON X GOTO 40,100:PRINT "GOTO 90":DATA 10,GOTO 20:REM GOSUB 30')).toEqual([
      { command: 'GOTO', target: 40, start: 10, end: 12 }, { command: 'GOTO', target: 100, start: 13, end: 16 },
    ]);
  });

  it('renumbers a physical range and updates references from the complete program', () => {
    const preview = previewBasicRenumberRange('10 GOTO 30\n20 GOSUB 40\n30 GOTO 20\n40 END\n50 GOTO 30', { start: 25, increment: 5 }, { startPhysicalLine: 2, endPhysicalLine: 4 });
    expect(preview.errors).toEqual([]);
    expect(preview.updatedReferences).toBe(2);
    expect(preview.unresolvedReferences).toEqual([]);
    expect(preview.mappings.map(({ from, to }) => [from, to])).toEqual([[20, 25], [30, 30], [40, 35]]);
    expect(preview.content).toBe('10 GOTO 30\n25 GOSUB 35\n30 GOTO 25\n35 END\n50 GOTO 30');
  });

  it('rejects range collisions, ordering violations and invalid physical ranges', () => {
    const source = '10 GOTO 30\n20 END\n30 END\n40 END';
    expect(previewBasicRenumberRange(source, { start: 40, increment: 5 }, { startPhysicalLine: 2, endPhysicalLine: 3 }).errors.join(' ')).toMatch(/collides/);
    expect(previewBasicRenumberRange(source, { start: 5, increment: 1 }, { startPhysicalLine: 2, endPhysicalLine: 3 }).errors.join(' ')).toMatch(/preceding line/);
    expect(previewBasicRenumberRange(source, { start: 35, increment: 10 }, { startPhysicalLine: 2, endPhysicalLine: 3 }).errors.join(' ')).toMatch(/following line/);
    expect(previewBasicRenumberRange(source, { start: 20, increment: 10 }, { startPhysicalLine: 4, endPhysicalLine: 2 }).errors[0]).toMatch(/ascending physical lines/);
  });
});
