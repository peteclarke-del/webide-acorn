/*
 * What the machine's transport controls are called, and why it matters.
 *
 * These four buttons — run, pause, step, reset — sit in the emulator panel and
 * do two different jobs depending on whether a real machine is attached or the
 * bounded ROM-less runtime is. Their names did not follow that, and two of them
 * were wrong in ways that cost a person real time:
 *
 *  - The run button was always called "Run program". With a machine attached it
 *    resumes the machine, which is not running your program: your build reaches
 *    the machine through Build and debug. Only the tooltip said which, and a
 *    tooltip is not an accessible name.
 *  - The pause button was called "Step instruction" when no machine was
 *    attached, and stepped. So a pause icon stepped, and two adjacent buttons
 *    announced themselves identically — one of the few things a screen reader
 *    user cannot work around, because the name is all they have.
 *
 * The names are computed here so they can be tested as a set, which is the
 * only way to check the property that was violated: that no two controls in
 * this group share a name.
 */

export interface TransportState {
  /** Whether a real emulated machine is attached, powered and ready. */
  machineAttached: boolean;
  machinePowered: boolean;
  /** Whether a build exists for the ROM-less runtime to hold. */
  artifactLoaded: boolean;
  /** A reason the adapter refuses stepping, if it does. */
  stepRefusal?: string | null;
}

export interface TransportControl {
  id: 'run' | 'pause' | 'step' | 'reset';
  /** The accessible name: what a screen reader announces. */
  name: string;
  /** The tooltip, which may say more but never less. */
  title: string;
  disabled: boolean;
}

export function transportControls(state: TransportState): TransportControl[] {
  const live = state.machineAttached && state.machinePowered;
  return [
    {
      id: 'run',
      name: state.machineAttached ? 'Resume machine' : 'Run program',
      title: state.machineAttached
        ? state.machinePowered
          ? 'Resume the emulated machine. To put this build on it, use Build and debug.'
          : 'Power on the machine first'
        : state.artifactLoaded
          ? 'Continue the loaded program'
          : 'Supply the selected ROM set or build assembly first',
      disabled: state.machineAttached ? !state.machinePowered : !state.artifactLoaded,
    },
    {
      id: 'pause',
      name: 'Pause machine',
      title: state.machineAttached
        ? state.machinePowered ? 'Pause the emulated machine' : 'Power on the machine first'
        : 'Nothing is running to pause: without a machine, a program runs to completion. Use Step to advance one instruction.',
      disabled: !live,
    },
    {
      id: 'step',
      name: 'Step instruction',
      title: state.stepRefusal
        ?? (state.machineAttached && !state.machinePowered ? 'Power on the machine first' : 'Execute one processor instruction'),
      disabled: (state.machineAttached ? !state.machinePowered : !state.artifactLoaded) || !!state.stepRefusal,
    },
    {
      id: 'reset',
      name: 'Reset runtime',
      title: state.machineAttached
        ? state.machinePowered ? 'Hard reset the emulated machine' : 'Power on the machine first'
        : state.artifactLoaded ? 'Reset memory and registers' : 'No runtime is connected',
      disabled: state.machineAttached ? !state.machinePowered : !state.artifactLoaded,
    },
  ];
}
