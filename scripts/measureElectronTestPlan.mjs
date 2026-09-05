#!/usr/bin/env node
/*
 * Runs hardware test plans on a real Acorn Electron and records what came back.
 *
 * A test runner is the one piece of a workbench that must not be taken on
 * trust, because its failure mode is silence: a runner that evaluates nothing
 * and reports "passed" removes the evidence that the product works while
 * looking like the evidence itself. So the Elkulator adapter's runner is
 * measured the same way everything else here is — by running it on the machine
 * and reading what the machine said.
 *
 * Five plans are run against one small program, and each is there for a
 * different reason:
 *
 *   - a plan whose expectations are all true must pass, with the registers,
 *     memory and cycles it actually observed;
 *   - a plan with one wrong expectation must fail, and name the one that was
 *     wrong rather than the run;
 *   - a plan whose stop address is never reached must time out, and report the
 *     cycles that really elapsed rather than the budget it was given;
 *   - a plan asserting something this core cannot observe must be refused
 *     before it runs, not reported as a pass with nothing checked;
 *   - a plan naming a second processor must be refused, because the Electron
 *     has no Tube.
 *
 * The results are frozen in `src/emulator/elkulatorTestPlanMeasurements.ts`.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node --experimental-websocket scripts/measureElectronTestPlan.mjs <dir>
 *
 * where <dir> serves elkulator.html, the core and a roms/ tree.
 */
import { argv, exit } from 'node:process';
import { probeElectronRuntime } from './electronRuntimeProbe.mjs';

/* LDA #&42 : STA &2000 : LDX #7 : JMP * — four instructions, one visible
 * memory write, and a halt loop to stop at. */
export const PROGRAM = Object.freeze([0xa9, 0x42, 0x8d, 0x00, 0x20, 0xa2, 0x07, 0x4c, 0x07, 0x19]);
export const PROGRAM_ORIGIN = 0x1900;
export const PROGRAM_STOP = 0x1907;

export const PLANS = Object.freeze([
  {
    name: 'registers and memory',
    assertions: [
      { kind: 'register', register: 'a', expected: 0x42 },
      { kind: 'register', register: 'x', expected: 7 },
      { kind: 'memory', address: 0x2000, expected: [0x42] },
      { kind: 'cycles', operator: 'lte', expected: 100 },
    ],
    captures: [{ id: 'regs', kind: 'registers' }, { id: 'result', kind: 'memory', address: 0x2000, length: 4 }],
  },
  { name: 'a wrong expectation fails', assertions: [{ kind: 'register', register: 'a', expected: 0x43 }] },
  {
    name: 'an unreachable stop times out', stopAddress: 0x7f00, cycleBudget: 5000,
    assertions: [{ kind: 'register', register: 'a', expected: 0x42 }],
  },
  {
    name: 'a screen assertion is refused',
    assertions: [{ kind: 'screen', expected: '00000000', x: 0, y: 0, width: 8, height: 8 }],
  },
  {
    name: 'a parasite test is refused', processor: 'parasite',
    assertions: [{ kind: 'register', register: 'a', expected: 0x42 }],
  },
]);

const PROBE = [
  '(async () => {',
  '  const wait = (ms) => new Promise((done) => setTimeout(done, ms));',
  '  const out = { results: [] };',
  "  window.__command({ type: 'initialise', roms: { os: '/roms/os', basic: '/roms/basic.rom' } });",
  '  await wait(4000);',
  '  const base = { bytes: PROGRAM, origin: ORIGIN, entryPoint: ORIGIN, stopAddress: STOP, cycleBudget: 100000 };',
  '  for (const plan of PLANS) {',
  '    const before = window.__events.length;',
  "    window.__command({ type: 'run-test', ...base, ...plan });",
  '    let result = null;',
  '    for (let i = 0; i < 60 && !result; i += 1) {',
  '      await wait(250);',
  "      result = window.__events.slice(before).find((event) => event.type === 'test-result') ?? null;",
  '    }',
  "    out.results.push(result ?? { name: plan.name, status: 'no result' });",
  '  }',
  '  return JSON.stringify(out);',
  '})()',
].join('\n');

async function main() {
  const root = argv[2];
  if (!root) {
    console.error('Give the directory serving elkulator.html, the core and a roms/ tree.');
    exit(2);
  }
  const expression = PROBE
    .replace('PROGRAM', JSON.stringify(PROGRAM))
    .replaceAll('ORIGIN', String(PROGRAM_ORIGIN))
    .replace('STOP', String(PROGRAM_STOP))
    .replace('PLANS', JSON.stringify(PLANS));
  const { value: measured, pageErrors } = await probeElectronRuntime(root, expression);

  for (const result of measured.results) {
    console.log(result.name, '->', result.status, '|', result.reason ?? '', '| cycles', result.cycles ?? '-');
    for (const assertion of result.assertions ?? []) {
      console.log('   ', assertion.kind, assertion.register ?? assertion.operator ?? '',
        'expected', JSON.stringify(assertion.expected), 'actual', JSON.stringify(assertion.actual),
        assertion.passed ? 'PASS' : 'FAIL');
    }
    for (const capture of result.captures ?? []) {
      console.log('    capture', capture.id, JSON.stringify(capture.registers ?? capture.bytes));
    }
  }
  console.log('page errors:', pageErrors);
  if (pageErrors.length) exit(1);
  /* The runner is only trustworthy if it can fail and refuse as well as pass. */
  const byName = new Map(measured.results.map((result) => [result.name, result.status]));
  const expected = [['registers and memory', 'passed'], ['a wrong expectation fails', 'failed'],
    ['an unreachable stop times out', 'timeout'], ['a screen assertion is refused', 'error'],
    ['a parasite test is refused', 'error']];
  const wrong = expected.filter(([name, status]) => byName.get(name) !== status);
  if (wrong.length) {
    console.error('These plans did not do what a working runner would:', wrong);
    exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
