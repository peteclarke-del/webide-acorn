/* Searching imported documentation, and being told what you are reading.
 *
 * The hard part of a reference panel is not finding text. It is presenting two
 * passages about the same call — one from the manual, one from a forum — in a
 * way that does not quietly equate them. So results are separated: what may be
 * read as authoritative comes first under its own heading, and everything else
 * comes under a heading that says what it is. Ordering alone would not do it,
 * because a list is read as one list.
 *
 * A thin result is explained rather than left ambiguous. Somebody searching an
 * empty library and somebody searching a full one that happens not to cover
 * their machine both see nothing, and those are very different situations.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import type { PackLibrary } from '../research/packLibrary';
import { tierCaveat, type SourceTier } from '../research/referencePack';
import {
  searchCoverage,
  searchReferences,
  type SearchHit,
  type SearchTarget,
} from '../research/referenceSearch';
import { partitionByStanding } from '../research/accuracyEvaluation';
import { proposeInsertion, type InsertionLanguage } from '../research/referenceInsertion';
import { resolveReferenceLink, type LinkOrigin } from '../research/referenceLinks';

interface ReferencePanelProps {
  library: PackLibrary;
  target?: SearchTarget;
  /**
   * A question pushed in from elsewhere. An `origin` carries what the workbench
   * already knew — that this is an opcode, that this operand is an address —
   * and is asked by kind; a bare query is only a word.
   */
  request?: { sequence: number; query: string; origin?: LinkOrigin };
  /** The language of the file an insertion would go into, when there is one. */
  insertionLanguage?: InsertionLanguage;
  insertionDialect?: string;
  onInsert?: (text: string, hit: SearchHit) => void;
  onNotice: (message: string) => void;
}

const TIER_LABEL: Record<SourceTier, string> = {
  publisher: 'Publisher', independent: 'Independent', community: 'Community', generated: 'Generated',
};

/** Bounded, because a history nobody can see the end of is a list, not a history. */
const HISTORY_LIMIT = 12;

export function ReferencePanel({
  library, target, request, insertionLanguage, insertionDialect, onInsert, onNotice,
}: ReferencePanelProps) {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'authoritative'>('all');
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<Array<{ key: string; packId: string; entryId: string; title: string }>>([]);
  /* An origin is asked by kind and answered exactly, or not at all. A typed
   * question that found nothing is not re-asked as a word, because that would
   * turn a precise "nothing documents this" into a vague "here is something". */
  const [origin, setOrigin] = useState<LinkOrigin | undefined>();

  /* Any search somebody types abandons the typed question they arrived with:
   * the words in the box are then the whole of what was asked. */
  const run = useCallback((next: string) => {
    const trimmed = next.trim();
    setOrigin(undefined);
    setApplied(trimmed);
    setSelectedId('');
    if (!trimmed) return;
    setHistory((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, HISTORY_LIMIT));
  }, []);

  useEffect(() => {
    if (!request) return;
    setQuery(request.query);
    run(request.query);
    /* After `run`, which clears it: arriving from a disassembly row is a typed
     * question, and the words are only what goes in the box beside it. */
    setOrigin(request.origin);
  }, [request, run]);

  const linked = useMemo(() => (origin ? resolveReferenceLink(library, origin, target) : null), [origin, library, target]);
  const hits = useMemo(
    () => (linked ? linked.hits : applied ? searchReferences(library, applied, { target }) : []),
    [linked, library, applied, target],
  );
  const coverage = useMemo(() => searchCoverage(library, {}), [library]);
  const { authoritative, unverified } = useMemo(() => partitionByStanding(hits), [hits]);
  const shown = tierFilter === 'authoritative' ? authoritative : hits;
  const key = (hit: SearchHit) => `${hit.packId}#${hit.entry.id}`;
  const selected = shown.find((hit) => key(hit) === selectedId) ?? shown[0];

  const insertion = useMemo(() => {
    if (!selected || !insertionLanguage) return null;
    const pack = library.packs.find((held) => held.pack.id === selected.packId);
    if (!pack) return null;
    return proposeInsertion(selected, pack.pack, insertionLanguage, insertionDialect);
  }, [selected, insertionLanguage, insertionDialect, library]);

  const toggleBookmark = (hit: SearchHit) => {
    const id = key(hit);
    setBookmarks((current) => current.some((mark) => mark.key === id)
      ? current.filter((mark) => mark.key !== id)
      : [...current, { key: id, packId: hit.packId, entryId: hit.entry.id, title: hit.entry.title }]);
  };

  const insert = () => {
    if (!selected || !insertion?.permitted || !onInsert) return;
    onInsert(insertion.preview.text, selected);
    onNotice(`${selected.entry.title} inserted with its provenance from ${selected.packTitle}.`);
  };

  const renderHit = (hit: SearchHit) => (
    <button
      type="button"
      role="option"
      aria-selected={selected ? key(selected) === key(hit) : false}
      className={selected && key(selected) === key(hit) ? 'selected' : ''}
      key={key(hit)}
      onClick={() => setSelectedId(key(hit))}
    >
      <code>{hit.entry.title}</code>
      <span>{TIER_LABEL[hit.tier]} · {hit.packTitle}</span>
      <small>
        {hit.matchKind === 'anchor' ? `documents ${hit.matchedAnchor}` : hit.matchKind === 'title' ? 'title match' : 'mentioned in the text'}
        {hit.applicability === 'other' ? ' · names a different machine' : ''}
      </small>
    </button>
  );

  return (
    <section className="reference-panel" aria-label="Imported reference search">
      <div className="research-toolbar">
        <form
          role="search"
          onSubmit={(event) => { event.preventDefault(); run(query); }}
        >
          <label>
            <span className="visually-hidden">Search imported documentation</span>
            <input
              type="search"
              aria-label="Search imported documentation"
              value={query}
              placeholder="An opcode, an address, a call — LDA, &FE30, OSWRCH"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="submit"><Icon name="search" size={14} /> Search</button>
        </form>
        <div role="group" aria-label="Which sources to show">
          <button type="button" aria-pressed={tierFilter === 'all'} className={tierFilter === 'all' ? 'active' : ''} onClick={() => setTierFilter('all')}>
            Everything ({hits.length})
          </button>
          <button type="button" aria-pressed={tierFilter === 'authoritative'} className={tierFilter === 'authoritative' ? 'active' : ''} onClick={() => setTierFilter('authoritative')}>
            Publishers only ({authoritative.length})
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <div className="reference-history">
          <h3>Recent searches</h3>
          <ul>
            {history.map((item) => (
              <li key={item}>
                <button type="button" onClick={() => { setQuery(item); run(item); }}>{item}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bookmarks.length > 0 && (
        <div className="reference-bookmarks">
          <h3>Bookmarks</h3>
          <ul>
            {bookmarks.map((mark) => (
              <li key={mark.key}>
                <button type="button" onClick={() => { setQuery(mark.title); run(mark.title); }}>{mark.title}</button>
                <button type="button" aria-label={`Remove the bookmark for ${mark.title}`} onClick={() => setBookmarks((current) => current.filter((item) => item.key !== mark.key))}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!applied ? (
        <p className="honest-note" role="status">
          {coverage.packsSearched
            ? `${coverage.entriesSearched.toLocaleString()} entries across ${coverage.packsSearched} pack${coverage.packsSearched === 1 ? '' : 's'} are ready to search.`
            : 'No reference packs are held, so there is nothing here to search. Import one in Settings.'}
        </p>
      ) : !hits.length ? (
        <p className="honest-note" role="status">
          {linked?.absence ? `Asked ${linked.question}. ${linked.absence}` : coverage.packsSearched
            ? `Nothing in the ${coverage.entriesSearched.toLocaleString()} entries held matches "${applied}". That is an absence in what you have imported, not an absence of documentation.`
            : `No reference packs are held, so "${applied}" could not be looked up. This is not the same as finding nothing.`}
        </p>
      ) : (
        <div className="research-layout">
          <div className="research-results">
            {tierFilter === 'all' && authoritative.length > 0 && (
              <>
                <h3 id="reference-authoritative">From a publisher or a named author</h3>
                <div role="listbox" aria-labelledby="reference-authoritative">{authoritative.map(renderHit)}</div>
              </>
            )}
            {tierFilter === 'all' && unverified.length > 0 && (
              <>
                <h3 id="reference-unverified">Not a publisher — check anything you depend on</h3>
                <div role="listbox" aria-labelledby="reference-unverified">{unverified.map(renderHit)}</div>
              </>
            )}
            {tierFilter === 'authoritative' && (
              <div role="listbox" aria-label="Publisher results">{authoritative.map(renderHit)}</div>
            )}
          </div>

          <article className="reference-detail" aria-live="polite">
            {selected ? (
              <>
                <span className={selected.authoritative ? 'state-pill supported' : 'state-pill'}>{TIER_LABEL[selected.tier]}</span>
                <h3>{selected.entry.title}</h3>
                {tierCaveat(selected.tier) && <p className="dfs-warning">{tierCaveat(selected.tier)}</p>}
                <p>{selected.entry.body}</p>

                <dl>
                  <div><dt>From</dt><dd>{selected.packTitle} — {selected.publisher}</dd></div>
                  {selected.entry.citations.length > 0 && (
                    <div>
                      <dt>Cited as</dt>
                      <dd>
                        {selected.entry.citations.map((citation) => (
                          <span key={`${citation.title}-${citation.section ?? ''}-${citation.page ?? ''}`}>
                            {[citation.title, citation.section, citation.page ? `p.${citation.page}` : null].filter(Boolean).join(', ')}
                            {citation.url && <> — <a href={citation.url} target="_blank" rel="noreferrer noopener">read it{' '}<span className="visually-hidden">(opens in a new tab)</span></a></>}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                  <div><dt>Applies to</dt><dd>{selected.applicability === 'declared' ? 'this machine' : selected.applicability === 'other' ? 'a different machine from the one selected' : 'not restricted to a machine'}</dd></div>
                </dl>

                <div className="reference-actions">
                  <button type="button" onClick={() => toggleBookmark(selected)}>
                    <Icon name="bookmark" size={14} /> {bookmarks.some((mark) => mark.key === key(selected)) ? 'Remove bookmark' : 'Bookmark'}
                  </button>
                  {onInsert && insertion && (
                    insertion.permitted ? (
                      <button type="button" onClick={insert}>
                        <Icon name="code" size={14} /> Insert with provenance
                      </button>
                    ) : (
                      <span className="honest-note">{insertion.refusal.detail}</span>
                    )
                  )}
                </div>

                {insertion?.permitted && (
                  <>
                    {insertion.preview.dialect.standing !== 'match' && (
                      <p className="honest-note">{insertion.preview.dialect.detail}</p>
                    )}
                    <details>
                      <summary>What would be inserted</summary>
                      <pre>{insertion.preview.text}</pre>
                    </details>
                  </>
                )}
              </>
            ) : (
              <div className="honest-empty">Choose a result to read it.</div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
