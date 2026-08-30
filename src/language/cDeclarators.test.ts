// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { describeDeclarator, parseCDeclaration, type CDeclarator } from './cDeclarators';

/** Name and kind only, so a test states what it means. */
const shape = (text: string) => (parseCDeclaration(text) ?? []).map((item) => [item.name, item.kind, item.type]);

describe('the simple half of the language, which the old pattern already covered', () => {
  it('reads a plain variable, keeping the whole base type', () => {
    expect(shape('int frame_counter;')).toEqual([['frame_counter', 'variable', 'int']]);
    expect(shape('unsigned char tile;')).toEqual([['tile', 'variable', 'unsigned char']]);
    expect(shape('static const int limit = 5;')).toEqual([['limit', 'variable', 'int']]);
  });

  it('reads a function, with its parameters separated', () => {
    const [declarator] = parseCDeclaration('void draw_sprite(int x, int y);')!;
    expect(declarator).toMatchObject({ name: 'draw_sprite', kind: 'function', parameters: ['int x', 'int y'] });
    expect(describeDeclarator(declarator!)).toBe('function returning void');
  });

  it('treats an empty parameter list and (void) as the same thing', () => {
    expect(parseCDeclaration('int frame(void);')![0]!.parameters).toEqual([]);
    expect(parseCDeclaration('int frame();')![0]!.parameters).toEqual([]);
  });
});

describe('the half a pattern quietly gets wrong', () => {
  it('tells an array of pointers from a pointer', () => {
    /* The distinction a regular expression cannot make, and the one that
     * matters: `names` is eight pointers, not one. */
    expect(shape('char *names[8];')).toEqual([['names', 'array', 'char *[8]']]);
    expect(shape('char *name;')).toEqual([['name', 'pointer', 'char *']]);
  });

  it('reads a function pointer as a function pointer, not as a variable of the return type', () => {
    const [declarator] = parseCDeclaration('void (*handler)(int);')!;
    expect(declarator).toMatchObject({ name: 'handler', kind: 'function-pointer', parameters: ['int'] });
    /* The `*` makes this a pointer to a function. It decorates the declarator,
     * not the return type, so `void` must not become `void *`. */
    expect(declarator!.type).toBe('void');
    expect(describeDeclarator(declarator!)).toBe('pointer to function returning void');
  });

  it('reads an array of function pointers', () => {
    const [declarator] = parseCDeclaration('int (*table[4])(void);')!;
    expect(declarator).toMatchObject({ name: 'table', kind: 'function-pointer', parameters: [] });
    /* The return type is `int`; the array-ness is in the declaration, which is
     * carried as written rather than inferred into the type. */
    expect(declarator!.type).toBe('int');
    expect(declarator!.declaration).toBe('int (*table[4])(void)');
  });

  it('gives each declarator in one declaration its own type', () => {
    /* `int a, *b, c[3];` is three different types, which is exactly what a
     * `type name` pattern flattens into one. */
    expect(shape('int a, *b, c[3];')).toEqual([
      ['a', 'variable', 'int'],
      ['b', 'pointer', 'int *'],
      ['c', 'array', 'int[3]'],
    ]);
  });

  it('keeps every dimension of a multidimensional array', () => {
    expect(shape('unsigned char screen[8][8];')).toEqual([['screen', 'array', 'unsigned char[8][8]']]);
  });

  it('keeps a struct, union or enum tag as part of the type', () => {
    expect(shape('struct sprite_state state;')).toEqual([['state', 'variable', 'struct sprite_state']]);
    expect(shape('enum mode current, previous;')).toEqual([
      ['current', 'variable', 'enum mode'],
      ['previous', 'variable', 'enum mode'],
    ]);
  });

  it('reads a typedef name as a type', () => {
    expect(shape('sprite_state state;')).toEqual([['state', 'variable', 'sprite_state']]);
    expect(shape('sprite_state *states[4];')).toEqual([['states', 'array', 'sprite_state *[4]']]);
  });

  it('drops the initialiser, which is not part of the declarator', () => {
    expect(shape('int counter = frame(1, 2), other = 3;')).toEqual([
      ['counter', 'variable', 'int'],
      ['other', 'variable', 'int'],
    ]);
  });

  it('reads a pointer to a pointer', () => {
    expect(shape('char **argv;')).toEqual([['argv', 'pointer', 'char **']]);
  });
});

describe('what it refuses to read', () => {
  it('answers with nothing rather than guessing, and that is a real answer', () => {
    /* A caller must show no type at all rather than a wrong one. */
    for (const text of ['', '   ', 'frame_counter = 0;', 'return x;', 'if (x) {', '/* only a comment */', '}']) {
      expect(parseCDeclaration(text), text).toBeNull();
    }
  });

  it('does not read a call or an assignment as a declaration', () => {
    expect(parseCDeclaration('draw_sprite(1, 2);')).toBeNull();
    expect(parseCDeclaration('counter += 1;')).toBeNull();
  });

  it('does not fall over on an unbalanced declaration', () => {
    expect(() => parseCDeclaration('void (*handler)(int;')).not.toThrow();
    expect(() => parseCDeclaration('char *names[8;')).not.toThrow();
  });
});

describe('where each name sits in the text', () => {
  it('gives an offset that lands on the name, so navigation is exact', () => {
    const text = 'static unsigned char *rows[8], *columns[8];';
    const declarators = parseCDeclaration(text)! as CDeclarator[];
    for (const declarator of declarators) {
      expect(text.slice(declarator.offset, declarator.offset + declarator.name.length)).toBe(declarator.name);
    }
  });

  it('lands on the name inside a parenthesised declarator too', () => {
    const text = 'void (*handler)(int);';
    const [declarator] = parseCDeclaration(text)!;
    expect(text.slice(declarator!.offset, declarator!.offset + declarator!.name.length)).toBe('handler');
  });
});
