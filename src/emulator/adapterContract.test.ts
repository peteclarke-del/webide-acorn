import { describe, expect, it } from 'vitest';
import {
  EMULATOR_ADAPTER_API_VERSION,
  assertEmulatorTransition,
  assertOperation,
  productionAdapterDescriptors,
  validateAdapterDescriptor,
  type EmulatorAdapter,
  type EmulatorAdapterDescriptor,
  type EmulatorArtifact,
  type EmulatorCapture,
  type EmulatorConfiguration,
  type EmulatorInputEvent,
  type EmulatorInspection,
  type EmulatorLifecycle,
  type EmulatorMedia,
  type EmulatorResetKind,
  type EmulatorStateBlob,
} from './adapterContract';

class FakeAdapter implements EmulatorAdapter {
  private state: EmulatorLifecycle = 'created';
  private configuration: EmulatorConfiguration | null = null;
  private artifact: EmulatorArtifact | null = null;
  private time = 0;
  private readonly inputs: EmulatorInputEvent[] = [];

  constructor(readonly descriptor: EmulatorAdapterDescriptor) {}
  lifecycle() { return this.state; }
  private move(to: EmulatorLifecycle) { assertEmulatorTransition(this.state, to); this.state = to; }
  async configure(configuration: EmulatorConfiguration) { assertOperation(this.descriptor, 'configure'); this.configuration = configuration; this.move('configured'); }
  async mountMedia(_media: EmulatorMedia) { assertOperation(this.descriptor, 'mount-media'); if (!this.configuration) throw new Error('Adapter is not configured'); }
  async loadArtifact(artifact: EmulatorArtifact) { assertOperation(this.descriptor, 'load-artifact'); if (!this.configuration) throw new Error('Adapter is not configured'); this.artifact = artifact; this.move('loaded'); }
  async start() { assertOperation(this.descriptor, 'start'); if (!this.configuration) throw new Error('Adapter is not configured'); this.move('running'); }
  async pause() { assertOperation(this.descriptor, 'pause'); this.move('paused'); }
  async resume() { assertOperation(this.descriptor, 'resume'); this.move('running'); }
  async reset(_kind: EmulatorResetKind) { assertOperation(this.descriptor, 'reset'); if (!this.configuration) throw new Error('Adapter is not configured'); this.move('configured'); }
  async powerOff() { assertOperation(this.descriptor, 'power-off'); this.move('powered-off'); }
  async step(instructions = 1) { assertOperation(this.descriptor, 'step'); if (this.state !== 'paused' || !Number.isInteger(instructions) || instructions < 1 || instructions > 1000) throw new Error('Step requires a paused adapter and 1 to 1,000 instructions'); this.time += instructions; }
  async serializeState(): Promise<EmulatorStateBlob> { assertOperation(this.descriptor, 'serialize-state'); if (!this.configuration) throw new Error('Adapter is not configured'); return { format: 'fake-v1', adapterId: this.descriptor.id, adapterVersion: this.descriptor.version, machineManifestSha256: this.configuration.machineManifestSha256, bytes: new Uint8Array([this.time]) }; }
  async restoreState(state: EmulatorStateBlob) { assertOperation(this.descriptor, 'restore-state'); if (!this.configuration || state.adapterId !== this.descriptor.id || state.adapterVersion !== this.descriptor.version || state.machineManifestSha256 !== this.configuration.machineManifestSha256) throw new Error('State provenance is incompatible'); this.time = state.bytes[0] ?? 0; this.move('paused'); }
  async captureFrame(): Promise<EmulatorCapture> { assertOperation(this.descriptor, 'capture-frame'); return { mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]), monotonicTime: this.time }; }
  async captureAudio(_durationMs: number): Promise<EmulatorCapture> { assertOperation(this.descriptor, 'capture-audio'); return { mimeType: 'audio/wav', bytes: new Uint8Array(), monotonicTime: this.time }; }
  async injectInput(events: readonly EmulatorInputEvent[]) { assertOperation(this.descriptor, 'inject-input'); this.inputs.push(...events); }
  async inspectState(): Promise<EmulatorInspection> { assertOperation(this.descriptor, 'inspect-state'); return { lifecycle: this.state, running: this.state === 'running', monotonicTime: this.time, state: { artifact: this.artifact?.name ?? null, inputCount: this.inputs.length } }; }
  async debug(command: Readonly<Record<string, unknown>>) { assertOperation(this.descriptor, 'debug'); return { accepted: true, command }; }
  async destroy() { assertOperation(this.descriptor, 'destroy'); this.move('destroyed'); }
}

const fullDescriptor: EmulatorAdapterDescriptor = {
  apiVersion: EMULATOR_ADAPTER_API_VERSION,
  id: 'contract.fake',
  version: '1.0.0',
  operations: Object.fromEntries(['configure', 'mount-media', 'load-artifact', 'start', 'pause', 'resume', 'reset', 'power-off', 'step', 'serialize-state', 'restore-state', 'capture-frame', 'capture-audio', 'inject-input', 'inspect-state', 'debug', 'destroy'].map((name) => [name, true])) as EmulatorAdapterDescriptor['operations'],
  limitations: [],
};

describe('emulator adapter contract', () => {
  it('runs the complete lifecycle against a fake implementation', async () => {
    expect(validateAdapterDescriptor(fullDescriptor)).toEqual([]);
    const adapter = new FakeAdapter(fullDescriptor);
    const configuration = { machineManifestId: 'bbc-b-os12', machineManifestSha256: 'a'.repeat(64), roms: [], options: {} };
    await adapter.configure(configuration);
    await adapter.mountMedia({ slot: 'drive-0', name: 'test.ssd', format: 'dfs-ssd', bytes: new Uint8Array(204800), writable: false });
    await adapter.loadArtifact({ name: 'test.bin', bytes: new Uint8Array([0xea]), sha256: 'b'.repeat(64), loadAddress: 0x1900, entryPoint: 0x1900 });
    await adapter.start();
    await adapter.injectInput([{ kind: 'key', code: 'KeyA', pressed: true }]);
    await adapter.pause();
    await adapter.step(3);
    const state = await adapter.serializeState();
    await adapter.resume();
    await adapter.restoreState(state);
    expect(await adapter.inspectState()).toMatchObject({ lifecycle: 'paused', running: false, monotonicTime: 3, state: { artifact: 'test.bin', inputCount: 1 } });
    expect((await adapter.captureFrame()).mimeType).toBe('image/png');
    expect((await adapter.debug({ type: 'registers' })).accepted).toBe(true);
    await adapter.powerOff();
    await adapter.destroy();
    expect(adapter.lifecycle()).toBe('destroyed');
  });

  it('rejects illegal state, incompatible restore and unavailable capabilities', async () => {
    const descriptor = { ...fullDescriptor, operations: { ...fullDescriptor.operations, 'capture-audio': false }, limitations: ['Audio capture is unavailable in this fake.'] };
    const adapter = new FakeAdapter(descriptor);
    await expect(adapter.start()).rejects.toThrow('not configured');
    await adapter.configure({ machineManifestId: 'atom', machineManifestSha256: 'c'.repeat(64), roms: [], options: {} });
    await adapter.start();
    await adapter.pause();
    await expect(adapter.restoreState({ format: 'fake-v1', adapterId: descriptor.id, adapterVersion: descriptor.version, machineManifestSha256: 'd'.repeat(64), bytes: new Uint8Array() })).rejects.toThrow('incompatible');
    await expect(adapter.captureAudio(100)).rejects.toThrow('does not support capture-audio');
    await adapter.destroy();
    await expect(adapter.resume()).rejects.toThrow('Illegal emulator lifecycle transition');
  });

  it('validates every production declaration and its honest limitations', () => {
    expect(validateAdapterDescriptor(productionAdapterDescriptors.jsbeeb)).toEqual([]);
    expect(validateAdapterDescriptor(productionAdapterDescriptors.arculator)).toEqual([]);
    expect(productionAdapterDescriptors.arculator.operations['serialize-state']).toBe(false);
    expect(productionAdapterDescriptors.jsbeeb.operations['capture-frame']).toBe(true);
    expect(productionAdapterDescriptors.jsbeeb.operations['capture-audio']).toBe(true);
    expect(productionAdapterDescriptors.arculator.operations['capture-audio']).toBe(true);
  });
});
