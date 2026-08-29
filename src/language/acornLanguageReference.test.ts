import { describe, expect, it } from 'vitest';
import { basicLanguageItem, mosLanguageItem } from './acornLanguageReference';
import type { LanguageTargetContext } from './languageTarget';

const target = (overrides: Partial<LanguageTargetContext> = {}): LanguageTargetContext => ({
  processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC Micro Model B', romId: 'os12-basic2', romLabel: 'OS 1.20 / BASIC II', romReady: true, enabledCapabilities: ['dfs'], ...overrides,
});

describe('Acorn language reference', () => {
  it('provides cited, structured BBC BASIC parameter and range documentation', () => {
    const sound = basicLanguageItem('sound', target());
    expect(sound).toMatchObject({ token: 'SOUND', signature: 'SOUND channel, amplitude, pitch, duration' });
    expect(sound?.documentation?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'channel', range: expect.stringMatching(/0–3/) }),
      expect.objectContaining({ name: 'amplitude', range: expect.stringMatching(/-15.*0/) }),
    ]));
    expect(sound?.documentation?.compatibility).toMatchObject({ supported: true, appliesTo: expect.arrayContaining(['BBC BASIC II', 'BBC Micro Model B']) });
    expect(sound?.documentation?.citations?.[0]).toMatchObject({ title: expect.stringMatching(/User Guide/), url: expect.stringMatching(/^https:/) });
  });

  it('states Electron envelope and target incompatibility limits explicitly', () => {
    expect(basicLanguageItem('ENVELOPE', target({ machineId: 'electron', machineLabel: 'Acorn Electron' }))?.documentation?.compatibility)
      .toMatchObject({ supported: true, warning: expect.stringMatching(/amplitude-envelope phases/) });
    expect(basicLanguageItem('MODE', target({ machineId: 'atom', machineLabel: 'Acorn Atom', romId: 'atom', romLabel: 'Atom ROMs' }))?.documentation?.compatibility)
      .toMatchObject({ supported: false, warning: expect.stringMatching(/not compatible/) });
  });

  it('switches to the cited Atom BASIC dialect instead of presenting BBC syntax as portable', () => {
    const atom = target({ machineId: 'atom', machineLabel: 'Acorn Atom', romId: 'atom-basic', romLabel: 'Atom BASIC / OS', enabledCapabilities: [] });
    const clear = basicLanguageItem('CLEAR', atom);
    expect(clear).toMatchObject({ token: 'CLEAR', signature: 'CLEAR mode', documentation: { category: 'Atom BASIC statement', compatibility: { supported: true } } });
    expect(clear?.documentation?.citations?.[0]).toMatchObject({ title: 'Atomic Theory and Practice', section: expect.stringMatching(/Chapter 20/) });
    expect(basicLanguageItem('PRINT', atom)?.detail).toMatch(/does not add a newline automatically/i);
    expect(basicLanguageItem('SOUND', atom)?.documentation?.compatibility).toMatchObject({ supported: false, warning: expect.stringMatching(/BBC BASIC/) });
    expect(basicLanguageItem('COLOUR', atom)?.documentation?.compatibility).toMatchObject({ supported: false, warning: expect.stringMatching(/floating-point extension ROM/) });
    expect(basicLanguageItem('COLOUR', { ...atom, romId: 'atom-fp', romLabel: 'Atom FP ROM', enabledCapabilities: ['fp-rom'] })?.documentation?.compatibility).toMatchObject({ supported: true });
  });

  it('documents MOS registers, effects, entry address, provenance and ROM readiness', () => {
    const call = mosLanguageItem('OSWRCH', target({ romReady: false }));
    expect(call).toMatchObject({ token: 'OSWRCH', kind: 'mos', detail: expect.stringMatching(/&FFEE/) });
    expect(call?.documentation?.parameters).toContainEqual(expect.objectContaining({ name: 'A', range: '&00–&FF.' }));
    expect(call?.documentation?.sideEffects?.join(' ')).toMatch(/VDU state/);
    expect(call?.documentation?.compatibility).toMatchObject({ supported: true, warning: expect.stringMatching(/ROM set is not ready/) });
    expect(call?.documentation?.citations?.[0]).toMatchObject({ title: expect.stringMatching(/Advanced User Guide/), section: expect.stringMatching(/OSWRCH.*&FFEE/) });
  });
});
