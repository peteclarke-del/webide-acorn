import { decodePlainText, decodeTokenizedBasic, isProbablyText } from './bbcBasic';
import { disassemble6502 } from './disassembler6502';
import { disassembleArm } from './disassemblerArm';
import { decodePlainBasic, type PlainBasicDialect } from './plainBasic';
import type { AnalysisAnnotations } from './analysisAnnotations';
import type { AnalysisProgressReporter } from './analysisProgress';
import type { AcornFileMetadata, AnalysisProcessor, FileAnalysis } from './types';

export interface AnalysisOptions {
  origin: number;
  entryPoint: number;
  processor: AnalysisProcessor;
  basicDialect?: PlainBasicDialect;
  /* What the reader has recorded about this binary. Carried through the worker
   * boundary as a plain document, and validated there rather than trusted. */
  annotations?: AnalysisAnnotations;
}

export function inferAcornAddresses(name: string): Pick<AnalysisOptions, 'origin' | 'entryPoint'> | null {
  // Common host export form: NAME,1900-1900. A three-digit RISC OS filetype
  // suffix is deliberately not treated as an address.
  const match = name.match(/,([0-9a-f]{4})(?:-([0-9a-f]{4}))?$/i);
  if (!match) return null;
  return {
    origin: Number.parseInt(match[1]!, 16),
    entryPoint: Number.parseInt(match[2] ?? match[1]!, 16),
  };
}

function parseMetadataWord(value: string | undefined): number | undefined {
  if (!value || !/^(?:&|0x)?[0-9a-f]{1,8}$/i.test(value)) return undefined;
  return Number.parseInt(value.replace(/^(?:&|0x)/i, ''), 16) >>> 0;
}

export function parseInfSidecar(text: string, sidecarName = 'metadata.inf'): AcornFileMetadata | null {
  const fields = text.trim().match(/"[^"]*"|\S+/g) ?? [];
  if (fields.length < 3) return null;
  const load = parseMetadataWord(fields[1]);
  const execute = parseMetadataWord(fields[2]);
  if (load === undefined || execute === undefined) return null;
  const cataloguePath = fields[0]!.replace(/^"|"$/g, '');
  const declaredLength = parseMetadataWord(fields[3]);
  const accessFields = fields.slice(declaredLength === undefined ? 3 : 4);
  return {
    source: 'sidecar',
    catalogueName: cataloguePath.split('.').at(-1) || cataloguePath,
    load,
    execute,
    declaredLength,
    locked: accessFields.some((field) => /^(?:l|locked)$/i.test(field)),
    sidecarName,
    warnings: [],
  };
}

export function metadataForHostFile(name: string, sidecar?: { name: string; text: string }, container?: AcornFileMetadata): AcornFileMetadata {
  const filenameAddresses = inferAcornAddresses(name);
  const filenameMetadata: AcornFileMetadata = filenameAddresses ? {
    source: 'filename', load: filenameAddresses.origin, execute: filenameAddresses.entryPoint, warnings: [],
  } : { source: 'manual-default', warnings: [] };
  const embedded = container ? { ...container, warnings: [...container.warnings] } : filenameMetadata;
  if (container && filenameAddresses && (container.load !== filenameAddresses.origin || container.execute !== filenameAddresses.entryPoint)) embedded.warnings.push('Container and filename addresses disagree; embedded container metadata takes precedence.');
  if (!sidecar) return embedded;
  const parsed = parseInfSidecar(sidecar.text, sidecar.name);
  if (!parsed) return {
    ...embedded,
    warnings: [...embedded.warnings, `${sidecar.name} is malformed and was not used.`],
  };
  const lowerPrecedence = container ?? filenameMetadata;
  if (lowerPrecedence.load !== undefined && ((parsed.load! & 0xffff) !== (lowerPrecedence.load & 0xffff) || (parsed.execute! & 0xffff) !== ((lowerPrecedence.execute ?? lowerPrecedence.load) & 0xffff))) parsed.warnings.push(`Sidecar and ${container ? 'container' : 'filename'} addresses disagree; the explicitly selected .inf sidecar takes precedence.`);
  if (container) { parsed.containerFormat = container.containerFormat; parsed.containerByteLength = container.containerByteLength; }
  return parsed;
}

export function logical6502Address(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : value & 0xffff;
}

export function logicalAnalysisAddress(value: number | undefined, fallback: number, processor: AnalysisProcessor): number {
  if (processor === 'arm2' || processor === 'arm3') return (value ?? fallback) & 0x03ffffff;
  return logical6502Address(value, fallback);
}

function looksLikePlainBasic(name: string, text: string): boolean {
  const extensionSuggestsBasic = /\.(?:bas|basic)$/i.test(name);
  const meaningful = text.split('\n').filter((line) => line.trim());
  const numbered = meaningful.filter((line) => /^\s*\d{1,5}(?:\s|[A-Za-z*])/u.test(line)).length;
  return Boolean(meaningful.length && (extensionSuggestsBasic || numbered / meaningful.length >= 0.7));
}

export function analyseFile(bytes: Uint8Array, name: string, options: AnalysisOptions, onProgress?: AnalysisProgressReporter): FileAnalysis {
  const basic = decodeTokenizedBasic(bytes);
  if (basic) return basic;
  if (isProbablyText(bytes)) {
    const text = decodePlainText(bytes);
    if (looksLikePlainBasic(name, text)) {
      return decodePlainBasic(bytes, options.basicDialect ?? 'bbc-basic-ii');
    }
    return { kind: 'text', text, lineCount: text.split('\n').length };
  }
  /* Only the disassemblers report. A text or BASIC decode is a single pass
   * that finishes before a progress bar could be drawn, and reporting on it
   * would be reporting on nothing. */
  return options.processor === 'arm2' || options.processor === 'arm3'
    ? disassembleArm(bytes, options.origin, options.entryPoint, options.processor, onProgress)
    : disassemble6502(bytes, options.origin, options.entryPoint, options.processor, options.annotations, onProgress);
}

export function parseHexAddress(value: string, maximumDigits = 4): number | null {
  const normalised = value.trim().replace(/^&/, '').replace(/^0x/i, '');
  if (!new RegExp(`^[0-9a-f]{1,${maximumDigits}}$`, 'i').test(normalised)) return null;
  return Number.parseInt(normalised, 16);
}
