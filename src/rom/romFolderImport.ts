import type { RomRequirement } from './romProfiles';

export interface RomFolderFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
}

export interface RomFolderMatch<T extends RomFolderFile = RomFolderFile> {
  requirement: RomRequirement;
  file: T;
}

export interface RomFolderImportPlan<T extends RomFolderFile = RomFolderFile> {
  matches: RomFolderMatch<T>[];
  missing: RomRequirement[];
  ambiguous: Array<{ requirement: RomRequirement; files: T[] }>;
}

export function planRomFolderImport<T extends RomFolderFile>(requirements: RomRequirement[], files: T[]): RomFolderImportPlan<T> {
  const matches: RomFolderMatch<T>[] = [];
  const missing: RomRequirement[] = [];
  const ambiguous: Array<{ requirement: RomRequirement; files: T[] }> = [];
  for (const requirement of requirements) {
    const expected = normalize(requirement.emulatorPath);
    const candidates = files.map((file) => ({ file, score: pathScore(file, expected) }))
      .filter((candidate) => candidate.score >= 0 && requirement.acceptedSizes.includes(candidate.file.size))
      .sort((left, right) => left.score - right.score || pathFor(left.file).localeCompare(pathFor(right.file)));
    if (!candidates.length) { missing.push(requirement); continue; }
    const best = candidates.filter((candidate) => candidate.score === candidates[0]!.score);
    if (best.length > 1) { ambiguous.push({ requirement, files: best.map((candidate) => candidate.file) }); continue; }
    matches.push({ requirement, file: best[0]!.file });
  }
  return { matches, missing, ambiguous };
}

function pathScore(file: RomFolderFile, expected: string): number {
  const path = pathFor(file);
  if (path === expected) return 0;
  const withoutRoot = path.includes('/') ? path.slice(path.indexOf('/') + 1) : path;
  if (withoutRoot === expected) return 1;
  if (path.endsWith(`/${expected}`)) return 2;
  if (!expected.includes('/') && normalize(file.name) === expected) return 3;
  return -1;
}

function pathFor(file: RomFolderFile): string { return normalize(file.webkitRelativePath || file.name); }
function normalize(path: string): string { return path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase(); }
