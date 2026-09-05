/*
 * What to say when a run produced no report.
 *
 * A test plan that cannot run retains no result, so the workbench's export
 * buttons stay disabled and the runner waits for a report that will never
 * arrive. Left to the timeout, the operator is told "Native report export timed
 * out", which names neither the plan that was wrong nor what was wrong with it,
 * and points at the export rather than at the fix. This builds the refusal that
 * does.
 */

/** The refusal for rows that could not run, or null when every plan ran. */
export function unrunnablePlanRefusal(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Test-all rows must be an array');
  const unrunnable = rows.filter((row) => row?.status === 'error');
  if (!unrunnable.length) return null;
  const detail = unrunnable
    .map((row) => `  ${row.name || 'an unnamed plan'}: ${row.message || 'no reason given'}`)
    .join('\n');
  return `${unrunnable.length} of ${rows.length} test plans could not run, so no report was produced:\n${detail}\nFix the plan in the project and run again.`;
}
