export const ARM_LOGICAL_PAGE_SIZE = 4096;
export const ARM_LOGICAL_PAGE_COUNT = 16384;
export type ArmPageKind = 'unmapped' | 'ram' | 'rom' | 'support-rom' | 'extension-rom' | 'other';
export interface ArmMappedPage { page: number; kind: ArmPageKind; physicalPage: number | null }
export interface ArmMappedRegion { logicalStart: number; logicalEnd: number; kind: ArmPageKind; physicalStart: number | null; pages: number }

export function compressArmMemoryMap(pages: ArmMappedPage[]): ArmMappedRegion[] {
  if (pages.length !== ARM_LOGICAL_PAGE_COUNT || pages.some((entry, index) => entry.page !== index || !['unmapped', 'ram', 'rom', 'support-rom', 'extension-rom', 'other'].includes(entry.kind) || (entry.physicalPage !== null && (!Number.isInteger(entry.physicalPage) || entry.physicalPage < 0)))) throw new Error('ARM memory map requires all 16,384 ordered logical pages');
  const regions: ArmMappedRegion[] = [];
  for (const page of pages) {
    const previous = regions.at(-1);
    const contiguousPhysical = previous !== undefined && (page.physicalPage === null ? previous.physicalStart === null : previous.physicalStart !== null && page.physicalPage === previous.physicalStart / ARM_LOGICAL_PAGE_SIZE + previous.pages);
    if (previous && previous.kind === page.kind && contiguousPhysical) { previous.pages++; previous.logicalEnd += ARM_LOGICAL_PAGE_SIZE; continue; }
    regions.push({ logicalStart: page.page * ARM_LOGICAL_PAGE_SIZE, logicalEnd: (page.page + 1) * ARM_LOGICAL_PAGE_SIZE - 1, kind: page.kind, physicalStart: page.physicalPage === null ? null : page.physicalPage * ARM_LOGICAL_PAGE_SIZE, pages: 1 });
  }
  return regions;
}
