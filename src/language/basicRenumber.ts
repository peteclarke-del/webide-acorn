export interface BasicRenumberOptions { start: number; increment: number }
export interface BasicRenumberRange { startPhysicalLine: number; endPhysicalLine: number }
export interface BasicLineMapping { physicalLine: number; from: number; to: number }
export interface BasicUnresolvedReference { physicalLine: number; sourceLine: number; target: number; command: string }
export interface BasicLineReference { target: number; command: string; start: number; end: number }
export interface BasicRenumberPreview {
  content: string;
  mappings: BasicLineMapping[];
  updatedReferences: number;
  unresolvedReferences: BasicUnresolvedReference[];
  errors: string[];
  changed: boolean;
}

const MAX_LINE = 32767;
const TARGET_COMMAND = /^(GOSUB|GOTO|RESTORE|RESUME|THEN|ELSE|RUN)\b/i;

export function validateBasicNumbering(options: BasicRenumberOptions) {
  if (!Number.isInteger(options.start) || options.start < 0 || options.start > MAX_LINE) throw new Error('BASIC start line must be an integer from 0 to 32,767');
  if (!Number.isInteger(options.increment) || options.increment < 1 || options.increment > MAX_LINE) throw new Error('BASIC line increment must be an integer from 1 to 32,767');
  return options;
}

export function previewBasicRenumber(source: string, input: BasicRenumberOptions): BasicRenumberPreview {
  return previewBasicRenumberInternal(source, input);
}

export function previewBasicRenumberRange(source: string, input: BasicRenumberOptions, range: BasicRenumberRange): BasicRenumberPreview {
  if (!Number.isInteger(range.startPhysicalLine) || !Number.isInteger(range.endPhysicalLine) || range.startPhysicalLine < 1 || range.endPhysicalLine < range.startPhysicalLine) {
    return { content: source, mappings: [], updatedReferences: 0, unresolvedReferences: [], errors: ['BASIC renumber range must use ascending physical lines from 1'], changed: false };
  }
  return previewBasicRenumberInternal(source, input, range);
}

function previewBasicRenumberInternal(source: string, input: BasicRenumberOptions, range?: BasicRenumberRange): BasicRenumberPreview {
  const options = validateBasicNumbering(input);
  const newline = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
  const physicalLines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const parsed: Array<{ physicalLine: number; indent: string; number: number; spacing: string; body: string }> = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < physicalLines.length; index++) {
    const text = physicalLines[index]!;
    if (!text.trim()) continue;
    const match = text.match(/^(\s*)(\d{1,5})(\s?)(.*)$/);
    if (!match) { if (!range || (index + 1 >= range.startPhysicalLine && index + 1 <= range.endPhysicalLine)) errors.push(`Physical line ${index + 1} has no BASIC line number`); continue; }
    const number = Number(match[2]);
    if (number > MAX_LINE) errors.push(`Physical line ${index + 1} has line number ${number}, outside 0–32,767`);
    if (seen.has(number)) errors.push(`Line number ${number} is duplicated and cannot be mapped safely`);
    seen.add(number);
    parsed.push({ physicalLine: index + 1, indent: match[1]!, number, spacing: match[3] || ' ', body: match[4]! });
  }
  const selected = range ? parsed.filter((line) => line.physicalLine >= range.startPhysicalLine && line.physicalLine <= range.endPhysicalLine) : parsed;
  if (!selected.length && !errors.length) errors.push(range ? `Physical lines ${range.startPhysicalLine} to ${range.endPhysicalLine} contain no numbered BASIC lines` : 'The BASIC source contains no numbered lines');
  const last = options.start + Math.max(0, selected.length - 1) * options.increment;
  if (last > MAX_LINE) errors.push(`Renumbering ${selected.length} lines from ${options.start} in steps of ${options.increment} would exceed 32,767`);
  if (range && selected.length) {
    const selectedNumbers = new Set(selected.map((line) => line.number));
    const unselectedNumbers = new Set(parsed.filter((line) => !selectedNumbers.has(line.number)).map((line) => line.number));
    const destinations = selected.map((_, index) => options.start + index * options.increment);
    const collision = destinations.find((number) => unselectedNumbers.has(number));
    if (collision !== undefined) errors.push(`Range destination line ${collision} collides with a line outside the selected range`);
    const preceding = parsed.filter((line) => line.physicalLine < range.startPhysicalLine).at(-1)?.number;
    const following = parsed.find((line) => line.physicalLine > range.endPhysicalLine)?.number;
    if (preceding !== undefined && destinations[0]! <= preceding) errors.push(`Range would begin at ${destinations[0]}, not after preceding line ${preceding}`);
    if (following !== undefined && destinations.at(-1)! >= following) errors.push(`Range would end at ${destinations.at(-1)}, not before following line ${following}`);
  }
  if (errors.length) return { content: source, mappings: [], updatedReferences: 0, unresolvedReferences: [], errors, changed: false };

  const mappings = selected.map((line, index) => ({ physicalLine: line.physicalLine, from: line.number, to: options.start + index * options.increment }));
  const numberMap = new Map(mappings.map((mapping) => [mapping.from, mapping.to]));
  const parsedByPhysicalLine = new Map(parsed.map((line) => [line.physicalLine, line]));
  const declaredNumbers = new Set(parsed.map((line) => line.number));
  const unresolvedReferences: BasicUnresolvedReference[] = [];
  let updatedReferences = 0;
  const nextLines = physicalLines.map((original, index) => {
    const line = parsedByPhysicalLine.get(index + 1);
    if (!line) return original;
    const rewritten = rewriteReferences(line.body, numberMap, (target, command) => unresolvedReferences.push({ physicalLine: line.physicalLine, sourceLine: line.number, target, command }), () => updatedReferences++, declaredNumbers);
    const number = numberMap.get(line.number) ?? line.number;
    return `${line.indent}${number}${line.spacing}${rewritten}`;
  });
  const content = nextLines.join(newline);
  return { content, mappings, updatedReferences, unresolvedReferences, errors, changed: content !== source };
}

export function nextBasicLineNumber(source: string, physicalLine: number, input: BasicRenumberOptions): { number?: number; strategy?: 'start' | 'increment' | 'gap'; reason?: string } {
  const options = validateBasicNumbering(input);
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const numbers = lines.map((line) => Number(line.match(/^\s*(\d{1,5})(?=\s|[A-Za-z*]|$)/)?.[1] ?? Number.NaN));
  let previous: number | undefined;
  for (let index = Math.min(lines.length - 1, Math.max(0, physicalLine - 1)); index >= 0; index--) if (Number.isFinite(numbers[index])) { previous = numbers[index]; break; }
  let following: number | undefined;
  for (let index = Math.max(0, physicalLine); index < lines.length; index++) if (Number.isFinite(numbers[index])) { following = numbers[index]; break; }
  const desired = previous === undefined ? options.start : previous + options.increment;
  if (desired <= MAX_LINE && (following === undefined || desired < following)) return { number: desired, strategy: previous === undefined ? 'start' : 'increment' };
  if (previous !== undefined && following !== undefined && following - previous > 1) return { number: previous + Math.floor((following - previous) / 2), strategy: 'gap' };
  return { reason: following === undefined ? 'The next line number would exceed 32,767' : `No free line number exists between ${previous ?? 'the start'} and ${following}; renumber the program first` };
}

export function basicLineReferences(body: string): BasicLineReference[] {
  const references: BasicLineReference[] = [];
  rewriteReferences(body, new Map(), (target, command, start, end) => references.push({ target, command, start, end }), () => undefined);
  return references;
}

function rewriteReferences(body: string, mapping: Map<number, number>, unresolved: (target: number, command: string, start: number, end: number) => void, updated: () => void, declaredTargets = new Set<number>()) {
  let output = ''; let position = 0;
  while (position < body.length) {
    if (body[position] === '"') {
      const end = quotedEnd(body, position); output += body.slice(position, end); position = end; continue;
    }
    if (keywordAt(body, position, 'REM')) { output += body.slice(position); break; }
    if (keywordAt(body, position, 'DATA')) {
      const end = statementEnd(body, position + 4); output += body.slice(position, end); position = end; continue;
    }
    const targetCommand = body.slice(position).match(TARGET_COMMAND);
    if (targetCommand && wordBoundaryBefore(body, position)) {
      const command = targetCommand[1]!.toUpperCase(); output += targetCommand[0]; position += targetCommand[0].length;
      const list = command === 'GOTO' || command === 'GOSUB';
      const result = rewriteTargetSequence(body, position, command, list, mapping, unresolved, updated, declaredTargets);
      output += result.text; position = result.position; continue;
    }
    output += body[position]; position++;
  }
  return output;
}

function rewriteTargetSequence(source: string, start: number, command: string, list: boolean, mapping: Map<number, number>, unresolved: (target: number, command: string, start: number, end: number) => void, updated: () => void, declaredTargets: Set<number>) {
  let position = start; let text = ''; let first = true;
  while (position < source.length) {
    const whitespace = source.slice(position).match(/^\s*/)?.[0] ?? ''; text += whitespace; position += whitespace.length;
    const match = source.slice(position).match(/^\d{1,5}/);
    if (!match) break;
    const targetStart = position;
    const target = Number(match[0]); const replacement = mapping.get(target);
    if (replacement === undefined) { if (!declaredTargets.has(target)) unresolved(target, command, targetStart, targetStart + match[0].length); text += match[0]; }
    else { text += String(replacement); if (replacement !== target) updated(); }
    position += match[0].length; first = false;
    if (!list) break;
    const separator = source.slice(position).match(/^(\s*,\s*)/);
    if (!separator) break;
    text += separator[0]; position += separator[0].length;
  }
  return { text, position, matched: !first };
}

function wordBoundaryBefore(source: string, position: number) { return position === 0 || !/[A-Za-z0-9_$%]/.test(source[position - 1]!); }
function keywordAt(source: string, position: number, keyword: string) { return wordBoundaryBefore(source, position) && source.slice(position, position + keyword.length).toUpperCase() === keyword && !/[A-Za-z0-9_$%]/.test(source[position + keyword.length] ?? ''); }
function quotedEnd(source: string, start: number) { const end = source.indexOf('"', start + 1); return end < 0 ? source.length : end + 1; }
function statementEnd(source: string, start: number) {
  let quoted = false;
  for (let position = start; position < source.length; position++) { if (source[position] === '"') quoted = !quoted; else if (!quoted && source[position] === ':') return position; }
  return source.length;
}
