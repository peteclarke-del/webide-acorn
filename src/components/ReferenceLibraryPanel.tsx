/* Managing the reference packs this browser holds.
 *
 * Import, update, remove — and, as prominently as any of those, an account of
 * what is held and what it may be used for. A library of documentation is not
 * neutral furniture: a library that is mostly community notes answers
 * differently from one that is mostly manuals, and somebody deciding whether to
 * trust an answer needs to know which they have before they read it, not after.
 *
 * Everything here is local. Nothing is fetched and nothing is uploaded, so
 * these packs work offline for the same reason they work at all.
 */
import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import {
  installPack,
  libraryStanding,
  removePack,
  type PackLibrary,
} from '../research/packLibrary';
import { PACK_LIMITS, tierCaveat, type SourceTier } from '../research/referencePack';
import { describeAccuracy, evaluateAccuracy } from '../research/accuracyEvaluation';
import type { SearchTarget } from '../research/referenceSearch';

interface ReferenceLibraryPanelProps {
  library: PackLibrary;
  target?: SearchTarget;
  onChange: (library: PackLibrary) => void;
  onNotice: (message: string) => void;
  /** The clock, supplied so the record of when something happened is the host's. */
  now?: () => string;
}

const TIER_LABEL: Record<SourceTier, string> = {
  publisher: 'Publisher',
  independent: 'Independent',
  community: 'Community',
  generated: 'Generated',
};

export function ReferenceLibraryPanel({ library, target, onChange, onNotice, now }: ReferenceLibraryPanelProps) {
  const [busy, setBusy] = useState(false);
  const standing = useMemo(() => libraryStanding(library), [library]);
  const accuracy = useMemo(() => evaluateAccuracy(library, target), [library, target]);
  const clock = now ?? (() => new Date().toISOString());

  const importPack = async (file: File) => {
    setBusy(true);
    try {
      if (file.size > PACK_LIMITS.packBytes) {
        onNotice(`${file.name} is ${file.size.toLocaleString()} bytes and a reference pack is limited to ${PACK_LIMITS.packBytes.toLocaleString()}.`);
        return;
      }
      const outcome = installPack(library, JSON.parse(await file.text()), clock());
      onChange(outcome.library);
      onNotice(outcome.summary);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = (packId: string) => {
    try {
      const outcome = removePack(library, packId, clock());
      onChange(outcome.library);
      onNotice(outcome.summary);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="reference-library panel-surface" aria-label="Reference packs">
      <div className="panel-heading">
        <div><span className="eyebrow">IMPORTED DOCUMENTATION</span><h2>Reference packs</h2></div>
        <small>{standing.packs} held · {standing.entries.toLocaleString()} entries</small>
      </div>

      <p className="binding-note">
        Documentation you import, kept in this browser. Nothing here is fetched and nothing is uploaded, which is why
        it answers offline. A pack carries its own account of who published it, what may be quoted from it and what may
        be copied into your own source; this build shows what it was told rather than deciding on its behalf.
      </p>

      <div className="media-fields">
        <label className="sideways-picker">
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import a reference pack"
            disabled={busy}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importPack(file); }}
          />
          <Icon name="open" size={14} /> {busy ? 'Reading…' : 'Import a pack'}
        </label>
      </div>

      {standing.packs === 0 ? (
        <p className="honest-note" role="status">
          No packs are held. The workbench still answers from its own maintained knowledge — opcodes, OS calls and
          hardware registers, each with its citation — and this is where imported manuals would go alongside it.
        </p>
      ) : (
        <>
          <table className="reference-pack-table">
            <caption>What each pack is, and what it permits.</caption>
            <thead>
              <tr>
                <th scope="col">Pack</th><th scope="col">Source</th><th scope="col">Entries</th>
                <th scope="col">Applies to</th><th scope="col">Licence</th><th scope="col" />
              </tr>
            </thead>
            <tbody>
              {library.packs.map((held) => {
                const applies = [
                  ...held.pack.applicability.machines,
                  ...held.pack.applicability.processors,
                  ...held.pack.applicability.dialects,
                ];
                return (
                  <tr key={held.pack.id}>
                    <th scope="row">
                      {held.pack.title}
                      <small>{held.pack.publisher} · version {held.pack.packVersion}</small>
                    </th>
                    <td>
                      <span className={held.pack.tier === 'publisher' || held.pack.tier === 'independent' ? 'state-pill supported' : 'state-pill'}>
                        {TIER_LABEL[held.pack.tier]}
                      </span>
                    </td>
                    <td><code>{held.pack.entries.length.toLocaleString()}</code></td>
                    <td>{applies.length ? applies.join(', ') : <span className="sideways-empty">anything</span>}</td>
                    <td>
                      <code>{held.pack.licence.name}</code>
                      <small>
                        {held.pack.licence.quotable ? 'quotable' : 'not quotable'} ·{' '}
                        {held.pack.licence.insertable ? 'may be inserted' : 'may not be inserted'}
                      </small>
                    </td>
                    <td><button type="button" aria-label={`Remove ${held.pack.title}`} onClick={() => remove(held.pack.id)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div>
            <h3>What this library is made of</h3>
            <p className="binding-note">
              {standing.byTier.map((entry) => `${entry.entries.toLocaleString()} ${TIER_LABEL[entry.tier as SourceTier].toLowerCase()}`).join(', ')}.
              {standing.byTier.some((entry) => entry.tier === 'community' || entry.tier === 'generated') && (
                <> {tierCaveat(standing.byTier.find((entry) => entry.tier === 'generated') ? 'generated' : 'community')}</>
              )}
            </p>
          </div>

          <div>
            <h3>Checks over what is held</h3>
            <p className={accuracy.findings.length ? 'dfs-warning' : 'binding-note'} role="status">
              {describeAccuracy(accuracy)}
            </p>
            {accuracy.findings.length > 0 && (
              <ul className="system-status-unmet">
                {accuracy.findings.slice(0, 6).map((finding) => (
                  <li key={`${finding.rule}-${finding.packId}-${finding.entryId ?? ''}`}>
                    <strong>{finding.rule}</strong><span>{finding.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {library.audit.length > 0 && (
        <div>
          <h3>What has been done to this library</h3>
          <table className="reference-audit-table">
            <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Pack</th><th scope="col">Version</th></tr></thead>
            <tbody>
              {library.audit.slice(0, 8).map((record, index) => (
                <tr key={`${record.at}-${record.packId}-${index}`}>
                  <td><code>{record.at}</code></td>
                  <td>{record.action}</td>
                  <td>{record.packId}</td>
                  <td>
                    {record.packVersion}
                    {record.replacedVersion && <small>replaced {record.replacedVersion}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
