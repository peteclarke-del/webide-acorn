import { describe, expect, it } from 'vitest';
import { applyEditorCommand } from '../editor/editorOperations';
import { adjacentSourceBookmark, createSourceBookmark } from '../editor/sourceBookmarks';
import { nextBasicLineNumber, previewBasicRenumber } from './basicRenumber';
import { StaleLanguageResponseError, VersionedLanguageSession } from './languageService';
import { buildProjectLanguageIndex, projectCompletionItems, projectHelpForToken, projectSignatureHelpAt, resolveProjectDefinition, sourceTypeHints } from './projectLanguageService';
import { LANGUAGE_ASSISTANCE_FIXTURES, type ConformanceDimension } from './languageAssistanceConformance';

const requiredIds = ['6502', '65c02', 'bbc-basic', 'atom-basic', '8bit-c', 'arm-assembly', 'risc-os-c'];
const dimensions: ConformanceDimension[] = ['completion', 'types', 'hover', 'signature', 'target-jump', 'bookmarks', 'numbering', 'editing', 'accessibility', 'stale-response'];

describe('language assistance conformance fixtures', () => {
  it('tracks every required language and every assistance dimension without an unrecorded claim', () => {
    expect(LANGUAGE_ASSISTANCE_FIXTURES.map((fixture) => fixture.id)).toEqual(requiredIds);
    for (const fixture of LANGUAGE_ASSISTANCE_FIXTURES) for (const dimension of dimensions) {
      expect(fixture.dimensions[dimension].evidence.trim(), `${fixture.id} ${dimension}`).not.toBe('');
      if (fixture.dimensions[dimension].state === 'blocked') expect(fixture.dimensions[dimension].evidence).toMatch(/requires|not integrated/);
    }
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.completionToken))('$label executes its registered completion fixture', (fixture) => {
    const index = buildProjectLanguageIndex([fixture.file]);
    const candidates = projectCompletionItems(fixture.file, index, fixture.processor, fixture.file.content.length, fixture.target);
    expect(candidates.some((candidate) => candidate.token.toUpperCase() === fixture.completionToken!.toUpperCase())).toBe(true);
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions.hover.state === 'supported'))('$label executes its registered hover fixture', (fixture) => {
    const index = buildProjectLanguageIndex([fixture.file]);
    const help = projectHelpForToken(fixture.file, fixture.completionToken!, index, fixture.processor, fixture.target);
    expect(help?.detail, `${fixture.id} hover detail`).toBeTruthy();
    expect(help?.signature, `${fixture.id} hover signature`).toBeTruthy();
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions.signature.state === 'supported'))('$label executes its registered signature fixture', (fixture) => {
    expect(fixture.signature, `${fixture.id} signature fixture`).toBeDefined();
    const source = { ...fixture.file, content: fixture.signature!.source };
    const help = projectSignatureHelpAt(source, source.content.length, buildProjectLanguageIndex([source]), fixture.processor, fixture.target);
    expect(help?.item.token.toUpperCase()).toBe(fixture.signature!.token.toUpperCase());
    expect(help?.signatures.length).toBeGreaterThan(0);
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions['target-jump'].state === 'supported'))('$label resolves its registered source jump', (fixture) => {
    expect(fixture.navigation, `${fixture.id} navigation fixture`).toBeDefined();
    const source = { ...fixture.file, content: fixture.navigation!.source };
    const occurrence = fixture.navigation!.occurrence === 'last' ? source.content.lastIndexOf(fixture.navigation!.reference) : source.content.indexOf(fixture.navigation!.reference);
    const position = occurrence + 1;
    const result = resolveProjectDefinition(source, position, buildProjectLanguageIndex([source]));
    expect(result.status).toBe('resolved');
    expect(result.candidates[0]?.line).toBe(fixture.navigation!.declarationLine);
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions.types.state === 'supported'))('$label returns an authoritative registered type hint', (fixture) => {
    expect(fixture.typeHint, `${fixture.id} type fixture`).toBeDefined();
    const source = { ...fixture.file, content: fixture.typeHint!.source };
    expect(sourceTypeHints(source, fixture.target).map((hint) => hint.token)).toContain(fixture.typeHint!.token);
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions.bookmarks.state === 'supported'))('$label anchors and navigates its language-neutral bookmark', (fixture) => {
    const bookmark = createSourceBookmark(fixture.file, 1, 1, `${fixture.label} entry`);
    expect(bookmark.anchor).toBe(fixture.file.content.split('\n')[0]!.trim());
    expect(adjacentSourceBookmark([bookmark], [fixture.file], fixture.file.id, 1, 1)?.id).toBe(bookmark.id);
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions.numbering.state === 'supported'))('$label executes numbering and reference-safe renumbering', () => {
    expect(nextBasicLineNumber('10 GOTO 30\n\n30 END', 2, { start: 10, increment: 10 })).toMatchObject({ number: 20, strategy: 'increment' });
    expect(previewBasicRenumber('10 GOTO 30\n30 END', { start: 100, increment: 10 })).toMatchObject({ content: '100 GOTO 110\n110 END', updatedReferences: 1, errors: [] });
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions.editing.state === 'supported'))('$label executes a reversible language-aware edit', (fixture) => {
    const source = fixture.file.language === 'c' ? 'int value;' : fixture.file.language === 'bbc-basic' ? '10 PRINT "READY"' : fixture.file.language === 'arm' ? ' MOV R0,R1' : ' LDA #1';
    const commented = applyEditorCommand(source, { start: 0, end: source.length }, 'toggle-comment', fixture.file.language);
    expect(commented.content).not.toBe(source);
    expect(applyEditorCommand(commented.content, commented, 'toggle-comment', fixture.file.language).content).toBe(source);
  });

  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions['stale-response'].state === 'supported'))('$label rejects a stale provider response', async (fixture) => {
    const session = new VersionedLanguageSession();
    let finish!: (value: string) => void;
    const pending = session.request(fixture.file, () => new Promise<string>((resolve) => { finish = resolve; }), 'project-one', 'completion');
    session.open({ ...fixture.file, content: `${fixture.file.content} ` }, 'project-two');
    finish('old result');
    await expect(pending).rejects.toBeInstanceOf(StaleLanguageResponseError);
  });
});
