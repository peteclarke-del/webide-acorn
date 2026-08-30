/* The sideways ROM banks, as sixteen rows a person fills.
 *
 * Mounting worked before this and chose the bank itself, which is enough to run
 * a machine and not enough to develop for one: a sideways ROM's bank decides
 * its service-call priority, so it decides which ROM answers a `*` command
 * first and which one wins when two claim the same name. None of that is
 * visible if the product picks the number.
 *
 * Every bank is shown, filled or not, because an empty bank is information —
 * it is where the next ROM can go, and its number is what that ROM's priority
 * will be. The list is ordered the way the hardware numbers them, with the
 * service-call order stated separately rather than left to be known.
 */
import { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import {
  SIDEWAYS_BANKS,
  assignBank,
  bankRows,
  clearBank,
  serviceCallOrder,
  validateSidewaysImage,
  type SidewaysAssignment,
} from '../rom/sidewaysSlots';

interface SidewaysSlotPanelProps {
  /** Whether this machine has sideways RAM or ROM fitted at all. */
  available: boolean;
  /** Why not, when it is not. Stated rather than left as an absence. */
  unavailableReason?: string;
  layout: SidewaysAssignment[];
  onChange: (layout: SidewaysAssignment[]) => void;
  onNotice: (message: string) => void;
}

export function SidewaysSlotPanel({ available, unavailableReason, layout, onChange, onNotice }: SidewaysSlotPanelProps) {
  const [pendingBank, setPendingBank] = useState(15);
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => bankRows(layout), [layout]);
  const order = useMemo(() => serviceCallOrder(layout), [layout]);

  if (!available) {
    return (
      <section className="sideways-slots panel-surface" aria-label="Sideways ROM banks">
        <div className="panel-heading"><div><span className="eyebrow">EXPANSION ROM</span><h2>Sideways banks</h2></div></div>
        <p className="binding-note" role="status">
          {unavailableReason ?? 'This machine has no sideways ROM, so there are no banks to fill.'}
        </p>
      </section>
    );
  }

  const place = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const problems = validateSidewaysImage(bytes, file.name);
      if (problems.length) { onNotice(problems[0]!.reason); return; }
      const result = assignBank(layout, { bank: pendingBank, romId: `${file.name}:${bytes.length}`, label: file.name });
      if (result.problem) { onNotice(result.problem.reason); return; }
      onChange(result.layout);
      onNotice(`${file.name} placed in bank ${pendingBank}`);
    } catch (error) {
      onNotice(`${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const remove = (bank: number) => {
    const result = clearBank(layout, bank);
    if (result.problem) { onNotice(result.problem.reason); return; }
    onChange(result.layout);
    onNotice(`Bank ${bank} emptied`);
  };

  return (
    <section className="sideways-slots panel-surface" aria-label="Sideways ROM banks">
      <div className="panel-heading">
        <div><span className="eyebrow">EXPANSION ROM</span><h2>Sideways banks</h2></div>
        <small>{layout.length} of {SIDEWAYS_BANKS} filled</small>
      </div>
      <p className="binding-note">
        A sideways ROM's bank decides its service-call priority: the machine offers a call to bank {SIDEWAYS_BANKS - 1}
        first and bank 0 last, so two ROMs claiming the same star command are resolved by bank number. Nothing is moved
        for you, because the bank is the thing being chosen. ROM images stay in this browser and are never uploaded.
      </p>

      <div className="sideways-place">
        <label>
          <span>Bank</span>
          <select aria-label="Bank to fill" value={pendingBank} onChange={(event) => setPendingBank(Number(event.target.value))}>
            {rows.map((row) => (
              <option key={row.bank} value={row.bank} disabled={!!row.assignment}>
                {row.bank}{row.assignment ? ` — ${row.assignment.label}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="sideways-picker">
          <input
            ref={fileRef}
            type="file"
            accept=".rom,.bin,application/octet-stream"
            aria-label="Choose a sideways ROM image"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void place(file); }}
          />
          <Icon name="open" size={14} /> Place a ROM in bank {pendingBank}
        </label>
      </div>

      <table className="sideways-table">
        <thead><tr><th scope="col">Bank</th><th scope="col">Contents</th><th scope="col" /></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.bank} className={row.assignment ? 'filled' : undefined}>
              <th scope="row">{row.bank}</th>
              <td>
                {row.assignment
                  ? <>{row.assignment.label}{row.assignment.reserved && <small> · part of this machine's own firmware</small>}</>
                  : <span className="sideways-empty">empty</span>}
              </td>
              <td>
                {row.assignment && !row.assignment.reserved && (
                  <button type="button" aria-label={`Empty bank ${row.bank}`} onClick={() => remove(row.bank)}>Empty</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.length > 1 && (
        <div>
          <h3>Service-call order</h3>
          <p className="binding-note">
            {order.map((entry) => `${entry.label} (bank ${entry.bank})`).join(', then ')}.
          </p>
        </div>
      )}
    </section>
  );
}
