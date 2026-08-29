import { afterEach, describe, expect, it, vi } from 'vitest';
import { disassembleArm } from './disassemblerArm';
import { createArmAssemblySource, verifyArmAssemblySource } from './disassemblyArmAssemblyExport';

const bytes = Uint8Array.from([0x01, 0x00, 0xa0, 0xe3, 0xfe, 0xff, 0xff, 0xea]);

afterEach(() => vi.restoreAllMocks());

describe('guarded ARM disassembly source export', () => {
  it('emits labels, readable instruction comments and exact little-endian words', () => {
    const analysis = disassembleArm(bytes, 0x8000, 0x8000, 'arm2');
    const generated = createArmAssemblySource(analysis, { 0x8000: 'ignored_entry' });
    expect(generated.source).toContain('_start:');
    expect(generated.source).toContain('ignored_entry:');
    expect(generated.source).toContain('.inst 0xE3A00001 @ MOV R0, #&01');
    expect(generated.source).toContain('.inst 0xEAFFFFFE @ B loop_00008004');
  });

  it('accepts a native result only when bytes, origin and entry all match', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      schema: '8bit-net.native-build-response',
      result: { invocation: { adapterId: 'gnu.arm-none-eabi-binutils', adapterVersion: '2026.08.1' }, diagnostics: [] },
      artifact: { bytesBase64: btoa(String.fromCharCode(...bytes)), origin: 0x8000, entryPoint: 0x8000 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const analysis = disassembleArm(bytes, 0x8000, 0x8000, 'arm2');
    const result = await verifyArmAssemblySource(createArmAssemblySource(analysis), analysis, bytes);
    expect(result.verified).toBe(true);
    expect(result.toolchain).toContain('@2026.08.1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/builds/arm-binutils', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects a byte mismatch and an invalid low origin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      schema: '8bit-net.native-build-response', result: { diagnostics: [] },
      artifact: { bytesBase64: btoa(String.fromCharCode(0)), origin: 0x8000, entryPoint: 0x8000 },
    }), { status: 200 }));
    const analysis = disassembleArm(bytes, 0x8000, 0x8000, 'arm3');
    expect((await verifyArmAssemblySource(createArmAssemblySource(analysis), analysis, bytes)).verified).toBe(false);
    const low = { ...analysis, origin: 0x1000, entryPoint: 0x1000 };
    expect((await verifyArmAssemblySource(createArmAssemblySource(low), low, bytes)).verificationMessage).toContain('at or above');
  });
});
