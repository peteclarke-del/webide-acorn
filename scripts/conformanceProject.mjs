#!/usr/bin/env node
/* Turn the conformance cases into a project the headless runner can drive.
 *
 * Generated from the suite module itself rather than from a hand-kept copy, so
 * the cases that run on a real machine are the same objects the suite reports
 * coverage for. Two declarations of that would eventually disagree about what
 * was actually proved, which for a conformance suite is the whole game.
 *
 * The module is TypeScript, so it is bundled with esbuild — which vite already
 * brings — and imported. An earlier version of this script read the source with
 * a regular expression and silently dropped two of the six cases; a generator
 * that quietly writes a smaller suite than it was given is worse than no
 * generator, so the count is checked against the module at the end.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = new Map();
for (let index = 2; index < process.argv.length; index += 2) argv.set(process.argv[index], process.argv[index + 1]);
const output = resolve(argv.get('--output') ?? 'ci/conformance-project.json');
const machineId = argv.get('--machine') ?? 'bbc-b';
const variant = argv.get('--variant') ?? 'Model B · 8271 DFS';
const romId = argv.get('--rom') ?? 'os12-basic2-dfs';

const staging = await mkdtemp(join(tmpdir(), '8bit-net-conformance-'));
try {
  const bundle = join(staging, 'suite.mjs');
  await run('npx', ['esbuild', 'src/testing/conformanceSuite.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning']);
  const suite = await import(`file://${bundle}`);
  const mediaBundle = join(staging, 'media.mjs');
  await run('npx', ['esbuild', 'src/media/dfsImage.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${mediaBundle}`, '--log-level=warning']);
  const media = await import(`file://${mediaBundle}`);
  const all = suite.CONFORMANCE_CASES;
  /*
   * The project enables what the applicable cases declare they need, rather
   * than a list somebody kept in step by hand — but only where the machine
   * actually offers it. A case cannot conjure a capability the profile calls
   * planned: doing that ran the Tube case against a BBC B whose Tube this
   * build no longer claims, and reported a failure about the machine as though
   * it were about the product.
   */
  const machinesBundle = join(staging, 'machines.mjs');
  await run('npx', ['esbuild', 'src/data/machines.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${machinesBundle}`, '--log-level=warning']);
  const { machineProfiles } = await import(`file://${machinesBundle}`);
  const profile = machineProfiles.find((candidate) => candidate.id === machineId);
  if (!profile) throw new Error(`No machine profile is named ${machineId}.`);
  const offered = new Set(profile.capabilities.filter((item) => item.state !== 'planned').map((item) => item.id));
  const wanted = new Set(['dfs', 'sideways', ...all.flatMap((item) => item.requires.capabilities)]);
  const capabilities = [...wanted].filter((id) => offered.has(id)).sort();
  const withheld = [...wanted].filter((id) => !offered.has(id)).sort();
  if (withheld.length) console.log(`Not enabled, because ${machineId} does not offer them: ${withheld.join(', ')}`);
  const applicable = all.filter((item) => suite.caseApplies(item, { machineId, capabilities, romSetId: romId }).applies);
  if (!applicable.length) throw new Error(`No conformance case applies to ${machineId}, so this would have produced a project that proves nothing.`);

  const carriesDisc = applicable.some((item) => item.disc);
  const project = {
    format: '8bit-net-dev-project-13',
    name: `Conformance suite (${machineId})`,
    files: applicable.map((item) => ({ id: item.id, name: `${item.id}.asm`, content: item.source })),
    target: { platformClass: '8-16-bit', machineId, variant, romId, enabledCapabilities: capabilities },
    breakpoints: {}, bookmarks: [],
    buildTargets: applicable.map((item) => ({
      schemaVersion: 5, id: item.id, name: item.title,
      entryFileId: item.id, sourceFileIds: [item.id],
      toolchainId: '8bit-net.asm.6502', outputName: `${item.id}.bin`,
    })),
    activeBuildTargetId: applicable[0].id,
    testPlans: applicable.map((item) => ({
      schemaVersion: 1, id: `${item.id}-plan`, targetId: item.id,
      name: item.title, suite: `Conformance: ${item.area}`,
      /*
       * Ejecting before each case is how a case that declares no disc is kept
       * from seeing one. It cannot stand once any case does need a disc: the
       * ejection is of the live drive, so the first case to run takes the disc
       * away from every case after it, and the disc case fails with a timeout
       * that says nothing about the filing system. That is what happened.
       *
       * So a project carrying a disc retains media throughout, and says so.
       * The alternative — ordering disc cases first — would work today and
       * break silently the moment somebody reordered the suite.
       */
      setup: { reset: 'hard', media: carriesDisc ? 'retain' : 'eject' },
      inputs: [], stop: item.stop, assertions: item.assertions,
      cycleBudget: item.cycleBudget,
      captures: [{ id: 'registers', kind: 'registers' }],
      teardown: { action: 'pause' }, enabled: true,
    })),
    armBreakpoints: {}, armBreakpointGroups: {},
    breakpoints6502: {}, breakpointGroups6502: {},
    analysisAnnotations: {}, diskSets: [], settings: {}, trash: [],
  };

  await writeFile(output, `${JSON.stringify(project, null, 2)}\n`);

  /*
   * Discs are built here from what the case describes, with the same DFS
   * mastering the product writes, rather than kept in the repository as an
   * image nobody can read or check. The runner mounts them through the
   * workbench's own import.
   */
  const discs = [];
  for (const item of applicable) {
    if (!item.disc) continue;
    const created = media.createDfsImage({
      title: item.disc.title, name: item.disc.name, directory: item.disc.directory,
      loadAddress: item.disc.loadAddress, executionAddress: item.disc.executionAddress,
      bytes: Uint8Array.from(item.disc.contents),
    });
    const discPath = join(dirname(output), `${item.id}.ssd`);
    await writeFile(discPath, created.image);
    discs.push({ id: item.id, drive: item.disc.drive, path: discPath, bytes: created.image.length });
    console.log(`Disc for ${item.id}: drive ${item.disc.drive}, ${created.image.length} bytes, catalogue "${created.catalogue.title}" holding ${created.catalogue.files.length} file(s) — ${discPath}`);
  }
  if (discs.length) console.log(`Mount with: ${discs.map((disc) => `--disc-${disc.drive} ${disc.path}`).join(' ')}`);
  if (carriesDisc) console.log('Every plan retains media, because ejecting before a case would take the disc away from the cases that need one.');

  /* The check that makes the generation trustworthy: what was written back,
   * counted against what the module holds. */
  const written = JSON.parse(await readFile(output, 'utf8'));
  if (written.testPlans.length !== applicable.length) {
    throw new Error(`${applicable.length} cases apply to ${machineId} and ${written.testPlans.length} were written.`);
  }
  const skipped = all.length - applicable.length;
  console.log(`${applicable.length} of ${all.length} conformance cases apply to ${machineId} and were written to ${output}.`);
  console.log(`Cases: ${applicable.map((item) => item.id).join(', ')}`);
  console.log(`Capabilities enabled by what the cases need: ${capabilities.join(', ')}`);
  if (skipped) {
    for (const item of all.filter((candidate) => !applicable.includes(candidate))) {
      console.log(`Not applicable: ${item.id} — ${suite.caseApplies(item, { machineId, capabilities, romSetId: romId }).reason}`);
    }
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
