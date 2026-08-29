import { validateBasicNumbering } from '../language/basicRenumber';

export type BasicNumberingDialect = 'bbc' | 'atom';
export interface BasicNumberingPreferences { enabled: boolean; start: number; increment: number }

const DEFAULTS: BasicNumberingPreferences = { enabled: true, start: 10, increment: 10 };
const PREFIX = '8bit-net-dev:basic-numbering:1:';

export function readBasicNumberingPreferences(dialect: BasicNumberingDialect, storage: Pick<Storage, 'getItem'> = localStorage): BasicNumberingPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(`${PREFIX}${dialect}`) ?? 'null') as Partial<BasicNumberingPreferences> | null;
    if (!parsed || typeof parsed.enabled !== 'boolean') return { ...DEFAULTS };
    const validated = validateBasicNumbering({ start: Number(parsed.start), increment: Number(parsed.increment) });
    return { enabled: parsed.enabled, ...validated };
  } catch { return { ...DEFAULTS }; }
}

export function writeBasicNumberingPreferences(dialect: BasicNumberingDialect, preferences: BasicNumberingPreferences, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    const validated = validateBasicNumbering(preferences);
    storage.setItem(`${PREFIX}${dialect}`, JSON.stringify({ enabled: preferences.enabled, ...validated }));
    return true;
  } catch { return false; }
}
