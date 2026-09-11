import { describe, expect, it } from 'vitest';
import { diskSetArtifactFor } from './diskSetArtifacts';

const machineCode = (targetId: string, origin: number) => ({ targetId, targetName: targetId, artifact: { kind: '6502-binary', bytes: new Uint8Array([0xea]), origin, entryPoint: origin, provenance: { fingerprint: 'f', target: { outputName: `${targetId}.bin` } } } });
const targets = [{ id: 'host', processor: 'host' }, { id: 'parasite', processor: 'parasite' }, { id: 'loader' }];

describe('what a build looks like on a disc', () => {
  it('gives a host program &FFFF in the top half of its addresses on a machine with the Tube, and a parasite program its own origin', () => {
    expect(diskSetArtifactFor(machineCode('host', 0x1900), targets, ['tube'])).toMatchObject({ loadAddress: 0x31900, executionAddress: 0x31900, kind: 'machine-code', outputName: 'host.bin' });
    expect(diskSetArtifactFor(machineCode('parasite', 0x2000), targets, ['tube'])).toMatchObject({ loadAddress: 0x2000, executionAddress: 0x2000 });
    /* Without a Tube the addresses are the machine's own. */
    expect(diskSetArtifactFor(machineCode('host', 0x1900), targets, ['dfs'])).toMatchObject({ loadAddress: 0x1900 });
  });

  it('puts a BASIC program on with conventional addresses and says it is BASIC, so the boot file CHAINs it', () => {
    const basic = { targetId: 'loader', targetName: 'loader', artifact: { kind: 'bbc-basic-program', bytes: new Uint8Array([0x0d, 0xff]) } };
    expect(diskSetArtifactFor(basic, targets, ['tube'])).toMatchObject({ loadAddress: 0x31900, executionAddress: 0x38023, kind: 'bbc-basic', outputName: 'loader' });
  });

  it('leaves out an artifact that is neither machine code nor BASIC', () => {
    expect(diskSetArtifactFor({ targetId: 'x', targetName: 'x', artifact: { kind: 'atom-basic-text', bytes: new Uint8Array(1) } }, targets, [])).toBeNull();
  });
});
