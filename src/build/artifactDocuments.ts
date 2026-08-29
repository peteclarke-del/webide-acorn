import type { RetainedArtifactDocument, SourceLocation } from './assembler6502';
import { cFunctionFrames, hasTypeInformation, parseCc65DebugInfo } from './cc65DebugInfo';
import { isMachineCodeArtifact, type MachineCodeArtifact } from './artifactTypes';
import type { BuildArtifact, BuildResultMetadata } from './buildService';

export interface GeneratedArtifactDocument {
  id: string;
  label: string;
  filename: string;
  content: string;
}

export interface ArtifactListingRow { address?: number; text: string; source?: SourceLocation }
export interface ArtifactSymbolReference extends SourceLocation { column: number; definition: boolean }

export function artifactListingRows(artifact: BuildArtifact): ArtifactListingRow[] {
  if (!isMachineCodeArtifact(artifact)) return artifact.listing.map((text) => ({ text }));
  return artifact.listing.map((text) => {
    const match = /(?:^|\]\s*)&([0-9A-F]{4,8})\b/i.exec(text);
    const address = match ? Number.parseInt(match[1]!, 16) : undefined;
    return { text, ...(address === undefined ? {} : { address, source: artifact.sourceLocations[address] }) };
  });
}

export function artifactSymbolReferences(artifact: MachineCodeArtifact, symbol: string): ArtifactSymbolReference[] {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = new RegExp(`(^|[^A-Za-z0-9_])\\.?(${escaped})(?![A-Za-z0-9_])`, 'ig');
  const references: ArtifactSymbolReference[] = [];
  Object.entries(artifact.sourceFiles).forEach(([fileId, file]) => file.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').forEach((source, index) => {
    const code = stripAssemblyComment(source);
    token.lastIndex = 0; let match: RegExpExecArray | null;
    while ((match = token.exec(code))) {
      const column = match.index + match[1]!.length + (code[match.index + match[1]!.length] === '.' ? 2 : 1);
      const before = code.slice(0, match.index + match[1]!.length);
      const definition = /^\s*$/.test(before) && (code.trimStart().startsWith('.') || new RegExp(`^\\s*${escaped}:`, 'i').test(code));
      references.push({ fileId, fileName: file.name, line: index + 1, column, definition });
      if (match[0].length === 0) token.lastIndex += 1;
    }
  }));
  return references;
}

export function generatedArtifactDocuments(artifact: BuildArtifact, metadata?: BuildResultMetadata): GeneratedArtifactDocument[] {
  const outputName = artifact.provenance?.target.outputName ?? 'artifact';
  const listing = artifact.listing.join('\n');
  const provenance = artifact.provenance ? JSON.stringify(artifact.provenance, null, 2) : 'No provenance record was produced.';
  const result = metadata ? [{ id: 'build-result', label: 'Normalized build result', filename: `${outputName}.result.json`, content: JSON.stringify(metadata, null, 2) }] : [];
  if (!isMachineCodeArtifact(artifact)) return [
    { id: 'listing', label: 'Interpreter listing', filename: `${outputName}.listing.txt`, content: listing },
    { id: 'provenance', label: 'Build provenance', filename: `${outputName}.provenance.json`, content: provenance },
    ...result,
  ];
  const width = artifact.kind === 'arm-binary' ? 8 : 4;
  const symbols = Object.entries(artifact.symbols).sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0])).map(([name, address]) => `${name.padEnd(24)} &${address.toString(16).toUpperCase().padStart(width, '0')}`).join('\n');
  const sourceMap = Object.entries(artifact.sourceLocations).sort(([left], [right]) => Number(left) - Number(right)).map(([address, location]) => `&${Number(address).toString(16).toUpperCase().padStart(width, '0')}  ${location.fileName}:${location.line}`).join('\n');
  const end = artifact.bytes.length ? artifact.origin + artifact.bytes.length - 1 : artifact.origin;
  const memoryMap = [`Processor: ${artifact.processor.toUpperCase()}`, `Format:    ${artifact.kind === 'arm-binary' ? 'raw little-endian ARM · not a RISC OS application' : 'raw 6502 binary'}`, `Origin:    &${artifact.origin.toString(16).toUpperCase().padStart(width, '0')}`, `End:       &${end.toString(16).toUpperCase().padStart(width, '0')}`, `Entry:     &${artifact.entryPoint.toString(16).toUpperCase().padStart(width, '0')}`, `Size:      ${artifact.bytes.length} bytes`, `Mapped:    ${Object.keys(artifact.sourceLocations).length} byte addresses`, `Inputs:    ${Object.keys(artifact.sourceFiles).length}`, `Symbols:   ${Object.keys(artifact.symbols).length}`].join('\n');
  const native = artifact.retainedDocuments ?? [];
  const debugInfo = native.find((document) => document.id === 'debug-info');
  return [
    { id: 'listing', label: 'Assembler listing', filename: `${outputName}.listing.txt`, content: listing },
    { id: 'symbols', label: 'Symbol table', filename: `${outputName}.symbols.txt`, content: symbols },
    { id: 'source-map', label: 'Source/address map', filename: `${outputName}.source-map.txt`, content: sourceMap },
    { id: 'memory-map', label: 'Memory and size report', filename: `${outputName}.memory-map.txt`, content: memoryMap },
    { id: 'provenance', label: 'Build provenance', filename: `${outputName}.provenance.json`, content: provenance },
    ...(debugInfo ? [{ id: 'compiler-records', label: 'Compiler records', filename: `${outputName}.compiler-records.txt`, content: compilerRecords(debugInfo) }] : []),
    ...native.map(({ id, label, filename, content }) => ({ id: `native-${id}`, label, filename, content })),
    ...result,
  ];
}

function stripAssemblyComment(source: string) {
  let single = false; let double = false; let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"' && !single) { double = !double; result += ' '; }
    else if (character === "'" && !double) { single = !single; result += ' '; }
    else if (character === ';' && !single && !double) return result;
    else result += single || double ? ' ' : character;
  }
  return result;
}

/*
 * What the linker recorded about a C build, in a form somebody can read.
 *
 * The raw debug file is retained beside this one and is the authority; this is
 * the part of it that answers questions people actually ask — where a local
 * lives, and which addresses a line of C produced.
 *
 * A file that cannot be read produces this document saying so rather than no
 * document at all. Silently omitting it would read as "this build had no
 * compiler records", which is a different and untrue statement.
 */
function compilerRecords(document: RetainedArtifactDocument): string {
  let info;
  try {
    info = parseCc65DebugInfo(document.content);
  } catch (error) {
    return [
      `The linker debug file ${document.filename} could not be read, so nothing below it is reported.`,
      '',
      error instanceof Error ? error.message : String(error),
    ].join('\n');
  }

  const lines: string[] = [
    `From ${document.filename} · debug format ${info.version.major}.${info.version.minor} · ${document.bytes.toLocaleString()} bytes · SHA-256 ${document.sha256}`,
    '',
    'TYPE INFORMATION',
    hasTypeInformation(info)
      ? `${info.types.length} type records are present.`
      : 'None. This toolchain writes one empty type record and points every C symbol at it, so no type or layout below is derived from the compiler — only storage classes and frame offsets, which are exact.',
    '',
    'C FUNCTION FRAMES',
  ];
  const frames = cFunctionFrames(info);
  if (!frames.length) lines.push('None recorded.');
  for (const frame of frames) {
    lines.push(`${frame.function}${frame.address === null ? '' : ` at &${frame.address.toString(16).toUpperCase().padStart(4, '0')}`} · ${frame.size} bytes`);
    for (const entry of frame.entries) {
      const where = entry.offset !== null ? `frame offset ${entry.offset}`
        : entry.address !== null ? `&${entry.address.toString(16).toUpperCase().padStart(4, '0')}`
        : 'no location recorded';
      lines.push(`  ${entry.name.padEnd(20)} ${entry.storage.padEnd(8)} ${where}`);
    }
  }

  /* Where each address came from is not repeated here: the build backend reads
   * this same file for that and the artifact's own source map carries the
   * result, so it is answered once. */
  lines.push('', 'SEGMENTS AS LINKED');
  for (const segment of info.segments) {
    lines.push(`${segment.name.padEnd(12)} &${segment.start.toString(16).toUpperCase().padStart(4, '0')} · ${segment.size} bytes · ${segment.addrsize} · ${segment.outputName ? `written to ${segment.outputName} at offset ${segment.outputOffset}` : 'not written to any output file'}`);
  }
  return lines.join('\n');
}
