/* What this build has conformance evidence for, and what it does not.
 *
 * The uncovered areas are the reason this panel exists. A list of cases that
 * pass is reassuring and answers the wrong question: what somebody needs to
 * know is where a fault would go unnoticed, and that is the areas with no cases
 * at all. So they are listed first, named, and not counted as anything.
 *
 * Nothing here runs a case. A case that has not been executed against a real
 * machine is shown as not run, because a suite that presented an unrun case as
 * anything else would be the exact failure it exists to catch.
 */
import { useMemo } from 'react';
import {
  AREA_LABELS,
  CONFORMANCE_CASES,
  caseApplies,
  casesForArea,
  suiteCoverage,
  type ConformanceArea,
} from '../testing/conformanceSuite';

interface ConformancePanelProps {
  machineId: string;
  capabilities: readonly string[];
  /** Results from runs that actually happened, keyed by case identifier. */
  results?: Record<string, { passed: boolean; detail: string }>;
}

export function ConformancePanel({ machineId, capabilities, results }: ConformancePanelProps) {
  const coverage = useMemo(() => suiteCoverage(), []);
  const machine = useMemo(() => ({ machineId, capabilities }), [machineId, capabilities]);

  return (
    <section className="conformance-panel panel-surface" aria-label="Platform conformance">
      <div className="panel-heading">
        <div><span className="eyebrow">EVIDENCE FOR WHAT THIS EMULATES</span><h2>Platform conformance</h2></div>
        <small>{coverage.coveredAreas} of {coverage.totalAreas} areas have cases</small>
      </div>

      <p className={coverage.uncovered.length ? 'dfs-warning' : 'binding-note'} role="status">{coverage.summary}</p>

      {coverage.uncovered.length > 0 && (
        <div>
          <h3>Areas with no conformance cases</h3>
          <ul className="system-status-unmet">
            {coverage.uncovered.map((area: ConformanceArea) => (
              <li key={area}>
                <strong>{AREA_LABELS[area]}</strong>
                <span>Nothing here checks this. It is not known to be wrong and it is not known to be right.</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <table className="conformance-table">
        <caption>Every case, and whether it has been run on this machine.</caption>
        <thead>
          <tr><th scope="col">Area</th><th scope="col">Case</th><th scope="col">Applies here</th><th scope="col">Result</th></tr>
        </thead>
        <tbody>
          {coverage.areas.filter((entry) => entry.covered).flatMap((entry) => casesForArea(entry.area).map((item) => {
            const standing = caseApplies(item, machine);
            const result = results?.[item.id];
            return (
              <tr key={item.id}>
                <th scope="row">{AREA_LABELS[item.area]}</th>
                <td>{item.title}<small>{item.rationale}</small></td>
                <td>{standing.applies ? 'yes' : <span title={standing.reason ?? undefined}>no</span>}</td>
                <td>
                  {!standing.applies
                    ? <span className="sideways-empty">not applicable</span>
                    : result
                      ? <span className={result.passed ? 'state-pill supported' : 'state-pill'}>{result.passed ? 'passed' : 'failed'}</span>
                      : <span className="sideways-empty">not run</span>}
                  {result && <small>{result.detail}</small>}
                </td>
              </tr>
            );
          }))}
        </tbody>
      </table>

      <p className="media-limit">
        A case that has not been run against a real machine is shown as not run. Running one needs the selected machine
        ROM set and goes through the same hardware-test path as any other test in this workbench, so a case here is one
        somebody can also run by hand.
      </p>
    </section>
  );
}

export { CONFORMANCE_CASES };
