export const MAX_CLIPBOARD_TEXT_CHARACTERS = 8 * 1024 * 1024;

export type ClipboardFailureReason = 'unavailable' | 'denied' | 'aborted' | 'too-large' | 'failed';

export class PlainTextClipboardError extends Error {
  constructor(public readonly operation: 'read' | 'write', public readonly reason: ClipboardFailureReason, message: string) {
    super(message);
    this.name = 'PlainTextClipboardError';
  }
}

export interface PlainTextClipboardPort {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
}

function classifyFailure(operation: 'read' | 'write', error: unknown): PlainTextClipboardError {
  if (error instanceof PlainTextClipboardError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new PlainTextClipboardError(operation, 'denied', `Clipboard ${operation} permission was denied by the browser`);
  if (name === 'AbortError') return new PlainTextClipboardError(operation, 'aborted', `Clipboard ${operation} was aborted by the browser`);
  return new PlainTextClipboardError(operation, 'failed', `Clipboard ${operation} failed`);
}

function validateText(operation: 'read' | 'write', text: string) {
  if (text.length > MAX_CLIPBOARD_TEXT_CHARACTERS) throw new PlainTextClipboardError(operation, 'too-large', `Clipboard text exceeds the ${MAX_CLIPBOARD_TEXT_CHARACTERS.toLocaleString()} character safety limit`);
  return text;
}

export async function readPlainTextClipboard(port: PlainTextClipboardPort | undefined = navigator.clipboard): Promise<string> {
  if (!port?.readText) throw new PlainTextClipboardError('read', 'unavailable', 'The browser does not expose plain-text clipboard read access');
  try { return validateText('read', await port.readText()); }
  catch (error) { throw classifyFailure('read', error); }
}

export async function writePlainTextClipboard(text: string, port: PlainTextClipboardPort | undefined = navigator.clipboard): Promise<void> {
  validateText('write', text);
  if (!port?.writeText) throw new PlainTextClipboardError('write', 'unavailable', 'The browser does not expose plain-text clipboard write access');
  try { await port.writeText(text); }
  catch (error) { throw classifyFailure('write', error); }
}

export function clipboardFailureMessage(error: unknown) {
  if (!(error instanceof PlainTextClipboardError)) return 'The browser clipboard operation failed';
  if (error.reason === 'denied') return 'The browser denied clipboard permission';
  if (error.reason === 'unavailable') return 'This browser context does not expose clipboard access';
  if (error.reason === 'aborted') return 'The browser cancelled the clipboard operation';
  return error.message;
}
