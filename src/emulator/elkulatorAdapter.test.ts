import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ELKULATOR_CAPABILITIES,
  ELKULATOR_COMMAND_CAPABILITY,
  ELKULATOR_UNAVAILABLE,
  elkulatorCommandRefusal,
} from './elkulatorAdapter';
import { ELECTRON_COMMAND_CAPABILITY } from './electronAdapter';

/* The workbench refuses commands this Electron core cannot honour, using the
 * reason the core itself records. That is only honest while the two
 * declarations agree, so this reads the runtime the browser actually loads and
 * compares it against the module the workbench imports. */
const runtimeSource = readFileSync(resolve(process.cwd(), 'public/elkulator-runtime.js'), 'utf8');
const bridgeSource = readFileSync(resolve(process.cwd(), 'docker/elkulator/webide_bridge.c'), 'utf8');

function declaredBlock(name: string): string {
  const start = runtimeSource.indexOf(`const ${name} = `);
  expect(start, `${name} is declared in public/elkulator-runtime.js`).toBeGreaterThan(-1);
  const opening = name === 'CAPABILITIES' ? '[' : '{';
  const closing = name === 'CAPABILITIES' ? ']' : '}';
  const open = runtimeSource.indexOf(opening, start);
  let depth = 0;
  for (let index = open; index < runtimeSource.length; index += 1) {
    if (runtimeSource[index] === opening) depth += 1;
    if (runtimeSource[index] === closing) {
      depth -= 1;
      if (depth === 0) return runtimeSource.slice(open, index + 1);
    }
  }
  throw new Error(`${name} is not a balanced literal`);
}

/** Keys of an object literal, whether quoted or bare. */
function literalKeys(block: string): string[] {
  return [...block.matchAll(/(?:^|[{,]\s*)(?:'([^']+)'|([A-Za-z][\w-]*))\s*:/g)]
    .map((match) => match[1] ?? match[2]!)
    .sort();
}

describe('Elkulator Electron adapter declaration', () => {
  it('declares the same capabilities the runtime does', () => {
    const runtimeCapabilities = [...declaredBlock('CAPABILITIES').matchAll(/'([^']+)'/g)].map((match) => match[1]!);
    expect(runtimeCapabilities.slice().sort()).toEqual([...ELKULATOR_CAPABILITIES].sort());
  });

  it('declares the same unavailable capabilities the runtime does', () => {
    expect(literalKeys(declaredBlock('UNAVAILABLE'))).toEqual(Object.keys(ELKULATOR_UNAVAILABLE).sort());
  });

  it('records the same reason for every unavailable capability', () => {
    const block = declaredBlock('UNAVAILABLE');
    for (const [capability, reason] of Object.entries(ELKULATOR_UNAVAILABLE)) {
      expect(block, `${capability} reason matches the runtime`).toContain(reason);
    }
  });

  it('maps the same commands to the same capabilities as the runtime', () => {
    const block = declaredBlock('COMMAND_CAPABILITY');
    expect(literalKeys(block)).toEqual(Object.keys(ELKULATOR_COMMAND_CAPABILITY).sort());
    for (const [command, capability] of Object.entries(ELKULATOR_COMMAND_CAPABILITY)) {
      const pattern = new RegExp(`(?:'${command}'|(?<![\\w-])${command})\\s*:\\s*'${capability}'`);
      expect(pattern.test(block), `${command} maps to ${capability} in the runtime`).toBe(true);
    }
  });

  it('classifies every command as either offered or refused with a reason', () => {
    const offered = new Set<string>(ELKULATOR_CAPABILITIES);
    for (const [command, capability] of Object.entries(ELKULATOR_COMMAND_CAPABILITY)) {
      const refusal = elkulatorCommandRefusal(command);
      if (offered.has(capability)) expect(refusal, `${command} is offered`).toBeNull();
      else expect(refusal, `${command} is refused with a reason`).toBe(ELKULATOR_UNAVAILABLE[capability]);
    }
  });

  it('never leaves a capability both offered and unavailable', () => {
    for (const capability of ELKULATOR_CAPABILITIES) {
      expect(ELKULATOR_UNAVAILABLE[capability], `${capability} is not also declared unavailable`).toBeUndefined();
    }
  });

  it('names a capability that exists for every command', () => {
    const known = new Set<string>([...ELKULATOR_CAPABILITIES, ...Object.keys(ELKULATOR_UNAVAILABLE)]);
    for (const [command, capability] of Object.entries(ELKULATOR_COMMAND_CAPABILITY)) {
      expect(known.has(capability), `${command} names a declared capability`).toBe(true);
    }
  });

  it('refuses a command it has never been taught rather than passing it through', () => {
    expect(elkulatorCommandRefusal('load-cartridge')).toBe('load-cartridge is not a command the Elkulator adapter accepts.');
  });

  it('answers for exactly the same command vocabulary as the other Electron core', () => {
    /* Two adapters for one machine that disagreed about which commands exist
     * would let a command be refused by one and unknown to the other, which
     * reads to a user as the same machine behaving differently by accident. */
    expect(Object.keys(ELKULATOR_COMMAND_CAPABILITY).sort()).toEqual(Object.keys(ELECTRON_COMMAND_CAPABILITY).sort());
  });

  it('offers what the ElkJS core has to refuse, and says so for the rest', () => {
    for (const command of ['step', 'step-over', 'set-breakpoints', 'run-to', 'write-registers', 'run-test', 'inject-text', 'tap-key']) {
      expect(elkulatorCommandRefusal(command), `${command} is offered here`).toBeNull();
    }
    expect(elkulatorCommandRefusal('watchpoint')).toContain('no hook');
    expect(elkulatorCommandRefusal('read-tube-memory')).toContain('no Tube interface');
    expect(elkulatorCommandRefusal('set-audio')).toContain('has not been verified');
    expect(elkulatorCommandRefusal('load-disc')).toContain('mounts none');
  });

  it('covers every command type the jsbeeb runtime accepts, so nothing falls through untaught', () => {
    const jsbeebSource = readFileSync(resolve(process.cwd(), 'src/emulator/runtime.ts'), 'utf8');
    const union = jsbeebSource.slice(jsbeebSource.indexOf('type CommandPayload ='), jsbeebSource.indexOf("| { type: 'stop-audio-capture' };") + 40);
    const commands = new Set<string>();
    for (const match of union.matchAll(/type:\s*((?:'[a-z0-9-]+'\s*\|\s*)*'[a-z0-9-]+')/g)) {
      for (const name of match[1]!.matchAll(/'([a-z0-9-]+)'/g)) commands.add(name[1]!);
    }
    expect(commands.size).toBeGreaterThan(40);
    const untaught = [...commands].filter((command) => ELKULATOR_COMMAND_CAPABILITY[command] === undefined).sort();
    expect(untaught).toEqual([]);
  });

  it('asks the bridge only for entry points the bridge actually exports', () => {
    /* The runtime calls into the WebAssembly core by name. A name that is not
     * there fails at runtime with nothing to say, so it is checked against the
     * bridge's own source here instead. */
    const exported = new Set([...bridgeSource.matchAll(/EMSCRIPTEN_KEEPALIVE\s+(elk_webide_[a-z_]+)/g)].map((match) => match[1]!));
    expect(exported.size).toBeGreaterThan(15);
    const called = new Set([...runtimeSource.matchAll(/call\('(elk_webide_[a-z_]+)'/g)].map((match) => match[1]!));
    expect(called.size).toBeGreaterThan(10);
    expect([...called].filter((name) => !exported.has(name)).sort()).toEqual([]);
  });

  it('offers a capability only where the bridge carries something that could provide it', () => {
    /* Each offered capability names the bridge entry point it rests on. A
     * capability with nothing behind it is the failure this adapter exists to
     * prevent, so it is asserted rather than assumed. */
    const behind: Record<string, string> = {
      execution: 'elk_webide_resume',
      reset: 'elk_webide_reset',
      'instruction-step': 'elk_webide_step',
      'execute-breakpoint': 'elk_webide_set_breakpoint',
      'register-read': 'elk_webide_get_register',
      'register-write': 'elk_webide_set_register',
      'memory-read': 'elk_webide_read_ram',
      'memory-write': 'elk_webide_write_memory',
      'program-load': 'elk_webide_load',
      'run-test': 'elk_webide_breakpoint_hit',
      'key-injection': 'elk_webide_set_key',
    };
    for (const capability of ELKULATOR_CAPABILITIES) {
      const entry = behind[capability];
      if (!entry) continue;
      expect(bridgeSource, `${capability} rests on ${entry}`).toContain(`EMSCRIPTEN_KEEPALIVE ${entry}`);
    }
    /* And the ones with no bridge entry are the ones the browser provides:
     * the keyboard SDL installs, the canvas, its filter, its capture and its
     * focus. Naming them here stops the list above being quietly incomplete. */
    const browserProvided = ['keyboard-input', 'display', 'display-filter', 'screen-capture', 'input-focus'];
    expect([...ELKULATOR_CAPABILITIES].filter((capability) => !behind[capability]).sort()).toEqual(browserProvided.slice().sort());
  });
});
