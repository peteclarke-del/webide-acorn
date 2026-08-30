import { describe, expect, it } from 'vitest';
import { ARM_LOGICAL_PAGE_COUNT, compressArmMemoryMap, type ArmMappedPage } from './armMemoryMapModel';

function mapWith(overrides: Partial<Record<number, Omit<ArmMappedPage, 'page'>>> = {}): ArmMappedPage[] {
  return Array.from({ length: ARM_LOGICAL_PAGE_COUNT }, (_, page) => ({ page, kind: 'unmapped' as const, physicalPage: null, ...overrides[page] }));
}

describe('ARM MEMC mapping model', () => {
  it('compresses adjacent logical and physical RAM pages but separates aliases', () => {
    const regions = compressArmMemoryMap(mapWith({ 8: { kind: 'ram', physicalPage: 8 }, 9: { kind: 'ram', physicalPage: 9 }, 10: { kind: 'ram', physicalPage: 2 } }));
    expect(regions.slice(1, 3)).toEqual([
      { logicalStart: 0x8000, logicalEnd: 0x9fff, kind: 'ram', physicalStart: 0x8000, pages: 2 },
      { logicalStart: 0xa000, logicalEnd: 0xafff, kind: 'ram', physicalStart: 0x2000, pages: 1 },
    ]);
  });
  it('keeps mapped kinds and unmapped spans distinct', () => {
    const regions = compressArmMemoryMap(mapWith({ 0x3800: { kind: 'rom', physicalPage: 0 }, 0x3801: { kind: 'rom', physicalPage: 1 } }));
    expect(regions.at(-2)).toMatchObject({ kind: 'rom', pages: 2, physicalStart: 0 });
  });
  it('rejects incomplete page inventories', () => expect(() => compressArmMemoryMap([])).toThrow(/16,384/));
});
