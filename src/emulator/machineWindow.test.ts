import { describe, expect, it } from 'vitest';
import { isDetached, isMachineHandoff, peerWindowOf, popoutWindowFeatures } from './machineWindow';

describe('the machine in its own window', () => {
  it('reports to the window that opened it, and otherwise to the one framing it', () => {
    const self = {}; const opener = {}; const parent = {};
    expect(peerWindowOf({ opener, parent, self })).toBe(opener);
    expect(peerWindowOf({ opener: null, parent, self })).toBe(parent);
    /* A top-level page's opener can be itself in some browsers; that is not a peer. */
    expect(peerWindowOf({ opener: self, parent, self })).toBe(parent);
    expect(isDetached({ opener, self })).toBe(true);
    expect(isDetached({ opener: null, self })).toBe(false);
  });

  it('asks for a plain resizable window no smaller than a screen', () => {
    expect(popoutWindowFeatures(1060, 720)).toBe('popup=yes,width=1060,height=720,resizable=yes');
    expect(popoutWindowFeatures(10, 10)).toBe('popup=yes,width=320,height=240,resizable=yes');
  });

  it('accepts a handoff only with the state and whether the machine was running', () => {
    expect(isMachineHandoff({ json: '{}', running: true })).toBe(true);
    expect(isMachineHandoff({ json: '{}' })).toBe(false);
    expect(isMachineHandoff(null)).toBe(false);
  });
});
