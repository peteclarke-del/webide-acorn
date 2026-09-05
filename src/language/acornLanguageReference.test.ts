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

describe('keywords the ROMs have and nobody has written up', () => {
  it('answers with what the ROM tables say rather than with nothing', () => {
    /* An empty panel reads as "this is not a keyword". It is one — it is just
     * undocumented, and those are different things. */
    const item = basicLanguageItem('ADVAL')!;
    expect(item.token).toBe('ADVAL');
    expect(item.detail).toMatch(/No description of what it does is documented in this build yet/);
    expect(item.documentation?.compatibility?.appliesTo).toContain('BBC BASIC II');
  });

  it('cites the ROM table it came from, without a link it does not have', () => {
    /* Inventing a URL so the shape fits would be a fabricated citation. */
    const citation = basicLanguageItem('ADVAL')!.documentation!.citations![0]!;
    expect(citation.title).toMatch(/language ROM keyword tables/);
    expect(citation.url).toBeUndefined();
    expect(citation.section).toMatch(/BBC BASIC II &96/);
  });

  it('does not displace a keyword somebody has written up', () => {
    const written = basicLanguageItem('PRINT')!;
    expect(written.detail).not.toMatch(/No description/);
    expect(written.documentation?.citations?.[0]?.title).toBe('BBC Microcomputer System User Guide');
  });

  it('still says nothing for a word no ROM has', () => {
    expect(basicLanguageItem('NOTAKEYWORD')).toBeUndefined();
  });

  it('says which machines have a keyword only some of them have', () => {
    const item = basicLanguageItem('EDIT')!;
    expect(item.documentation?.compatibility?.appliesTo).toEqual(['BBC BASIC IV']);
  });
});
