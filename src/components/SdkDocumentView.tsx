import { useEffect, useMemo, useRef } from 'react';
import type { SdkDocument } from '../language/sdkDocumentClient';

interface SdkDocumentViewProps {
  document: SdkDocument;
  token?: string;
  onClose: () => void;
  onNotice: (message: string) => void;
}

export function SdkDocumentView({ document, token, onClose, onNotice }: SdkDocumentViewProps) {
  const activeRef = useRef<HTMLLIElement>(null);
  const lines = useMemo(() => document.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n'), [document.content]);
  const activeLine = useMemo(() => {
    if (!token) return 1;
    const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const found = lines.findIndex((line) => pattern.test(line));
    return found < 0 ? 1 : found + 1;
  }, [lines, token]);

  useEffect(() => {
    if (typeof activeRef.current?.scrollIntoView === 'function') activeRef.current.scrollIntoView({ block: 'center' });
  }, [activeLine, document.path]);

  const copyPath = async () => {
    try { await navigator.clipboard.writeText(document.path); onNotice(`Copied SDK path ${document.path}`); }
    catch { onNotice(`Clipboard access was denied. SDK path: ${document.path}`); }
  };

  return <div className="sdk-document-workspace" role="dialog" aria-modal="true" aria-label={`Read-only SDK document ${document.path}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <header className="sdk-document-heading">
      <div><span>IMMUTABLE TOOLCHAIN SDK</span><h2>{document.path}</h2><p>{token ? `Declaration requested for ${token}` : 'Opened from a system include operand'}</p></div>
      <div><button type="button" onClick={copyPath}>Copy path</button><button type="button" autoFocus onClick={onClose}>Back to source</button></div>
    </header>
    <section className="sdk-document-provenance" aria-label="SDK document provenance">
      <span><small>Toolchain</small><strong>{document.toolchainId}@{document.toolchainVersion}</strong></span>
      <span><small>Installed source</small><strong>{document.source}</strong></span>
      <span><small>Size</small><strong>{document.bytes.toLocaleString()} bytes</strong></span>
      <span><small>SHA-256</small><code title={document.sha256}>{document.sha256}</code></span>
      <span><small>Access</small><strong>READ ONLY</strong></span>
    </section>
    <p className="sdk-document-licence">{document.licence}</p>
    <ol className="sdk-source-listing" aria-label={`${document.path} source listing`}>
      {lines.map((line, index) => <li ref={index + 1 === activeLine ? activeRef : undefined} aria-current={index + 1 === activeLine ? 'location' : undefined} className={index + 1 === activeLine ? 'active' : ''} key={index}><code>{line || ' '}</code></li>)}
    </ol>
  </div>;
}
