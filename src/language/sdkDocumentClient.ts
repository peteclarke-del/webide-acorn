export interface SdkDocument {
  schema: '8bit-net.sdk-document';
  version: 1;
  toolchainId: string;
  toolchainVersion: string;
  path: string;
  source: string;
  licence: string;
  readOnly: true;
  bytes: number;
  sha256: string;
  content: string;
}

const MAXIMUM_DOCUMENT_BYTES = 262_144;

export async function loadSdkDocument(path: string, signal?: AbortSignal): Promise<SdkDocument> {
  const response = await fetch(`/api/v1/toolchains/cc65-c/sdk?${new URLSearchParams({ path })}`, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => undefined) as Partial<SdkDocument> & { error?: { message?: string } } | undefined;
  if (!response.ok) throw new Error(payload?.error?.message ?? `SDK document request failed with HTTP ${response.status}`);
  if (!payload || payload.schema !== '8bit-net.sdk-document' || payload.version !== 1 || payload.readOnly !== true || payload.path !== path
    || typeof payload.content !== 'string' || typeof payload.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(payload.sha256)
    || typeof payload.bytes !== 'number' || payload.bytes < 0 || payload.bytes > MAXIMUM_DOCUMENT_BYTES
    || typeof payload.toolchainId !== 'string' || typeof payload.toolchainVersion !== 'string' || typeof payload.source !== 'string' || typeof payload.licence !== 'string') {
    throw new Error('SDK document response failed schema or size validation');
  }
  if (new TextEncoder().encode(payload.content).length !== payload.bytes) throw new Error('SDK document byte count does not match its content');
  return payload as SdkDocument;
}
