import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSdkDocument } from './sdkDocumentClient';

afterEach(() => vi.restoreAllMocks());

describe('SDK document client', () => {
  it('loads and validates exact read-only SDK source', async () => {
    const content = 'void acorn_oswrch(unsigned char value);\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schema: '8bit-net.sdk-document', version: 1, toolchainId: 'cc65.c-bbc', toolchainVersion: '2026.08.1', path: 'acorn.h', source: '8bit-net BBC C SDK include/acorn.h', licence: 'Project runtime source.', readOnly: true, bytes: new TextEncoder().encode(content).length, sha256: 'a'.repeat(64), content }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(loadSdkDocument('acorn.h')).resolves.toMatchObject({ path: 'acorn.h', readOnly: true, content });
    expect(fetch).toHaveBeenCalledWith('/api/v1/toolchains/cc65-c/sdk?path=acorn.h', expect.objectContaining({ method: 'GET', cache: 'no-store' }));
  });

  it('surfaces bounded API failures and rejects mismatched payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Unknown SDK document' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })));
    await expect(loadSdkDocument('missing.h')).rejects.toThrow('Unknown SDK document');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schema: '8bit-net.sdk-document', version: 1, readOnly: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(loadSdkDocument('acorn.h')).rejects.toThrow('schema or size');
  });
});
