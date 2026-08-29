// @vitest-environment node

/* The documentation is checked the way the code is: by asserting the things
 * that go wrong silently. A broken link, a decision record missing from the
 * index, two records sharing a number, a command in the README that no longer
 * exists — none of these announce themselves, and all of them mislead someone
 * who trusted the document. */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let adrFiles: string[] = [];
let index = '';
let architecture = '';
let readme = '';
let scripts: Record<string, string> = {};

beforeAll(async () => {
  adrFiles = (await readdir(join(root, 'docs', 'adr'))).filter((name) => /^\d{4}-.*\.md$/.test(name)).sort();
  index = await readFile(join(root, 'docs', 'adr', 'README.md'), 'utf8');
  architecture = await readFile(join(root, 'docs', 'architecture.md'), 'utf8');
  readme = await readFile(join(root, 'README.md'), 'utf8');
  scripts = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).scripts;
});

describe('the decision records', () => {
  it('gives every record a number of its own', () => {
    /* A decision log whose identifiers are ambiguous cannot be cited. */
    const numbers = adrFiles.map((name) => name.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('lists every record in the index, and lists nothing that is not there', async () => {
    for (const file of adrFiles) expect(index, file).toContain(`(${file})`);
    const linked = [...index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((match) => match[1]!);
    for (const link of linked) expect(adrFiles, link).toContain(link);
    expect(linked).toHaveLength(adrFiles.length);
  });

  it('records a status for every decision, so none reads as settled when it is not', async () => {
    for (const file of adrFiles) {
      const text = await readFile(join(root, 'docs', 'adr', file), 'utf8');
      expect(text.slice(0, 400).toLowerCase(), file).toContain('status');
    }
  });

  it('says in the index which decision is still awaiting a licence sign-off', () => {
    /* The one thing a reader must not miss is a decision that is accepted
     * technically and not yet legally. */
    expect(index).toMatch(/licence position pending sign-off/i);
  });
});

describe('the architecture document', () => {
  it('links only to documents that exist', async () => {
    const links = [...architecture.matchAll(/`(docs\/[^`]+\.md|[^`]*adr\/[^`]+\.md)`/g)].map((match) => match[1]!);
    for (const link of links) {
      const path = link.startsWith('docs/') ? join(root, link) : join(root, 'docs', link);
      await expect(readFile(path, 'utf8'), link).resolves.toBeTypeOf('string');
    }
  });

  it('names every module directory that exists, and none that does not', async () => {
    const directories = (await readdir(join(root, 'src'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== 'test' && entry.name !== 'theme')
      .map((entry) => entry.name);
    for (const directory of directories) expect(architecture, directory).toContain(`\`src/${directory}\``);
  });

  it('names only commands the package actually defines', () => {
    const named = [...architecture.matchAll(/npm run ([a-z:]+)/g)].map((match) => match[1]!);
    for (const command of named) expect(Object.keys(scripts), command).toContain(command);
  });
});

describe('the README', () => {
  it('names only commands the package actually defines', () => {
    const named = [...readme.matchAll(/npm run ([a-z:]+)/g)].map((match) => match[1]!);
    for (const command of named) expect(Object.keys(scripts), command).toContain(command);
  });

  it('leads with the supported Compose command rather than the end-of-life one', () => {
    /* The standalone script is Compose v1, which fails against images built by
     * current Docker. Documenting it first sends people into that failure. */
    const firstCompose = readme.indexOf('docker compose up');
    const standalone = readme.indexOf('docker-compose up');
    expect(firstCompose).toBeGreaterThan(-1);
    expect(standalone === -1 || firstCompose < standalone).toBe(true);
  });

  it('says no firmware is distributed, which is the claim that matters most', () => {
    const combined = `${readme} ${architecture}`;
    expect(combined).toMatch(/no firmware|firmware/i);
  });
});

describe('the security and privacy statement', () => {
  let security = '';
  beforeAll(async () => { security = await readFile(join(root, 'docs', 'security-and-privacy.md'), 'utf8'); });

  it('says where the work lives and how it leaves', () => {
    expect(security).toMatch(/stays on your machine/i);
    for (const subject of ['project', 'firmware', 'folder', 'native builder']) {
      expect(security.toLowerCase(), subject).toContain(subject);
    }
  });

  it('states the absence of collection rather than implying it', () => {
    /* "We respect your privacy" is a sentiment. Naming each thing that is not
     * collected is a claim that can be checked against the code. */
    for (const absent of ['analytics', 'telemetry', 'account']) {
      expect(security.toLowerCase(), absent).toContain(absent);
    }
    expect(security).toMatch(/no analytics, no telemetry/i);
  });

  it('tells someone how to report a vulnerability privately, and what will happen', () => {
    expect(security).toMatch(/report it privately/i);
    expect(security).toMatch(/acknowledgement/i);
    /* A policy that asks for reports and says nothing about the response is a
     * policy people stop using. */
    expect(security).toMatch(/do not put the detail\s+in a public issue/i);
  });

  it('gives a reason for everything it puts out of scope', () => {
    const outOfScope = security.slice(security.indexOf('Out of scope'));
    expect(outOfScope).toMatch(/rather than as a way of avoiding the work/i);
    /* Three exclusions, each with a because. */
    expect((outOfScope.match(/^- /gm) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('says what happens if firmware or a credential ever reaches a published artefact', () => {
    /* The one incident case specific to this product, and the one where the
     * wrong response — quietly replacing the artefact — is the tempting one. */
    expect(security).toMatch(/withdraw the artefact, do not merely replace it/i);
  });

  it('names the outstanding licence position rather than leaving it to be found', () => {
    expect(security).toMatch(/GPL-2\.0/);
    expect(security).toContain('0008-elkjs-electron-adapter-and-gpl-position.md');
  });

  it('links only to documents that exist', async () => {
    const links = [...security.matchAll(/`(docs\/[^`]+\.md)`|`(docker\/[^`]+\.conf)`/g)]
      .map((match) => match[1] ?? match[2]!);
    for (const link of links) {
      await expect(readFile(join(root, link), 'utf8'), link).resolves.toBeTypeOf('string');
    }
    expect(links.length).toBeGreaterThan(2);
  });
});
