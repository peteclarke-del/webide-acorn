/*
 * The machine in its own window.
 *
 * The runtime is a page of its own, spoken to by messages, so it can sit in
 * the workbench's frame or in a window the workbench opened; what changes is
 * which window is its peer. Detaching moves the machine, state and all: the
 * runtime hands its state over, the new page loads it, and the workbench
 * re-arms what it knows (the program's source map and the breakpoints), so
 * the debugger goes on working against the window.
 */

export const POPOUT_WINDOW_NAME = '8bit-net-machine';

/** The window a runtime page reports to: the one that opened it, else the one it is framed in. */
export function peerWindowOf(target: { opener: unknown; parent: unknown; self?: unknown }): unknown {
  return target.opener && target.opener !== target.self ? target.opener : target.parent;
}

/** Whether a runtime page is in a window of its own rather than a frame. */
export function isDetached(target: { opener: unknown; self?: unknown }): boolean {
  return !!target.opener && target.opener !== target.self;
}

/** The features string for the machine's window: a plain window the person can size and put full screen. */
export function popoutWindowFeatures(width: number, height: number): string {
  const w = Math.max(320, Math.round(width)); const h = Math.max(240, Math.round(height));
  return `popup=yes,width=${w},height=${h},resizable=yes`;
}

/** What one runtime hands to the next when the machine moves window. */
export interface MachineHandoff { json: string; running: boolean }

export function isMachineHandoff(value: unknown): value is MachineHandoff {
  return !!value && typeof value === 'object' && typeof (value as MachineHandoff).json === 'string' && typeof (value as MachineHandoff).running === 'boolean';
}
