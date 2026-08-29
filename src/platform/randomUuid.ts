export function uuidV4FromBytes(input: Uint8Array): string {
  if (input.length !== 16) throw new Error('UUID input must contain exactly 16 bytes');
  const bytes = input.slice();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function installRandomUuidCompatibility(target: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => `${string}-${string}-${string}-${string}-${string}` } = globalThis.crypto): void {
  if (typeof target.randomUUID === 'function') return;
  Object.defineProperty(target, 'randomUUID', {
    configurable: true,
    value: () => uuidV4FromBytes(target.getRandomValues(new Uint8Array(16))) as `${string}-${string}-${string}-${string}-${string}`,
  });
}
