import { describe, expect, it } from 'vitest';
import { transportControls, type TransportState } from './machineTransportControls';

const states: Array<[string, TransportState]> = [
  ['a live machine', { machineAttached: true, machinePowered: true, artifactLoaded: true }],
  ['a machine powered off', { machineAttached: true, machinePowered: false, artifactLoaded: true }],
  ['no machine, with a build', { machineAttached: false, machinePowered: false, artifactLoaded: true }],
  ['no machine and no build', { machineAttached: false, machinePowered: false, artifactLoaded: false }],
  ['a machine that refuses stepping', { machineAttached: true, machinePowered: true, artifactLoaded: true, stepRefusal: 'This core has no per-instruction hook' }],
];

describe('the machine transport controls', () => {
  it('never gives two of them the same name', () => {
    /* The property that was violated: with no machine attached, the pause
     * button was called "Step instruction" like the step button beside it. Two
     * controls announcing themselves identically is the one thing a screen
     * reader user cannot work around, because the name is all they have. */
    for (const [label, state] of states) {
      const names = transportControls(state).map((control) => control.name);
      expect(new Set(names).size, `${label} gives every control its own name`).toBe(names.length);
    }
  });

  it('calls the run button what it will actually do', () => {
    /* With a machine attached it resumes the machine — which is not running
     * your program. Your build reaches the machine through Build and debug. */
    const withMachine = transportControls(states[0]![1]).find((control) => control.id === 'run')!;
    expect(withMachine.name).toBe('Resume machine');
    expect(withMachine.title).toContain('Build and debug');
    const withoutMachine = transportControls(states[2]![1]).find((control) => control.id === 'run')!;
    expect(withoutMachine.name).toBe('Run program');
  });

  it('always calls the pause button pause, because it always looks like one', () => {
    for (const [label, state] of states) {
      const pause = transportControls(state).find((control) => control.id === 'pause')!;
      expect(pause.name, label).toBe('Pause machine');
    }
  });

  it('offers no pause when there is nothing that runs', () => {
    /* The ROM-less runtime executes to completion rather than running, so there
     * is no moment at which pausing means anything. It used to step instead,
     * which is what the step button is for. */
    const pause = transportControls(states[2]![1]).find((control) => control.id === 'pause')!;
    expect(pause.disabled).toBe(true);
    expect(pause.title).toContain('runs to completion');
    expect(pause.title).toContain('Use Step');
  });

  it('disables everything a powered-off machine cannot do, and says why', () => {
    for (const control of transportControls(states[1]![1])) {
      expect(control.disabled, control.id).toBe(true);
      expect(control.title, control.id).toContain('Power on the machine first');
    }
  });

  it('passes an adapter\'s own refusal through rather than inventing one', () => {
    const step = transportControls(states[4]![1]).find((control) => control.id === 'step')!;
    expect(step.disabled).toBe(true);
    expect(step.title).toBe('This core has no per-instruction hook');
  });

  it('gives every control a name and a tooltip in every state', () => {
    for (const [label, state] of states) {
      for (const control of transportControls(state)) {
        expect(control.name.length, `${label} · ${control.id}`).toBeGreaterThan(3);
        expect(control.title.length, `${label} · ${control.id}`).toBeGreaterThan(10);
      }
    }
  });
});
