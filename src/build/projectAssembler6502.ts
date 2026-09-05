import { assemble6502, type AssemblyArtifact, type BuildDiagnostic, type SourceLocation } from './assembler6502';
import type { Processor } from '../analysis/types';
import { generatePixelAssetOutput, parsePixelAssetDocument } from '../assets/pixelAssetDocument';
import { generateTileMapOutput, parseTileMapDocument } from '../assets/tileMapDocument';
import { generatePaletteOutput, parsePaletteDocument } from '../assets/paletteDocument';
import { generateFontOutput, parseFontDocument } from '../assets/fontDocument';
import { generateScreenOutput, parseScreenDocument } from '../assets/screenDocument';
import { generateSongOutput, parseSongDocument } from '../assets/songDocument';
import { resolveIncluded } from '../project/includeResolution';

export interface AssemblySourceFile { id: string; name: string; content: string }
export interface ProjectAssemblyOptions {
  defaultOrigin?: number;
  maximumAddress?: number;
  defines?: Record<string, number>;
  sourceFileIds?: string[];
  /* Which machine's operating-system vocabulary the source is written against.
   * The Atom's entry points are not the BBC's, and assembling against the wrong
   * table produces a program that builds and calls the wrong addresses. */
  machineId?: string;
}

const MAX_EXPANDED_CHARACTERS = 2 * 1024 * 1024;
const MAX_EXPANDED_LINES = 100_000;
const MAX_INCLUDE_DEPTH = 32;

export function assembleProject6502(entryFileId: string, files: AssemblySourceFile[], processor: Processor = '6502', options: ProjectAssemblyOptions = {}): AssemblyArtifact {
  const byId = new Map(files.map((file) => [file.id, file]));
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const entry = byId.get(entryFileId);
  if (!entry) throw new Error('Assembly entry file is not present in the project');
  const lines: string[] = [];
  const locations: SourceLocation[] = [];
  const dependencies: string[] = [];
  const dependencySet = new Set<string>();
  const diagnostics: BuildDiagnostic[] = [];
  let characters = 0;
  let expansionStopped = false;

  const pushLine = (source: string, location: SourceLocation) => {
    if (expansionStopped) return false;
    if (lines.length >= MAX_EXPANDED_LINES || characters + source.length + 1 > MAX_EXPANDED_CHARACTERS) {
      diagnostics.push(sourceDiagnostic(byId.get(location.fileId) ?? entry, location.line, 'Expanded assembly source exceeds the 100,000-line or 2 MiB build limit'));
      expansionStopped = true; return false;
    }
    lines.push(source); locations.push(location); characters += source.length + 1; return true;
  };

  /* An asset's labels may only be emitted once per build, however many maps and
   * INCLUDEASSET directives ask for it. */
  const emittedAssets = new Set<string>();

  const emitAsset = (target: AssemblySourceFile, requestedBy: AssemblySourceFile, line: number): boolean => {
    if (!dependencySet.has(target.id) && target.id !== entry.id) { dependencySet.add(target.id); dependencies.push(target.name); }
    if (emittedAssets.has(target.name.toLowerCase())) return true;
    emittedAssets.add(target.name.toLowerCase());
    try {
      const generated = generatePixelAssetOutput(parsePixelAssetDocument(target.content));
      for (const generatedLine of generated.assembly.split('\n')) if (!pushLine(generatedLine, { fileId: target.id, fileName: target.name, line: 1 })) return false;
      return true;
    } catch (error) {
      diagnostics.push(sourceDiagnostic(requestedBy, line, `Asset generation failed for ${target.name}: ${error instanceof Error ? error.message : String(error)}`));
      return true;
    }
  };

  const expand = (file: AssemblySourceFile, stack: string[]) => {
    if (expansionStopped) return;
    if (stack.length >= MAX_INCLUDE_DEPTH) { diagnostics.push(sourceDiagnostic(file, 1, `INCLUDE nesting exceeds ${MAX_INCLUDE_DEPTH} files`)); return; }
    const nextStack = [...stack, file.id];
    const sourceLines = file.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    for (let index = 0; index < sourceLines.length; index++) {
      const source = sourceLines[index]!;
      const assetInclude = /^\s*INCLUDEASSET\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(source);
      const mapInclude = /^\s*INCLUDEMAP\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(source);
      const paletteInclude = /^\s*INCLUDEPALETTE\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(source);
      const fontInclude = /^\s*INCLUDEFONT\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(source);
      const screenInclude = /^\s*INCLUDESCREEN\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(source);
      const songInclude = /^\s*INCLUDESONG\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(source);
      const include = /^\s*INCLUDE\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(source);
      if (songInclude) {
        const requested = (songInclude[1] ?? songInclude[2] ?? songInclude[3])!.trim();
        const target = resolveIncluded(byName, requested, file.name);
        if (!pushLine(`; ${source.trim()}`, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
        if (!target) { diagnostics.push(sourceDiagnostic(file, index + 1, `Included song not found: ${requested}`)); continue; }
        if (!dependencySet.has(target.id) && target.id !== entry.id) { dependencySet.add(target.id); dependencies.push(target.name); }
        try {
          const generated = generateSongOutput(parseSongDocument(target.content));
          for (const generatedLine of generated.assembly.split('\n')) if (!pushLine(generatedLine, { fileId: target.id, fileName: target.name, line: 1 })) return;
        } catch (error) { diagnostics.push(sourceDiagnostic(target, 1, `Song generation failed: ${error instanceof Error ? error.message : String(error)}`)); }
      } else if (screenInclude) {
        const requested = (screenInclude[1] ?? screenInclude[2] ?? screenInclude[3])!.trim();
        const target = resolveIncluded(byName, requested, file.name);
        if (!pushLine(`; ${source.trim()}`, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
        if (!target) { diagnostics.push(sourceDiagnostic(file, index + 1, `Included screen not found: ${requested}`)); continue; }
        if (!dependencySet.has(target.id) && target.id !== entry.id) { dependencySet.add(target.id); dependencies.push(target.name); }
        try {
          const generated = generateScreenOutput(parseScreenDocument(target.content));
          for (const generatedLine of generated.assembly.split('\n')) if (!pushLine(generatedLine, { fileId: target.id, fileName: target.name, line: 1 })) return;
        } catch (error) { diagnostics.push(sourceDiagnostic(target, 1, `Screen generation failed: ${error instanceof Error ? error.message : String(error)}`)); }
      } else if (fontInclude) {
        const requested = (fontInclude[1] ?? fontInclude[2] ?? fontInclude[3])!.trim();
        const target = resolveIncluded(byName, requested, file.name);
        if (!pushLine(`; ${source.trim()}`, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
        if (!target) { diagnostics.push(sourceDiagnostic(file, index + 1, `Included font not found: ${requested}`)); continue; }
        if (!dependencySet.has(target.id) && target.id !== entry.id) { dependencySet.add(target.id); dependencies.push(target.name); }
        try {
          const generated = generateFontOutput(parseFontDocument(target.content));
          for (const generatedLine of generated.assembly.split('\n')) if (!pushLine(generatedLine, { fileId: target.id, fileName: target.name, line: 1 })) return;
        } catch (error) { diagnostics.push(sourceDiagnostic(target, 1, `Font generation failed: ${error instanceof Error ? error.message : String(error)}`)); }
      } else if (paletteInclude) {
        const requested = (paletteInclude[1] ?? paletteInclude[2] ?? paletteInclude[3])!.trim();
        const target = resolveIncluded(byName, requested, file.name);
        if (!pushLine(`; ${source.trim()}`, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
        if (!target) { diagnostics.push(sourceDiagnostic(file, index + 1, `Included palette not found: ${requested}`)); continue; }
        if (!dependencySet.has(target.id) && target.id !== entry.id) { dependencySet.add(target.id); dependencies.push(target.name); }
        try {
          const generated = generatePaletteOutput(parsePaletteDocument(target.content));
          for (const generatedLine of generated.assembly.split('\n')) if (!pushLine(generatedLine, { fileId: target.id, fileName: target.name, line: 1 })) return;
        } catch (error) { diagnostics.push(sourceDiagnostic(target, 1, `Palette generation failed: ${error instanceof Error ? error.message : String(error)}`)); }
      } else if (mapInclude) {
        const requested = (mapInclude[1] ?? mapInclude[2] ?? mapInclude[3])!.trim();
        const target = resolveIncluded(byName, requested, file.name);
        if (!pushLine(`; ${source.trim()}`, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
        if (!target) { diagnostics.push(sourceDiagnostic(file, index + 1, `Included map not found: ${requested}`)); continue; }
        if (!dependencySet.has(target.id) && target.id !== entry.id) { dependencySet.add(target.id); dependencies.push(target.name); }
        let generated;
        try { generated = generateTileMapOutput(parseTileMapDocument(target.content)); }
        catch (error) { diagnostics.push(sourceDiagnostic(target, 1, `Map generation failed: ${error instanceof Error ? error.message : String(error)}`)); continue; }
        /* The map's pointer table names each tile's asset labels, so any tileset
         * entry the build has not already emitted is emitted here. A missing
         * asset file is reported instead of leaving the table unresolved. */
        for (const index of generated.manifest.unassignedIndices) {
          diagnostics.push(sourceDiagnostic(target, 1, `Map ${target.name} declares tile index ${index} with no artwork chosen, so its pointer stays zero`));
        }
        for (const assetFile of generated.requiredAssets) {
          const asset = resolveIncluded(byName, assetFile, target.name);
          if (!asset) { diagnostics.push(sourceDiagnostic(target, 1, `Map ${target.name} needs tileset asset ${assetFile}, which is not in this project`)); continue; }
          if (!emitAsset(asset, target, 1)) return;
        }
        for (const generatedLine of generated.assembly.split('\n')) if (!pushLine(generatedLine, { fileId: target.id, fileName: target.name, line: 1 })) return;
      } else if (assetInclude) {
        const requested = (assetInclude[1] ?? assetInclude[2] ?? assetInclude[3])!.trim(); const target = resolveIncluded(byName, requested, file.name);
        if (!pushLine(`; ${source.trim()}`, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
        if (!target) { diagnostics.push(sourceDiagnostic(file, index + 1, `Included asset not found: ${requested}`)); continue; }
        if (!emitAsset(target, file, index + 1)) return;
      } else if (!include) {
        if (!pushLine(source, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
      } else {
        const requested = (include[1] ?? include[2] ?? include[3])!.trim();
        const target = resolveIncluded(byName, requested, file.name);
        if (!pushLine(`; ${source.trim()}`, { fileId: file.id, fileName: file.name, line: index + 1 })) return;
        if (!target) { diagnostics.push(sourceDiagnostic(file, index + 1, `Included file not found: ${requested}`)); continue; }
        if (nextStack.includes(target.id)) {
          const chain = [...nextStack.slice(nextStack.indexOf(target.id)), target.id].map((id) => byId.get(id)?.name ?? id).join(' → ');
          diagnostics.push(sourceDiagnostic(file, index + 1, `Cyclic INCLUDE dependency: ${chain}`));
          continue;
        }
        if (!dependencySet.has(target.id) && target.id !== entry.id) { dependencySet.add(target.id); dependencies.push(target.name); }
        expand(target, nextStack);
      }
    }
  };
  expand(entry, []);
  for (const sourceFileId of options.sourceFileIds ?? []) {
    const sourceUnit = byId.get(sourceFileId);
    if (!sourceUnit || sourceUnit.id === entry.id || dependencySet.has(sourceUnit.id)) continue;
    dependencySet.add(sourceUnit.id); dependencies.push(sourceUnit.name);
    if (!pushLine(`; source unit ${sourceUnit.name}`, { fileId: sourceUnit.id, fileName: sourceUnit.name, line: 1 })) break;
    expand(sourceUnit, []);
  }
  const artifact = assemble6502(lines.join('\n'), processor, options.defaultOrigin ?? 0x1900, options.defines, options.machineId);
  const mappedDiagnostics = artifact.diagnostics.map((item) => {
    const location = locations[item.line - 1];
    return location ? { ...item, line: location.line, fileId: location.fileId, fileName: location.fileName } : item;
  });
  const sourceLocations: Record<number, SourceLocation> = {};
  const sourceMap: Record<number, number> = {};
  Object.entries(artifact.sourceMap).forEach(([address, expandedLine]) => {
    const location = locations[expandedLine - 1];
    if (!location) return;
    sourceLocations[Number(address)] = location;
    sourceMap[Number(address)] = location.line;
  });
  const listing = artifact.listing.map((row) => {
    const address = Number.parseInt(row.slice(1, 5), 16);
    const location = sourceLocations[address];
    return location ? `[${location.fileName}:${location.line}] ${row}` : row;
  });
  const usedFileIds = new Set([entry.id, ...dependencySet]);
  const sourceFiles = Object.fromEntries(files.filter((file) => usedFileIds.has(file.id)).map((file) => [file.id, { name: file.name, content: file.content }]));
  const maximumAddress = options.maximumAddress ?? 0xffff;
  const memoryDiagnostics = artifact.bytes.length && artifact.origin + artifact.bytes.length - 1 > maximumAddress
    ? [sourceDiagnostic(entry, 1, `Output ends at &${(artifact.origin + artifact.bytes.length - 1).toString(16).toUpperCase().padStart(4, '0')}, beyond target maximum &${maximumAddress.toString(16).toUpperCase().padStart(4, '0')}`)]
    : [];
  return { ...artifact, sourceMap, sourceLocations, entryFileId: entry.id, dependencies, sourceFiles, diagnostics: [...diagnostics, ...mappedDiagnostics, ...memoryDiagnostics], listing };
}

function sourceDiagnostic(file: AssemblySourceFile, line: number, message: string): BuildDiagnostic {
  return { line, column: 1, severity: 'error', message, fileId: file.id, fileName: file.name };
}
