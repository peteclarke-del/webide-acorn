// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  MAX_ARCHIVE_FILE_BYTES,
  crc32,
  readZipArchive,
  unsafeArchiveName,
} from './archiveImport';

/* The archives are built here, byte by byte, rather than fixtures checked in.
 * Every hostile case this reader exists to refuse — a traversing name, a
 * symbolic link, an encrypted entry, a header that lies about its own size —
 * is a property of the bytes, so the bytes are what the tests state. Real
 * deflate streams come from the platform's CompressionStream, which is the
 * same implementation the reader's DecompressionStream unpacks. */

interface Member {
  name: string;
  content?: string | Uint8Array;
  /** Written instead of the real deflate stream, to build a lying entry. */
  rawCompressed?: Uint8Array;
  method?: number;
  flags?: number;
  crc?: number;
  declaredUncompressed?: number;
  externalAttributes?: number;
  madeBy?: number;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function bytesOf(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

async function zip(members: Member[], options: { comment?: string; zip64?: boolean } = {}): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const member of members) {
    const raw = bytesOf(member.content ?? '');
    const method = member.method ?? 8;
    const data = member.rawCompressed ?? (method === 8 ? await deflate(raw) : raw);
    const name = encoder.encode(member.name);
    const crc = member.crc ?? crc32(raw);
    const declared = member.declaredUncompressed ?? raw.length;

    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, member.flags ?? 0, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, declared, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, ((member.madeBy ?? 3) << 8) | 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, member.flags ?? 0, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, declared, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, member.externalAttributes ?? 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const directorySize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const comment = encoder.encode(options.comment ?? '');
  const locator = options.zip64 ? 20 : 0;
  const end = new Uint8Array(locator + 22 + comment.length);
  const endView = new DataView(end.buffer);
  if (options.zip64) endView.setUint32(0, 0x07064b50, true);
  endView.setUint32(locator + 0, 0x06054b50, true);
  endView.setUint16(locator + 8, centrals.length, true);
  endView.setUint16(locator + 10, centrals.length, true);
  endView.setUint32(locator + 12, directorySize, true);
  endView.setUint32(locator + 16, offset, true);
  endView.setUint16(locator + 20, comment.length, true);
  end.set(comment, locator + 22);

  const parts = [...locals, ...centrals, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { archive.set(part, at); at += part.length; }
  return archive.buffer;
}

/** A symbolic link: Unix mode 0120777 in the high sixteen bits. */
const SYMLINK_ATTRIBUTES = 0xa1ff0000;

describe('reading a zip archive of source', () => {
  it('reads every text file, keeping its path, whether stored or deflated', async () => {
    const result = await readZipArchive(await zip([
      { name: 'game/main.asm', content: 'ORG &1900\n.start\nRTS\n' },
      { name: 'game/src/helper.asm', content: 'RTS\n', method: 0 },
      { name: 'game/', content: '' },
    ]));
    expect(result.entries.map((entry) => entry.path)).toEqual(['game/main.asm', 'game/src/helper.asm']);
    expect(result.entries[0]!.content).toBe('ORG &1900\n.start\nRTS\n');
    expect(result.entries[1]!.content).toBe('RTS\n');
    expect(result.refused).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('finds the directory even when the archive carries a comment after it', async () => {
    const result = await readZipArchive(await zip(
      [{ name: 'main.asm', content: 'RTS\n' }],
      { comment: 'built by someone else'.repeat(50) },
    ));
    expect(result.entries.map((entry) => entry.path)).toEqual(['main.asm']);
  });

  it('reads a backslash-separated name as the path it means', async () => {
    const result = await readZipArchive(await zip([{ name: 'game\\src\\main.asm', content: 'RTS\n' }]));
    expect(result.entries[0]!.path).toBe('game/src/main.asm');
  });

  it('passes over the build directories the folder importer also ignores', async () => {
    const result = await readZipArchive(await zip([
      { name: 'main.asm', content: 'RTS\n' },
      { name: 'node_modules/big.js', content: 'x' },
      { name: '__MACOSX/._main.asm', content: 'x' },
      { name: '.git/HEAD', content: 'ref' },
    ]));
    expect(result.entries.map((entry) => entry.path)).toEqual(['main.asm']);
    expect(result.refused).toEqual([]);
  });
});

describe('what an archive is not allowed to do', () => {
  it('refuses a name that would unpack outside the project, naming which', async () => {
    const result = await readZipArchive(await zip([
      { name: 'ok.asm', content: 'RTS\n' },
      { name: '../escaped.asm', content: 'RTS\n' },
      { name: 'game/../../escaped.asm', content: 'RTS\n' },
      { name: '/etc/passwd', content: 'root\n' },
      { name: 'C:\\Windows\\system.ini', content: 'x\n' },
    ]));
    expect(result.entries.map((entry) => entry.path)).toEqual(['ok.asm']);
    expect(result.refused.map((record) => record.reason)).toEqual(['path-traversal', 'path-traversal', 'absolute-path', 'absolute-path']);
    expect(result.refused[0]!.detail).toContain('outside the project');
  });

  it('reports a symbolic link as a link rather than importing the path it holds', async () => {
    const result = await readZipArchive(await zip([
      { name: 'real.asm', content: 'RTS\n' },
      { name: 'shortcut.asm', content: '../../../../etc/passwd', externalAttributes: SYMLINK_ATTRIBUTES, madeBy: 3 },
    ]));
    expect(result.entries.map((entry) => entry.path)).toEqual(['real.asm']);
    expect(result.refused).toEqual([{ path: 'shortcut.asm', reason: 'symbolic-link', detail: expect.stringContaining('symbolic link') }]);
  });

  it('does not mistake an ordinary file made on Windows for a link', async () => {
    /* Creator 0 is MS-DOS, where the high attribute bits mean nothing at all. */
    const result = await readZipArchive(await zip([
      { name: 'main.asm', content: 'RTS\n', madeBy: 0, externalAttributes: SYMLINK_ATTRIBUTES },
    ]));
    expect(result.entries.map((entry) => entry.path)).toEqual(['main.asm']);
  });

  it('reports an encrypted entry rather than importing its ciphertext', async () => {
    const result = await readZipArchive(await zip([
      { name: 'secret.asm', content: 'RTS\n', flags: 0x0001 },
    ]));
    expect(result.entries).toEqual([]);
    expect(result.refused[0]).toMatchObject({ reason: 'encrypted' });
    expect(result.refused[0]!.detail).toContain('archive passwords');
  });

  it('names the compression method it does not implement rather than producing rubbish', async () => {
    const result = await readZipArchive(await zip([
      { name: 'old.asm', content: 'RTS\n', method: 6, rawCompressed: new Uint8Array([1, 2, 3]) },
    ]));
    expect(result.refused[0]).toMatchObject({ reason: 'unsupported-compression' });
    expect(result.refused[0]!.detail).toContain('method 6');
  });

  it('refuses an entry that declares more than one file may hold, without expanding it', async () => {
    const result = await readZipArchive(await zip([
      { name: 'huge.asm', content: 'RTS\n', declaredUncompressed: MAX_ARCHIVE_FILE_BYTES + 1 },
    ]));
    expect(result.entries).toEqual([]);
    expect(result.refused[0]).toMatchObject({ reason: 'file-too-large' });
    expect(result.refused[0]!.detail).toContain('declares');
  });

  it('stops a small entry that expands past the limit, whatever its header claims', async () => {
    /* The oldest archive attack there is: a header that says four bytes and a
     * stream that produces megabytes. The declared size passes the cheap check,
     * so the bound has to hold during decompression as well. */
    const bomb = new Uint8Array(MAX_ARCHIVE_FILE_BYTES + 4096);
    const result = await readZipArchive(await zip([
      { name: 'bomb.asm', content: bomb, declaredUncompressed: 4, crc: 0 },
    ]));
    expect(result.entries).toEqual([]);
    expect(result.refused[0]).toMatchObject({ reason: 'file-too-large' });
    expect(result.refused[0]!.detail).toContain('whatever its header claims');
  });

  it('reports an entry whose bytes do not match the checksum the archive records', async () => {
    const result = await readZipArchive(await zip([
      { name: 'altered.asm', content: 'RTS\n', crc: 0xdeadbeef },
    ]));
    expect(result.entries).toEqual([]);
    expect(result.refused[0]).toMatchObject({ reason: 'checksum-mismatch' });
    expect(result.refused[0]!.detail).toContain('damaged or was altered');
  });

  it('reports a file that is not text rather than importing it as source', async () => {
    const result = await readZipArchive(await zip([
      { name: 'sprite.bin', content: new Uint8Array([0x00, 0x01, 0x02, 0xff]) },
      { name: 'invalid.asm', content: new Uint8Array([0x52, 0x54, 0x53, 0xc3, 0x28]) },
    ]));
    expect(result.entries).toEqual([]);
    expect(result.refused.map((record) => record.reason)).toEqual(['not-text', 'not-text']);
    expect(result.refused[1]!.detail).toContain('UTF-8');
  });

  it('refuses a zip64 archive rather than reading its overflowed 32-bit fields', async () => {
    await expect(readZipArchive(await zip([{ name: 'main.asm', content: 'RTS\n' }], { zip64: true })))
      .rejects.toThrow(/zip64/);
  });

  it('says plainly when a file is not a zip archive at all', async () => {
    await expect(readZipArchive(new TextEncoder().encode('this is not a zip file at all').buffer as ArrayBuffer))
      .rejects.toThrow(/not a zip archive/);
  });

  it('reports a truncated archive rather than reading past its end', async () => {
    const whole = await zip([{ name: 'main.asm', content: 'RTS\n'.repeat(200) }]);
    /* Keep the end record, which holds the directory offset, and remove what it
     * points at: the archive now describes data that is not there. */
    const bytes = new Uint8Array(whole);
    const cut = new Uint8Array(bytes.length - 22);
    cut.set(bytes.subarray(bytes.length - 22), 0);
    const view = new DataView(cut.buffer);
    view.setUint32(16, 10_000_000, true);
    await expect(readZipArchive(cut.buffer)).rejects.toThrow(/truncated|not a zip archive|damaged/);
  });
});

describe('the name rule on its own', () => {
  it('accepts an ordinary path and refuses the two shapes that escape', () => {
    expect(unsafeArchiveName('game/src/main.asm')).toBeNull();
    expect(unsafeArchiveName('..hidden.asm')).toBeNull();
    expect(unsafeArchiveName('../out.asm')?.reason).toBe('path-traversal');
    expect(unsafeArchiveName('a/../../out.asm')?.reason).toBe('path-traversal');
    expect(unsafeArchiveName('a\\..\\..\\out.asm')?.reason).toBe('path-traversal');
    expect(unsafeArchiveName('/out.asm')?.reason).toBe('absolute-path');
    expect(unsafeArchiveName('D:/out.asm')?.reason).toBe('absolute-path');
  });
});

describe('the checksum this reader computes', () => {
  it('matches the published CRC-32 of a known string', () => {
    /* "123456789" is the standard check value for CRC-32. */
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});
