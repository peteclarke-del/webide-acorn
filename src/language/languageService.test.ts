import { describe, expect, it } from 'vitest';
import { completionItems, helpForToken, referenceItems, signatureHelpAt, sourceDefinitionAt, sourceReferences, StaleLanguageResponseError, tokenAt, VersionedLanguageSession } from './languageService';
import type { ProjectFile } from '../project/project';
import type { LanguageTargetContext } from './languageTarget';

const file = (language: ProjectFile['language'], content: string): ProjectFile => ({ id: 'f', name: 'test', content, language, modified: false });
const atom: LanguageTargetContext = { processor: '6502', machineId: 'atom', machineLabel: 'Acorn Atom', romId: 'atom-basic', romLabel: 'Atom BASIC / OS', romReady: true, enabledCapabilities: [] };

describe('language service', () => {
  it('returns contextual command and opcode help', () => {
    expect(helpForToken(file('bbc-basic', ''), 'PRINT')?.signature).toMatch(/PRINT/);
    expect(helpForToken(file('6502', ''), 'LDA')?.detail).toMatch(/Load A/);
  });
  it('finds a token on either side of the caret', () => expect(tokenAt(' JSR OSWRCH', 8)).toBe('OSWRCH'));
  it('exposes the same offline reference catalogue by language', () => {
    expect(referenceItems('bbc-basic')).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'PRINT', kind: 'command' })]));
    expect(referenceItems('6502')).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'OSWRCH', kind: 'mos' }), expect.objectContaining({ token: 'LDA', kind: 'opcode' }), expect.objectContaining({ token: 'INCLUDEASSET', signature: 'INCLUDEASSET "name.asset.json"' })]));
    expect(referenceItems('bbc-basic').some((item) => item.kind === 'opcode')).toBe(false);
  });
  it('exposes ca65 completion and hover definitions only for the selected native dialect', () => {
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: false, enabledCapabilities: [], toolchainId: 'cc65.ca65-ld65' };
    expect(referenceItems('6502', target)).toEqual(expect.arrayContaining([expect.objectContaining({ token: '.SEGMENT', signature: '.segment "name"' }), expect.objectContaining({ token: '.INCLUDE' })]));
    expect(helpForToken(file('6502', '.segment "CODE"'), '.segment', target)?.detail).toMatch(/named ld65 output segment/i);
    expect(referenceItems('6502', { ...target, toolchainId: '8bit-net.asm.6502' }).some((item) => item.token === '.SEGMENT')).toBe(false);
    expect(referenceItems('6502', target).some((item) => item.token === 'EQUB')).toBe(false);
  });
  it('exposes BeebAsm output and include assistance with sandbox constraints', () => {
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: false, enabledCapabilities: [], toolchainId: 'stardot.beebasm' };
    expect(referenceItems('6502', target)).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'SAVE', signature: 'SAVE start, end[, exec[, reload]]' }), expect.objectContaining({ token: 'INCLUDE' }), expect.objectContaining({ token: 'GUARD' })]));
    expect(helpForToken(file('6502', 'SAVE start,P%,start'), 'SAVE', target)?.documentation?.compatibility?.warning).toMatch(/filenames are rejected/i);
    expect(referenceItems('6502', target).some((item) => item.token === '.SEGMENT')).toBe(false);
  });
  it('provides cc65 C completion, hover, signatures and function navigation', () => {
    const target: LanguageTargetContext = { processor: '6502', machineId: 'bbc-b', machineLabel: 'BBC B', romId: 'os12', romLabel: 'OS 1.20', romReady: true, enabledCapabilities: [], toolchainId: 'cc65.c-bbc' };
    const source = file('c', "#include <acorn.h>\nstatic int draw(unsigned char colour) { return colour; }\nint main(void) { acorn_oswrch('A'); return draw(2); }");
    expect(completionItems(source, target)).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'acorn_oswrch', parameters: ['value'] }), expect.objectContaining({ token: 'draw', kind: 'symbol' }), expect.objectContaining({ token: 'unsigned', kind: 'type' })]));
    expect(helpForToken(source, 'acorn_oswrch', target)?.documentation?.compatibility?.warning).toMatch(/acorn\.h/i);
    expect(signatureHelpAt(source, source.content.indexOf("'A'") + 3, completionItems(source, target))).toMatchObject({ item: { token: 'acorn_oswrch' }, parameter: 'value' });
    expect(sourceDefinitionAt(source, source.content.lastIndexOf('draw'))).toMatchObject({ line: 2, kind: 'function' });
    expect(sourceReferences(source)).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'draw', targetLine: 2 })]));
  });
  it('resolves BASIC and assembly navigation targets', () => {
    expect(sourceReferences(file('bbc-basic', '10 GOTO 30\n30 END'))[0]).toMatchObject({ targetLine: 2, resolved: true });
    expect(sourceReferences(file('bbc-basic', '10 ON X GOTO 30,40:PRINT "GOTO 50":REM GOSUB 60\n30 END\n40 END')).map((item) => item.target)).toEqual(['30', '40']);
    expect(sourceReferences(file('bbc-basic', '10 PROCdraw(1)\n100 DEF PROCdraw(colour%)'))[0]).toMatchObject({ label: 'PROCdraw', targetLine: 2, resolved: true });
    expect(sourceReferences(file('6502', ' BNE loop\n.loop\n RTS'))[0]).toMatchObject({ targetLine: 2, resolved: true });
  });
  it('reports the active signature parameter without counting nested commas', () => {
    const basic = file('bbc-basic', '10 SOUND 1,FNlevel(2,3),120,');
    expect(signatureHelpAt(basic, basic.content.length)).toMatchObject({ activeParameter: 3, parameter: 'duration', parameters: ['channel', 'amplitude', 'pitch', 'duration'] });
  });
  it('selects the innermost open call and returns to the outer signature after it closes', () => {
    const content = '10 SOUND 1,FNlevel(2,,120,5\n100 DEF FNlevel(low%,high%)=low%';
    const basic = file('bbc-basic', content);
    const nestedPosition = content.indexOf(',,') + 1;
    expect(signatureHelpAt(basic, nestedPosition)).toMatchObject({ item: { token: 'FNlevel' }, activeParameter: 1, parameter: 'high%' });

    const closed = file('bbc-basic', '10 SOUND 1,FNlevel(2,3),120,\n100 DEF FNlevel(low%,high%)=low%');
    expect(signatureHelpAt(closed, closed.content.indexOf('\n'))).toMatchObject({ item: { token: 'SOUND' }, activeParameter: 3, parameter: 'duration' });
  });
  it('exposes alternative forms and ignores tokens inside strings or REM commentary', () => {
    const call = file('bbc-basic', '10 CALL &1900,A%,');
    expect(signatureHelpAt(call, call.content.length)).toMatchObject({ activeSignature: 1, signatures: [expect.objectContaining({ signature: 'CALL address' }), expect.objectContaining({ signature: 'CALL address, variable…' })], parameter: 'variable…' });
    expect(signatureHelpAt(file('bbc-basic', '10 PRINT "CALL &1900,"'), 22)).toMatchObject({ item: { token: 'PRINT' } });
    expect(signatureHelpAt(file('bbc-basic', '10 REM SOUND 1,'), 15)).toBeUndefined();
  });
  it('provides Atom completion, signatures and labelled-branch navigation for the Atom target', () => {
    const basic = file('bbc-basic', '10 GOSUB a\n100aPLOT 13,20,');
    const completions = completionItems(basic, atom);
    expect(completions).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'PLOT' }), expect.objectContaining({ token: 'a', kind: 'symbol' })]));
    expect(completions.some((item) => item.token === 'SOUND')).toBe(false);
    expect(signatureHelpAt(basic, basic.content.length, completions)).toMatchObject({ item: { token: 'PLOT' }, activeParameter: 2, parameter: 'y' });
    expect(tokenAt(basic.content, basic.content.indexOf('PLOT') + 1)).toBe('PLOT');
    expect(sourceDefinitionAt(basic, basic.content.indexOf('a'))).toMatchObject({ token: 'a', line: 2, kind: 'label' });
    expect(sourceReferences(basic)).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'a', targetLine: 2, resolved: true })]));
  });
  it('indexes assembly labels and dynamic BASIC procedures as source definitions', () => {
    const assembly = file('6502', ' JMP draw\n.draw\n RTS');
    expect(sourceDefinitionAt(assembly, assembly.content.indexOf('draw'))).toMatchObject({ token: 'draw', line: 2, column: 2, kind: 'label' });
    const basic = file('bbc-basic', '10 PROCdraw(1)\n20 END\n100 DEF PROCdraw(colour%)');
    expect(completionItems(basic)).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'PROCdraw', parameters: ['colour%'] })]));
    expect(sourceDefinitionAt(basic, basic.content.indexOf('PROCdraw'))).toMatchObject({ line: 3, kind: 'procedure' });
  });
  it('indexes colon-delimited ARM labels without mistaking standalone instructions for symbols', () => {
    const assembly = file('arm', '_start:\n  NOP\nloop: @ spin\n  B loop');
    const symbols = completionItems(assembly).filter((candidate) => candidate.kind === 'symbol').map((candidate) => candidate.token);
    expect(symbols).toEqual(expect.arrayContaining(['_start', 'loop']));
    expect(symbols).not.toContain('NOP');
  });
  it('rejects a provider response after the document version changes', async () => {
    const session = new VersionedLanguageSession();
    let finish!: (value: string) => void;
    const first = file('6502', 'LDA #1');
    const pending = session.request(first, () => new Promise<string>((resolve) => { finish = resolve; }));
    session.open({ ...first, content: 'LDA #2' });
    finish('old result');
    await expect(pending).rejects.toBeInstanceOf(StaleLanguageResponseError);
  });
  it('rejects a provider response after another project file changes', async () => {
    const session = new VersionedLanguageSession();
    let finish!: (value: string) => void;
    const current = file('6502', 'JSR draw');
    const pending = session.request(current, () => new Promise<string>((resolve) => { finish = resolve; }), 'project-one');
    session.open(current, 'project-two');
    finish('stale project result');
    await expect(pending).rejects.toBeInstanceOf(StaleLanguageResponseError);
  });
  it('rejects an older request superseded on the same provider channel', async () => {
    const session = new VersionedLanguageSession();
    let finish!: (value: string) => void;
    const current = file('6502', 'JSR draw');
    const first = session.request(current, () => new Promise<string>((resolve) => { finish = resolve; }), 'project-one', 'hover');
    await session.request(current, () => 'new hover', 'project-one', 'hover');
    finish('old hover');
    await expect(first).rejects.toBeInstanceOf(StaleLanguageResponseError);
  });
  it('aborts providers on document, channel and explicit cancellation', async () => {
    const session = new VersionedLanguageSession();
    const current = file('6502', 'JSR draw');
    let documentSignal!: AbortSignal; let channelSignal!: AbortSignal; let explicitSignal!: AbortSignal;
    const documentRequest = session.request(current, (signal) => { documentSignal = signal; return new Promise<string>(() => undefined); }, 'project-one', 'hover');
    session.open({ ...current, content: 'JSR paint' }, 'project-two');
    expect(documentSignal.aborted).toBe(true);
    void documentRequest.catch(() => undefined);

    const firstChannel = session.request(current, (signal) => { channelSignal = signal; return new Promise<string>(() => undefined); }, 'project-three', 'completion');
    await session.request(current, () => 'new completion', 'project-three', 'completion');
    expect(channelSignal.aborted).toBe(true);
    void firstChannel.catch(() => undefined);

    const explicit = session.request(current, (signal) => { explicitSignal = signal; return new Promise<string>(() => undefined); }, 'project-three', 'definition');
    session.cancel('definition');
    expect(explicitSignal.aborted).toBe(true);
    void explicit.catch(() => undefined);
  });
  it('exposes a response identity that becomes invalid when its channel or build revision changes', async () => {
    const session = new VersionedLanguageSession();
    const current = file('6502', 'JSR draw');
    const response = await session.requestVersioned(current, () => ['draw'], 'project\0build-one', 'completion');
    expect(session.isCurrent(response.revision)).toBe(true);
    await session.requestVersioned(current, () => ['paint'], 'project\0build-one', 'completion');
    expect(session.isCurrent(response.revision)).toBe(false);
    const buildResponse = await session.requestVersioned(current, () => 'draw', 'project\0build-one', 'definition');
    session.open(current, 'project\0build-two');
    expect(session.isCurrent(buildResponse.revision)).toBe(false);
  });
});
