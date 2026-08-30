import { describe, expect, it, vi } from 'vitest';
import { clipboardFailureMessage, MAX_CLIPBOARD_TEXT_CHARACTERS, PlainTextClipboardError, readPlainTextClipboard, writePlainTextClipboard } from './plainTextClipboard';

describe('plain-text clipboard adapter', () => {
  it('preserves exact Unicode and line endings without interpreting markup', async () => {
    const text = '<script>not executed</script>\r\nPRINT "£ π 😀"';
    const writeText = vi.fn(async () => undefined);
    await writePlainTextClipboard(text, { writeText });
    expect(writeText).toHaveBeenCalledWith(text);
    await expect(readPlainTextClipboard({ readText: async () => text })).resolves.toBe(text);
  });

  it('classifies unavailable, denied and aborted browser behavior', async () => {
    await expect(readPlainTextClipboard({})).rejects.toMatchObject({ reason: 'unavailable', operation: 'read' });
    await expect(writePlainTextClipboard('text', { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } })).rejects.toMatchObject({ reason: 'denied', operation: 'write' });
    const aborted = await readPlainTextClipboard({ readText: async () => { throw new DOMException('cancelled', 'AbortError'); } }).catch((error) => error);
    expect(aborted).toMatchObject({ reason: 'aborted' });
    expect(clipboardFailureMessage(aborted)).toContain('cancelled');
  });

  it('bounds both directions before text reaches the editor or operating system clipboard', async () => {
    const oversized = 'x'.repeat(MAX_CLIPBOARD_TEXT_CHARACTERS + 1);
    const writeText = vi.fn(async () => undefined);
    await expect(writePlainTextClipboard(oversized, { writeText })).rejects.toBeInstanceOf(PlainTextClipboardError);
    expect(writeText).not.toHaveBeenCalled();
    await expect(readPlainTextClipboard({ readText: async () => oversized })).rejects.toMatchObject({ reason: 'too-large' });
  });
});
