export const MAX_TAPE_IMAGE_BYTES = 8 * 1024 * 1024;

export type TapeFormat = 'UEF' | 'tapefile';

const UEF_SIGNATURE = [0x55, 0x45, 0x46, 0x20, 0x46, 0x69, 0x6c, 0x65, 0x21, 0x00];

export function detectTapeFormat(bytes: Uint8Array): TapeFormat | null {
  if (bytes.length >= 12 && UEF_SIGNATURE.every((byte, index) => bytes[index] === byte)) return 'UEF';
  if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0x04) return 'tapefile';
  return null;
}

export function validateTapeImage(bytes: Uint8Array): TapeFormat {
  if (bytes.length === 0) throw new Error('Cassette images must not be empty');
  if (bytes.length > MAX_TAPE_IMAGE_BYTES) throw new Error('Cassette images are limited to 8 MiB');
  const format = detectTapeFormat(bytes);
  if (!format) throw new Error('The file is not a recognized UEF or tapefile cassette image');
  return format;
}
