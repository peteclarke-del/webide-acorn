// @vitest-environment node

/* The release gate and these contracts run the same scanner, imported here as
 * the module the gate imports, so the two cannot drift into disagreeing about
 * what may be committed.
 *
 * Every key-shaped string below is invented for this file. */
import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  SECRET_PATTERNS,
  forbiddenPath,
  scanRepository,
  scanText,
  summarise,
  unexplainedAllowlistEntries,
} from './hygiene.mjs';

describe('paths that may never be committed', () => {
  it('refuses firmware, disk and tape images whatever they are called', () => {
    for (const path of ['os12.rom', 'docs/BASIC2.ROM', 'a/b/game.ssd', 'tape.uef', 'disc.adf', 'x.tzx']) {
      expect(forbiddenPath(path), path).toMatchObject({ rule: 'firmware' });
    }
  });

  it('refuses captured runtime state, which is a session and may hold firmware', () => {
    for (const path of ['session.trace', 'crash.dump', 'x/y.heapsnapshot']) {
      expect(forbiddenPath(path), path).toMatchObject({ rule: 'capture' });
    }
  });

  it('refuses private material wherever it sits', () => {
    for (const path of ['local-roms/normalized/os.bin', '.env', 'services/.env.production', 'secrets.json', 'id_ed25519']) {
      expect(forbiddenPath(path), path).toMatchObject({ rule: 'private' });
    }
  });

  it('allows the ordinary contents of a source repository', () => {
    for (const path of ['src/App.tsx', 'docs/todo.md', 'ci/roms.json', 'src/samples/acornHarvest.ts', 'public/electron/elkjs/processor.js']) {
      expect(forbiddenPath(path), path).toBeNull();
    }
  });

  it('tells a real .env from a template of one', () => {
    /* A template holds the names of the variables and is documentation, so it
     * belongs in the repository — and is still scanned for content. */
    for (const path of ['.env.example', '.env.sample', 'services/.env.template', '.env.dist']) {
      expect(forbiddenPath(path), path).toBeNull();
    }
    for (const path of ['.env', '.env.local', '.env.production']) {
      expect(forbiddenPath(path), path).toMatchObject({ rule: 'private' });
    }
  });

  it('takes no allowlist for a path rule, because none of them has a legitimate case', () => {
    /* A firmware image has no reason to be in a source repository under any
     * name, so there is deliberately no way to permit one. */
    expect(forbiddenPath('src/project/projectBundle.test.ts.rom')).toMatchObject({ rule: 'firmware' });
  });
});

describe('secret shapes in file contents', () => {
  const cases: Array<[string, string]> = [
    ['private-key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['aws-access-key', 'const key = "AKIAQQQQWWWWEEEERRRR";'],
    ['github-token', 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['slack-token', 'const hook = "xoxb-1111111111-abcdefghij";'],
    ['google-api-key', `AIza${'S'}${'A'.repeat(34)}`],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
    ['basic-auth-url', 'https://someone:hunter2001@example.invalid/path'],
    ['assigned-secret', 'api_key = "abcdefghijklmnop"'],
  ];

  for (const [rule, text] of cases) {
    it(`finds ${rule}`, () => {
      const findings = scanText('src/anything.ts', text);
      expect(findings.map((finding) => finding.rule)).toContain(rule);
    });
  }

  it('never puts the value it found into the report', () => {
    /* A finding that quotes the token puts the token into the build log, which
     * is a place secrets are read from. */
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const findings = scanText('src/anything.ts', `const token = "${secret}";`);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).not.toContain(secret);
    expect(findings[0]!.detail).toMatch(/\d+ characters, starting/);
  });

  it('gives the line, so a finding can be acted on', () => {
    const findings = scanText('src/anything.ts', 'one\ntwo\nAKIAQQQQWWWWEEEERRRR\n');
    expect(findings[0]).toMatchObject({ line: 3, path: 'src/anything.ts' });
  });

  it('does not fire on the word alone, or on a value too short to be real', () => {
    /* A scanner that fires on the word `password` is one people learn to
     * ignore, and an ignored scanner protects nothing. */
    for (const text of ['// remember the password', 'password = ""', 'let apiKey;', 'password: userInput', 'api_key = "short"']) {
      expect(scanText('src/anything.ts', text), text).toEqual([]);
    }
  });

  it('does not fire on the product’s own ordinary source', () => {
    const text = [
      'const OSWRCH = 0xffee;',
      'export const PROJECT_FORMAT = "8bit-net-dev-project-21";',
      'https://example.invalid/path?query=1',
      'sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"',
    ].join('\n');
    expect(scanText('src/anything.ts', text)).toEqual([]);
  });
});

describe('the allowlist', () => {
  it('permits a named rule in a named file and nothing else', () => {
    const secret = 'api_key = "abcdefghijklmnop"';
    expect(scanText('src/project/projectBundle.ts', secret)).toEqual([]);
    /* The same content anywhere else is still a finding. */
    expect(scanText('src/project/somewhereElse.ts', secret)).toHaveLength(1);
  });

  it('does not permit a rule the entry did not name', () => {
    expect(scanText('src/project/projectBundle.ts', 'AKIAQQQQWWWWEEEERRRR')).toHaveLength(1);
  });

  it('requires every entry to say why it is there', () => {
    /* An unexplained allowlist is how a real secret eventually gets one. */
    expect(unexplainedAllowlistEntries()).toEqual([]);
    expect(unexplainedAllowlistEntries([{ path: 'x.ts', rules: ['jwt'], reason: '  ' }])[0]).toMatchObject({ rule: 'allowlist' });
    expect(unexplainedAllowlistEntries([{ path: 'x.ts', rules: [], reason: 'because' }])[0]).toMatchObject({ rule: 'allowlist' });
  });

  it('names only rules that exist, so an entry cannot permit nothing by a typo', () => {
    const known = new Set(SECRET_PATTERNS.map((entry) => entry.id));
    for (const entry of ALLOWLIST) {
      for (const rule of entry.rules) expect(known, `${entry.path} names ${rule}`).toContain(rule);
    }
  });
});

describe('scanning a set of files', () => {
  const files = {
    'src/App.tsx': 'export const App = () => null;',
    'src/leak.ts': 'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
    'docs/notes.md': 'nothing here',
    'public/vendor.wasm': null,
  };

  it('reports a path rule and a content rule together, worst first', async () => {
    const { findings } = await scanRepository([...Object.keys(files), 'os12.rom'], async (path) => (files as Record<string, string | null>)[path] ?? null);
    const lines = summarise(findings);
    expect(lines[0]).toContain('os12.rom');
    expect(lines.some((line) => line.includes('src/leak.ts:1'))).toBe(true);
  });

  it('reads only what it can read as text, and says how much it read', async () => {
    const { scanned } = await scanRepository(Object.keys(files), async (path) => (files as Record<string, string | null>)[path] ?? null);
    /* The wasm binary is not text and is not counted as scanned. */
    expect(scanned).toBe(3);
  });

  it('does not read a file it has already refused by path', async () => {
    const read = async () => { throw new Error('should not be read'); };
    await expect(scanRepository(['os12.rom'], read)).resolves.toMatchObject({ scanned: 0 });
  });
});
