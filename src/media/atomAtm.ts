const HEADER_SIZE = 22;
const NAME_FIELD_SIZE = 16;
const MAX_NAME_LENGTH = 12;

export interface AtomAtmFile {
  name: string;
  loadAddress: number;
  executionAddress: number;
  bytes: Uint8Array;
}

function address(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`${field} must be a 16-bit Atom address`);
  return value;
}

function name(value: string): string {
  const normalized = value.trim();
  if (!normalized.length || normalized.length > MAX_NAME_LENGTH || !/^[\x20-\x7e]+$/.test(normalized) || /[\\/]/.test(normalized)) throw new Error('ATM name must contain 1–12 printable characters without path separators');
  return normalized;
}

export function parseAtomAtm(image: Uint8Array): AtomAtmFile {
  if (image.length < HEADER_SIZE) throw new Error('An Atom ATM container must contain its 22-byte header');
  const zero = image.subarray(0, NAME_FIELD_SIZE).indexOf(0);
  const nameLength = zero < 0 ? NAME_FIELD_SIZE : zero;
  const decodedName = String.fromCharCode(...image.subarray(0, nameLength));
  const parsedName = name(decodedName);
  if (parsedName.length > MAX_NAME_LENGTH) throw new Error('ATM header name exceeds the 12-character AtoMMC limit');
  if (zero >= 0 && image.subarray(zero, NAME_FIELD_SIZE).some((byte) => byte !== 0)) throw new Error('ATM header name padding must be zero-filled');
  const loadAddress = image[16]! | (image[17]! << 8);
  const executionAddress = image[18]! | (image[19]! << 8);
  const length = image[20]! | (image[21]! << 8);
  if (!length) throw new Error('ATM payload must contain at least one byte');
  if (image.length !== HEADER_SIZE + length) throw new Error(`ATM header declares ${length} payload bytes but the container contains ${image.length - HEADER_SIZE}`);
  return { name: parsedName, loadAddress, executionAddress, bytes: image.slice(HEADER_SIZE) };
}

/** Writes the documented AtoMMC/Atomulator 22-byte ATM header and independently
 * reparses the result before it is returned. */
export function createAtomAtm(file: AtomAtmFile): Uint8Array {
  const parsedName = name(file.name); const loadAddress = address(file.loadAddress, 'Load address'); const executionAddress = address(file.executionAddress, 'Execution address');
  if (!file.bytes?.length || file.bytes.length > 0xffff) throw new Error('ATM payload must contain 1–65,535 bytes');
  const image = new Uint8Array(HEADER_SIZE + file.bytes.length);
  image.set(new TextEncoder().encode(parsedName), 0);
  image[16] = loadAddress & 0xff; image[17] = loadAddress >>> 8;
  image[18] = executionAddress & 0xff; image[19] = executionAddress >>> 8;
  image[20] = file.bytes.length & 0xff; image[21] = file.bytes.length >>> 8;
  image.set(file.bytes, HEADER_SIZE);
  const reparsed = parseAtomAtm(image);
  if (reparsed.name !== parsedName || reparsed.loadAddress !== loadAddress || reparsed.executionAddress !== executionAddress || !reparsed.bytes.every((byte, index) => byte === file.bytes[index])) throw new Error('Generated ATM container failed independent header and payload validation');
  return image;
}
