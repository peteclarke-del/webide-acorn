export const MACHINE_TEXT_LIMIT = 4096;

export type JsBeebKeyboardLayout = 'physical' | 'natural' | 'gaming';

export const JSBEEB_KEYBOARD_LAYOUTS: ReadonlyArray<{ id: JsBeebKeyboardLayout; label: string; detail: string }> = [
  { id: 'physical', label: 'Physical', detail: 'Host key positions use jsbeeb physical mapping.' },
  { id: 'natural', label: 'Natural', detail: 'Printed characters follow the host UK or US layout.' },
  { id: 'gaming', label: 'Gaming', detail: 'Critical BBC keys move away from browser shortcut positions.' },
];

export const ACORN_KEY_ROWS: ReadonlyArray<ReadonlyArray<{ label: string; code: number }>> = [
  [{ label: 'f0', code: 121 }, ...Array.from({ length: 9 }, (_, index) => ({ label: `f${index + 1}`, code: 112 + index }))],
  [...'1234567890'.split('').map((label, index) => ({ label, code: 49 + index % 10 })), { label: 'DELETE', code: 8 }],
  [...'QWERTYUIOP'.split('').map((label) => ({ label, code: label.charCodeAt(0) })), { label: 'RETURN', code: 13 }],
  [...'ASDFGHJKL'.split('').map((label) => ({ label, code: label.charCodeAt(0) })), { label: 'COPY', code: 122 }],
  [{ label: 'SHIFT', code: 16 }, ...'ZXCVBNM'.split('').map((label) => ({ label, code: label.charCodeAt(0) })), { label: 'SPACE', code: 32 }],
  [{ label: 'ESCAPE', code: 27 }, { label: 'CTRL', code: 17 }, { label: '←', code: 37 }, { label: '↑', code: 38 }, { label: '↓', code: 40 }, { label: '→', code: 39 }],
];

const VALID_TAP_CODES = new Set(ACORN_KEY_ROWS.flatMap((row) => row.map((key) => key.code)));

export function isJsBeebKeyboardLayout(value: unknown): value is JsBeebKeyboardLayout {
  return value === 'physical' || value === 'natural' || value === 'gaming';
}

export function validateMachineText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Machine text must be a string');
  if (value.length < 1 || value.length > MACHINE_TEXT_LIMIT) throw new Error(`Machine text must contain 1 to ${MACHINE_TEXT_LIMIT.toLocaleString()} characters`);
  const normalized = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const unsupported = Array.from(normalized).find((character) => character !== '\n' && character !== '\t' && (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) > 0x7e));
  if (unsupported) throw new Error(`Machine text contains unsupported U+${unsupported.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  return normalized;
}

export function validateMachineTapCode(value: unknown): number {
  if (!Number.isInteger(value) || !VALID_TAP_CODES.has(Number(value))) throw new Error('The requested on-screen key is not in the maintained Acorn key surface');
  return Number(value);
}
