import { describe, expect, it } from 'vitest';
import { createSongDocument, setSongCell } from './songDocument';
import { previewRows } from './songPlayback';
import { SongPlayer, type PlayerAudioParam, type PlayerContext } from './songPlayer';

function fakeParam(log: string[], name: string): PlayerAudioParam {
  return { value: 0, setValueAtTime: (value, time) => log.push(`${name}=${value}@${time}`), linearRampToValueAtTime: (value, time) => log.push(`${name}->${value}@${time.toFixed(3)}`), cancelScheduledValues: () => undefined };
}
function fakeContext(log: string[]): PlayerContext {
  let oscillators = 0; let gains = 0;
  return {
    currentTime: 1, sampleRate: 8000, destination: 'speaker',
    createOscillator: () => { const id = `osc${oscillators++}`; return { type: 'sine', frequency: fakeParam(log, `${id}.f`), connect: () => undefined, disconnect: () => undefined, start: () => log.push(`${id} start`), stop: () => undefined }; },
    createGain: () => { const id = `gain${gains++}`; return { gain: fakeParam(log, id), connect: () => undefined, disconnect: () => undefined }; },
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ buffer: null, loop: false, connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined }),
  };
}

describe('the browser speaker for a song', () => {
  it('sets each channel\'s pitch and level for a row, and silences a channel that has nothing', () => {
    const log: string[] = [];
    const player = new SongPlayer(fakeContext(log), 4);
    let document = createSongDocument('t', 1, 'bbc-sn76489');
    document = setSongCell(document, 0, 1, { pitch: 89, volume: 15 });
    player.playRow(previewRows(document)[0]!);
    /* Channel 1 is the second gain (the master is gain0) and the second oscillator. */
    expect(log).toContain('osc1.f=440@1');
    expect(log).toContain('gain2=1@1');
    expect(log).toContain('gain1=0@1');
    expect(log).toContain('gain3=0@1');
  });

  it('ramps a BeebSID note through its attack and decay to its sustain', () => {
    const log: string[] = [];
    const player = new SongPlayer(fakeContext(log), 3);
    let document = createSongDocument('t', 1, 'bbc-beebsid');
    document = setSongCell(document, 0, 0, { pitch: 57, volume: 8 });
    player.playRow(previewRows(document)[0]!);
    expect(log.some((line) => line.startsWith('gain1->1@'))).toBe(true);
    expect(log.some((line) => line.startsWith(`gain1->${8 / 15}@`))).toBe(true);
  });
});
