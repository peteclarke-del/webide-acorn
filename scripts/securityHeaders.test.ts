// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DIFFERENCES,
  auditSnippet,
  parseHeaders,
  parsePolicy,
  unexplainedDifferences,
} from './securityHeaders.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const snippet = (name: string) => readFile(join(root, 'docker', name), 'utf8');

describe('the headers this service serves', () => {
  it('satisfies every required directive in both policies', async () => {
    /* Read from the files nginx actually includes, so the check is on what is
     * served and not on a copy of it. */
    expect(auditSnippet('the document policy', await snippet('security-headers.conf'))).toEqual([]);
    expect(auditSnippet('the embedded policy', await snippet('security-headers-embedded.conf'))).toEqual([]);
  });

  it('never allows inline script, any origin, or an insecure one', () => {
    const bad = 'add_header X-Content-Type-Options "nosniff" always;\nadd_header Referrer-Policy "strict-origin-when-cross-origin" always;\nadd_header Content-Security-Policy "default-src \'self\'; script-src \'self\' \'unsafe-inline\'; img-src *; connect-src http://elsewhere.invalid; object-src \'none\'; base-uri \'self\'; font-src \'self\'" always;';
    const problems = auditSnippet('a policy', bad);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining("allows 'unsafe-inline' scripts"),
      expect.stringContaining('img-src allows any origin'),
      expect.stringContaining('permits an insecure origin'),
    ]));
  });

  it('reports every problem at once rather than the first', () => {
    expect(auditSnippet('an empty policy', '').length).toBeGreaterThanOrEqual(3);
  });

  it('explains every difference between the two policies', async () => {
    /* A relaxation nobody wrote down is one nobody reviewed. */
    const document = parseHeaders(await snippet('security-headers.conf'))['Content-Security-Policy']!;
    const embedded = parseHeaders(await snippet('security-headers-embedded.conf'))['Content-Security-Policy']!;
    expect(unexplainedDifferences(document, embedded)).toEqual([]);
  });

  it('catches a difference that has no recorded reason', () => {
    expect(unexplainedDifferences("default-src 'self'", "default-src 'self' cdn.invalid")[0])
      .toContain('with no recorded reason');
  });

  it('records a reason for every difference it permits', () => {
    for (const entry of ALLOWED_DIFFERENCES) {
      expect(entry.directive.trim(), entry.directive).not.toBe('');
      expect(entry.reason.trim().length, entry.directive).toBeGreaterThan(40);
    }
  });

  it('keeps the document policy stricter than the embedded one, not the other way round', async () => {
    /* The workbench must never gain a relaxation the runtime frame needs. */
    const document = parsePolicy(parseHeaders(await snippet('security-headers.conf'))['Content-Security-Policy']!);
    const embedded = parsePolicy(parseHeaders(await snippet('security-headers-embedded.conf'))['Content-Security-Policy']!);
    expect(document['script-src']).not.toContain("'unsafe-eval'");
    expect(embedded['script-src']).toContain("'unsafe-eval'");
    expect(document['frame-ancestors']).toEqual(["'none'"]);
  });
});

describe('messages arriving from another window', () => {
  it('is checked for its origin by every handler that listens for one', async () => {
    /* A `message` handler that does not check the origin will act on anything
     * any page can send it, which is the whole shape of the attack. */
    const offenders: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const text = await readFile(path, 'utf8');
        const listeners = [...text.matchAll(/addEventListener\(\s*'message'\s*,\s*([A-Za-z_$][\w$]*)/g)];
        for (const listener of listeners) {
          const name = listener[1]!;
          /* The handler body, taken from its declaration to the end of the
           * function, is where the origin check has to be. */
          const declaration = new RegExp(`const ${name}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*\\{`).exec(text);
          if (!declaration) { offenders.push(`${path}: could not find the body of ${name}`); continue; }
          const body = text.slice(declaration.index, text.indexOf('addEventListener', declaration.index));
          if (!/\.origin\s*!==|\.origin\s*===/.test(body)) offenders.push(`${path}: ${name} does not check event.origin`);
        }
      }
    };
    await walk(join(root, 'src'));
    expect(offenders).toEqual([]);
  });
});
