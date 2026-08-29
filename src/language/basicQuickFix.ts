import { nextBasicLineNumber, type BasicRenumberOptions } from './basicRenumber';

export interface BasicLineNumberFixPreview {
  physicalLine: number;
  number?: number;
  before: string;
  after: string;
  changed: boolean;
  errors: string[];
}

export function previewMissingBasicLineNumber(source: string, physicalLine: number, options: BasicRenumberOptions): BasicLineNumberFixPreview {
  const lines = source.split('\n'); const original = lines[physicalLine - 1];
  const blocked = (message: string): BasicLineNumberFixPreview => ({ physicalLine, before: source, after: source, changed: false, errors: [message] });
  if (!Number.isInteger(physicalLine) || physicalLine < 1 || physicalLine > lines.length) return blocked('The diagnostic physical line is outside the current source.');
  if (!original?.trim()) return blocked(`Physical line ${physicalLine} is blank and does not require a BASIC line number.`);
  if (/^\s*\d{1,5}(?=\s|[A-Za-z*]|$)/.test(original)) return blocked(`Physical line ${physicalLine} already has a BASIC line number.`);
  const suggestion = nextBasicLineNumber(source, physicalLine, options);
  if (suggestion.number === undefined) return blocked(suggestion.reason ?? 'No collision-free BASIC line number is available.');
  const indent = original.match(/^\s*/)?.[0] ?? '';
  lines[physicalLine - 1] = `${indent}${suggestion.number} ${original.slice(indent.length)}`;
  const after = lines.join('\n');
  return { physicalLine, number: suggestion.number, before: source, after, changed: after !== source, errors: [] };
}
