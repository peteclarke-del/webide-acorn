/* The operations the benchmark actually performs.
 *
 * Kept apart from the declarations so that the suite — what is measured, what
 * is not, and every ceiling — can be read and contract-tested without pulling
 * in an assembler and a tile map. Each runner returns how much work it did, so
 * a case that quietly produced nothing fails its budget rather than passing it
 * with the cost of doing nothing.
 */
import { assemble6502 } from '../build/assembler6502';
import { languageAdapterFor } from '../language/languageAdapter';
import { createTileMapDocument, generateTileMapOutput } from '../assets/tileMapDocument';
import { traceInstructionMatches, validateTraceConfig } from '../emulator/traceModel';
import type { ProjectFile } from '../project/project';
import type { DecodedInstructionState } from '../emulator/instructionState';

/**
 * A source of a size somebody would actually have.
 *
 * Two thousand lines, built from a repeating shape rather than the same line
 * two thousand times: a reader that memoised on the line text would measure as
 * fast as a reader that did the work, and the point is to tell them apart.
 */
export function benchmarkSource(lines = 2000): string {
  const body: string[] = ['ORG &1900', '.start'];
  for (let index = 0; index < lines; index += 1) {
    const label = `label_${index}`;
    body.push(`.${label}`);
    body.push(` LDA #&${(index & 0xff).toString(16).toUpperCase().padStart(2, '0')}`);
    body.push(` STA &${(0x2000 + (index & 0x3ff)).toString(16).toUpperCase()}`);
    if (index % 7 === 0) body.push(` JSR ${label}`);
  }
  body.push('.done', ' RTS');
  return body.join('\n');
}

export function benchmarkFile(content: string): ProjectFile {
  return { id: 'benchmark', name: 'benchmark.asm', language: '6502', content, modified: false };
}

/**
 * One keystroke applied to a large source.
 *
 * The edit is a splice at a moving point rather than an append, because an
 * append is the one edit a rope or a line cache never has to work for, and
 * measuring it would report that editing is free when it is not.
 */
export function runEditLatency(source: string, iterations: number): number {
  let content = source;
  let produced = 0;
  for (let index = 0; index < iterations; index += 1) {
    const at = Math.floor((content.length / (iterations + 1)) * (index + 1));
    content = `${content.slice(0, at)}X${content.slice(at)}`;
    /* The line the caret is on has to be found for the editor to show anything,
     * and that is the part of a keystroke that grows with the file. */
    produced += content.slice(0, at).split('\n').length;
  }
  return produced;
}

export function runDiagnostics(file: ProjectFile, iterations: number): number {
  const adapter = languageAdapterFor(file);
  if (!adapter) throw new Error('No language adapter is registered for the benchmark source, so nothing would be measured.');
  let produced = 0;
  for (let index = 0; index < iterations; index += 1) {
    produced += adapter.outline(file).length + adapter.diagnostics(file).length;
  }
  return produced;
}

export function runBuild(source: string, iterations: number): number {
  let produced = 0;
  for (let index = 0; index < iterations; index += 1) {
    produced += assemble6502(source).bytes.length;
  }
  return produced;
}

/** A trace window of the size the runtime retains, filtered as the panel does. */
export function runTraceFilter(events: number, iterations: number): number {
  const config = validateTraceConfig({ capacity: 4096, eventKinds: ['instruction'], addressStart: 0x1900, addressEnd: 0x2000 });
  const instruction = { opcode: 0xa9, mnemonic: 'LDA', operand: '#&00', bytes: [0xa9, 0x00], length: 2, cycles: 2 } as unknown as DecodedInstructionState;
  let produced = 0;
  for (let index = 0; index < iterations; index += 1) {
    for (let event = 0; event < events; event += 1) {
      if (traceInstructionMatches(config, 0x1900 + (event & 0x1fff), instruction)) produced += 1;
    }
  }
  return produced;
}

/** A tile map redrawn, which is what an asset canvas does on every stroke. */
export function runAssetCanvas(iterations: number): number {
  const document = createTileMapDocument('benchmark', 64, 64, 8, 8);
  /* Sixteen declared indices, painted across the whole map. A map that used an
   * index the tileset does not declare is refused, and rightly so — but it
   * would be refused before any drawing happened, so it would measure the
   * refusal rather than the drawing. */
  const tileset = Array.from({ length: 16 }, (_entry, index) => ({ index: index + 1, assetFile: null, properties: [index & 0xff] }));
  /* From 1, because index 0 is always the empty tile and cannot be declared. */
  const cells = document.layers[0]!.cells.map((_cell, index) => (index % 16) + 1);
  const populated = { ...document, tileset, layers: [{ ...document.layers[0]!, cells }, ...document.layers.slice(1)] };
  let produced = 0;
  for (let index = 0; index < iterations; index += 1) {
    produced += generateTileMapOutput(populated).bytes.length;
  }
  return produced;
}

/**
 * How long the shipped workbench takes to put its first frame on screen.
 *
 * Measured by loading the real built page in a frame and reading its own
 * `performance` timings, rather than by mounting a component here: the number
 * worth knowing is what the product costs, not what one of its parts costs.
 */
export async function runStartup(url: string, timeoutMs = 30_000): Promise<{ milliseconds: number; produced: number }> {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-10000px;width:1280px;height:800px;border:0';
  frame.src = url;
  const started = performance.now();
  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.addEventListener('error', () => reject(new Error(`The workbench at ${url} could not be loaded.`)), { once: true });
  });
  document.body.appendChild(frame);
  try {
    await Promise.race([
      loaded,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`The workbench at ${url} did not load within ${timeoutMs} ms.`)), timeoutMs)),
    ]);
    const view = frame.contentWindow;
    const inner = frame.contentDocument;
    if (!view || !inner) throw new Error('The workbench frame is not readable, so its startup cannot be measured.');
    /* Waited for rather than assumed from the load event: a page can fire load
     * before the application has rendered anything, and the wait is what the
     * person actually experiences. */
    const deadline = Date.now() + timeoutMs;
    let shell = inner.querySelector('.app-shell');
    while (!shell && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 16));
      shell = inner.querySelector('.app-shell');
    }
    if (!shell) throw new Error(`The workbench rendered no application shell within ${timeoutMs} ms.`);
    return { milliseconds: performance.now() - started, produced: inner.querySelectorAll('button, input, select, a[href]').length };
  } finally {
    frame.remove();
  }
}
