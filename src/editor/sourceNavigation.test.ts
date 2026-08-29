import { describe, expect, it } from 'vitest';
import { adjacentSourcePoint, enclosingSourceRange } from './sourceNavigation';

describe('source navigation model', () => {
  it('wraps ordered diagnostic and change locations in both directions', () => {
    const points = [{ line: 8, column: 2 }, { line: 2, column: 4 }, { line: 8, column: 1 }];
    expect(adjacentSourcePoint(points, { line: 8, column: 1 }, 1)).toEqual({ line: 8, column: 2 });
    expect(adjacentSourcePoint(points, { line: 2, column: 4 }, -1)).toEqual({ line: 8, column: 2 });
  });

  it('finds the smallest enclosing bracket while ignoring strings and comments', () => {
    const content = 'void draw(void) {\n  print("}"); // }\n  if (ready) { plot(); }\n}';
    const position = content.indexOf('plot');
    expect(enclosingSourceRange({ content, language: 'c' }, position)).toMatchObject({ kind: 'bracket', label: '{} block', startLine: 3, endLine: 3 });
  });

  it('matches nested BBC BASIC loop scopes and excludes REM text', () => {
    const content = '10 FOR I=1 TO 2\n20 REPEAT\n30 PRINT I\n40 UNTIL I=2\n50 NEXT\n60 REM FOR X=1 TO 9';
    expect(enclosingSourceRange({ content, language: 'bbc-basic' }, content.indexOf('PRINT'))).toMatchObject({ kind: 'loop', label: 'REPEAT/UNTIL', startLine: 2, endLine: 4 });
  });
});
