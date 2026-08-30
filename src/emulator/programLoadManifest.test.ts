import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../build/digest';
import { bindProgramLoadManifest, validateProgramLoadManifest, type ProgramLoadDraft } from './programLoadManifest';

const bytes = new Uint8Array([0xa9, 0x41, 0x60]);
const draft: ProgramLoadDraft = { source: 'build', mode: 'run', processor: '6502', name: 'main.bin', expectedSha256: sha256Hex(bytes), build: { targetId: 'main', targetName: 'Main', fingerprint: '1234abcd', toolchainId: 'browser.6502', toolchainVersion: '1' } };
const session = 'a'.repeat(64);

describe('immutable program load manifest', () => {
  it('binds exact bytes, build, addresses and runtime session', () => {
    const manifest = bindProgramLoadManifest(draft, session, bytes, 0x1900, 0x1900);
    expect(manifest.outputSha256).toBe(draft.expectedSha256);
    expect(manifest.bytes).toBe(3);
    expect(manifest.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(validateProgramLoadManifest(JSON.parse(JSON.stringify(manifest)), session, bytes, 0x1900, 0x1900).fingerprint).toBe(manifest.fingerprint);
  });

  it('rejects changed bytes, addresses, session or fingerprint', () => {
    expect(() => bindProgramLoadManifest(draft, session, new Uint8Array([0]), 0x1900, 0x1900)).toThrow(/do not match/);
    const manifest = bindProgramLoadManifest(draft, session, bytes, 0x1900, 0x1900);
    expect(() => validateProgramLoadManifest(manifest, 'b'.repeat(64), bytes, 0x1900, 0x1900)).toThrow();
    expect(() => validateProgramLoadManifest(manifest, session, bytes, 0x1901, 0x1900)).toThrow();
    expect(() => validateProgramLoadManifest({ ...manifest, fingerprint: '0'.repeat(64) }, session, bytes, 0x1900, 0x1900)).toThrow(/fingerprint/);
  });

  it('binds a hardware-test load as a distinct immutable execution mode', () => {
    const manifest = bindProgramLoadManifest({ ...draft, mode: 'test' }, session, bytes, 0x1900, 0x1900);
    expect(manifest.mode).toBe('test');
    expect(manifest.fingerprint).not.toBe(bindProgramLoadManifest(draft, session, bytes, 0x1900, 0x1900).fingerprint);
    expect(validateProgramLoadManifest(manifest, session, bytes, 0x1900, 0x1900)).toEqual(manifest);
  });

  it('binds interpreter-resolved BASIC payloads without claiming a fixed guest address', () => {
    const basic = bindProgramLoadManifest({ ...draft, format: 'bbc-basic-program', placement: 'interpreter-page' }, session, bytes, 0, 0);
    expect(basic).toMatchObject({ format: 'bbc-basic-program', placement: 'interpreter-page', origin: 0, entryPoint: 0 });
    expect(validateProgramLoadManifest(basic, session, bytes, 0, 0).fingerprint).toBe(basic.fingerprint);
    expect(() => bindProgramLoadManifest({ ...draft, format: 'bbc-basic-program', placement: 'fixed' }, session, bytes, 0, 0)).toThrow(/format and placement/);
  });
});
