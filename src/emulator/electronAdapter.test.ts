import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ELECTRON_CAPABILITIES,
  ELECTRON_COMMAND_CAPABILITY,
  ELECTRON_UNAVAILABLE,
  electronCommandRefusal,
} from './electronAdapter';

/* The workbench refuses commands the Electron core cannot honour, using the
 * reason the core itself records. That is only honest while the two
 * declarations agree, so this reads the runtime the browser actually loads and
 * compares it against the module the workbench imports. */
const runtimeSource = readFileSync(resolve(process.cwd(), 'public/electron-runtime.js'), 'utf8');

function declaredBlock(name: string): string {
  const start = runtimeSource.indexOf(`const ${name} = `);
  expect(start, `${name} is declared in public/electron-runtime.js`).toBeGreaterThan(-1);
  const open = runtimeSource.indexOf(name === 'CAPABILITIES' ? '[' : '{', start);
  const closing = name === 'CAPABILITIES' ? ']' : '}';
  const opening = name === 'CAPABILITIES' ? '[' : '{';
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

describe('ElkJS Electron adapter declaration', () => {
  it('declares the same capabilities the runtime does', () => {
    const runtimeCapabilities = [...declaredBlock('CAPABILITIES').matchAll(/'([^']+)'/g)].map((match) => match[1]!);
    expect(runtimeCapabilities.slice().sort()).toEqual([...ELECTRON_CAPABILITIES].sort());
  });

  it('declares the same unavailable capabilities the runtime does', () => {
    expect(literalKeys(declaredBlock('UNAVAILABLE'))).toEqual(Object.keys(ELECTRON_UNAVAILABLE).sort());
  });

  it('records the same reason for every unavailable capability', () => {
    const block = declaredBlock('UNAVAILABLE');
    for (const [capability, reason] of Object.entries(ELECTRON_UNAVAILABLE)) {
      expect(block, `${capability} reason matches the runtime`).toContain(reason);
    }
  });

  it('maps the same commands to the same capabilities as the runtime', () => {
    const block = declaredBlock('COMMAND_CAPABILITY');
    expect(literalKeys(block)).toEqual(Object.keys(ELECTRON_COMMAND_CAPABILITY).sort());
    for (const [command, capability] of Object.entries(ELECTRON_COMMAND_CAPABILITY)) {
      const pattern = new RegExp(`(?:'${command}'|(?<![\\w-])${command})\\s*:\\s*'${capability}'`);
      expect(pattern.test(block), `${command} maps to ${capability} in the runtime`).toBe(true);
    }
  });

  it('classifies every command as either offered or refused with a reason', () => {
    const offered = new Set<string>(ELECTRON_CAPABILITIES);
    for (const [command, capability] of Object.entries(ELECTRON_COMMAND_CAPABILITY)) {
      const refusal = electronCommandRefusal(command);
      if (offered.has(capability)) expect(refusal, `${command} is offered`).toBeNull();
      else expect(refusal, `${command} is refused with a reason`).toBe(ELECTRON_UNAVAILABLE[capability]);
    }
  });

  it('never leaves a capability both offered and unavailable', () => {
    for (const capability of ELECTRON_CAPABILITIES) {
      expect(ELECTRON_UNAVAILABLE[capability], `${capability} is not also declared unavailable`).toBeUndefined();
    }
  });

  it('names a capability that exists for every command', () => {
    const known = new Set<string>([...ELECTRON_CAPABILITIES, ...Object.keys(ELECTRON_UNAVAILABLE)]);
    for (const [command, capability] of Object.entries(ELECTRON_COMMAND_CAPABILITY)) {
      expect(known.has(capability), `${command} names a declared capability`).toBe(true);
    }
  });

  it('refuses a command it has never been taught rather than passing it through', () => {
    expect(electronCommandRefusal('load-cartridge')).toBe('load-cartridge is not a command the Electron adapter accepts.');
  });

  it('offers execution, memory and program loading, and refuses stepping and breakpoints', () => {
    expect(electronCommandRefusal('run')).toBeNull();
    expect(electronCommandRefusal('read-memory')).toBeNull();
    expect(electronCommandRefusal('write-memory')).toBeNull();
    expect(electronCommandRefusal('load-machine-code')).toBeNull();
    expect(electronCommandRefusal('capture-screen')).toBeNull();
    expect(electronCommandRefusal('step')).toContain('no per-instruction hook');
    expect(electronCommandRefusal('set-breakpoints')).toContain('breakpoint could not be honoured');
    expect(electronCommandRefusal('run-test')).toContain('per-instruction hook');
    expect(electronCommandRefusal('load-disc')).toContain('not offered by this slice');
  });

  it('covers every command type the jsbeeb runtime accepts, so nothing falls through untaught', () => {
    const jsbeebSource = readFileSync(resolve(process.cwd(), 'src/emulator/runtime.ts'), 'utf8');
    const union = jsbeebSource.slice(jsbeebSource.indexOf('type CommandPayload ='), jsbeebSource.indexOf("| { type: 'stop-audio-capture' };") + 40);
    const commands = new Set<string>();
    for (const match of union.matchAll(/type:\s*((?:'[a-z0-9-]+'\s*\|\s*)*'[a-z0-9-]+')/g)) {
      for (const name of match[1]!.matchAll(/'([a-z0-9-]+)'/g)) commands.add(name[1]!);
    }
    expect(commands.size).toBeGreaterThan(40);
    const untaught = [...commands].filter((command) => ELECTRON_COMMAND_CAPABILITY[command] === undefined).sort();
    expect(untaught).toEqual([]);
  });
});
