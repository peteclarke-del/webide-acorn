#!/usr/bin/env node
/*
 * Asks a BBC Model B what each of its screen modes actually is.
 *
 * A table of BBC screen modes is the easiest thing in the world to write from
 * memory and get slightly wrong, and a game is designed against it, so this
 * puts every number to the machine instead.
 *
 * Four questions per mode, none of which needs anything to be assumed:
 *
 *   - Where does the screen start? HIMEM after a mode change is the bottom of
 *     screen memory, so &8000 minus it is what the screen costs.
 *   - Where does a program start? PAGE, which is what is left for code.
 *   - How wide is a pixel? Plot one point at the origin and walk right until
 *     POINT stops seeing it. Graphics coordinates are always 1280 by 1024, so
 *     the step is the mode's resolution.
 *   - How many logical colours? GCOL masks its argument to the mode's range, so
 *     the first colour that behaves like colour zero is the count.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureBbcScreenModes.mjs <directory containing roms/>
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';

/** The BBC's graphics coordinate space, which never changes with the mode. */
export const GRAPHICS_WIDTH = 1280;
export const GRAPHICS_HEIGHT = 1024;

/** Screen memory always ends at &8000 on a Model B. */
export const SCREEN_TOP = 0x8000;

/** Type a line and give back everything the machine printed in reply. */
export async function ask(machine, line, seconds = 10) {
  await machine.type(line);
  let text = '';
  for (let index = 0; index < seconds; index += 1) { await machine.runFor(2_000_000); text += machine.drainText({ raw: true }); }
  return text.trim();
}

/** The last whitespace-separated fields the machine printed, as numbers. */
function answered(reply, count) {
  const fields = reply.split('\n').at(-2)?.trim().split(/\s+/) ?? [];
  return fields.slice(-count).map((field) => Number.parseInt(field, 16));
}

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const machine = new TestMachine('B');
  await machine.initialise();
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  console.log('machine:', JSON.stringify(banner.split('\n').filter(Boolean)[0]));

  for (let mode = 0; mode <= 7; mode += 1) {
    const memory = answered(await ask(machine, `MODE ${mode}:PRINT ~PAGE,~HIMEM`), 2);
    const [page, himem] = memory;
    const prefix = `MODE ${mode}  page &${page.toString(16).toUpperCase()}  himem &${himem.toString(16).toUpperCase()}  screen ${SCREEN_TOP - himem} bytes`;
    if (mode === 7) {
      console.log(`${prefix}  teletext, so there are no pixels to measure`);
      continue;
    }
    /* Modes 3 and 6 are text only. Asking the machine rather than knowing it:
     * a point plotted at the origin is not there afterwards. */
    const plotted = answered(await ask(machine, `MODE ${mode}:GCOL 0,1:PLOT 69,0,0:PRINT ~POINT(0,0)`, 15), 1);
    if (plotted[0] !== 1) {
      console.log(`${prefix}  text only: a point plotted at the origin is not there afterwards`);
      continue;
    }
    /* One point at the origin, then walk right and up until POINT loses it.
     * The step is one pixel in graphics units. */
    const across = answered(await ask(machine,
      `MODE ${mode}:GCOL 0,1:PLOT 69,0,0:X%=0:REPEAT X%=X%+1:UNTIL POINT(X%,0)<>1 OR X%>32:Y%=0:REPEAT Y%=Y%+1:UNTIL POINT(0,Y%)<>1 OR Y%>32:PRINT ~X%,~Y%`, 20), 2);
    const colours = answered(await ask(machine,
      `MODE ${mode}:C%=0:REPEAT C%=C%+1:GCOL 0,C%:PLOT 69,0,0:UNTIL POINT(0,0)=0 OR C%>16:PRINT ~C%`, 20), 1);
    const [stepX, stepY] = across;
    console.log(
      `${prefix}` +
      `  ${GRAPHICS_WIDTH / stepX} by ${GRAPHICS_HEIGHT / stepY} pixels` +
      `  ${colours[0]} logical colours`,
    );
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
