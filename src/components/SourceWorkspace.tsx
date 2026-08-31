import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProjectFile, SourceBookmark } from '../project/project';
import type { Processor } from '../analysis/types';
import { Icon } from './Icon';
import { StaleLanguageResponseError, tokenAt, VersionedLanguageSession, type LanguageItem, type LanguageRequestRevision, type SignatureHelp } from '../language/languageService';
import { basicNavigationModel, buildProjectLanguageIndex, findProjectReferences, projectCallHierarchyAt, projectCompletionItems, projectHelpForToken, projectSignatureHelpAt, projectSourceReferences, projectTokensWithHelp, resolveProjectDefinition, resolveProjectRelationship, sdkDocumentForToken, sdkDocumentTargetAt, sourceTypeHints, type ProjectCallHierarchyResult, type ProjectReferenceResult, type ProjectRelationshipKind, type ProjectSourceReference, type ProjectSymbol } from '../language/projectLanguageService';
import { languageAdapterFor, type OutlineNode } from '../language/languageAdapter';
import { nextBasicLineNumber, previewBasicRenumber, previewBasicRenumberRange, type BasicRenumberPreview } from '../language/basicRenumber';
import { languageTargetRevision, type LanguageTargetContext } from '../language/languageTarget';
import { applyEditorCommand, editorCopyRange, editorCut, replaceEditorSelection, type EditorCommand, type EditorEdit, type EditorSelection } from '../editor/editorOperations';
import { adjacentSourceBookmark, orderedSourceBookmarks } from '../editor/sourceBookmarks';
import { LARGE_SOURCE_WARNING_BYTES, sourceUtf8ByteLength, type SourceEncoding, type SourceLineEnding } from '../editor/sourceTextFormat';
import { commitCharactersFor, completionContextAt, rankCompletionItems } from '../language/completionModel';
import { previewProjectRename, type ProjectRenameFileChange, type ProjectRenamePreview } from '../language/projectRename';
import { convertNumber, type NumberWidth } from '../editor/numberConverter';
import { inlayHintRail } from '../editor/inlayHintRail';
import { DEFAULT_EDITOR_PREFERENCES, readEditorPreferences, writeEditorPreferences } from '../editor/editorPreferences';
import { clipboardFailureMessage, readPlainTextClipboard, writePlainTextClipboard } from '../editor/plainTextClipboard';
import { sourceLineDiff } from '../editor/sourceDiff';
import { readBasicNumberingPreferences, writeBasicNumberingPreferences, type BasicNumberingDialect } from '../editor/basicNumberingPreferences';
import { adjacentSourcePoint, enclosingSourceRange, type SourcePoint } from '../editor/sourceNavigation';
import { previewMissingBasicLineNumber, type BasicLineNumberFixPreview } from '../language/basicQuickFix';
import { ariaKeyShortcuts, chordFromEvent, keyBindingLookup, resolveKeyBindings, type ResolvedKeyBinding } from '../commands/keyBindings';

interface EditorHistoryEntry { before: string; after: string; beforeSelection: EditorSelection; afterSelection: EditorSelection; label: string }
interface EditorCommandHistory { undo: EditorHistoryEntry[]; redo: EditorHistoryEntry[] }

interface SourceWorkspaceProps {
  files: ProjectFile[];
  projectFiles?: ProjectFile[];
  processor?: Processor;
  languageTarget?: LanguageTargetContext;
  languageBuildRevision?: string;
  activeFileId: string;
  onSelectFile: (id: string) => void;
  onChange: (id: string, content: string) => void;
  onChangeFiles?: (changes: Array<{ id: string; content: string }>) => void;
  onChangeTextFormat?: (id: string, encoding: SourceEncoding, lineEnding: SourceLineEnding) => void;
  onNewFile: () => void;
  onRenameFile: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onSave: () => void;
  onSaveAll?: () => void;
  onRevert?: (id: string) => boolean;
  onCloseFile?: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseAll?: () => void;
  onReopenClosed?: () => void;
  onNavigateSource?: (fileId: string, line: number, column?: number, length?: number) => void;
  onResearch?: (language: 'bbc-basic' | '6502' | 'arm' | 'c', query: string) => void;
  onOpenGeneratedSymbol?: (token: string) => void;
  onOpenSdkDocument?: (path: string, token?: string) => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  paneId?: 'primary' | 'secondary';
  activePane?: boolean;
  splitOpen?: boolean;
  onActivatePane?: () => void;
  onRequestSplit?: (fileId: string) => void;
  onCloseSplit?: () => void;
  canReopenClosed?: boolean;
  onCaretChange: (line: number, column: number, selectionLength?: number, scrollTop?: number) => void;
  onNotice: (message: string) => void;
  breakpoints?: number[];
  onToggleBreakpoint?: (line: number) => void;
  bookmarks?: SourceBookmark[];
  onAddBookmark?: (fileId: string, line: number, column: number, name: string) => void;
  onUpdateBookmark?: (id: string, changes: Partial<Pick<SourceBookmark, 'name' | 'description' | 'scope' | 'enabled' | 'line' | 'column' | 'anchor' | 'orphaned'>>) => void;
  onRemoveBookmark?: (id: string) => void;
  jump?: { fileId: string; line: number; column?: number; length?: number; scrollTop?: number; sequence: number; paneId?: 'primary' | 'secondary' };
  command?: { type: 'find'; sequence: number };
  keyBindings?: readonly ResolvedKeyBinding[];
  inactive?: boolean;
}

export function SourceWorkspace({
  files, projectFiles = files, processor = '6502', languageTarget, languageBuildRevision = 'no-build', activeFileId, onSelectFile, onChange, onChangeFiles, onChangeTextFormat, onNewFile, onRenameFile,
  onDeleteFile, onDownloadFile, onSave, onSaveAll, onRevert, onCloseFile, onCloseOthers, onCloseAll, onReopenClosed, canReopenClosed = false, onCaretChange, onNotice,
  onNavigateSource, onResearch, onOpenGeneratedSymbol, onOpenSdkDocument, canNavigateBack = false, canNavigateForward = false, onNavigateBack, onNavigateForward, breakpoints = [], onToggleBreakpoint,
  paneId = 'primary', activePane = true, splitOpen = false, onActivatePane, onRequestSplit, onCloseSplit,
  bookmarks = [], onAddBookmark, onUpdateBookmark, onRemoveBookmark,
  jump, command, keyBindings, inactive = false,
}: SourceWorkspaceProps) {
  const file = files.find((candidate) => candidate.id === activeFileId) ?? files[0]!;
  const numberingDialect: BasicNumberingDialect = languageTarget?.machineId === 'atom' ? 'atom' : 'bbc';
  const resolvedEditorBindings = useMemo(() => keyBindings ?? resolveKeyBindings(), [keyBindings]);
  const editorKeyLookup = useMemo(() => keyBindingLookup(resolvedEditorBindings, 'editor'), [resolvedEditorBindings]);
  /* The advertised shortcut list is generated from what is dispatched, so a
   * remapped or unbound chord cannot be announced to assistive technology. */
  const editorAriaKeyShortcuts = useMemo(() => ariaKeyShortcuts(resolvedEditorBindings, 'editor'), [resolvedEditorBindings]);
  const initialNumbering = useMemo(() => readBasicNumberingPreferences(numberingDialect), []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const hintRailRef = useRef<HTMLDivElement>(null);
  const languageSessionRef = useRef(new VersionedLanguageSession());
  const completionRevisionRef = useRef<LanguageRequestRevision | undefined>(undefined);
  const activeFileRef = useRef(file);
  const pasteContextRef = useRef<{ fileId: string; content: string; selection: EditorSelection }>({ fileId: file.id, content: file.content, selection: { start: 0, end: 0 } });
  activeFileRef.current = file;
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionCandidates, setCompletionCandidates] = useState<LanguageItem[]>([]);
  const [completionPrefix, setCompletionPrefix] = useState('');
  const [completionRange, setCompletionRange] = useState<EditorSelection>({ start: 0, end: 0 });
  const [completionIndex, setCompletionIndex] = useState(0);
  const [bookmarkSearch, setBookmarkSearch] = useState('');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [caretLineNumber, setCaretLineNumber] = useState(1);
  const [caretPosition, setCaretPosition] = useState(0);
  const [activeHelp, setActiveHelp] = useState<LanguageItem>();
  const [hoverHelp, setHoverHelp] = useState<LanguageItem>();
  const [signatureHelp, setSignatureHelp] = useState<SignatureHelp>();
  const [autoNumber, setAutoNumber] = useState(initialNumbering.enabled);
  const [basicStart, setBasicStart] = useState(String(initialNumbering.start));
  const [basicIncrement, setBasicIncrement] = useState(String(initialNumbering.increment));
  const [renumberScope, setRenumberScope] = useState<'program' | 'range'>('program');
  const [renumberRangeStart, setRenumberRangeStart] = useState('1');
  const [renumberRangeEnd, setRenumberRangeEnd] = useState(String(file.content.split('\n').length));
  const [renumberPreview, setRenumberPreview] = useState<{ baseContent: string; result: BasicRenumberPreview }>();
  const [renumberUndo, setRenumberUndo] = useState<{ fileId: string; content: string }>();
  const [commandHistory, setCommandHistory] = useState<Record<string, EditorCommandHistory>>({});
  const [pasteFallbackOpen, setPasteFallbackOpen] = useState(false);
  const [pasteFallbackText, setPasteFallbackText] = useState('');
  const [pasteFallbackReason, setPasteFallbackReason] = useState('');
  const [definitionChoices, setDefinitionChoices] = useState<{ token: string; reason: string; candidates: ProjectSymbol[] }>();
  const [showTypeHints, setShowTypeHints] = useState(false);
  const [referenceResult, setReferenceResult] = useState<ProjectReferenceResult>();
  const [callHierarchy, setCallHierarchy] = useState<ProjectCallHierarchyResult>();
  const [renameInput, setRenameInput] = useState('');
  const [renamePreview, setRenamePreview] = useState<ProjectRenamePreview>();
  const [renameUndo, setRenameUndo] = useState<ProjectRenameFileChange[]>();
  const [basicLineTarget, setBasicLineTarget] = useState('');
  const [converterInput, setConverterInput] = useState('&1900');
  const [converterBits, setConverterBits] = useState<NumberWidth>(16);
  const [editorPreferences, setEditorPreferences] = useState(readEditorPreferences);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [recentFileIds, setRecentFileIds] = useState<string[]>([file.id]);
  const [basicQuickFix, setBasicQuickFix] = useState<BasicLineNumberFixPreview>();
  const [basicQuickFixUndo, setBasicQuickFixUndo] = useState<{ fileId: string; content: string }>();

  const lines = file.content.split('\n');
  const sourceBytes = useMemo(() => sourceUtf8ByteLength(file.content), [file.content]);
  const largeSourceFile = sourceBytes > LARGE_SOURCE_WARNING_BYTES;
  const orderedBookmarks = useMemo(() => orderedSourceBookmarks(bookmarks, projectFiles), [bookmarks, projectFiles]);
  const fileBookmarks = orderedBookmarks.filter((bookmark) => bookmark.fileId === file.id);
  const filteredBookmarks = orderedBookmarks.filter((bookmark) => !bookmarkSearch.trim() || `${bookmark.name} ${bookmark.description} ${bookmark.scope} ${projectFiles.find((candidate) => candidate.id === bookmark.fileId)?.name ?? ''} ${bookmark.line}`.toLowerCase().includes(bookmarkSearch.trim().toLowerCase()));
  const projectIndex = useMemo(() => buildProjectLanguageIndex(projectFiles), [projectFiles]);
  const filteredProjectSymbols = useMemo(() => {
    const terms = symbolSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return projectIndex.symbols
      .filter((symbol) => {
        const haystack = `${symbol.token} ${symbol.signature} ${symbol.kind} ${symbol.fileName}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) => left.token.localeCompare(right.token) || left.fileName.localeCompare(right.fileName) || left.line - right.line)
      .slice(0, 200);
  }, [projectIndex, symbolSearch]);
  const effectiveProcessor = languageTarget?.processor ?? processor;
  const targetRevision = languageTarget ? languageTargetRevision(languageTarget) : `cpu:${effectiveProcessor}`;
  const languageRevision = `${projectIndex.revisionKey}\0target:${targetRevision}\0build:${languageBuildRevision}`;
  const suggestions = useMemo(() => rankCompletionItems(completionCandidates, completionPrefix, file.id), [completionCandidates, completionPrefix, file.id]);
  /* The outline and the single-file diagnostics come from the registered
   * language adapter where there is one. A language with no adapter keeps the
   * older flat scan, which is honest about being less than an adapter rather
   * than an empty panel pretending to be one. */
  const adapter = useMemo(() => languageAdapterFor(file), [file]);
  const outline = useMemo(() => largeSourceFile ? [] : adapter ? flattenOutline(adapter.outline(file)) : sourceOutline(file), [adapter, file, largeSourceFile]);
  const documentIssues = useMemo(() => largeSourceFile || !adapter ? [] : adapter.diagnostics(file), [adapter, file, largeSourceFile]);
  const basicNavigation = useMemo(() => basicNavigationModel(file, projectIndex, languageTarget?.machineId === 'atom'), [file, projectIndex, languageTarget?.machineId]);
  const references = useMemo(() => file.language === 'bbc-basic' ? basicNavigation.references : projectSourceReferences(file, projectIndex), [file, projectIndex, basicNavigation.references]);
  const lineHelp = useMemo(() => projectTokensWithHelp(file, caretLineNumber, projectIndex, effectiveProcessor, languageTarget), [file, caretLineNumber, effectiveProcessor, languageTarget, projectIndex]);
  const typeHints = useMemo(() => largeSourceFile ? [] : sourceTypeHints(file, languageTarget), [file, languageTarget, largeSourceFile]);
  const hintRail = useMemo(
    () => inlayHintRail(typeHints, { enabled: editorPreferences.inlayHints, wordWrap: editorPreferences.wordWrap, paused: largeSourceFile }),
    [typeHints, editorPreferences.inlayHints, editorPreferences.wordWrap, largeSourceFile],
  );
  const numberConversion = useMemo(() => convertNumber(converterInput, converterBits, file.language === 'arm' ? 'arm' : effectiveProcessor), [converterBits, converterInput, effectiveProcessor, file.language]);
  const basicDialectLabel = languageTarget?.machineId === 'atom' ? 'atom-basic' : 'bbc-basic';
  const displayedHelp = hoverHelp ?? activeHelp;
  const supportsFormatting = file.language === 'bbc-basic' || file.language === '6502';
  const supportsLineComments = file.language !== 'text';
  const canRevertContent = file.saved !== false && file.content !== (file.savedContent ?? file.content);
  const isReadOnly = file.access === 'read-only' || file.kind === 'generated';
  const comparison = useMemo(() => sourceLineDiff(file.savedContent ?? '', file.content), [file.content, file.savedContent]);
  const enclosingRange = useMemo(() => enclosingSourceRange(file, caretPosition), [file, caretPosition]);
  const currentScope = useMemo(() => [...outline].reverse().find((item) => item.line <= caretLineNumber && !item.label.startsWith('Line ')), [caretLineNumber, outline]);
  const changePoints = useMemo<SourcePoint[]>(() => Array.from(new Set(comparison.rows.filter((row) => row.kind !== 'unchanged' && row.afterLine !== undefined).map((row) => row.afterLine!))).map((line) => ({ line, column: 1 })), [comparison.rows]);
  const diagnosticPoints = useMemo<SourcePoint[]>(() => basicNavigation.diagnostics.map(({ line, column }) => ({ line, column })), [basicNavigation.diagnostics]);

  const updateCaret = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const position = textarea.selectionStart;
    setCaretPosition(position);
    const before = file.content.slice(0, textarea.selectionStart);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    setCaretLineNumber(line);
    onCaretChange(line, column, textarea.selectionEnd - textarea.selectionStart, textarea.scrollTop);
    void languageSessionRef.current.request(file, () => ({
      help: projectHelpForToken(file, tokenAt(file.content, position), projectIndex, effectiveProcessor, languageTarget),
      signature: projectSignatureHelpAt(file, position, projectIndex, effectiveProcessor, languageTarget),
    }), languageRevision, 'caret').then((result) => { setActiveHelp(result.help); setSignatureHelp(result.signature); })
      .catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`Language help failed: ${String(error)}`); });
  };

  const selectRange = (start: number, end = start, scrollTop?: number) => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
      if (scrollTop !== undefined && textareaRef.current) textareaRef.current.scrollTop = scrollTop;
      updateCaret();
    });
  };

  const replaceRange = (start: number, end: number, value: string) => {
    if (isReadOnly) { onNotice(`${file.name} is read-only${file.generator ? ` and generated by ${file.generator}` : ''}; source was not changed`); return; }
    const next = `${file.content.slice(0, start)}${value}${file.content.slice(end)}`;
    setRenumberPreview(undefined); setRenumberUndo(undefined);
    setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } }));
    onChange(file.id, next);
    selectRange(start + value.length);
  };

  const currentLine = () => {
    const position = textareaRef.current?.selectionStart ?? 0;
    return file.content.slice(0, position).split('\n').length;
  };

  const toggleBookmark = () => {
    const line = currentLine();
    const existing = fileBookmarks.find((bookmark) => bookmark.line === line);
    if (existing) { onRemoveBookmark?.(existing.id); onNotice(`Bookmark “${existing.name}” removed from ${file.name}:${line}`); return; }
    const requested = window.prompt('Bookmark name:', `${file.name}:${line}`);
    if (requested === null || !requested.trim()) return;
    const before = file.content.slice(0, textareaRef.current?.selectionStart ?? 0);
    const column = before.length - before.lastIndexOf('\n');
    onAddBookmark?.(file.id, line, column, requested.trim());
    onNotice(`Bookmark “${requested.trim()}” added at ${file.name}:${line}`);
  };

  const navigateBookmark = (bookmark: SourceBookmark) => {
    if (onNavigateSource) onNavigateSource(bookmark.fileId, bookmark.line, bookmark.column);
    else if (bookmark.fileId === file.id) goToLine(bookmark.line);
    onNotice(`Bookmark “${bookmark.name}” · ${bookmark.scope} · ${projectFiles.find((candidate) => candidate.id === bookmark.fileId)?.name ?? bookmark.fileId}:${bookmark.line}${bookmark.orphaned ? ' · orphaned candidate; use Recover here to reattach it' : ''}${bookmark.description ? ` · ${bookmark.description}` : ''}`);
  };

  const navigateAdjacentBookmark = (direction: 1 | -1) => {
    const bookmark = adjacentSourceBookmark(bookmarks, projectFiles, file.id, currentLine(), direction);
    if (bookmark) navigateBookmark(bookmark); else onNotice('No enabled source bookmarks are available');
  };

  const navigateProjectSymbol = (symbol: ProjectSymbol) => {
    if (onNavigateSource) onNavigateSource(symbol.fileId, symbol.line, symbol.column, symbol.length);
    else if (symbol.fileId === file.id) navigateSourcePosition(symbol.fileId, symbol.line, symbol.column, symbol.length);
    else onSelectFile(symbol.fileId);
    onNotice(`Symbol ${symbol.token} · ${symbol.fileName}:${symbol.line}:${symbol.column}`);
  };

  const renameBookmark = (bookmark: SourceBookmark) => {
    const requested = window.prompt('Rename bookmark:', bookmark.name);
    if (requested === null || !requested.trim() || requested.trim() === bookmark.name) return;
    onUpdateBookmark?.(bookmark.id, { name: requested.trim() }); onNotice(`Bookmark renamed to “${requested.trim()}”`);
  };

  const editBookmarkDescription = (bookmark: SourceBookmark) => {
    const requested = window.prompt('Bookmark description (optional, up to 1000 characters):', bookmark.description);
    if (requested === null || requested.trim() === bookmark.description) return;
    onUpdateBookmark?.(bookmark.id, { description: requested.trim().slice(0, 1000) });
    onNotice(requested.trim() ? `Description updated for “${bookmark.name}”` : `Description cleared for “${bookmark.name}”`);
  };

  const recoverBookmark = (bookmark: SourceBookmark) => {
    if (bookmark.fileId !== file.id) { navigateBookmark(bookmark); return; }
    const line = currentLine(); const source = file.content.split('\n')[line - 1] ?? '';
    const before = file.content.slice(0, textareaRef.current?.selectionStart ?? 0); const column = before.length - before.lastIndexOf('\n');
    onUpdateBookmark?.(bookmark.id, { line, column, anchor: source.trim().slice(0, 240), orphaned: false, enabled: true });
    onNotice(`Bookmark “${bookmark.name}” recovered at ${file.name}:${line}`);
  };

  const goToLine = (line: number) => {
    const start = lineStart(file.content, line);
    selectRange(start, Math.min(file.content.length, start + (lines[line - 1]?.length ?? 0)));
  };

  const navigateSourcePosition = (fileId: string, line: number, column = 1, length = 0) => {
    if (onNavigateSource) onNavigateSource(fileId, line, column, length || undefined);
    else if (fileId === file.id) {
      const start = lineStart(file.content, line) + Math.max(0, column - 1);
      selectRange(start, start + length);
    }
  };

  const navigateReferenceSource = (reference: ProjectSourceReference) => {
    navigateSourcePosition(file.id, reference.fromLine, reference.fromColumn, reference.length);
    onNotice(`Reference ${reference.label} at ${file.name}:${reference.fromLine}:${reference.fromColumn}`);
  };

  const navigateReferenceTarget = (reference: ProjectSourceReference) => {
    if (reference.status === 'ambiguous' && reference.candidates) { setDefinitionChoices({ token: reference.target, reason: reference.reason, candidates: reference.candidates }); onNotice(reference.reason); return; }
    if (reference.status !== 'resolved' || !reference.targetFileId || !reference.targetLine) { onNotice(reference.reason); return; }
    navigateSourcePosition(reference.targetFileId, reference.targetLine, reference.targetColumn, reference.targetLength);
    onNotice(`${reference.label} → ${reference.targetFileName}:${reference.targetLine}`);
  };

  const referenceAtPosition = (position: number) => {
    const before = file.content.slice(0, position);
    const line = before.split('\n').length;
    const lineStartOffset = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
    const column = position - lineStartOffset + 1;
    return references.find((reference) => reference.fromLine === line && column >= reference.fromColumn && column <= reference.fromColumn + reference.length);
  };

  const navigateAdjacentReference = (direction: 1 | -1) => {
    if (!references.length) { onNotice(`No ${file.language === 'bbc-basic' ? 'BASIC line' : 'source'} references are available`); return; }
    const position = textareaRef.current?.selectionStart ?? 0;
    const line = file.content.slice(0, position).split('\n').length;
    const lineOffset = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
    const column = position - lineOffset + 1;
    const ordered = [...references].sort((left, right) => left.fromLine - right.fromLine || left.fromColumn - right.fromColumn);
    const candidate = direction > 0
      ? ordered.find((reference) => reference.fromLine > line || (reference.fromLine === line && reference.fromColumn > column)) ?? ordered[0]!
      : [...ordered].reverse().find((reference) => reference.fromLine < line || (reference.fromLine === line && reference.fromColumn < column)) ?? ordered.at(-1)!;
    navigateReferenceSource(candidate);
  };

  const navigateAdjacentPoint = (points: SourcePoint[], direction: 1 | -1, label: string) => {
    const position = textareaRef.current?.selectionStart ?? 0;
    const line = file.content.slice(0, position).split('\n').length;
    const lineOffset = file.content.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
    const column = position - lineOffset + 1;
    const candidate = adjacentSourcePoint(points, { line, column }, direction);
    if (!candidate) { onNotice(`No ${label} locations are available for ${file.name}`); return; }
    navigateSourcePosition(file.id, candidate.line, candidate.column, 1);
    onNotice(`${direction > 0 ? 'Next' : 'Previous'} ${label} at ${file.name}:${candidate.line}:${candidate.column}`);
  };

  const navigateEnclosingRange = (edge: 'start' | 'end') => {
    if (!enclosingRange) { onNotice(`No matched bracket or BASIC loop encloses the caret in ${file.name}`); return; }
    const position = edge === 'start' ? enclosingRange.start : enclosingRange.end;
    selectRange(position, position + 1);
    onNotice(`${enclosingRange.label} ${edge} at ${file.name}:${edge === 'start' ? enclosingRange.startLine : enclosingRange.endLine}`);
  };

  const previewBasicQuickFix = (physicalLine: number) => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; quick fix is unavailable`); return; }
    const preview = previewMissingBasicLineNumber(file.content, physicalLine, basicNumberingOptions());
    setBasicQuickFix(preview);
    onNotice(preview.errors.length ? `Quick fix blocked: ${preview.errors[0]}` : `Quick fix preview: insert BASIC line ${preview.number} at physical line ${physicalLine}`);
  };

  const applyBasicQuickFix = () => {
    if (!basicQuickFix || basicQuickFix.errors.length || !basicQuickFix.changed) return;
    if (isReadOnly || file.content !== basicQuickFix.before) { setBasicQuickFix(undefined); onNotice('Quick fix refused because source or access changed after preview'); return; }
    setBasicQuickFixUndo({ fileId: file.id, content: file.content }); onChange(file.id, basicQuickFix.after); setBasicQuickFix(undefined);
    onNotice(`Inserted BASIC line ${basicQuickFix.number} as one quick-fix edit`);
  };

  const undoBasicQuickFix = () => {
    if (!basicQuickFixUndo || basicQuickFixUndo.fileId !== file.id || isReadOnly) return;
    onChange(file.id, basicQuickFixUndo.content); setBasicQuickFixUndo(undefined); onNotice('Undid BASIC line-number quick fix');
  };

  const goToBasicLine = () => {
    const requested = basicLineTarget.trim();
    if (!/^\d{1,5}$/.test(requested)) { onNotice('Enter a BASIC line number from 0 to 32767'); return; }
    const number = Number(requested);
    const declarations = basicNavigation.declaredLines.filter((line) => line.number === number);
    if (!declarations.length) { onNotice(`BASIC line ${number} is not declared in ${file.name}`); return; }
    if (declarations.length > 1) {
      const candidates = projectIndex.symbols.filter((symbol) => symbol.fileId === file.id && symbol.kind === 'line' && symbol.token === requested);
      setDefinitionChoices({ token: requested, reason: `Line ${number} has ${declarations.length} declarations in ${file.name}.`, candidates });
      onNotice(`Line ${number} is ambiguous; choose one of ${declarations.length} declarations`); return;
    }
    navigateSourcePosition(file.id, declarations[0]!.line, declarations[0]!.column, requested.length);
    onNotice(`BASIC line ${number} at ${file.name}:${declarations[0]!.line}`);
  };

  useEffect(() => {
    if (jump?.fileId !== file.id || (jump.paneId && jump.paneId !== paneId)) return;
    const line = lineStart(file.content, jump.line);
    const start = Math.min(file.content.length, line + Math.max(0, (jump.column ?? 1) - 1));
    selectRange(start, Math.min(file.content.length, start + (jump.length ?? (lines[jump.line - 1]?.length ?? 0))), jump.scrollTop);
  }, [jump?.sequence, jump?.fileId, jump?.line, jump?.column, jump?.length, jump?.scrollTop, jump?.paneId, paneId, file.id]);

  useEffect(() => {
    if (command?.type === 'find') setFindOpen(true);
  }, [command?.sequence, command?.type]);

  useEffect(() => {
    languageSessionRef.current.open(file, languageRevision);
  }, [file, languageRevision]);

  useEffect(() => () => languageSessionRef.current.dispose(), []);

  useEffect(() => {
    setRenumberPreview(undefined); setRenumberUndo(undefined); setCompletionOpen(false); setCompletionCandidates([]); completionRevisionRef.current = undefined;
    setBasicLineTarget(''); setRenumberScope('program'); setRenumberRangeStart('1'); setRenumberRangeEnd(String(file.content.split('\n').length));
    setActiveHelp(undefined); setHoverHelp(undefined); setSignatureHelp(undefined); setDefinitionChoices(undefined); setReferenceResult(undefined); setCallHierarchy(undefined); setBasicQuickFix(undefined); setBasicQuickFixUndo(undefined);
  }, [file.id]);

  useEffect(() => {
    setRecentFileIds((current) => [file.id, ...current.filter((id) => id !== file.id && projectFiles.some((candidate) => candidate.id === id))].slice(0, 10));
  }, [file.id, projectFiles]);

  useEffect(() => {
    if (!completionRevisionRef.current || !languageSessionRef.current.isCurrent(completionRevisionRef.current)) { setCompletionOpen(false); setCompletionCandidates([]); completionRevisionRef.current = undefined; }
    setSignatureHelp(undefined); setDefinitionChoices(undefined); setReferenceResult(undefined); setCallHierarchy(undefined); setRenamePreview(undefined);
    setActiveHelp((current) => current ? projectHelpForToken(file, current.token, projectIndex, effectiveProcessor, languageTarget) : undefined);
    setHoverHelp((current) => current ? projectHelpForToken(file, current.token, projectIndex, effectiveProcessor, languageTarget) : undefined);
  }, [languageRevision]);

  const editorSelection = (): EditorSelection => ({ start: textareaRef.current?.selectionStart ?? 0, end: textareaRef.current?.selectionEnd ?? 0 });

  const commitEditorEdit = (edit: EditorEdit) => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; source was not changed`); return false; }
    if (edit.content === file.content) { onNotice(`${edit.label}: nothing to change`); return false; }
    const beforeSelection = editorSelection();
    const entry: EditorHistoryEntry = { before: file.content, after: edit.content, beforeSelection, afterSelection: { start: edit.start, end: edit.end }, label: edit.label };
    setCommandHistory((current) => ({ ...current, [file.id]: { undo: [...(current[file.id]?.undo ?? []), entry].slice(-100), redo: [] } }));
    setRenumberPreview(undefined); setRenumberUndo(undefined); onChange(file.id, edit.content); selectRange(edit.start, edit.end);
    onNotice(`${edit.label} applied · Ctrl+Z to undo`); return true;
  };

  const runEditorCommand = (command: EditorCommand) => { if (isReadOnly) { onNotice(`${file.name} is read-only; editor command was not applied`); return; } commitEditorEdit(applyEditorCommand(file.content, editorSelection(), command, file.language)); };

  const revertEditor = () => {
    if (!onRevert || !canRevertContent) { onNotice(`${file.name} has no saved content changes to revert`); return; }
    if (!onRevert(file.id)) return;
    setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } }));
    setRenumberPreview(undefined); setRenumberUndo(undefined); selectRange(0);
    onNotice(`${file.name} reverted to its last explicit save · command undo history cleared`);
  };

  const undoEditorCommand = () => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; undo is unavailable`); return false; }
    const history = commandHistory[file.id];
    if (!history) return false;
    const entry = history.undo.at(-1);
    if (!entry) return false;
    if (file.content !== entry.after) { setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } })); onNotice('Command undo history cleared because the source changed'); return false; }
    setCommandHistory((current) => ({ ...current, [file.id]: { undo: history.undo.slice(0, -1), redo: [...history.redo, entry].slice(-100) } }));
    onChange(file.id, entry.before); selectRange(entry.beforeSelection.start, entry.beforeSelection.end); onNotice(`Undid ${entry.label}`); return true;
  };

  const redoEditorCommand = () => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; redo is unavailable`); return false; }
    const history = commandHistory[file.id];
    if (!history) return false;
    const entry = history.redo.at(-1);
    if (!entry) return false;
    if (file.content !== entry.before) { setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } })); onNotice('Command redo history cleared because the source changed'); return false; }
    setCommandHistory((current) => ({ ...current, [file.id]: { undo: [...history.undo, entry].slice(-100), redo: history.redo.slice(0, -1) } }));
    onChange(file.id, entry.after); selectRange(entry.afterSelection.start, entry.afterSelection.end); onNotice(`Redid ${entry.label}`); return true;
  };

  const writeClipboard = async (copied: ReturnType<typeof editorCopyRange>) => {
    try {
      await writePlainTextClipboard(copied.text); onNotice(`Copied ${copied.text.length} plain-text character${copied.text.length === 1 ? '' : 's'}`); return true;
    } catch (error) {
      const textarea = textareaRef.current;
      if (textarea) {
        const original = editorSelection(); textarea.focus(); textarea.setSelectionRange(copied.start, copied.end);
        const copiedByBrowser = typeof document.execCommand === 'function' && document.execCommand('copy'); textarea.setSelectionRange(original.start, original.end);
        if (copiedByBrowser) { onNotice(`Copied ${copied.text.length} plain-text character${copied.text.length === 1 ? '' : 's'} using the browser fallback`); return true; }
      }
      onNotice(`${clipboardFailureMessage(error)}; use Ctrl/Command+C on the visibly selected source`); return false;
    }
  };

  const copyToClipboard = async () => writeClipboard(editorCopyRange(file.content, editorSelection()));

  const cutToClipboard = async () => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; use Copy instead of Cut`); return; }
    const source = file.content; const fileId = file.id; const selection = editorSelection();
    if (!await writeClipboard(editorCopyRange(source, selection))) return;
    if (activeFileRef.current.id !== fileId || activeFileRef.current.content !== source) { onNotice('Cut cancelled because the source changed while clipboard access was pending'); return; }
    commitEditorEdit(editorCut(source, selection));
  };

  const pasteFromClipboard = async () => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; paste is unavailable`); return; }
    const context = { fileId: file.id, content: file.content, selection: editorSelection() }; pasteContextRef.current = context;
    try {
      const text = await readPlainTextClipboard();
      if (activeFileRef.current.id !== context.fileId || activeFileRef.current.content !== context.content) { onNotice('Paste cancelled because the source changed while clipboard access was pending'); return; }
      commitEditorEdit(replaceEditorSelection(context.content, context.selection, text, 'Paste plain text'));
    } catch (error) { const reason = clipboardFailureMessage(error); setPasteFallbackText(''); setPasteFallbackReason(reason); setPasteFallbackOpen(true); onNotice(`${reason}; paste into the plain-text fallback`); }
  };

  const insertFallbackPaste = () => {
    const context = pasteContextRef.current;
    if (activeFileRef.current.id !== context.fileId || activeFileRef.current.content !== context.content) { setPasteFallbackOpen(false); setPasteFallbackText(''); setPasteFallbackReason(''); onNotice('Paste cancelled because the source changed after the fallback opened'); return; }
    commitEditorEdit(replaceEditorSelection(context.content, context.selection, pasteFallbackText, 'Paste plain text')); setPasteFallbackOpen(false); setPasteFallbackText(''); setPasteFallbackReason('');
  };

  const basicNumberingOptions = () => {
    if (!basicStart.trim() || !basicIncrement.trim()) throw new Error('BASIC numbering start and increment are required');
    return { start: Number(basicStart), increment: Number(basicIncrement) };
  };

  const persistBasicNumbering = (enabled: boolean, start: string, increment: string) => {
    writeBasicNumberingPreferences(numberingDialect, { enabled, start: Number(start), increment: Number(increment) });
  };

  const createRenumberPreview = () => {
    try {
      const result = renumberScope === 'range'
        ? previewBasicRenumberRange(file.content, basicNumberingOptions(), { startPhysicalLine: Number(renumberRangeStart), endPhysicalLine: Number(renumberRangeEnd) })
        : previewBasicRenumber(file.content, basicNumberingOptions());
      setRenumberPreview({ baseContent: file.content, result });
      onNotice(result.errors.length ? `Renumber preview blocked by ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}` : `Renumber preview: ${result.mappings.length} ${renumberScope === 'range' ? 'range ' : ''}lines and ${result.updatedReferences} references`);
    } catch (error) { setRenumberPreview(undefined); onNotice(error instanceof Error ? error.message : String(error)); }
  };

  const applyRenumber = () => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; renumber was not applied`); return; }
    if (!renumberPreview || renumberPreview.result.errors.length || !renumberPreview.result.changed) return;
    if (file.content !== renumberPreview.baseContent) { setRenumberPreview(undefined); onNotice('Renumber preview is stale because the source changed; preview it again'); return; }
    setRenumberUndo({ fileId: file.id, content: file.content });
    setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } })); onChange(file.id, renumberPreview.result.content); setRenumberPreview(undefined);
    onNotice(`Renumbered ${renumberPreview.result.mappings.length} lines and updated ${renumberPreview.result.updatedReferences} references in one edit`);
  };

  const undoRenumber = () => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; renumber undo is unavailable`); return; }
    if (!renumberUndo || renumberUndo.fileId !== file.id) return;
    setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } })); onChange(file.id, renumberUndo.content); setRenumberUndo(undefined); setRenumberPreview(undefined);
    onNotice(`Undid the last renumber operation in ${file.name}`);
  };

  const findNext = (backwards = false) => {
    if (!query) return;
    const textarea = textareaRef.current;
    const haystack = matchCase ? file.content : file.content.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    const position = backwards
      ? haystack.lastIndexOf(needle, Math.max(0, (textarea?.selectionStart ?? file.content.length) - 1))
      : haystack.indexOf(needle, textarea?.selectionEnd ?? 0);
    const wrapped = position < 0 ? (backwards ? haystack.lastIndexOf(needle) : haystack.indexOf(needle)) : position;
    if (wrapped < 0) onNotice(`No match for “${query}” in ${file.name}`);
    else selectRange(wrapped, wrapped + query.length);
  };

  const replaceCurrent = () => {
    const textarea = textareaRef.current;
    if (!textarea || !query) return;
    const selected = file.content.slice(textarea.selectionStart, textarea.selectionEnd);
    const matches = matchCase ? selected === query : selected.toLowerCase() === query.toLowerCase();
    if (!matches) return findNext();
    replaceRange(textarea.selectionStart, textarea.selectionEnd, replacement);
  };

  const replaceAll = () => {
    if (isReadOnly) { onNotice(`${file.name} is read-only; replacement was not applied`); return; }
    if (!query) return;
    const expression = new RegExp(escapeRegExp(query), matchCase ? 'g' : 'gi');
    const matches = file.content.match(expression)?.length ?? 0;
    if (!matches) return onNotice(`No match for “${query}” in ${file.name}`);
    setRenumberPreview(undefined); setRenumberUndo(undefined); setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } })); onChange(file.id, file.content.replace(expression, replacement));
    onNotice(`Replaced ${matches} occurrence${matches === 1 ? '' : 's'} in ${file.name}`);
  };

  const invokeCompletion = () => {
    const position = textareaRef.current?.selectionStart ?? 0;
    const context = completionContextAt(file.content, position, file.language, languageTarget?.machineId === 'atom');
    void languageSessionRef.current.requestVersioned(file, () => ({ context, candidates: projectCompletionItems(file, projectIndex, effectiveProcessor, position, languageTarget, true) }), languageRevision, 'completion').then((response) => {
      const result = response.value; completionRevisionRef.current = response.revision;
      setCompletionCandidates(result.candidates); setCompletionPrefix(result.context.prefix); setCompletionRange({ start: result.context.start, end: result.context.end }); setCompletionIndex(0); setCompletionOpen(true);
    }).catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`Completion failed: ${String(error)}`); });
  };

  const invokeSignatureHelp = () => {
    const position = textareaRef.current?.selectionStart ?? 0;
    void languageSessionRef.current.request(file, () => projectSignatureHelpAt(file, position, projectIndex, effectiveProcessor, languageTarget), languageRevision, 'signature').then((help) => {
      setSignatureHelp(help);
      onNotice(help ? `${help.signatures[help.activeSignature]?.signature ?? help.item.signature}${help.parameter ? ` · active parameter ${help.parameter}` : ''}${help.signatures.length > 1 ? ` · ${help.signatures.length} forms` : ''}` : `No signature at the caret in ${file.name}`);
    }).catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`Signature lookup failed: ${String(error)}`); });
  };

  const selectSignatureForm = (index: number) => {
    setSignatureHelp((current) => {
      if (!current?.signatures.length) return current;
      const activeSignature = (index + current.signatures.length) % current.signatures.length;
      const parameters = current.signatures[activeSignature]?.parameters ?? [];
      const activeParameter = parameters.length ? Math.min(current.activeParameter, parameters.length - 1) : 0;
      return { ...current, activeSignature, parameters, activeParameter, parameter: parameters[activeParameter] };
    });
  };

  const acceptCompletion = (item: LanguageItem, trailing = '') => {
    if (item.available === false) {
      onNotice(item.unavailableReason ?? `${item.token} is unavailable for the selected target`);
      return;
    }
    if (!completionRevisionRef.current || !languageSessionRef.current.isCurrent(completionRevisionRef.current)) {
      setCompletionOpen(false); setCompletionCandidates([]); completionRevisionRef.current = undefined;
      onNotice('Completion was cancelled because the source, project, target or build changed');
      return;
    }
    /* A commit character is typed as well as accepting, which is the whole
     * point of it: `dr(` should leave `draw_sprite(` and not `draw_sprite`. */
    replaceRange(completionRange.start, completionRange.end, `${item.insertText ?? item.token}${trailing}`);
    setCompletionOpen(false); completionRevisionRef.current = undefined;
    onNotice(`${item.token} inserted into ${file.name}`);
  };

  const navigateToDefinition = (definition: ProjectSymbol) => {
    setDefinitionChoices(undefined);
    if (onNavigateSource) onNavigateSource(definition.fileId, definition.line, definition.column, definition.length || undefined);
    else {
      const start = lineStart(file.content, definition.line) + definition.column - 1;
      selectRange(start, start + definition.length);
    }
    onNotice(`${definition.kind} ${definition.token} at ${definition.fileName}:${definition.line}:${definition.column}`);
  };

  const goToDefinition = (position = textareaRef.current?.selectionStart ?? 0) => {
    const sdkInclude = sdkDocumentTargetAt(file, position, languageTarget);
    if (sdkInclude && onOpenSdkDocument) {
      onOpenSdkDocument(sdkInclude.path);
      onNotice(`Opening immutable SDK document ${sdkInclude.path} from ${languageTarget?.toolchainId}.`);
      return;
    }
    void languageSessionRef.current.request(file, () => resolveProjectDefinition(file, position, projectIndex), languageRevision, 'definition').then((resolution) => {
      if (resolution.status === 'resolved') { navigateToDefinition(resolution.candidates[0]!); return; }
      if (resolution.status === 'ambiguous') { setDefinitionChoices({ token: resolution.token, reason: resolution.reason, candidates: resolution.candidates }); onNotice(resolution.reason); return; }
      setDefinitionChoices(undefined);
      const generated = languageTarget?.generatedSymbols?.find((symbol) => symbol.name.toUpperCase() === resolution.token.toUpperCase());
      if (generated && onOpenGeneratedSymbol) {
        onOpenGeneratedSymbol(generated.name);
        const width = file.language === 'arm' ? 8 : 4;
        onNotice(`${generated.name} = &${generated.value.toString(16).toUpperCase().padStart(width, '0')} is supplied by the exact current build and has no editable declaration. Opened the read-only artifact symbol evidence.`);
        return;
      }
      const help = projectHelpForToken(file, resolution.token, projectIndex, effectiveProcessor, languageTarget);
      const sdkDocument = sdkDocumentForToken(file, resolution.token, languageTarget);
      if (sdkDocument && onOpenSdkDocument) {
        onOpenSdkDocument(sdkDocument.path, sdkDocument.token);
        onNotice(`Opening ${sdkDocument.token} in immutable SDK document ${sdkDocument.path}.`);
        return;
      }
      if (help?.source?.label === 'current build symbols' && onOpenGeneratedSymbol) {
        onOpenGeneratedSymbol(help.token);
        onNotice(`${help.signature} is supplied by the exact current build and has no editable declaration. Opened the read-only symbol table.`);
        return;
      }
      if (help && help.source?.kind !== 'project' && file.language !== 'text' && onResearch) {
        onResearch(file.language, help.token);
        onNotice(`${help.token} has maintained technical documentation but no editable project declaration. Opened Research.`);
        return;
      }
      onNotice(resolution.reason);
    }).catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`Definition lookup failed: ${String(error)}`); });
  };

  const findReferencesAtCaret = (position = textareaRef.current?.selectionStart ?? 0) => {
    void languageSessionRef.current.request(file, () => findProjectReferences(file, position, projectIndex), languageRevision, 'references').then((result) => {
      setReferenceResult(result);
      onNotice(result.locations.length ? `${result.locations.length} declaration/reference location${result.locations.length === 1 ? '' : 's'} for ${result.token}` : result.reason);
    }).catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`Reference lookup failed: ${String(error)}`); });
  };

  const goToRelationship = (relationship: Exclude<ProjectRelationshipKind, 'definition'>, position = textareaRef.current?.selectionStart ?? 0) => {
    void languageSessionRef.current.request(file, () => resolveProjectRelationship(file, position, projectIndex, relationship), languageRevision, `relationship-${relationship}`).then((resolution) => {
      if (resolution.status === 'resolved') { navigateToDefinition(resolution.candidates[0]!); onNotice(resolution.reason); return; }
      if (resolution.status === 'ambiguous') { setDefinitionChoices({ token: resolution.token, reason: resolution.reason, candidates: resolution.candidates }); onNotice(resolution.reason); return; }
      setDefinitionChoices(undefined); onNotice(resolution.reason);
    }).catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`${relationship.replace('-', ' ')} lookup failed: ${String(error)}`); });
  };

  const showCallHierarchyAtCaret = (position = textareaRef.current?.selectionStart ?? 0) => {
    void languageSessionRef.current.request(file, () => projectCallHierarchyAt(file, position, projectIndex), languageRevision, 'call-hierarchy').then((result) => {
      setCallHierarchy(result);
      onNotice(result.status === 'resolved' ? result.reason : `Call hierarchy unavailable: ${result.reason}`);
    }).catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`Call hierarchy failed: ${String(error)}`); });
  };

  useEffect(() => {
    setRenameInput(referenceResult?.token ?? '');
    setRenamePreview(undefined);
  }, [referenceResult?.token]);

  useEffect(() => setConverterBits(file.language === 'arm' ? 32 : 16), [file.language]);
  useEffect(() => { const preferences = readBasicNumberingPreferences(numberingDialect); setAutoNumber(preferences.enabled); setBasicStart(String(preferences.start)); setBasicIncrement(String(preferences.increment)); setRenumberPreview(undefined); }, [numberingDialect]);
  useEffect(() => { writeEditorPreferences(editorPreferences); }, [editorPreferences]);

  const createRenamePreview = () => {
    if (!referenceResult) return;
    const preview = previewProjectRename(projectFiles, projectIndex, referenceResult, renameInput);
    setRenamePreview(preview);
    onNotice(preview.errors.length ? `Rename blocked: ${preview.errors[0]}` : `Rename preview: ${preview.changes.reduce((total, change) => total + change.replacements, 0)} locations in ${preview.changes.length} files`);
  };

  const applyRename = () => {
    if (!renamePreview || renamePreview.errors.length || !renamePreview.changes.length) return;
    if (!referenceResult) { setRenamePreview(undefined); onNotice('Rename preview expired because its resolved reference set is no longer current'); return; }
    const revalidated = previewProjectRename(projectFiles, projectIndex, referenceResult, renameInput);
    const stillCurrent = !revalidated.errors.length && JSON.stringify(revalidated.changes.map(({ fileId, before, after }) => ({ fileId, before, after }))) === JSON.stringify(renamePreview.changes.map(({ fileId, before, after }) => ({ fileId, before, after })));
    if (!stillCurrent) { setRenamePreview(revalidated); onNotice('Rename preview changed because project source moved. Review the refreshed preview before applying.'); return; }
    const protectedFile = renamePreview.changes.map((change) => projectFiles.find((candidate) => candidate.id === change.fileId)).find((candidate) => candidate?.access === 'read-only' || candidate?.kind === 'generated');
    if (protectedFile) { onNotice(`Rename blocked because ${protectedFile.name} is read-only`); return; }
    const changes = renamePreview.changes.map((change) => ({ id: change.fileId, content: change.after }));
    if (onChangeFiles) onChangeFiles(changes); else changes.forEach((change) => onChange(change.id, change.content));
    setRenameUndo(renamePreview.changes);
    setReferenceResult(undefined); setRenamePreview(undefined);
    onNotice(`Renamed ${renamePreview.token} to ${renamePreview.replacement} in ${renamePreview.changes.length} files as one project update`);
  };

  const undoRename = () => {
    if (!renameUndo?.length) return;
    const protectedFile = renameUndo.map((change) => projectFiles.find((candidate) => candidate.id === change.fileId)).find((candidate) => candidate?.access === 'read-only' || candidate?.kind === 'generated');
    if (protectedFile) { onNotice(`Rename undo blocked because ${protectedFile.name} is read-only`); return; }
    const changes = renameUndo.map((change) => ({ id: change.fileId, content: change.before }));
    if (onChangeFiles) onChangeFiles(changes); else changes.forEach((change) => onChange(change.id, change.content));
    onNotice(`Undid project-wide rename in ${renameUndo.length} files`);
    setRenameUndo(undefined);
  };

  /* Editor shortcuts resolve through the same canonical binding table as the
   * workbench, so a remapped or unbound chord changes real dispatch instead of
   * only the documented label. Returning false leaves the chord to the browser. */
  const dispatchEditorBinding = (commandId: string, event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const caret = event.currentTarget.selectionStart;
    const history = commandHistory[file.id];
    const handle = (action: () => void) => { event.preventDefault(); action(); return true; };
    switch (commandId) {
      case 'editor-split-toggle': return handle(() => { if (splitOpen && paneId === 'secondary') onCloseSplit?.(); else onRequestSplit?.(file.id); });
      case 'editor-bookmark-toggle': return handle(toggleBookmark);
      case 'editor-bookmark-previous': return handle(() => navigateAdjacentBookmark(-1));
      case 'editor-bookmark-next': return handle(() => navigateAdjacentBookmark(1));
      /* With no command history left the chord belongs to the browser's own
       * text undo rather than being swallowed. */
      case 'editor-undo': return history?.undo.length ? handle(undoEditorCommand) : false;
      case 'editor-redo': return history?.redo.length ? handle(redoEditorCommand) : false;
      case 'editor-toggle-block-comment': return handle(() => { if (file.language === 'c') runEditorCommand('toggle-block-comment'); else onNotice(`${file.language} has no block-comment syntax`); });
      case 'editor-toggle-comment': return handle(() => { if (supportsLineComments) runEditorCommand('toggle-comment'); else onNotice('Plain text has no line-comment syntax'); });
      case 'editor-split-line': return handle(() => runEditorCommand('split-line'));
      case 'editor-join-lines': return handle(() => runEditorCommand('join-lines'));
      case 'editor-tabs-to-spaces': return handle(() => runEditorCommand('tabs-to-spaces'));
      case 'editor-uppercase': return handle(() => runEditorCommand('uppercase'));
      case 'editor-lowercase': return handle(() => runEditorCommand('lowercase'));
      case 'editor-trim-trailing': return handle(() => runEditorCommand('trim-trailing'));
      case 'editor-format-document': return handle(() => { if (supportsFormatting) runEditorCommand('format-document'); else onNotice(`No formatter is registered for ${file.language}`); });
      case 'editor-format-selection': return handle(() => { if (supportsFormatting) runEditorCommand('format-selection'); else onNotice(`No formatter is registered for ${file.language}`); });
      case 'editor-revert': return handle(revertEditor);
      case 'editor-duplicate-lines': return handle(() => runEditorCommand('duplicate-lines'));
      case 'editor-delete-lines': return handle(() => runEditorCommand('delete-lines'));
      case 'editor-move-lines-up': return handle(() => runEditorCommand('move-lines-up'));
      case 'editor-move-lines-down': return handle(() => runEditorCommand('move-lines-down'));
      case 'editor-navigate-back': return onNavigateBack ? handle(onNavigateBack) : false;
      case 'editor-navigate-forward': return onNavigateForward ? handle(onNavigateForward) : false;
      case 'editor-change-next': return handle(() => navigateAdjacentPoint(changePoints, 1, 'saved change'));
      case 'editor-change-previous': return handle(() => navigateAdjacentPoint(changePoints, -1, 'saved change'));
      case 'editor-diagnostic-next': return handle(() => navigateAdjacentPoint(diagnosticPoints, 1, 'diagnostic'));
      case 'editor-diagnostic-previous': return handle(() => navigateAdjacentPoint(diagnosticPoints, -1, 'diagnostic'));
      case 'editor-enclosing-start': return handle(() => navigateEnclosingRange('start'));
      case 'editor-enclosing-end': return handle(() => navigateEnclosingRange('end'));
      case 'editor-signature-help': return handle(invokeSignatureHelp);
      case 'editor-completion': return handle(invokeCompletion);
      case 'editor-save': return handle(onSave);
      case 'editor-save-all': return handle(onSaveAll ?? onSave);
      case 'editor-close': return onCloseFile ? handle(() => onCloseFile(file.id)) : false;
      case 'editor-reopen-closed': return onReopenClosed ? handle(onReopenClosed) : false;
      case 'editor-find': return handle(() => setFindOpen(true));
      case 'editor-replace': return handle(() => setFindOpen(true));
      case 'editor-call-hierarchy': return handle(() => showCallHierarchyAtCaret(caret));
      case 'editor-goto-implementation': return handle(() => goToRelationship('implementation', caret));
      case 'editor-goto-declaration': return handle(() => goToRelationship('declaration', caret));
      case 'editor-goto-type-definition': return handle(() => goToRelationship('type-definition', caret));
      case 'editor-find-references': return handle(() => findReferencesAtCaret(caret));
      case 'editor-goto-definition': return handle(() => goToDefinition(caret));
      default: return false;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const chord = chordFromEvent(event);
    const boundCommand = chord ? editorKeyLookup.get(chord) : undefined;
    if (boundCommand && dispatchEditorBinding(boundCommand, event)) return;
    if (completionOpen) {
      if (event.key === 'Escape') { event.preventDefault(); setCompletionOpen(false); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setCompletionIndex((current) => suggestions.length ? (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length : 0);
        return;
      }
      const selected = suggestions[completionIndex]?.item;
      if (selected) {
        const commits = selected.commitCharacters ?? commitCharactersFor(selected);
        if ((event.key === 'Enter' || event.key === 'Tab') && commits.includes(event.key)) {
          event.preventDefault(); acceptCompletion(selected); return;
        }
        /* Punctuation both accepts and is typed. It is only treated as a
         * commit while a candidate is actually selected; otherwise the same
         * key press has to type the character and nothing else. */
        if (event.key.length === 1 && commits.includes(event.key)) {
          event.preventDefault(); acceptCompletion(selected, event.key); return;
        }
      }
    }
    if (event.key === 'Escape' && signatureHelp) { event.preventDefault(); setSignatureHelp(undefined); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      const textarea = event.currentTarget;
      if (textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).includes('\n') || event.shiftKey) runEditorCommand(event.shiftKey ? 'outdent-lines' : 'indent-lines');
      else replaceRange(textarea.selectionStart, textarea.selectionEnd, '  ');
      return;
    }
    if (event.key === 'Enter' && file.language === 'bbc-basic' && autoNumber && !event.shiftKey) {
      const textarea = event.currentTarget;
      if (isReadOnly || textarea.selectionStart !== textarea.selectionEnd) return;
      const lineEnd = file.content.indexOf('\n', textarea.selectionStart);
      const afterCaret = file.content.slice(textarea.selectionStart, lineEnd < 0 ? file.content.length : lineEnd);
      if (!/^\s*$/.test(afterCaret)) return;
      const before = file.content.slice(0, textarea.selectionStart);
      const body = before.slice(before.lastIndexOf('\n') + 1);
      const numbered = body.match(/^\s*(\d{1,5})(?=\s|[A-Za-z*]|$)/);
      if (numbered) {
        event.preventDefault();
        try {
          const suggestion = nextBasicLineNumber(file.content, currentLine(), basicNumberingOptions());
          if (suggestion.number === undefined) { replaceRange(textarea.selectionStart, textarea.selectionEnd, '\n'); onNotice(suggestion.reason ?? 'No safe BASIC line number is available'); }
          else { replaceRange(textarea.selectionStart, textarea.selectionEnd, `\n${suggestion.number} `); if (suggestion.strategy === 'gap') onNotice(`Used free line ${suggestion.number} because the configured increment would collide; renumber for regular spacing`); }
        } catch (error) { replaceRange(textarea.selectionStart, textarea.selectionEnd, '\n'); onNotice(error instanceof Error ? error.message : String(error)); }
      }
    }
  };

  return (
    <div className={`source-workspace source-pane-${paneId}${activePane ? ' active-pane' : ''}${inactive ? ' inactive' : ''}`} aria-label={`${paneId === 'primary' ? 'Primary' : 'Secondary'} source editor pane`} aria-hidden={inactive || undefined} inert={inactive || undefined} onPointerDown={onActivatePane} onFocusCapture={onActivatePane}>
      <div className="editor-tabs" role="tablist" aria-label="Open source files">
        {files.map((candidate) => <div role="presentation" className={candidate.id === file.id ? 'editor-tab active' : 'editor-tab'} key={candidate.id}><button role="tab" aria-selected={candidate.id === file.id} type="button" onClick={() => onSelectFile(candidate.id)}><span className={candidate.language === 'bbc-basic' ? 'basic-file-dot' : 'asm-file-dot'} />{candidate.name}{(candidate.access === 'read-only' || candidate.kind === 'generated') && <span className="tab-access" aria-label="read only">RO</span>}{candidate.modified && <span className="tab-dirty" aria-label="modified">●</span>}</button>{onCloseFile && <button className="tab-close" type="button" aria-label={`Close ${candidate.name}`} title={`Close editor · ${candidate.modified ? 'unsaved content remains in the project' : 'file remains in the project'}`} onClick={() => onCloseFile(candidate.id)}><Icon name="close" size={11} /></button>}</div>)}
        <button type="button" aria-label="New source file" onClick={onNewFile}><Icon name="new" size={14} /></button>
      </div>
      <div className="editor-toolbar source-toolbar">
        <div className="breadcrumbs"><span>Local project</span><Icon name="chevron" size={12} /><strong>{file.name}</strong>{currentScope && <><Icon name="chevron" size={12} /><button type="button" onClick={() => goToLine(currentScope.line)} title={`Go to scope at line ${currentScope.line}`}>{currentScope.label}</button></>}<span className="language-badge">{file.language === 'bbc-basic' ? basicDialectLabel : file.language}</span><span className={`document-kind ${file.kind ?? 'authored'}`}>{(file.kind ?? 'authored').toUpperCase()}</span>{isReadOnly && <span className="document-access">READ ONLY</span>}</div>
        <div className="editor-tools" onClickCapture={(event) => {
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button:not(:disabled)');
          button?.closest<HTMLDetailsElement>('details.editor-command-menu')?.removeAttribute('open');
        }}>
          <details className="editor-command-menu"><summary>File</summary><div aria-label="File editor actions"><button type="button" onClick={onSave}>Save {file.name} <kbd>Ctrl S</kbd></button><button type="button" onClick={onSaveAll ?? onSave}>Save all <kbd>Ctrl ⇧ S</kbd></button><button type="button" disabled={!onRevert || !canRevertContent} onClick={revertEditor}>Revert saved content <kbd>Ctrl Alt R</kbd></button><button type="button" disabled={!onCloseFile} onClick={() => onCloseFile?.(file.id)}>Close editor <kbd>Ctrl W</kbd></button><button type="button" disabled={!onCloseOthers || files.length < 2} onClick={() => onCloseOthers?.(file.id)}>Close other editors</button><button type="button" disabled={!onCloseAll} onClick={() => onCloseAll?.()}>Close all editors</button><button type="button" disabled={!onReopenClosed || !canReopenClosed} onClick={() => onReopenClosed?.()}>Reopen closed editor <kbd>Ctrl ⇧ T</kbd></button></div></details>
          <details className="editor-command-menu"><summary>Edit</summary><div aria-label="Editor actions"><button type="button" disabled={!commandHistory[file.id]?.undo.length} onClick={undoEditorCommand}>Undo command <kbd>Ctrl Z</kbd></button><button type="button" disabled={!commandHistory[file.id]?.redo.length} onClick={redoEditorCommand}>Redo command <kbd>Ctrl Y</kbd></button><button type="button" onClick={() => void cutToClipboard()}>Cut</button><button type="button" onClick={() => void copyToClipboard()}>Copy</button><button type="button" onClick={() => void pasteFromClipboard()}>Paste plain text</button><button type="button" onClick={() => selectRange(0, file.content.length)}>Select all</button><button type="button" onClick={() => runEditorCommand('duplicate-lines')}>Duplicate lines <kbd>Ctrl ⇧ D</kbd></button><button type="button" onClick={() => runEditorCommand('delete-lines')}>Delete lines <kbd>Ctrl ⇧ K</kbd></button><button type="button" onClick={() => runEditorCommand('move-lines-up')}>Move lines up <kbd>Alt ↑</kbd></button><button type="button" onClick={() => runEditorCommand('move-lines-down')}>Move lines down <kbd>Alt ↓</kbd></button><button type="button" onClick={() => runEditorCommand('join-lines')}>Join lines <kbd>Ctrl J</kbd></button><button type="button" onClick={() => runEditorCommand('split-line')}>Split line <kbd>Ctrl ⇧ Enter</kbd></button><button type="button" onClick={() => runEditorCommand('indent-lines')}>Indent lines</button><button type="button" onClick={() => runEditorCommand('outdent-lines')}>Outdent lines</button><button type="button" onClick={() => runEditorCommand('tabs-to-spaces')}>Convert tabs to spaces <kbd>Ctrl Alt T</kbd></button><button type="button" disabled={!supportsLineComments} onClick={() => runEditorCommand('toggle-comment')}>Toggle line comment <kbd>Ctrl /</kbd></button><button type="button" disabled={file.language !== 'c'} onClick={() => runEditorCommand('toggle-block-comment')}>Toggle block comment <kbd>Ctrl ⇧ /</kbd></button><button type="button" disabled={!supportsFormatting} onClick={() => runEditorCommand('format-selection')}>Format selection <kbd>Ctrl Alt F</kbd></button><button type="button" disabled={!supportsFormatting} onClick={() => runEditorCommand('format-document')}>Format document <kbd>Alt ⇧ F</kbd></button><button type="button" onClick={() => runEditorCommand('uppercase')}>Uppercase <kbd>Ctrl Alt U</kbd></button><button type="button" onClick={() => runEditorCommand('lowercase')}>Lowercase <kbd>Ctrl Alt L</kbd></button><button type="button" onClick={() => runEditorCommand('trim-trailing')}>Trim trailing whitespace <kbd>Ctrl Alt W</kbd></button></div></details>
          <details className="editor-preferences"><summary>Preferences</summary><div><label><span>Font px</span><input aria-label="Editor font size" type="number" min={10} max={18} value={editorPreferences.fontSize} onChange={(event) => setEditorPreferences((current) => ({ ...current, fontSize: Math.max(10, Math.min(18, Number(event.target.value) || 10)), lineHeight: Math.max(current.lineHeight, Math.max(10, Math.min(18, Number(event.target.value) || 10)) + 4) }))} /></label><label><span>Line px</span><input aria-label="Editor line height" type="number" min={Math.max(16, editorPreferences.fontSize + 4)} max={36} value={editorPreferences.lineHeight} onChange={(event) => setEditorPreferences((current) => ({ ...current, lineHeight: Math.max(current.fontSize + 4, Math.min(36, Number(event.target.value) || current.fontSize + 4)) }))} /></label><label><span>Tab</span><select aria-label="Editor tab size" value={editorPreferences.tabSize} onChange={(event) => setEditorPreferences((current) => ({ ...current, tabSize: Number(event.target.value) as 2 | 4 | 8 }))}><option value={2}>2</option><option value={4}>4</option><option value={8}>8</option></select></label><label><span>Encoding</span><select aria-label={`Source encoding for ${file.name}`} value={file.encoding ?? 'utf-8'} onChange={(event) => onChangeTextFormat?.(file.id, event.target.value as SourceEncoding, file.lineEnding ?? 'lf')}><option value="utf-8">UTF-8</option><option value="utf-8-bom">UTF-8 BOM</option><option value="windows-1252">Windows-1252</option></select></label><label><span>Line endings</span><select aria-label={`Line endings for ${file.name}`} value={file.lineEnding ?? 'lf'} onChange={(event) => onChangeTextFormat?.(file.id, file.encoding ?? 'utf-8', event.target.value as SourceLineEnding)}><option value="lf">LF</option><option value="crlf">CRLF</option><option value="cr">CR</option></select></label><label><input aria-label="Editor word wrap" type="checkbox" checked={editorPreferences.wordWrap} onChange={(event) => setEditorPreferences((current) => ({ ...current, wordWrap: event.target.checked }))} /> Wrap</label><label><input aria-label="Decorate type hints beside the source" type="checkbox" checked={editorPreferences.inlayHints} onChange={(event) => setEditorPreferences((current) => ({ ...current, inlayHints: event.target.checked }))} /> Hints</label><button type="button" onClick={() => setEditorPreferences({ ...DEFAULT_EDITOR_PREFERENCES })}>Reset view</button></div></details>
          <details className="editor-command-menu source-navigation-menu"><summary>Navigate</summary><div aria-label="Source navigation actions"><button type="button" disabled={!diagnosticPoints.length} onClick={() => navigateAdjacentPoint(diagnosticPoints, -1, 'diagnostic')}>Previous diagnostic <kbd>Shift F8</kbd></button><button type="button" disabled={!diagnosticPoints.length} onClick={() => navigateAdjacentPoint(diagnosticPoints, 1, 'diagnostic')}>Next diagnostic <kbd>F8</kbd></button><button type="button" disabled={!changePoints.length} onClick={() => navigateAdjacentPoint(changePoints, -1, 'saved change')}>Previous saved change <kbd>Alt Shift F8</kbd></button><button type="button" disabled={!changePoints.length} onClick={() => navigateAdjacentPoint(changePoints, 1, 'saved change')}>Next saved change <kbd>Alt F8</kbd></button><button type="button" disabled={!enclosingRange} title={enclosingRange ? `${enclosingRange.label}, lines ${enclosingRange.startLine} to ${enclosingRange.endLine}` : 'No matched bracket or BASIC loop encloses the caret'} onClick={() => navigateEnclosingRange('start')}>Enclosing scope start <kbd>Alt [</kbd></button><button type="button" disabled={!enclosingRange} title={enclosingRange ? `${enclosingRange.label}, lines ${enclosingRange.startLine} to ${enclosingRange.endLine}` : 'No matched bracket or BASIC loop encloses the caret'} onClick={() => navigateEnclosingRange('end')}>Enclosing scope end <kbd>Alt ]</kbd></button>{recentFileIds.map((id) => { const recent = projectFiles.find((candidate) => candidate.id === id); return recent ? <button type="button" key={id} disabled={id === file.id} onClick={() => onSelectFile(id)}>Recent: {recent.name}{id === file.id ? ' (current)' : ''}</button> : null; })}</div></details>
          <button type="button" onClick={() => setFindOpen((current) => !current)}><Icon name="search" size={14} /> Find</button>
          <button type="button" disabled={file.saved === false} aria-expanded={comparisonOpen} onClick={() => setComparisonOpen((current) => !current)}>Compare saved</button>
          <button type="button" onClick={toggleBookmark}><Icon name="bookmark" size={14} /> {fileBookmarks.some((bookmark) => bookmark.line === caretLineNumber) ? 'Remove bookmark' : 'Add bookmark'}</button>
          <button type="button" disabled={!bookmarks.some((bookmark) => bookmark.enabled && !bookmark.orphaned)} onClick={() => navigateAdjacentBookmark(-1)} title="Previous enabled source bookmark">Bookmark ↑</button>
          <button type="button" disabled={!bookmarks.some((bookmark) => bookmark.enabled && !bookmark.orphaned)} onClick={() => navigateAdjacentBookmark(1)} title="Next enabled source bookmark">Bookmark ↓</button>
          <button type="button" disabled={!canNavigateBack} onClick={onNavigateBack} title="Previous source location (Alt+Left)">← Back</button>
          <button type="button" disabled={!canNavigateForward} onClick={onNavigateForward} title="Next source location (Alt+Right)">Forward →</button>
          {paneId === 'secondary' ? <button type="button" onClick={onCloseSplit} title="Close the secondary source editor (Ctrl+Backslash)">Close split</button> : <button type="button" onClick={() => onRequestSplit?.(file.id)} title="Open a second independently navigable source editor (Ctrl+Backslash)">{splitOpen ? 'Reset split' : 'Split editor'}</button>}
          <button type="button" onClick={() => goToDefinition()} title="Go to an editable definition or open maintained technical research at the caret (F12)">Definition / Research</button>
          <button type="button" onClick={() => goToRelationship('declaration')} title="Open the separately parsed declaration when available (Ctrl+F12)">Declaration</button>
          <button type="button" onClick={() => goToRelationship('implementation')} title="Open the separately parsed implementation when available (Ctrl+Shift+F12)">Implementation</button>
          <button type="button" onClick={() => goToRelationship('type-definition')} title="Open a connected C typedef or tagged type (Alt+F12)">Type definition</button>
          <button type="button" onClick={() => findReferencesAtCaret()} title="Find declarations and references at the caret (Shift+F12)">References</button>
          <button type="button" onClick={() => showCallHierarchyAtCaret()} title="Show statically parsed callers and callees at the caret (Alt+Shift+H)">Call hierarchy</button>
          <button type="button" onClick={() => onToggleBreakpoint?.(currentLine())}><Icon name="debug" size={14} /> Breakpoint</button>
          <button type="button" onClick={invokeCompletion}>Ctrl Space</button>
          <button type="button" onClick={invokeSignatureHelp}>Ctrl ⇧ Space</button>
          <button type="button" onClick={() => onDownloadFile(file.id)}><Icon name="download" size={14} /> Download</button>
          <button type="button" onClick={() => onRenameFile(file.id)}>Rename</button>
          <button type="button" onClick={() => onDeleteFile(file.id)}>Delete</button>
        </div>
      </div>
      <div className="sticky-scope-header" aria-label="Current source scope"><span>SCOPE</span><strong>{currentScope?.label ?? 'File level'}</strong><small>{enclosingRange ? `${enclosingRange.label} · lines ${enclosingRange.startLine} to ${enclosingRange.endLine}` : 'No enclosing bracket or BASIC loop at caret'}</small><button type="button" disabled={!enclosingRange} onClick={() => navigateEnclosingRange('start')}>Start</button><button type="button" disabled={!enclosingRange} onClick={() => navigateEnclosingRange('end')}>End</button></div>
      {pasteFallbackOpen && <div className="paste-fallback" role="dialog" aria-modal="false" aria-labelledby="paste-fallback-title"><div><strong id="paste-fallback-title">Paste plain text</strong><span>{pasteFallbackReason}. Paste ordinary text here, then insert it unchanged at the captured source selection. Markup is never interpreted or executed.</span></div><textarea autoFocus aria-label="Plain-text paste fallback" value={pasteFallbackText} onChange={(event) => setPasteFallbackText(event.target.value)} /><button type="button" disabled={!pasteFallbackText} onClick={insertFallbackPaste}>Insert text</button><button type="button" onClick={() => { setPasteFallbackOpen(false); setPasteFallbackText(''); setPasteFallbackReason(''); textareaRef.current?.focus(); }}>Cancel</button></div>}
      {file.language === 'bbc-basic' && <div className="basic-numbering" aria-label={`${languageTarget?.machineId === 'atom' ? 'Atom' : 'BBC'} BASIC numbering tools`}>
        <label className="basic-auto"><input type="checkbox" checked={autoNumber} disabled={isReadOnly} onChange={(event) => { setAutoNumber(event.target.checked); persistBasicNumbering(event.target.checked, basicStart, basicIncrement); }} /><span>Auto number after Enter</span></label>
        <label><span>Start</span><input aria-label="BASIC numbering start" inputMode="numeric" disabled={isReadOnly} value={basicStart} onChange={(event) => { setBasicStart(event.target.value); persistBasicNumbering(autoNumber, event.target.value, basicIncrement); setRenumberPreview(undefined); }} /></label>
        <label><span>Increment</span><input aria-label="BASIC numbering increment" inputMode="numeric" disabled={isReadOnly} value={basicIncrement} onChange={(event) => { setBasicIncrement(event.target.value); persistBasicNumbering(autoNumber, basicStart, event.target.value); setRenumberPreview(undefined); }} /></label>
        <label><span>Scope</span><select aria-label="BASIC renumber scope" disabled={isReadOnly} value={renumberScope} onChange={(event) => { setRenumberScope(event.target.value as 'program' | 'range'); setRenumberPreview(undefined); }}><option value="program">Whole program</option><option value="range">Physical line range</option></select></label>
        {renumberScope === 'range' && <><label><span>From row</span><input aria-label="BASIC renumber first physical line" inputMode="numeric" disabled={isReadOnly} value={renumberRangeStart} onChange={(event) => { setRenumberRangeStart(event.target.value); setRenumberPreview(undefined); }} /></label><label><span>To row</span><input aria-label="BASIC renumber last physical line" inputMode="numeric" disabled={isReadOnly} value={renumberRangeEnd} onChange={(event) => { setRenumberRangeEnd(event.target.value); setRenumberPreview(undefined); }} /></label></>}
        <button type="button" disabled={isReadOnly} onClick={createRenumberPreview}>Preview renumber</button><button type="button" disabled={isReadOnly || !renumberUndo || renumberUndo.fileId !== file.id} onClick={undoRenumber}>Undo renumber</button><small>0–32767 · {numberingDialect.toUpperCase()} preferences persist in this browser · references are previewed before one atomic edit</small>
      </div>}
      {renumberPreview && <section className="renumber-preview" aria-label="BASIC renumber preview"><div className="renumber-preview-heading"><strong>{renumberPreview.result.errors.length ? 'Renumber blocked' : `${renumberPreview.result.mappings.length} lines · ${renumberPreview.result.updatedReferences} references`}</strong><span>{renumberPreview.result.unresolvedReferences.length} unresolved target{renumberPreview.result.unresolvedReferences.length === 1 ? '' : 's'}</span><button type="button" disabled={renumberPreview.result.errors.length > 0 || !renumberPreview.result.changed} onClick={applyRenumber}>Apply renumber</button><button type="button" onClick={() => setRenumberPreview(undefined)}>Cancel</button></div>{renumberPreview.result.errors.length > 0 && <ul className="renumber-errors" role="alert">{renumberPreview.result.errors.map((error) => <li key={error}>{error}</li>)}</ul>}{renumberPreview.result.unresolvedReferences.length > 0 && <ul className="renumber-unresolved" aria-label="Unresolved BASIC line references">{renumberPreview.result.unresolvedReferences.map((reference, index) => <li key={`${reference.physicalLine}-${reference.target}-${index}`}><code>{reference.sourceLine}</code><span>{reference.command} {reference.target}</span><strong>target is not declared and will remain unchanged</strong></li>)}</ul>}<div className="renumber-map" role="table" aria-label="BASIC line-number changes"><div role="row"><span role="columnheader">Source row</span><span role="columnheader">Old</span><span role="columnheader">New</span></div>{renumberPreview.result.mappings.slice(0, 200).map((mapping) => <div role="row" key={mapping.physicalLine}><code role="cell">{mapping.physicalLine}</code><code role="cell">{mapping.from}</code><strong role="cell">{mapping.to}</strong></div>)}{renumberPreview.result.mappings.length > 200 && <small>Showing 200 of {renumberPreview.result.mappings.length} line mappings.</small>}</div></section>}
      {basicQuickFix && <section className="basic-quick-fix-preview" role="dialog" aria-modal="false" aria-label="BASIC quick fix preview"><div><strong>{basicQuickFix.errors.length ? 'Quick fix blocked' : `Insert line ${basicQuickFix.number}`}</strong><span>Physical source line {basicQuickFix.physicalLine}</span></div>{basicQuickFix.errors.length ? <p role="alert">{basicQuickFix.errors[0]}</p> : <code>{basicQuickFix.after.split('\n')[basicQuickFix.physicalLine - 1]}</code>}<button type="button" disabled={basicQuickFix.errors.length > 0 || !basicQuickFix.changed} onClick={applyBasicQuickFix}>Apply quick fix</button><button type="button" onClick={() => setBasicQuickFix(undefined)}>Cancel</button></section>}
      {findOpen && <div className="find-bar" role="search"><label><span className="visually-hidden">Find</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') findNext(event.shiftKey); }} placeholder="Find" /></label><label><span className="visually-hidden">Replace with</span><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Replace" /></label><label className="find-check"><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} /> Aa</label><button type="button" onClick={() => findNext(true)} aria-label="Previous match">↑</button><button type="button" onClick={() => findNext()} aria-label="Next match">↓</button><button type="button" onClick={replaceCurrent}>Replace</button><button type="button" onClick={replaceAll}>All</button><button type="button" onClick={() => setFindOpen(false)} aria-label="Close find and replace"><Icon name="close" size={13} /></button></div>}
      {comparisonOpen && <section className="source-comparison" role="dialog" aria-modal="false" aria-label={`Saved comparison for ${file.name}`}><header><div><strong>{file.name}</strong><span>SAVED BASELINE vs WORKING COPY</span></div><div><b>{comparison.added} added</b><b>{comparison.removed} removed</b>{!comparison.exact && <b title="The comparison uses line-aligned changes to keep large documents responsive">BOUNDED LARGE DIFF</b>}<button type="button" onClick={() => setComparisonOpen(false)} aria-label="Close saved comparison">Close</button></div></header>{comparison.added === 0 && comparison.removed === 0 ? <p>No text differences from the saved baseline. Encoding, line-ending or filename changes may still make the file dirty.</p> : <div className="source-comparison-rows" role="table" aria-label="Line differences"><div role="row" className="source-comparison-heading"><span role="columnheader">Saved</span><span role="columnheader">Working</span><span role="columnheader">Change</span><span role="columnheader">Source</span></div>{comparison.rows.map((row, index) => <button type="button" role="row" disabled={row.afterLine === undefined} onClick={() => row.afterLine && goToLine(row.afterLine)} className={row.kind} key={`${row.kind}-${row.beforeLine ?? 0}-${row.afterLine ?? 0}-${index}`}><code role="cell">{row.beforeLine ?? ''}</code><code role="cell">{row.afterLine ?? ''}</code><span role="cell">{row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '}</span><code role="cell">{row.text || ' '}</code></button>)}</div>}</section>}
      <div className="source-intelligence" aria-label="Inline language help"><div className="line-tokens"><span>LINE {caretLineNumber}</span>{lineHelp.map((item) => <button type="button" key={`${item.kind}-${item.token}-${item.source?.label ?? ''}`} title={`${item.signature ?? item.token}: ${item.detail}`} onMouseEnter={() => setHoverHelp(item)} onMouseLeave={() => setHoverHelp(undefined)} onFocus={() => setHoverHelp(item)} onBlur={() => setHoverHelp(undefined)}>{item.token}</button>)}<label className="type-hints-toggle"><input type="checkbox" checked={showTypeHints} onChange={(event) => setShowTypeHints(event.target.checked)} /> Type hints</label></div>{displayedHelp ? <TokenDefinition item={displayedHelp} onDismiss={() => { setActiveHelp(undefined); setHoverHelp(undefined); }} onSelectRelated={(token) => { const related = projectHelpForToken(file, token, projectIndex, effectiveProcessor, languageTarget); if (related) { setActiveHelp(related); setHoverHelp(undefined); } else onNotice(`No maintained ${token} help is available for the selected source and target`); }} /> : <div className="token-definition empty"><span>Place the caret on a known command, opcode, directive, MOS call, symbol or line number for contextual help.</span></div>}</div>
      {definitionChoices && <section className="definition-choices" role="dialog" aria-modal="false" aria-label={`Definitions for ${definitionChoices.token}`}><div><strong>{definitionChoices.candidates.length} definitions for {definitionChoices.token}</strong><span>{definitionChoices.reason}</span></div>{definitionChoices.candidates.map((candidate) => <button type="button" key={`${candidate.fileId}-${candidate.line}-${candidate.column}`} onClick={() => navigateToDefinition(candidate)}><span>{candidate.fileName}</span><code>{candidate.line}:{candidate.column}</code><small>{candidate.signature}</small></button>)}<button type="button" onClick={() => setDefinitionChoices(undefined)}>Cancel</button></section>}
      {referenceResult && <section className="reference-peek" role="dialog" aria-modal="false" aria-label={`References for ${referenceResult.token || 'source token'}`}><div className="reference-peek-heading"><div><strong>{referenceResult.token || 'No symbol'} · {referenceResult.locations.length} location{referenceResult.locations.length === 1 ? '' : 's'}</strong><span>{referenceResult.reason} · index {projectIndex.version}</span></div><button type="button" onClick={() => setReferenceResult(undefined)} aria-label="Close references">Close</button></div>{referenceResult.locations.length ? <div className="reference-peek-results">{referenceResult.locations.map((location, index) => { const source = projectFiles.find((candidate) => candidate.id === location.fileId)?.content.split('\n')[location.line - 1] ?? ''; return <button type="button" key={`${location.fileId}-${location.line}-${location.column}-${location.kind}-${index}`} onClick={() => onNavigateSource ? onNavigateSource(location.fileId, location.line, location.column, location.length) : location.fileId === file.id && selectRange(lineStart(file.content, location.line) + location.column - 1, lineStart(file.content, location.line) + location.column - 1 + location.length)}><span><b>{location.fileName}:{location.line}:{location.column}</b><small>{location.kind}</small></span><code>{source.trim() || ' '}</code></button>; })}</div> : <p>{referenceResult.reason}</p>}</section>}
      {callHierarchy && <section className="call-hierarchy-peek" role="dialog" aria-modal="false" aria-label={`Call hierarchy for ${callHierarchy.token || 'source token'}`}><header><div><strong>{callHierarchy.token || 'No callable symbol'}</strong><span>{callHierarchy.reason} · index {projectIndex.version}</span></div><button type="button" onClick={() => setCallHierarchy(undefined)} aria-label="Close call hierarchy">Close</button></header>{callHierarchy.status === 'resolved' ? <div className="call-hierarchy-columns">{(['incoming', 'outgoing'] as const).map((direction) => { const edges = callHierarchy[direction]; return <section key={direction}><h3>{direction === 'incoming' ? 'Incoming callers' : 'Outgoing callees'} <small>{edges.length}</small></h3>{edges.length ? edges.map((edge, index) => <article key={`${direction}-${edge.fileId}-${edge.line}-${index}`}><div><strong>{edge.caller}</strong><span>calls</span><strong>{edge.callee}</strong></div><code>{edge.fileName}:{edge.line}:{edge.column}</code><div><button type="button" onClick={() => navigateSourcePosition(edge.fileId, edge.line, edge.column, edge.length)}>Open call site</button>{edge.targetFileId && edge.targetLine && <button type="button" onClick={() => navigateSourcePosition(edge.targetFileId!, edge.targetLine!, edge.targetColumn, edge.targetLength)}>Open callee</button>}</div></article>) : <p>No statically parsed {direction === 'incoming' ? 'callers' : 'callees'}.</p>}</section>; })}</div> : <p>{callHierarchy.reason}</p>}<footer>Direct calls only. Branches, indirect calls, macro expansion and compiler-generated edges are not inferred.</footer></section>}
      {referenceResult && <section className="project-rename" aria-label={`Rename ${referenceResult.token || 'source symbol'}`}><div><label><span>Rename uniquely resolved symbol</span><input aria-label="Replacement symbol name" value={renameInput} maxLength={80} onChange={(event) => { setRenameInput(event.target.value); setRenamePreview(undefined); }} /></label><button type="button" disabled={!referenceResult.locations.length} onClick={createRenamePreview}>Preview rename</button><button type="button" disabled={!renameUndo?.length} onClick={undoRename}>Undo last rename</button></div>{renamePreview && <div className="project-rename-preview"><header><strong>{renamePreview.errors.length ? 'Rename blocked' : `${renamePreview.token} → ${renamePreview.replacement}`}</strong><span>{renamePreview.changes.reduce((total, change) => total + change.replacements, 0)} edits in {renamePreview.changes.length} files</span><button type="button" disabled={renamePreview.errors.length > 0 || !renamePreview.changes.length} onClick={applyRename}>Apply project rename</button><button type="button" onClick={() => setRenamePreview(undefined)}>Cancel</button></header>{renamePreview.errors.length > 0 ? <ul role="alert">{renamePreview.errors.map((error) => <li key={error}>{error}</li>)}</ul> : <div role="list" aria-label="Project rename file changes">{renamePreview.changes.map((change) => <div role="listitem" key={change.fileId}><strong>{change.fileName}</strong><span>{change.replacements} replacement{change.replacements === 1 ? '' : 's'}</span><code>lines {change.lines.join(', ')}</code></div>)}</div>}</div>}</section>}
      {!referenceResult && renameUndo?.length ? <div className="project-rename-undo" role="status"><span>A project-wide rename can be undone until the next rename.</span><button type="button" onClick={undoRename}>Undo last rename</button></div> : null}
      {signatureHelp && <div className="signature-help" role="status" aria-live="polite" aria-atomic="true"><span>SIGNATURE {signatureHelp.activeSignature + 1}/{signatureHelp.signatures.length}</span><code>{signatureHelp.signatures[signatureHelp.activeSignature]?.signature ?? signatureHelp.item.signature}</code><div className="signature-controls"><button type="button" disabled={signatureHelp.signatures.length < 2} onClick={() => selectSignatureForm(signatureHelp.activeSignature - 1)} aria-label="Previous signature form">↑</button><button type="button" disabled={signatureHelp.signatures.length < 2} onClick={() => selectSignatureForm(signatureHelp.activeSignature + 1)} aria-label="Next signature form">↓</button><button type="button" onClick={() => { setSignatureHelp(undefined); textareaRef.current?.focus(); }} aria-label="Dismiss signature help">×</button></div>{signatureHelp.parameters.length > 0 && <div className="signature-parameters" role="list" aria-label={`Active parameter ${signatureHelp.activeParameter + 1} of ${signatureHelp.parameters.length}`}>{signatureHelp.parameters.map((parameter, index) => <strong role="listitem" aria-current={index === signatureHelp.activeParameter ? 'true' : undefined} className={index === signatureHelp.activeParameter ? 'active' : ''} key={`${parameter}-${index}`}>{parameter}{/\[.*\]|…/.test(parameter) && <small>optional or repeated</small>}</strong>)}</div>}{signatureHelp.signatures.length > 1 && <ol className="signature-alternatives" aria-label={`${signatureHelp.item.token} alternative forms`}>{signatureHelp.signatures.map((form, index) => <li aria-current={index === signatureHelp.activeSignature ? 'true' : undefined} key={`${form.signature}-${index}`}><code>{form.signature}</code>{form.detail && <small>{form.detail}</small>}</li>)}</ol>}</div>}
      {isReadOnly && <div className="document-access-policy" role="status"><strong>{file.kind === 'generated' ? 'Generated read-only source' : 'Read-only source'}</strong><span>{file.generator ? `Generated by ${file.generator}. ` : ''}Inspect, navigate, select, copy, compare and download are available. Editing, paste, formatting, refactoring, rename, save and revert are blocked.</span></div>}
      {largeSourceFile && <div className="large-source-policy" role="status"><strong>Large source mode</strong><span>{sourceBytes.toLocaleString()} bytes. Automatic completion, outline and type-hint scans are paused. {isReadOnly ? 'Inspection, find, navigation, copy and download remain available.' : 'Manual completion, editing, find, navigation, save and download remain available.'}</span></div>}
      <div className="source-editor-layout" style={{ '--editor-font-size': `${editorPreferences.fontSize}px`, '--editor-line-height': `${editorPreferences.lineHeight}px`, '--editor-tab-size': editorPreferences.tabSize } as CSSProperties}>
        <div className="source-editor-wrap">
          <div className="source-gutter" ref={gutterRef} aria-label="Line numbers, source bookmarks and breakpoints">{largeSourceFile ? <span className="large-gutter-summary" title={`${lines.length.toLocaleString()} lines; individual gutter controls are paused in large source mode`}>1…{lines.length}</span> : lines.map((_, index) => { const line = index + 1; const bookmark = fileBookmarks.find((item) => item.line === line); return <button type="button" aria-label={`${breakpoints.includes(line) ? 'Remove' : 'Add'} breakpoint at line ${line}${bookmark ? `; source bookmark ${bookmark.name}${bookmark.enabled ? '' : ' disabled'}${bookmark.orphaned ? ' orphaned' : ''}` : ''}`} className={`${bookmark ? `bookmarked${bookmark.enabled ? '' : ' disabled'}${bookmark.orphaned ? ' orphaned' : ''} ` : ''}${breakpoints.includes(line) ? 'breakpoint' : ''}`} onClick={() => onToggleBreakpoint?.(line)} key={index}>{line}</button>; })}</div>
          {editorPreferences.inlayHints && (hintRail.available ? (
            /* One row per source line so the rail lines up with the text; the
             * lines that have no hint are still rows, or every row below the
             * first hint would be one line out. */
            <div className="source-hint-rail" ref={hintRailRef} aria-label="Type hints beside the source">
              {lines.map((_, index) => {
                const row = hintRail.rows.find((candidate) => candidate.line === index + 1);
                return row
                  ? <button type="button" key={index} title={row.detail} aria-label={`Line ${row.line}: ${row.detail}`} onClick={() => goToLine(row.line)}>{row.label}</button>
                  : <span key={index} aria-hidden="true" />;
              })}
            </div>
          ) : null)}
          <textarea
            ref={textareaRef}
            className="source-textarea"
            style={{ whiteSpace: editorPreferences.wordWrap ? 'pre-wrap' : 'pre', overflowWrap: editorPreferences.wordWrap ? 'anywhere' : 'normal' }}
            aria-label={`Edit ${file.name}`}
            readOnly={isReadOnly}
            value={file.content}
            spellCheck={false}
            aria-autocomplete="list"
            aria-controls="source-command-completion"
            aria-expanded={completionOpen}
            aria-activedescendant={completionOpen && suggestions[completionIndex] ? `source-completion-${completionIndex}` : undefined}
            aria-keyshortcuts={editorAriaKeyShortcuts}
            onChange={(event) => {
              if (isReadOnly) { onNotice(`${file.name} is read-only; source was not changed`); return; }
              const next = event.target.value; const position = event.target.selectionStart;
              const nextFile = { ...file, content: next };
              const nextIndex = buildProjectLanguageIndex(projectFiles.map((candidate) => candidate.id === file.id ? nextFile : candidate));
              const nextLanguageRevision = `${nextIndex.revisionKey}\0target:${targetRevision}\0build:${languageBuildRevision}`;
              languageSessionRef.current.open(nextFile, nextLanguageRevision); setRenumberPreview(undefined); setRenumberUndo(undefined); setCommandHistory((current) => ({ ...current, [file.id]: { undo: [], redo: [] } })); onChange(file.id, next);
              const context = completionContextAt(next, position, file.language, languageTarget?.machineId === 'atom');
              setCompletionPrefix(context.prefix); setCompletionRange({ start: context.start, end: context.end }); setCompletionIndex(0);
              if (!largeSourceFile && context.automatic && context.prefix.length >= 2) void languageSessionRef.current.requestVersioned(nextFile, () => projectCompletionItems(nextFile, nextIndex, effectiveProcessor, position, languageTarget), nextLanguageRevision, 'completion').then((response) => { const candidates = response.value; completionRevisionRef.current = response.revision; setCompletionCandidates(candidates); setCompletionOpen(rankCompletionItems(candidates, context.prefix, file.id).length > 0); }).catch((error) => { if (!(error instanceof StaleLanguageResponseError)) onNotice(`Completion failed: ${String(error)}`); });
              else if (completionOpen) { languageSessionRef.current.cancel('completion'); setCompletionOpen(false); completionRevisionRef.current = undefined; }
            }}
            onClick={(event) => {
              updateCaret();
              const position = event.currentTarget.selectionStart;
              if (event.ctrlKey || event.metaKey) { goToDefinition(position); return; }
              const reference = referenceAtPosition(position);
              if (reference) navigateReferenceTarget(reference);
            }}
            onDoubleClick={(event) => goToDefinition(event.currentTarget.selectionStart)}
            onKeyUp={updateCaret}
            onKeyDown={handleKeyDown}
            onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; if (hintRailRef.current) hintRailRef.current.scrollTop = event.currentTarget.scrollTop; updateCaret(); }}
          />
          {completionOpen && <div id="source-command-completion" className="live-completion" role="listbox" aria-label="Command completion" aria-live="polite">{suggestions.length ? suggestions.map(({ item, ambiguousCount, matched, scattered }, index) => <button id={`source-completion-${index}`} className={`${index === completionIndex ? 'selected ' : ''}${item.available === false ? 'unavailable' : ''}`.trim()} role="option" aria-label={completionOptionLabel(item, ambiguousCount, scattered)} aria-selected={index === completionIndex} aria-disabled={item.available === false} aria-posinset={index + 1} aria-setsize={suggestions.length} type="button" key={`${item.kind}-${item.token}-${item.source?.label ?? ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => acceptCompletion(item)}><span><i className={`completion-kind-icon kind-${item.kind}`} aria-hidden="true">{completionKindGlyph(item.kind)}</i>{item.kind}{item.available === false ? ' · UNAVAILABLE' : ''}{ambiguousCount ? ` · AMBIGUOUS ${ambiguousCount}` : ''}</span><strong>{matchedToken(item.token, matched)}</strong>{scattered && <small className="completion-scattered">MATCHED OUT OF ORDER</small>}<small>{item.signature ? `${item.signature} · ${item.detail}` : item.detail}</small>{item.available === false && <small className="completion-unavailable-reason">{item.unavailableReason}</small>}<small><i className="completion-kind-icon" aria-hidden="true">{item.source?.kind === 'project' ? '●' : '◇'}</i>{item.source ? `${item.source.kind === 'project' ? 'PROJECT' : 'REFERENCE'} · ${item.source.label} · ${item.source.version}` : 'REFERENCE'}</small></button>) : <p>No matching candidates for the current language position and target.</p>}</div>}
        </div>
        <aside className="source-outline" aria-label="Source outline">
          <details className="number-converter"><summary>Number and address converter</summary><div><label><span>Value</span><input aria-label="Number converter value" value={converterInput} onChange={(event) => setConverterInput(event.target.value)} /></label><label><span>Width</span><select aria-label="Number converter width" value={converterBits} onChange={(event) => setConverterBits(Number(event.target.value) as NumberWidth)}><option value={8}>8 bit</option><option value={16}>16 bit</option><option value={32}>32 bit</option></select></label></div>{numberConversion.error ? <p role="alert">{numberConversion.error}</p> : numberConversion.conversion && <dl><div><dt>Toolchain literal</dt><dd><code>{file.language === 'arm' || file.language === 'c' ? numberConversion.conversion.cLiteral : languageTarget?.toolchainId?.includes('ca65') ? numberConversion.conversion.alternativeLiteral : numberConversion.conversion.acornLiteral}</code></dd></div><div><dt>Acorn hex</dt><dd><code>{numberConversion.conversion.acornLiteral}</code></dd></div><div><dt>Decimal unsigned</dt><dd><code>{numberConversion.conversion.decimal}</code></dd></div><div><dt>Decimal signed</dt><dd><code>{numberConversion.conversion.signed}</code></dd></div><div><dt>Binary</dt><dd><code>{numberConversion.conversion.binary}</code></dd></div><div><dt>Octal</dt><dd><code>{numberConversion.conversion.octal}</code></dd></div><div><dt>Little endian</dt><dd><code>{numberConversion.conversion.littleEndian}</code></dd></div><div><dt>Big endian</dt><dd><code>{numberConversion.conversion.bigEndian}</code></dd></div>{numberConversion.conversion.character && <div><dt>Low-byte text</dt><dd><code>{JSON.stringify(numberConversion.conversion.character)}</code></dd></div>}<div className={numberConversion.conversion.address.valid ? 'valid' : 'invalid'}><dt>{file.language === 'arm' ? 'ARM address' : `${effectiveProcessor.toUpperCase()} address`}</dt><dd>{numberConversion.conversion.address.reason}</dd></div></dl>}<small>Accepted notation: decimal, &amp;hex, $hex, 0xhex, %binary, 0bbinary and 0ooctal. The preferred literal follows the active source and ca65 or Acorn-style toolchain. Negative values use two's complement at the selected width.</small></details>
          <div><span>OUTLINE</span><small>{outline.length}</small></div>
          {outline.length ? outline.map((item) => <button type="button" className={item.depth ? `outline-depth-${Math.min(item.depth, 3)}` : undefined} key={`${item.line}-${item.label}-${item.depth ?? 0}`} onClick={() => goToLine(item.line)}><Icon name="chevron" size={11} /><span>{item.label}</span>{item.detail && <em>{item.detail}</em>}<code>{item.line}</code></button>) : <p>No numbered lines or labels yet.</p>}
          {documentIssues.length > 0 && <>
            <div><span>DOCUMENT ISSUES</span><small>{documentIssues.length}</small></div>
            <section className="document-issues" aria-label={`${adapter?.label ?? 'Document'} issues`}>
              {documentIssues.map((issue) => <button type="button" key={`${issue.line}-${issue.column}-${issue.message}`} onClick={() => navigateSourcePosition(file.id, issue.line, issue.column, 1)}><span>{issue.severity}</span><small>{issue.line}:{issue.column}</small><em>{issue.message}</em></button>)}
            </section>
          </>}
          <details className="symbol-selector"><summary>Project symbol selector <small>{projectIndex.symbols.length}</small></summary><label><span className="visually-hidden">Find project symbol</span><input type="search" aria-label="Find project symbol" value={symbolSearch} onChange={(event) => setSymbolSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && filteredProjectSymbols[0]) { event.preventDefault(); navigateProjectSymbol(filteredProjectSymbols[0]); } else if (event.key === 'Escape') { event.preventDefault(); setSymbolSearch(''); } }} placeholder="Symbol, kind or file…" /></label><div role="list" aria-label="Project symbols">{filteredProjectSymbols.length ? filteredProjectSymbols.map((symbol) => <button type="button" role="listitem" key={`${symbol.fileId}-${symbol.line}-${symbol.column}-${symbol.token}`} onClick={() => navigateProjectSymbol(symbol)}><span><strong>{symbol.token}</strong><small>{symbol.kind} · {symbol.signature}</small></span><code>{symbol.fileName}:{symbol.line}</code></button>) : <p>No parsed symbols match.</p>}</div>{projectIndex.symbols.length > 200 && !symbolSearch.trim() && <small>Showing the first 200 symbols. Type to narrow the project index.</small>}</details>
          <div><span>BOOKMARKS</span><small>{fileBookmarks.length}/{bookmarks.length}</small></div>
          {fileBookmarks.map((bookmark) => <button type="button" disabled={!bookmark.enabled} title={bookmark.orphaned ? 'Anchor text was removed; open its candidate line and recover it' : bookmark.enabled ? `${bookmark.name} · ${bookmark.scope}${bookmark.description ? ` · ${bookmark.description}` : ''}` : 'Bookmark disabled'} key={bookmark.id} onClick={() => navigateBookmark(bookmark)}><Icon name="bookmark" size={11} /><span>{bookmark.name}</span><code>{bookmark.scope === 'private' ? 'PRIVATE' : bookmark.orphaned ? '?' : bookmark.line}</code></button>)}
          <details className="bookmark-manager"><summary>All project bookmarks</summary><label><span className="visually-hidden">Search project bookmarks</span><input type="search" aria-label="Search project bookmarks" value={bookmarkSearch} onChange={(event) => setBookmarkSearch(event.target.value)} placeholder="Search name, note, scope or file" /></label><div aria-label="Project source bookmarks">{filteredBookmarks.length ? filteredBookmarks.map((bookmark) => { const bookmarkFile = projectFiles.find((candidate) => candidate.id === bookmark.fileId); return <section className={`${bookmark.orphaned ? 'orphaned ' : ''}${bookmark.scope === 'private' ? 'private' : 'project'}`.trim()} key={bookmark.id}><button type="button" onClick={() => navigateBookmark(bookmark)}><strong>{bookmark.name}</strong><small>{bookmarkFile?.name ?? 'Missing file'}:{bookmark.line}:{bookmark.column}{bookmark.orphaned ? ' · orphaned' : ''}</small>{bookmark.description && <p>{bookmark.description}</p>}</button><span className={`bookmark-scope ${bookmark.scope}`}>{bookmark.scope === 'private' ? 'PRIVATE' : 'PROJECT'}</span><div className="bookmark-actions">{bookmark.orphaned ? <button type="button" aria-label={`Recover bookmark ${bookmark.name}${bookmark.fileId === file.id ? ' at current line' : ' in its file'}`} onClick={() => recoverBookmark(bookmark)}>Recover</button> : <button type="button" aria-label={`${bookmark.enabled ? 'Disable' : 'Enable'} bookmark ${bookmark.name}`} onClick={() => onUpdateBookmark?.(bookmark.id, { enabled: !bookmark.enabled })}>{bookmark.enabled ? 'Enabled' : 'Disabled'}</button>}<button type="button" aria-label={`Change bookmark ${bookmark.name} to ${bookmark.scope === 'private' ? 'project' : 'private'} scope`} onClick={() => onUpdateBookmark?.(bookmark.id, { scope: bookmark.scope === 'private' ? 'project' : 'private' })}>Make {bookmark.scope === 'private' ? 'project' : 'private'}</button><button type="button" aria-label={`Edit description for bookmark ${bookmark.name}`} onClick={() => editBookmarkDescription(bookmark)}>Description</button><button type="button" aria-label={`Rename bookmark ${bookmark.name}`} onClick={() => renameBookmark(bookmark)}>Rename</button><button type="button" aria-label={`Delete bookmark ${bookmark.name}`} onClick={() => onRemoveBookmark?.(bookmark.id)}>Delete</button></div></section>; }) : <p>No bookmarks match.</p>}</div></details>
          {showTypeHints && <><div><span>TYPE HINTS</span><small>{typeHints.length}</small></div>{editorPreferences.inlayHints && hintRail.unavailableReason && <p className="binding-warning" role="status">{hintRail.unavailableReason}</p>}{typeHints.length ? <section className="source-type-hints" aria-label="Authoritative source type hints">{typeHints.map((hint) => <button type="button" key={`${hint.line}:${hint.column}:${hint.token}`} title={hint.detail} onClick={() => goToLine(hint.line)}><span><strong>{hint.token}</strong><small>{hint.role} · {hint.line}:{hint.column}</small></span><code>{hint.type} · {hint.storage}</code>{hint.signedness && <small>Signedness: {hint.signedness}</small>}{hint.addressSpace && <small>Address space: {hint.addressSpace}</small>}{hint.returns && <small>Returns: {hint.returns}</small>}{hint.parameters && <small>Parameters: {hint.parameters.length ? hint.parameters.join(', ') : 'none'}</small>}{hint.callingConvention && <small>Calling convention: {hint.callingConvention}</small>}</button>)}</section> : <p>{file.language === '6502' || file.language === 'arm' ? 'Untyped source: no types are inferred.' : file.language === 'bbc-basic' ? 'No assigned variables or declared parameters.' : file.language === 'c' ? 'No supported C declarations are present. Complex declarators require compiler type records and are not guessed.' : 'No authoritative type provider is registered.'}</p>}</>}
          <div><span>{file.language === 'bbc-basic' ? 'LINE REFERENCES' : 'JUMP TARGETS'}</span><small>{references.length}</small></div>
          {file.language === 'bbc-basic' && <section className="basic-reference-tools" aria-label="BASIC line navigation"><label><span className="visually-hidden">BASIC line number</span><input inputMode="numeric" aria-label="BASIC line number" value={basicLineTarget} onChange={(event) => setBasicLineTarget(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') goToBasicLine(); }} placeholder="Line…" /></label><button type="button" onClick={goToBasicLine}>Go</button><button type="button" disabled={!references.length} onClick={() => navigateAdjacentReference(-1)} aria-label="Previous BASIC reference">↑ Ref</button><button type="button" disabled={!references.length} onClick={() => navigateAdjacentReference(1)} aria-label="Next BASIC reference">Ref ↓</button></section>}
          {file.language === 'bbc-basic' && basicNavigation.diagnostics.length > 0 && <section className="basic-reference-diagnostics" aria-label="BASIC line diagnostics"><strong>{basicNavigation.diagnostics.length} line issue{basicNavigation.diagnostics.length === 1 ? '' : 's'}</strong>{basicNavigation.diagnostics.map((diagnostic) => <div key={diagnostic.id}><button type="button" onClick={() => navigateSourcePosition(file.id, diagnostic.line, diagnostic.column, 1)}><span>{diagnostic.kind.replaceAll('-', ' ')}</span><small>{diagnostic.line}:{diagnostic.column}</small><em>{diagnostic.message}</em></button><button type="button" disabled={diagnostic.kind !== 'missing-line-number' || isReadOnly} title={diagnostic.kind === 'missing-line-number' ? 'Preview a collision-free line number without changing source' : 'No automatic fix is safe for this diagnostic'} onClick={() => previewBasicQuickFix(diagnostic.line)}>{diagnostic.kind === 'missing-line-number' ? 'Preview quick fix' : 'Manual fix required'}</button></div>)}{basicQuickFixUndo?.fileId === file.id && <button type="button" onClick={undoBasicQuickFix}>Undo last quick fix</button>}</section>}
          <section className="source-reference-list" aria-label={file.language === 'bbc-basic' ? 'BASIC source references' : 'Source jump targets'}>{references.map((reference, index) => <div className={reference.status === 'resolved' ? '' : 'unresolved'} key={`${reference.fromLine}-${reference.fromColumn}-${index}`}><button type="button" title={`Go to source reference at ${file.name}:${reference.fromLine}:${reference.fromColumn}`} onClick={() => navigateReferenceSource(reference)}><code>{reference.fromLine}:{reference.fromColumn}</code><span>{reference.label}</span></button><button type="button" title={reference.reason} aria-label={`Go to target ${reference.target}; ${reference.reason}`} onClick={() => navigateReferenceTarget(reference)}><code>{reference.status === 'ambiguous' ? `${reference.candidates?.length ?? 0}?` : reference.resolved ? `→${reference.targetFileName === file.name ? '' : `${reference.targetFileName}:`}${reference.targetLine}` : 'missing'}</code></button></div>)}</section>
        </aside>
      </div>
    </div>
  );
}

function completionKindGlyph(kind: LanguageItem['kind']) {
  if (kind === 'opcode') return 'OP';
  if (kind === 'command') return 'K';
  if (kind === 'directive') return '.';
  if (kind === 'function') return 'ƒ';
  if (kind === 'variable') return 'v';
  if (kind === 'constant') return '#';
  if (kind === 'register') return 'R';
  if (kind === 'hardware') return 'H';
  if (kind === 'swi' || kind === 'mos') return 'OS';
  if (kind === 'macro') return 'M';
  if (kind === 'member') return 'm';
  if (kind === 'snippet') return 'S';
  if (kind === 'file') return '/';
  if (kind === 'line') return 'L';
  if (kind === 'type') return 'T';
  return '•';
}

function TokenDefinition({ item, onDismiss, onSelectRelated }: { item: LanguageItem; onDismiss: () => void; onSelectRelated: (token: string) => void }) {
  const documentation = item.documentation;
  return <section className={`token-definition${documentation ? ' rich' : ''}${documentation?.compatibility?.supported === false ? ' incompatible' : ''}`} aria-live="polite" aria-label={`${item.token} token help`}>
    <div className="token-definition-heading"><strong>{item.token}</strong><span>{documentation?.category ?? item.kind}</span><button type="button" onClick={onDismiss} aria-label={`Dismiss ${item.token} help`}><Icon name="close" size={10} /></button></div>
    <code>{item.signature}</code><p>{item.detail}</p>
    {documentation && <div className="token-definition-facts">
      {documentation.compatibility && <span className={documentation.compatibility.supported ? 'supported' : 'unsupported'}>{documentation.compatibility.supported ? 'SUPPORTED' : 'INCOMPATIBLE'} · {documentation.compatibility.appliesTo.join(' · ')}</span>}
      {!!documentation.flags?.length && <span>FLAGS · {documentation.flags.join(' · ')}</span>}
      {documentation.result && <span>RESULT · {documentation.result}</span>}
      {!!documentation.sideEffects?.length && <span>EFFECTS · {documentation.sideEffects.join(' ')}</span>}
      {documentation.compatibility?.warning && <strong role={documentation.compatibility.supported ? undefined : 'alert'}>{documentation.compatibility.warning}</strong>}
      {documentation.deprecation && <strong className="token-deprecation" role="alert">DEPRECATED · {documentation.deprecation.message}{documentation.deprecation.replacement ? ` Replacement: ${documentation.deprecation.replacement}.` : ''}</strong>}
      {!!documentation.examples?.length && <span>EXAMPLES · <code>{documentation.examples.join(' · ')}</code></span>}
      {!!documentation.related?.length && <span className="token-related">RELATED · {documentation.related.map((token) => <button type="button" key={token} onClick={() => onSelectRelated(token)}>{token}</button>)}</span>}
    </div>}
    {!!documentation?.cycles?.length && <table className="token-definition-cycles" aria-label={`${item.token} instruction cycles`}><caption>Instruction cycles</caption><thead><tr><th scope="col">Form</th><th scope="col">Cycles</th><th scope="col">Variation</th></tr></thead><tbody>{documentation.cycles.map((cycle) => <tr key={`${cycle.form}-${cycle.minimum}-${cycle.maximum}`}><th scope="row">{cycle.form}</th><td>{cycle.minimum === cycle.maximum ? cycle.minimum : `${cycle.minimum} to ${cycle.maximum}`}</td><td>{cycle.variability ?? 'Fixed for this form'}</td></tr>)}</tbody></table>}
    {!!documentation?.parameters?.length && <dl className="token-definition-parameters" aria-label={`${item.token} parameters`}>
      {documentation.parameters.map((parameter) => <div key={parameter.name}><dt>{parameter.name}</dt><dd>{parameter.detail}{parameter.range && <small>{parameter.range}</small>}</dd></div>)}
    </dl>}
    <footer>{item.source && <small>{item.source.kind === 'project' ? 'PROJECT' : 'REFERENCE'} · {item.source.label} · {item.source.version}</small>}{documentation?.citations?.map((citation) => {
      const label = `${citation.title}${citation.section ? ` · ${citation.section}` : ''}`;
      const hint = `${citation.section ?? ''}${citation.version ? ` · ${citation.version}` : ''}`;
      /* A source with nowhere to link to is named rather than rendered as a
       * link that goes nowhere, which reads as a broken control to anybody
       * navigating by them. */
      return citation.url
        ? <a key={`${citation.url}-${citation.section ?? ''}`} href={citation.url} target="_blank" rel="noreferrer" title={hint}>{label}</a>
        : <span key={`cited-${citation.title}-${citation.section ?? ''}`} title={hint}>{label}</span>;
    })}</footer>
  </section>;
}

/** Flatten a nested outline for the panel, keeping the depth for indentation. */
function flattenOutline(nodes: readonly OutlineNode[], depth = 0): Array<{ label: string; line: number; detail?: string; depth: number }> {
  return nodes.flatMap((node) => [
    { label: node.label, line: node.line, detail: node.detail, depth },
    ...flattenOutline(node.children, depth + 1),
  ]);
}

/* What a screen reader announces for one candidate.
 *
 * The name is given explicitly rather than left to be computed from the
 * option's contents, because the contents mark the matched characters
 * individually and a name computed from them would be announced letter by
 * letter. The wording follows the visible text so the two cannot diverge into
 * saying different things about the same candidate.
 */
function completionOptionLabel(item: LanguageItem, ambiguousCount: number, scattered: boolean): string {
  const parts = [item.kind, item.token];
  if (item.available === false) parts.push('unavailable', item.unavailableReason ?? 'for the selected target');
  if (ambiguousCount) parts.push(`ambiguous, ${ambiguousCount} declarations`);
  if (scattered) parts.push('matched out of order');
  parts.push(item.signature ? `${item.signature} · ${item.detail}` : item.detail);
  if (item.source) parts.push(`${item.source.kind === 'project' ? 'project' : 'reference'} · ${item.source.label} · ${item.source.version}`);
  return parts.filter(Boolean).join(' · ');
}

/* The typed characters, marked where they landed. A candidate found by
 * matching characters in order rather than from the front has to show why it
 * is in the list, or it reads as an unrelated suggestion. */
function matchedToken(token: string, matched: readonly number[]) {
  if (!matched.length) return token;
  const positions = new Set(matched);
  return [...token].map((character, index) => positions.has(index)
    ? <mark key={index}>{character}</mark>
    : <span key={index}>{character}</span>);
}

function sourceOutline(file: ProjectFile): Array<{ label: string; line: number; detail?: string; depth: number }> {
  return file.content.split('\n').flatMap((line, index) => {
    if (file.language === 'bbc-basic') {
      const results: Array<{ label: string; line: number; depth: number }> = [];
      const number = line.match(/^\s*(\d{1,5})(?=\s|[A-Za-z*]|$)/);
      const routine = line.match(/\bDEF\s+((?:PROC|FN)[A-Za-z_][A-Za-z0-9_]*)\b/i);
      const atomLabel = line.match(/^\s*\d{1,5}\s*([a-z])(?=[A-Z])/);
      if (number) results.push({ label: `Line ${number[1]}`, line: index + 1, depth: 0 });
      if (routine) results.push({ label: routine[1]!, line: index + 1, depth: 0 });
      if (atomLabel) results.push({ label: `Label ${atomLabel[1]}`, line: index + 1, depth: 0 });
      return results;
    }
    const match = line.match(/^\s*[.]?([A-Za-z_][A-Za-z0-9_]*)\s*:?\s*(?:;.*)?$/);
    return match ? [{ label: match[1]!, line: index + 1, depth: 0 }] : [];
  });
}

function lineStart(content: string, targetLine: number): number {
  if (targetLine <= 1) return 0;
  let position = 0;
  for (let line = 1; line < targetLine; line += 1) {
    const next = content.indexOf('\n', position);
    if (next < 0) return content.length;
    position = next + 1;
  }
  return position;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
