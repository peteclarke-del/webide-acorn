export interface TestAllRow { status?: string; name?: string; message?: string }
export function unrunnablePlanRefusal(rows: readonly TestAllRow[]): string | null;
