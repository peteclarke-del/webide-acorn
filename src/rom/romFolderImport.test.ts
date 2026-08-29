import { describe, expect, it } from 'vitest';
import { planRomFolderImport } from './romFolderImport';
import type { RomRequirement } from './romProfiles';

const requirement = (id: string, emulatorPath: string, size = 16): RomRequirement => ({ id, label: id, emulatorPath, acceptedSizes: [size], purpose: 'extension', required: true });

describe('ROM folder import planning', () => {
  it('prefers the exact normalized relative path over a same-named nested ROM', () => {
    const files = [
      { name: 'BASIC.ROM', size: 16, webkitRelativePath: 'normalized/electron/BASIC.ROM' },
      { name: 'BASIC.ROM', size: 16, webkitRelativePath: 'normalized/BASIC.ROM' },
    ];
    const plan = planRomFolderImport([requirement('basic', 'BASIC.ROM')], files);
    expect(plan.matches[0]?.file.webkitRelativePath).toBe('normalized/BASIC.ROM');
    expect(plan.missing).toEqual([]);
  });

  it('matches nested paths case-insensitively and rejects wrong sizes', () => {
    const plan = planRomFolderImport([requirement('dfs', 'b/DFS-0.9.rom', 8192), requirement('os', 'os.rom', 16384)], [
      { name: 'DFS-0.9.rom', size: 8192, webkitRelativePath: 'normalized/B/dfs-0.9.ROM' },
      { name: 'os.rom', size: 8192, webkitRelativePath: 'normalized/os.rom' },
    ]);
    expect(plan.matches.map((item) => item.requirement.id)).toEqual(['dfs']);
    expect(plan.missing.map((item) => item.id)).toEqual(['os']);
  });

  it('reports equally suitable duplicates instead of selecting arbitrarily', () => {
    const files = [{ name: 'os.rom', size: 16 }, { name: 'OS.ROM', size: 16 }];
    const plan = planRomFolderImport([requirement('os', 'os.rom')], files);
    expect(plan.matches).toEqual([]);
    expect(plan.ambiguous[0]?.files).toHaveLength(2);
  });
});
