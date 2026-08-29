import { describe, expect, it } from 'vitest';
import {
  addGlyph, clearGlyph, createFontDocument, FIRST_RESERVED_UDG_CODE, fontLabel, generateFontOutput,
  glyphAt, glyphPixels, MAX_GLYPHS, parseFontDocument, previewCharacters, removeGlyph,
  serializeFontDocument, setGlyphPixel, setSampleText, transformGlyph, type FontDocument,
} from './fontDocument';

/** A capital A drawn in the reserved user-defined range. */
function sample(): FontDocument {
  const base = createFontDocument('game font');
  const rows = [0x18, 0x3c, 0x66, 0x66, 0x7e, 0x66, 0x66, 0x00];
  return parseFontDocument({ ...base, glyphs: [{ code: 224, rows }], sampleText: 'AB' });
}

describe('font documents', () => {
  it('starts with one empty reserved character', () => {
    const document = createFontDocument();
    expect(document.glyphs).toEqual([{ code: FIRST_RESERVED_UDG_CODE, rows: Array(8).fill(0) }]);
    expect(parseFontDocument(document)).toEqual(document);
  });

  it('round-trips through serialization and keeps codes sorted', () => {
    const document = parseFontDocument({ ...sample(), glyphs: [{ code: 226, rows: Array(8).fill(1) }, { code: 224, rows: Array(8).fill(2) }] });
    expect(document.glyphs.map((glyph) => glyph.code)).toEqual([224, 226]);
    expect(parseFontDocument(serializeFontDocument(document))).toEqual(document);
  });

  it('refuses bad codes, duplicate codes, wrong row counts and non-byte rows', () => {
    expect(() => parseFontDocument({ ...sample(), glyphs: [{ code: 31, rows: Array(8).fill(0) }] })).toThrow(/whole number from 32 to 255/);
    expect(() => parseFontDocument({ ...sample(), glyphs: [{ code: 224, rows: Array(8).fill(0) }, { code: 224, rows: Array(8).fill(0) }] })).toThrow(/defined twice/);
    expect(() => parseFontDocument({ ...sample(), glyphs: [{ code: 224, rows: Array(7).fill(0) }] })).toThrow(/exactly 8 rows/);
    expect(() => parseFontDocument({ ...sample(), glyphs: [{ code: 224, rows: [0, 0, 0, 0, 0, 0, 0, 256] }] })).toThrow(/not a byte/);
    expect(() => parseFontDocument({ ...sample(), glyphs: [] })).toThrow(/at least one character/);
    expect(() => parseFontDocument({ schema: 'other', version: 1 })).toThrow(/Unsupported font schema/);
  });

  it('bounds the number of characters a font may define', () => {
    const glyphs = Array.from({ length: MAX_GLYPHS + 1 }, (_, index) => ({ code: 32 + index, rows: Array(8).fill(0) }));
    expect(() => parseFontDocument({ ...sample(), glyphs })).toThrow(/limited to 224 characters/);
  });

  it('reads a glyph as pixels with the most significant bit leftmost', () => {
    const pixels = glyphPixels(glyphAt(sample(), 224)!);
    expect(pixels).toHaveLength(64);
    // Row 0 is &18: two set pixels in the middle.
    expect(pixels.slice(0, 8)).toEqual([false, false, false, true, true, false, false, false]);
  });
});

describe('editing a character', () => {
  it('sets and clears one pixel', () => {
    const withPixel = setGlyphPixel(createFontDocument(), 224, 0, 0, true);
    expect(glyphAt(withPixel, 224)!.rows[0]).toBe(0x80);
    expect(glyphAt(setGlyphPixel(withPixel, 224, 0, 0, false), 224)!.rows[0]).toBe(0);
    expect(glyphAt(setGlyphPixel(withPixel, 224, 7, 3, true), 224)!.rows[3]).toBe(0x01);
  });

  it('refuses a pixel outside the character or a code the font lacks', () => {
    expect(() => setGlyphPixel(createFontDocument(), 224, 8, 0, true)).toThrow(/outside the character/);
    expect(() => setGlyphPixel(createFontDocument(), 225, 0, 0, true)).toThrow(/does not define character 225/);
  });

  it('adds, clears and removes characters', () => {
    const two = addGlyph(createFontDocument(), 225);
    expect(two.glyphs.map((glyph) => glyph.code)).toEqual([224, 225]);
    expect(() => addGlyph(two, 225)).toThrow(/already defined/);
    expect(removeGlyph(two, 224).glyphs.map((glyph) => glyph.code)).toEqual([225]);
    expect(() => removeGlyph(createFontDocument(), 224)).toThrow(/at least one character/);
    expect(glyphAt(clearGlyph(sample(), 224), 224)!.rows).toEqual(Array(8).fill(0));
  });

  it('applies each transform to the exact bits', () => {
    const rows = glyphAt(sample(), 224)!.rows;
    expect(glyphAt(transformGlyph(sample(), 224, 'flip-vertical'), 224)!.rows).toEqual([...rows].reverse());
    expect(glyphAt(transformGlyph(sample(), 224, 'invert'), 224)!.rows).toEqual(rows.map((row) => ~row & 0xff));
    expect(glyphAt(transformGlyph(sample(), 224, 'shift-up'), 224)!.rows).toEqual([...rows.slice(1), 0]);
    expect(glyphAt(transformGlyph(sample(), 224, 'shift-down'), 224)!.rows).toEqual([0, ...rows.slice(0, -1)]);
    // A vertically symmetric letter is unchanged by a horizontal flip.
    expect(glyphAt(transformGlyph(sample(), 224, 'flip-horizontal'), 224)!.rows).toEqual(rows);
    // Rotating right four times returns the original.
    let rotated = sample();
    for (let turn = 0; turn < 4; turn += 1) rotated = transformGlyph(rotated, 224, 'rotate-right');
    expect(glyphAt(rotated, 224)!.rows).toEqual(rows);
  });

  it('stores bounded sample text with the document', () => {
    expect(setSampleText(createFontDocument(), 'hello').sampleText).toBe('hello');
    expect(setSampleText(createFontDocument(), 'x'.repeat(300)).sampleText).toHaveLength(240);
  });
});

describe('text preview', () => {
  it('draws the characters the font defines', () => {
    const preview = previewCharacters(sample(), String.fromCharCode(224));
    expect(preview).toHaveLength(1);
    expect(preview[0]!.code).toBe(224);
    expect(preview[0]!.pixels).toHaveLength(64);
  });

  it('reports an undefined code instead of substituting a shape for it', () => {
    const preview = previewCharacters(sample(), `A${String.fromCharCode(224)}`);
    expect(preview[0]).toEqual({ code: 65, pixels: null });
    expect(preview[1]!.pixels).not.toBeNull();
  });

  it('previews the stored sample text by default', () => {
    expect(previewCharacters(sample()).map((entry) => entry.code)).toEqual([65, 66]);
  });
});

describe('generated font output', () => {
  const output = generateFontOutput(sample());

  it('emits the exact VDU 23 stream the machine needs', () => {
    expect(Array.from(output.bytes)).toEqual([23, 224, 0x18, 0x3c, 0x66, 0x66, 0x7e, 0x66, 0x66, 0x00]);
    expect(output.manifest).toMatchObject({ glyphCount: 1, codes: [224], byteLength: 10 });
    expect(output.manifest.sha256).toBe(generateFontOutput(sample()).manifest.sha256);
  });

  it('offers assembler and BASIC forms of the same definitions', () => {
    expect(fontLabel('game font')).toBe('font_game_font');
    expect(output.assembly).toContain('.font_game_font');
    expect(output.assembly).toContain('EQUB 23, 224, &18, &3C, &66, &66, &7E, &66, &66, &00');
    expect(output.basic).toBe('VDU 23,224,24,60,102,102,126,102,102,0');
  });

  it('names codes defined outside the range the machine reserves for user characters', () => {
    expect(output.manifest.codesOutsideReservedRange).toEqual([]);
    const wide = generateFontOutput(addGlyph(sample(), 65));
    expect(wide.manifest.codesOutsideReservedRange).toEqual([65]);
  });
});
