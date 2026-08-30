export type Editable6502Register = 'a' | 'x' | 'y' | 's' | 'p' | 'pc';
export type RegisterPatch = Partial<Record<Editable6502Register, number>>;

const registers = new Set<Editable6502Register>(['a', 'x', 'y', 's', 'p', 'pc']);

export function validateRegisterPatch(input: Record<string, unknown>): RegisterPatch {
  const entries = Object.entries(input);
  if (!entries.length) throw new Error('Register edit must contain at least one value');
  const patch: RegisterPatch = {};
  for (const [name, value] of entries) {
    if (!registers.has(name as Editable6502Register)) throw new Error(`Unsupported 6502 register ${name}`);
    const maximum = name === 'pc' ? 0xffff : 0xff;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > maximum) throw new Error(`${name.toUpperCase()} must be ${name === 'pc' ? 'a 16-bit' : 'an 8-bit'} value`);
    patch[name as Editable6502Register] = value as number;
  }
  return patch;
}
