/* The limits, where a person can read them before meeting one.
 *
 * Every limit here was already enforced. What was missing was anywhere to see
 * them, and a limit you only meet by exceeding it is indistinguishable from a
 * bug: the first thing someone does when an import stops half way is assume
 * the product is broken rather than that it told them something.
 *
 * Each row says what is limited, the number, why the number exists, and what
 * the product does on reaching it. The last column is the one that matters. A
 * limit that says only "it fails" leaves someone with nothing to act on, so the
 * register refuses an entry written that way.
 */
import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { PRODUCT_LIMITS, formatLimit, type LimitKind } from '../project/limits';

const KINDS: ReadonlyArray<{ id: LimitKind; label: string; description: string }> = [
  { id: 'size', label: 'Size', description: 'How large one thing may be.' },
  { id: 'count', label: 'Count', description: 'How many of a thing there may be.' },
  { id: 'retention', label: 'Retention', description: 'How much is kept, and what is dropped first.' },
  { id: 'concurrency', label: 'Concurrency', description: 'How much runs at once.' },
];

export function LimitsPanel() {
  const [query, setQuery] = useState('');
  const grouped = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = PRODUCT_LIMITS.filter((limit) => {
      if (!terms.length) return true;
      const haystack = `${limit.label} ${limit.unit} ${limit.reason} ${limit.onReaching}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    return KINDS.map((kind) => ({ ...kind, limits: matches.filter((limit) => limit.kind === kind.id) }))
      .filter((group) => group.limits.length);
  }, [query]);

  const total = grouped.reduce((sum, group) => sum + group.limits.length, 0);

  return (
    <section className="limits-panel panel-surface" aria-label="Limits">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">WHAT THIS BUILD ENFORCES</span>
          <h2>Limits</h2>
        </div>
        <small>{total} of {PRODUCT_LIMITS.length}</small>
      </div>
      <p className="binding-note">
        Every limit below is enforced by the product and is shown here so it can be read before it is met. Each says
        why it exists and what happens on reaching it: nothing is truncated silently, and nothing is left half applied.
      </p>
      <label className="limits-search">
        <span className="visually-hidden">Search limits</span>
        <Icon name="search" size={13} />
        <input type="search" aria-label="Search limits" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search limits…" />
      </label>

      {grouped.length ? grouped.map((group) => (
        <section key={group.id} aria-label={`${group.label} limits`}>
          <div className="limits-group-heading"><strong>{group.label.toUpperCase()}</strong><small>{group.description}</small></div>
          <table className="limits-table">
            <thead>
              <tr><th scope="col">Limit</th><th scope="col">Value</th><th scope="col">Why</th><th scope="col">On reaching it</th></tr>
            </thead>
            <tbody>
              {group.limits.map((limit) => (
                <tr key={limit.id}>
                  <th scope="row">{limit.label}</th>
                  <td><code>{formatLimit(limit)}</code></td>
                  <td>{limit.reason}</td>
                  <td>{limit.onReaching}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )) : <p role="status">No limit matches “{query.trim()}”.</p>}
    </section>
  );
}
