/* Two machines, side by side, before the work is committed to either.
 *
 * The portability warnings already existed and were raised at the moment a
 * project was opened — which is the right moment to be told, and the wrong
 * moment to be deciding. By then the choice has been made and the person is
 * reading a warning about something they cannot easily undo.
 *
 * This is the other half: pick any two configurations this build knows and see
 * what differs and what would not survive a move, before choosing. It answers a
 * question the warnings cannot, because the warnings only ever compare the
 * project you have with the machine you are on.
 *
 * Everything shown comes from `compareConfigurations`, which the warnings also
 * use. Two surfaces answering the same question differently would be worse than
 * one, so there is only one answer and this presents it.
 */
import { useMemo, useState } from 'react';
import { machineProfiles } from '../data/machines';
import { compareConfigurations, configurationSummary, resolveConfiguration } from '../profiles/profileRegistry';

interface Choice {
  machineId: string;
  variant: string;
  romId: string;
}

function defaultChoice(machineId: string): Choice {
  const machine = machineProfiles.find((candidate) => candidate.id === machineId) ?? machineProfiles[0]!;
  return { machineId: machine.id, variant: machine.variants[0] ?? '', romId: machine.roms[0]?.id ?? '' };
}

export function ProfileComparisonPanel() {
  const [left, setLeft] = useState<Choice>(() => defaultChoice(machineProfiles[0]!.id));
  const [right, setRight] = useState<Choice>(() => defaultChoice(machineProfiles[1]?.id ?? machineProfiles[0]!.id));

  const resolved = (choice: Choice) => {
    const machine = machineProfiles.find((candidate) => candidate.id === choice.machineId) ?? machineProfiles[0]!;
    return resolveConfiguration({
      platformClass: machine.platformClass,
      machineId: choice.machineId,
      variant: choice.variant,
      romId: choice.romId,
      /* Every capability the machine actually offers, so the comparison is
       * between the machines rather than between two arbitrary subsets. */
      enabledCapabilities: machine.capabilities.filter((capability) => capability.state !== 'planned').map((capability) => capability.id),
    });
  };

  const from = useMemo(() => resolved(left), [left]);
  const to = useMemo(() => resolved(right), [right]);
  const report = useMemo(() => compareConfigurations(from.target, to.target), [from, to]);

  const chooser = (side: 'left' | 'right', choice: Choice, set: (next: Choice) => void) => {
    const machine = machineProfiles.find((candidate) => candidate.id === choice.machineId) ?? machineProfiles[0]!;
    const label = side === 'left' ? 'first' : 'second';
    return (
      <div className="profile-choice">
        <label>
          <span>Machine</span>
          <select
            aria-label={`${label} machine`}
            value={choice.machineId}
            onChange={(event) => set(defaultChoice(event.target.value))}
          >
            {machineProfiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
        <label>
          <span>Variant</span>
          <select
            aria-label={`${label} variant`}
            value={choice.variant}
            onChange={(event) => set({ ...choice, variant: event.target.value })}
          >
            {machine.variants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}
          </select>
        </label>
        <label>
          <span>Firmware</span>
          <select
            aria-label={`${label} firmware`}
            value={choice.romId}
            onChange={(event) => set({ ...choice, romId: event.target.value })}
          >
            {machine.roms.map((rom) => <option key={rom.id} value={rom.id}>{rom.label}</option>)}
          </select>
        </label>
      </div>
    );
  };

  const same = !report.differences.length;

  return (
    <section className="profile-comparison panel-surface" aria-label="Compare machine profiles">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BEFORE YOU COMMIT TO ONE</span>
          <h2>Compare two machines</h2>
        </div>
      </div>
      <p className="binding-note">
        What differs between two configurations, and what would not survive moving work from the first to the second.
        The same comparison is raised when a project is opened against a different machine; this is it before the
        choice is made rather than after.
      </p>

      <div className="profile-choices">
        {chooser('left', left, setLeft)}
        {chooser('right', right, setRight)}
      </div>

      <div className="profile-summaries">
        <p><strong>First</strong> <span>{configurationSummary(from)}</span></p>
        <p><strong>Second</strong> <span>{configurationSummary(to)}</span></p>
      </div>

      <div>
        <h3>Differences</h3>
        {same
          ? <p role="status">These two configurations are the same in every respect this build compares.</p>
          : (
            <table className="profile-difference-table">
              <thead><tr><th scope="col">What</th><th scope="col">First</th><th scope="col">Second</th></tr></thead>
              <tbody>
                {report.differences.map((difference) => (
                  <tr key={difference.field}>
                    <th scope="row">{difference.field}</th>
                    <td>{difference.from}</td>
                    <td>{difference.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <div>
        <h3>What would not survive the move</h3>
        {report.warnings.length
          ? <ul className="profile-warnings">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          : (
            <p role="status">
              {same
                ? 'Nothing, because nothing differs.'
                : 'Nothing this build can identify. The differences above are real but none of them stops work moving between these two.'}
            </p>
          )}
      </div>

      {(from.diagnostics.length > 0 || to.diagnostics.length > 0) && (
        <div>
          <h3>What this build had to change to resolve these</h3>
          <ul className="profile-warnings">
            {/*
              * Both sides of the comparison are listed together, and the two
              * configurations frequently have the same thing to say — the same
              * capability needing the same variant. Keying by what was said
              * gave two children the same key, which React warns about because
              * it can drop or duplicate one of them. The side is part of the
              * identity, so it is part of the key.
              */}
            {[
              ...from.diagnostics.map((diagnostic) => ({ diagnostic, side: 'from' })),
              ...to.diagnostics.map((diagnostic) => ({ diagnostic, side: 'to' })),
            ].map(({ diagnostic, side }, index) => (
              <li key={`${side}-${index}-${diagnostic.kind}-${diagnostic.requested}`}>{diagnostic.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
