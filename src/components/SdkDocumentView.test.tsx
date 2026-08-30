import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SdkDocument } from '../language/sdkDocumentClient';
import { SdkDocumentView } from './SdkDocumentView';

afterEach(() => cleanup());

const document: SdkDocument = {
  schema: '8bit-net.sdk-document',
  version: 1,
  toolchainId: 'cc65.c-bbc',
  toolchainVersion: '2.19-1',
  path: 'acorn.h',
  source: 'WebIDE Acorn SDK overlay',
  licence: 'Project-maintained compatibility declarations.',
  readOnly: true,
  bytes: 61,
  sha256: '0'.repeat(64),
  content: '#ifndef ACORN_H\n#define ACORN_H\nvoid acorn_oswrch(unsigned char value);\n#endif\n',
};

describe('SDK document view', () => {
  it('shows immutable provenance and selects the exact requested declaration', () => {
    const close = vi.fn();
    render(<SdkDocumentView document={document} token="acorn_oswrch" onClose={close} onNotice={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Read-only SDK document acorn.h' })).toBeVisible();
    expect(screen.getByText('cc65.c-bbc@2.19-1')).toBeVisible();
    expect(screen.getByText('READ ONLY')).toBeVisible();
    expect(screen.getByRole('listitem', { current: 'location' })).toHaveTextContent('void acorn_oswrch(unsigned char value);');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns to source from the primary action', () => {
    const close = vi.fn();
    render(<SdkDocumentView document={document} onClose={close} onNotice={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to source' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
