export interface CopyleftComponent { id: string; what: string; licence: string; source: string }
export const COPYLEFT_COMPONENTS: readonly CopyleftComponent[];
export function licenceComplianceFindings(dockerfile: string, shippedCopyleftIds: readonly string[]): string[];
