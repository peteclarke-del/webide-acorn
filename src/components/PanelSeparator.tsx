import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_PANEL_SIZES, PANEL_BOUNDS, resizeByKey, type PanelId } from '../layout/panelLayout';

/* The grab area between two panels.
 *
 * It is a real separator rather than a decorative bar: it takes focus, reports
 * the size it governs, and moves with the arrow keys, because a workbench that
 * can only be rearranged with a mouse cannot be rearranged by everyone who uses
 * it. Home and End go to the extremes; Enter or Space returns the panel to the
 * size it started at, which is the way back from a drag somebody regrets.
 */

export interface PanelSeparatorProps {
  panel: PanelId;
  /** Which way the separator itself runs. */
  orientation: 'vertical' | 'horizontal';
  /** Whether the panel it governs lies before it in the layout. */
  before: boolean;
  /** Named for the panel it resizes, since that is what moving it changes. */
  label: string;
  size: number;
  onResize: (panel: PanelId, size: number) => void;
}

export function PanelSeparator({ panel, orientation, before, label, size, onResize }: PanelSeparatorProps) {
  const drag = useRef<{ origin: number; size: number } | null>(null);
  const bounds = PANEL_BOUNDS[panel];

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { origin: orientation === 'vertical' ? event.clientX : event.clientY, size };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const started = drag.current;
    if (!started) return;
    const now = orientation === 'vertical' ? event.clientX : event.clientY;
    /* A panel before the separator grows as the separator moves away from it;
     * one after it grows as the separator moves towards its own side. */
    const delta = (now - started.origin) * (before ? 1 : -1);
    onResize(panel, started.size + delta);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const key = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = resizeByKey(event.key, panel, size, before);
    if (next === null) return;
    event.preventDefault();
    onResize(panel, next);
  };

  return (
    <div
      className={`panel-separator ${orientation}`}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={key}
      onDoubleClick={() => onResize(panel, DEFAULT_PANEL_SIZES[panel])}
    />
  );
}
