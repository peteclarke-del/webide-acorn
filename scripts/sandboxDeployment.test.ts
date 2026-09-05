// @vitest-environment node

/* The sandbox controls that no PHP test can reach. A fork bomb is stopped by a
 * pids limit, an allocation bomb by a memory limit and a tool phoning home by
 * having no network at all — all three are declared in the Compose file and
 * nowhere else, so that file is held to a contract here.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditSandbox, list, scalar, serviceBlock } from './sandboxDeployment.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const compose = async () => readFile(join(root, 'compose.yaml'), 'utf8');

describe('the sandbox the build tools run in', () => {
  it('declares every control the deployment relies on', async () => {
    expect(auditSandbox(serviceBlock(await compose(), 'native-builder'))).toEqual([]);
  });

  it('names what is missing rather than only failing', async () => {
    /* A check that cannot fail is not a check: each control is removed in turn
     * and the audit has to notice, in words that say what was removed and why
     * it mattered. */
    const text = await compose();
    const block = serviceBlock(text, 'native-builder');
    const without = (predicate: (line: string) => boolean): string[] => block.filter((line) => !predicate(line));

    expect(auditSandbox(without((line) => line.startsWith('network_mode')))).toEqual([
      expect.stringContaining('network_mode: none'),
    ]);
    expect(auditSandbox(without((line) => line.startsWith('pids_limit')))).toEqual([
      expect.stringContaining('fork bomb'),
    ]);
    expect(auditSandbox(without((line) => line.startsWith('mem_limit')))).toEqual([
      expect.stringContaining('allocation bomb'),
    ]);
    expect(auditSandbox(without((line) => line.trim() === '- ALL'))).toEqual([
      expect.stringContaining('drop every capability'),
    ]);
    expect(auditSandbox(without((line) => line.includes('no-new-privileges')))).toEqual([
      expect.stringContaining('setuid binary regains'),
    ]);
    expect(auditSandbox(without((line) => line.startsWith('read_only')))).toEqual([
      expect.stringContaining('read_only: true'),
    ]);
  });

  it('rejects a process cap so loose it would not stop anything', async () => {
    const block = serviceBlock(await compose(), 'native-builder').map((line) =>
      line.startsWith('pids_limit') ? 'pids_limit: 100000' : line);
    expect(auditSandbox(block)).toEqual([expect.stringContaining('between 1 and 512')]);
  });

  it('rejects running the builder as root however that is written', async () => {
    const block = serviceBlock(await compose(), 'native-builder');
    for (const written of ['user: "0:0"', 'user: root', 'user: "0"']) {
      const asRoot = block.map((line) => (line.startsWith('user:') ? written : line));
      expect(auditSandbox(asRoot)).toEqual([expect.stringContaining('unprivileged user')]);
    }
  });

  it('requires the one writable path to be unable to hold a program', async () => {
    /* read_only leaves /tmp as the only place a build may write, which makes it
     * the only place an escalation could be staged. */
    const block = serviceBlock(await compose(), 'native-builder').map((line) =>
      line.includes('/tmp:rw') ? line.replace(',noexec', '') : line);
    expect(auditSandbox(block)).toEqual([expect.stringContaining('mounted noexec')]);
  });

  it('reads the service it was asked for and refuses one that is not there', async () => {
    const text = await compose();
    /* The parser has to stop at the next service, or an audit passes on
     * controls that belong to a different container. */
    expect(scalar(serviceBlock(text, 'webide-acorn'), 'network_mode')).toBeNull();
    expect(list(serviceBlock(text, 'headless-tests'), 'cap_drop')).toEqual(['ALL']);
    expect(() => serviceBlock(text, 'no-such-service')).toThrow(/declares no service named no-such-service/);
  });
});
