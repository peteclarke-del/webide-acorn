import { apiPath } from '../api/contracts';
/* Whether the build service is ready, and if not, what to do about it.
 *
 * The readiness endpoint existed and nothing in the product asked it. When a
 * native build failed because a toolchain was missing, the only sign was the
 * build failing, and the reason was in a container log the person using the
 * workbench cannot see.
 *
 * Every unmet check is shown with the remedy the service gave for it. Nothing
 * here decides what is wrong on its own: if the service cannot be reached at
 * all, that is what is reported, because "not ready" and "did not answer" are
 * different situations and only one of them is about a toolchain.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';

interface ReadinessCheck { check: string; ok: boolean; detail: string }

interface ToolchainStatus {
  id: string;
  label: string;
  ready: boolean;
  adapterVersion?: string;
  packageVersion?: string;
  language?: string;
  licence?: { spdx?: string };
  readiness?: ReadinessCheck[];
}

interface ReadyResponse {
  status: string;
  unmet?: Array<{ toolchain: string; check: string; detail: string }>;
  toolchains?: ToolchainStatus[];
}

type Outcome =
  | { kind: 'asking' }
  | { kind: 'answered'; body: ReadyResponse; correlationId: string | null }
  | { kind: 'unreachable'; reason: string };

export function SystemStatusPanel() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'asking' });

  const ask = useCallback(async () => {
    setOutcome({ kind: 'asking' });
    try {
      const response = await fetch(apiPath('healthReady'), { headers: { Accept: 'application/json' }, cache: 'no-store' });
      /* 503 is the service answering honestly that it is not ready, which is an
       * answer and not a failure to reach it. */
      const body = await response.json() as ReadyResponse;
      setOutcome({ kind: 'answered', body, correlationId: response.headers.get('X-Correlation-ID') });
    } catch (error) {
      setOutcome({ kind: 'unreachable', reason: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => { void ask(); }, [ask]);

  return (
    <section className="system-status panel-surface" aria-label="Build service status">
      <div className="panel-heading">
        <div><span className="eyebrow">BUILD SERVICE</span><h2>System status</h2></div>
        <button type="button" onClick={() => void ask()}><Icon name="reset" size={14} /> Check again</button>
      </div>

      {outcome.kind === 'asking' && <p role="status">Asking the build service whether it is ready…</p>}

      {outcome.kind === 'unreachable' && (
        <p className="honest-note" role="status">
          The build service did not answer, so nothing is known about the toolchains rather than assumed about them.
          Browser-local assembly is unaffected; native builds need this service. The request failed with: {outcome.reason}
        </p>
      )}

      {outcome.kind === 'answered' && (
        <>
          <p className="binding-note" role="status">
            {outcome.body.status === 'ready'
              ? 'Every pinned toolchain this service needs is present at the version it is pinned to.'
              : 'The service is running and at least one toolchain it needs is not usable. Native builds using it will fail until that is fixed.'}
            {outcome.correlationId && <> This answer is recorded under correlation identifier <code>{outcome.correlationId}</code>; quote it if you report a problem.</>}
          </p>

          {!!outcome.body.unmet?.length && (
            <div>
              <h3>What is not ready</h3>
              <ul className="system-status-unmet">
                {outcome.body.unmet.map((entry) => (
                  <li key={`${entry.toolchain}-${entry.check}`}><strong>{entry.toolchain} · {entry.check}</strong><span>{entry.detail}</span></li>
                ))}
              </ul>
            </div>
          )}

          <table className="system-status-table">
            <caption>Each toolchain as the service reports it, with the checks it ran.</caption>
            <thead><tr><th scope="col">Toolchain</th><th scope="col">Language</th><th scope="col">Version</th><th scope="col">Licence</th><th scope="col">Checks</th></tr></thead>
            <tbody>
              {(outcome.body.toolchains ?? []).map((toolchain) => {
                const checks = toolchain.readiness ?? [];
                const passed = checks.filter((check) => check.ok).length;
                return (
                  <tr key={toolchain.id} className={toolchain.ready ? undefined : 'not-ready'}>
                    <th scope="row">{toolchain.label}<small>{toolchain.id}</small></th>
                    <td>{toolchain.language ?? '—'}</td>
                    <td><code>{toolchain.packageVersion ?? toolchain.adapterVersion ?? '—'}</code></td>
                    <td><code>{toolchain.licence?.spdx ?? '—'}</code></td>
                    <td>
                      {checks.length
                        ? <span>{passed} of {checks.length} passed</span>
                        : <span>none reported</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="media-limit">
            This page reads a service endpoint that anyone who can reach the service can read. It is not an
            administrative surface and nothing here is restricted by role, because this build has no accounts to
            restrict it to; that arrives with the deferred authentication work rather than being implied here.
          </p>
        </>
      )}
    </section>
  );
}
