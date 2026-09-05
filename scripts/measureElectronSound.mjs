#!/usr/bin/env node
/*
 * Asks a real Acorn Electron to make a sound, and watches its ULA while it does.
 *
 * The Electron's sound hardware is one tone generator, driven by two write-only
 * ULA registers: the divider that fixes the pitch, and two bits that turn the
 * tone on. Write-only means a program cannot read back what it asked for, and
 * neither can a debugger by reading memory — so the bridge in
 * `docker/elkulator/webide_bridge.c` publishes both, and this script is why.
 *
 * It boots an Electron on the Elkulator WebAssembly core in headless Chromium,
 * types SOUND statements at its keyboard over the ordinary runtime command
 * envelope, and records the dividers seen while each note plays. The findings
 * are written into `src/assets/electronSoundMeasurements.ts`, which the
 * always-running tests compare the song editor's Electron target against.
 *
 * It is worth having because the answers are not what the BBC would lead you to
 * expect. A note sent to a second channel does not queue behind the one playing;
 * it replaces it, and the first is lost silently. There is no volume at all.
 * Channel 0 makes noise by modulating the same generator rather than by having a
 * noise source, so noise and tone cannot sound together either. A song editor
 * that assumed otherwise would let somebody write music this machine drops half
 * of without a word.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node --experimental-websocket scripts/measureElectronSound.mjs <dir>
 *
 * where <dir> holds `roms/os` and `roms/basic.rom` and a copy of the runtime
 * page and core, laid out the way the workbench serves them. CHROMIUM_PATH
 * selects the browser. The browser plumbing is in `electronRuntimeProbe.mjs`,
 * which this shares with the other measuring scripts.
 */
import { argv, exit } from 'node:process';
import { probeElectronRuntime } from './electronRuntimeProbe.mjs';

/** The statements to play, and what each is there to establish. */
export const MEASUREMENTS = Object.freeze({
  pitches: [0, 4, 32, 53, 89, 101, 149, 197, 231, 255],
  amplitudes: [0, -1, -7, -15],
  channels: [0, 1, 2, 3],
  pairs: [
    'SOUND 1,-15,53,10:SOUND 2,-15,197,10',
    'SOUND 0,-15,5,10:SOUND 1,-15,101,10',
    'SOUND 1,-15,53,10:SOUND 1,-15,197,10',
  ],
});

const PROBE = [
  '(async () => {',
  '  const wait = (ms) => new Promise((done) => setTimeout(done, ms));',
  '  const out = { pitches: [], amplitudes: [], channels: [], pairs: [] };',
  "  window.__command({ type: 'initialise', roms: { os: '/roms/os', basic: '/roms/basic.rom' } });",
  '  await wait(4000);',
  "  const sound = async () => { window.__command({ type: 'snapshot' }); await wait(90); return window.__lastState()?.sound ?? null; };",
  '  const quiet = async () => { let run = 0; for (let i = 0; i < 120 && run < 8; i += 1) { const s = await sound(); run = (s && s.enabled) ? 0 : run + 1; } };',
  '  const play = async (statement) => {',
  '    await quiet();',
  "    window.__command({ type: 'inject-text', text: statement + String.fromCharCode(10), holdFields: 6 });",
  '    const dividers = [];',
  '    let started = false, off = 0;',
  '    for (let i = 0; i < 200; i += 1) {',
  '      const state = await sound();',
  '      if (state && state.enabled) { started = true; off = 0; dividers.push(state.divider); }',
  '      else if (started && ++off > 6) break;',
  '    }',
  '    return { statement, played: started, dividers: [...new Set(dividers)] };',
  '  };',
  '  for (const pitch of PITCHES) out.pitches.push(await play("SOUND 1,-15," + pitch + ",10"));',
  '  for (const amplitude of AMPLITUDES) out.amplitudes.push(await play("SOUND 1," + amplitude + ",101,10"));',
  '  for (const channel of CHANNELS) out.channels.push(await play("SOUND " + channel + ",-15,101,10"));',
  '  for (const pair of PAIRS) out.pairs.push(await play(pair));',
  '  out.errors = window.__errors().map((event) => event.message);',
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
    .replace('PITCHES', JSON.stringify(MEASUREMENTS.pitches))
    .replace('AMPLITUDES', JSON.stringify(MEASUREMENTS.amplitudes))
    .replace('CHANNELS', JSON.stringify(MEASUREMENTS.channels))
    .replace('PAIRS', JSON.stringify(MEASUREMENTS.pairs));
  const { value: measured, pageErrors } = await probeElectronRuntime(root, expression);

  for (const group of ['pitches', 'amplitudes', 'channels', 'pairs']) {
    console.log(`${group}:`);
    for (const entry of measured[group]) {
      console.log('  ', entry.statement, '->', entry.played ? `dividers ${JSON.stringify(entry.dividers)}` : 'silent');
    }
  }
  console.log('runtime errors:', measured.errors, 'page errors:', pageErrors);
  if (measured.errors.length || pageErrors.length) exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
