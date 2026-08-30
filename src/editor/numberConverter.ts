import type { Processor } from '../analysis/types';

export type NumberWidth = 8 | 16 | 32;
export type ConverterProcessor = Processor | 'arm';

export interface NumberConversion {
  inputValue: number;
  unsigned: number;
  signed: number;
  bits: NumberWidth;
  decimal: string;
  hexadecimal: string;
  binary: string;
  octal: string;
  acornLiteral: string;
  alternativeLiteral: string;
  cLiteral: string;
  littleEndian: string;
  bigEndian: string;
  character?: string;
  address: { valid: boolean; maximum: number; alignment: number; reason: string };
}

function parseInteger(source: string) {
  const text = source.trim().replaceAll('_', '');
  const match = /^([+-]?)(?:(?:&|\$|0x)([0-9a-f]+)|(?:%|0b)([01]+)|0o([0-7]+)|(\d+))$/i.exec(text);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const body = match[2] ?? match[3] ?? match[4] ?? match[5]!;
  const radix = match[2] ? 16 : match[3] ? 2 : match[4] ? 8 : 10;
  const magnitude = Number.parseInt(body, radix);
  return Number.isSafeInteger(magnitude) ? sign * magnitude : null;
}

export function convertNumber(input: string, bits: NumberWidth, processor: ConverterProcessor): { conversion?: NumberConversion; error?: string } {
  const value = parseInteger(input);
  if (value === null) return { error: 'Enter decimal, &hex, $hex, 0xhex, %binary, 0bbinary or 0ooctal integer notation.' };
  const modulus = 2 ** bits;
  const signedMinimum = -(2 ** (bits - 1));
  if (value < signedMinimum || value >= modulus) return { error: `${bits}-bit conversion accepts ${signedMinimum.toLocaleString()} through ${(modulus - 1).toLocaleString()}.` };
  const unsigned = value < 0 ? modulus + value : value;
  const signed = unsigned >= 2 ** (bits - 1) ? unsigned - modulus : unsigned;
  const byteCount = bits / 8;
  const bytes = Array.from({ length: byteCount }, (_, index) => Math.floor(unsigned / (2 ** (index * 8))) & 0xff);
  const byteText = (values: number[]) => values.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const hex = unsigned.toString(16).toUpperCase().padStart(bits / 4, '0');
  const addressMaximum = processor === 'arm' ? 0x03ffffff : 0xffff;
  const alignment = processor === 'arm' ? 4 : 1;
  const inRange = value >= 0 && value <= addressMaximum;
  const aligned = inRange && value % alignment === 0;
  const address = {
    valid: inRange && aligned,
    maximum: addressMaximum,
    alignment,
    reason: !inRange ? `${processor === 'arm' ? 'ARM 26-bit' : '6502-family'} address range is &0000 to &${addressMaximum.toString(16).toUpperCase().padStart(processor === 'arm' ? 8 : 4, '0')}.` : !aligned ? 'ARM instruction addresses must be word aligned.' : `Valid ${processor === 'arm' ? 'ARM 26-bit word-aligned' : '16-bit 6502-family'} address.`,
  };
  return { conversion: {
    inputValue: value,
    unsigned,
    signed,
    bits,
    decimal: String(unsigned),
    hexadecimal: hex,
    binary: unsigned.toString(2).padStart(bits, '0'),
    octal: unsigned.toString(8).padStart(Math.ceil(bits / 3), '0'),
    acornLiteral: `&${hex}`,
    alternativeLiteral: `$${hex}`,
    cLiteral: `0x${hex}`,
    littleEndian: byteText(bytes),
    bigEndian: byteText([...bytes].reverse()),
    ...(bytes[0]! >= 32 && bytes[0]! <= 126 ? { character: String.fromCharCode(bytes[0]!) } : {}),
    address,
  } };
}
