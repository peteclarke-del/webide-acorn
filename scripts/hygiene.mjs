/* What must never be in this repository, or in anything it publishes.
 *
 * The rule the project already enforced was one line long: no tracked file may
 * have a firmware or disk-image extension. That is the most important case and
 * it is not the only one. A release is also wrong if it carries a private key,
 * an access token, someone's captured memory dump, or a copy of a commercial
 * program — and none of those announce themselves by their extension.
 *
 * Two things this scanner is careful about.
 *
 * It reports where and what, never the secret itself. A finding that quotes the
 * token it found puts the token into the build log, which is a place secrets
 * are read from. The value is replaced by its shape.
 *
 * It does not decide that something is fine on its own. A fixture that must
 * contain a key-shaped string is allowed only by an entry in the allowlist
 * below, and every entry has to say why it is there. An unexplained allowlist
 * is how a real secret eventually gets one.
 *
 * Written as plain JavaScript so the release gate and the test suite run the
 * same implementation rather than two that can drift.
 */

/* Extensions that carry firmware, disk images or tape images. None of these
 * may be committed, whatever the file is called or where it sits. */
export const FIRMWARE_EXTENSIONS = /\.(rom|uef|ssd|dsd|adf|adl|adfs|atm|inf|snap|hfe|csw|tzx|tap|z80|sna)$/i;

/* Captured runtime state. A trace or a memory dump is somebody's session, and
 * on a machine with real firmware loaded it is also a copy of that firmware. */
export const CAPTURE_EXTENSIONS = /\.(trace|dump|core|coredump|heapsnapshot|memdump)$/i;

/* Paths that hold a person's own material and are never part of the product. */
export const PRIVATE_PATHS = [
  /(^|\/)local-roms\//i,
  /* A real `.env` holds values. A template — `.env.example` and its usual
   * spellings — holds the names of the variables and is documentation, so it
   * belongs in the repository and is checked for content like anything else. */
  /(^|\/)\.env(?!\.(?:example|sample|template|dist)$)(\.|$)/i,
  /(^|\/)secrets?\.(json|ya?ml|toml|txt)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
];

/**
 * Secret shapes, each with the thing it identifies. Every pattern here matches
 * a value whose format is a deliberate, published marker — a key header, a
 * vendor's token prefix — rather than a guess from a variable name, because a
 * scanner that fires on the word `password` is one people learn to ignore.
 */
export const SECRET_PATTERNS = [
  { id: 'private-key', label: 'a PEM private key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', label: 'an AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', label: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', label: 'a Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', label: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'jwt', label: 'a JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: 'basic-auth-url', label: 'credentials inside a URL', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
  /* A named assignment with a value long enough to be real. The name list is
   * short on purpose: every addition costs a false positive somewhere. */
  { id: 'assigned-secret', label: 'an assigned credential', pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|passwd|password)\s*[:=]\s*['"][^'"\s]{12,}['"]/i },
];

/**
 * Files allowed to match a rule they would otherwise fail, each with the
 * reason. An entry without a reason is itself a finding: an unexplained
 * allowlist is how a real secret eventually gets one.
 */
export const ALLOWLIST = [
  {
    path: 'src/project/projectBundle.ts',
    rules: ['assigned-secret'],
    reason: 'Declares the patterns the bundle exporter uses to warn about possible secrets. The strings are the patterns themselves, not values.',
  },
  {
    path: 'src/project/projectBundle.test.ts',
    rules: ['assigned-secret', 'aws-access-key', 'github-token', 'private-key', 'basic-auth-url'],
    reason: 'Feeds invented key-shaped values to the exporter to prove it reports them, including AWS\'s own published example key id. Nothing here is a real credential.',
  },
  {
    path: 'scripts/hygiene.mjs',
    rules: ['assigned-secret', 'aws-access-key', 'github-token', 'slack-token', 'google-api-key', 'jwt', 'private-key', 'basic-auth-url'],
    reason: 'This scanner. The strings are the detection patterns.',
  },
  {
    path: 'scripts/hygiene.test.ts',
    rules: ['assigned-secret', 'aws-access-key', 'github-token', 'slack-token', 'google-api-key', 'jwt', 'private-key', 'basic-auth-url'],
    reason: 'Feeds invented key-shaped values to this scanner to prove each pattern fires. Nothing here is a real credential.',
  },
];

/** Text this scanner will read. Anything else is checked by path alone. */
const TEXT_EXTENSIONS = /\.(m?[jt]sx?|json|md|ya?ml|toml|css|html?|php|sh|mjs|cjs|txt|env|ini|conf|xml|asm|s|bas|c|h)$/i;

function allowed(path, ruleId) {
  const entry = ALLOWLIST.find((candidate) => candidate.path === path);
  return !!entry && entry.rules.includes(ruleId) && !!entry.reason.trim();
}

/** The shape of a value, for a report that must not carry the value itself. */
function shapeOf(value) {
  return `${value.length} characters, starting ${value.slice(0, 4)}…`;
}

/**
 * Why this path may not be committed, or null.
 *
 * Path rules are absolute: no allowlist applies to them, because a firmware
 * image or somebody's memory dump has no legitimate reason to be in a source
 * repository under any name.
 */
export function forbiddenPath(path) {
  if (FIRMWARE_EXTENSIONS.test(path)) return { rule: 'firmware', detail: 'is a firmware, disk or tape image' };
  if (CAPTURE_EXTENSIONS.test(path)) return { rule: 'capture', detail: 'is captured runtime state, which is a session and may contain firmware' };
  for (const pattern of PRIVATE_PATHS) {
    if (pattern.test(path)) return { rule: 'private', detail: 'is private material that is never part of the product' };
  }
  return null;
}

/** Every secret shape in one file's text, reported by shape and never by value. */
export function scanText(path, text) {
  const findings = [];
  const lines = text.split('\n');
  for (const { id, label, pattern } of SECRET_PATTERNS) {
    if (allowed(path, id)) continue;
    lines.forEach((line, index) => {
      const match = pattern.exec(line);
      if (!match) return;
      findings.push({ path, rule: id, line: index + 1, detail: `looks like ${label} (${shapeOf(match[0])})` });
    });
  }
  return findings;
}

/**
 * Scan a set of files. `read` is given a path and returns its text, or null
 * when the file is not text or cannot be read — which is reported as such
 * rather than treated as empty.
 */
export async function scanRepository(paths, read) {
  const findings = [];
  let scanned = 0;
  for (const path of paths) {
    const forbidden = forbiddenPath(path);
    if (forbidden) { findings.push({ path, rule: forbidden.rule, line: 0, detail: forbidden.detail }); continue; }
    if (!TEXT_EXTENSIONS.test(path)) continue;
    const text = await read(path);
    if (text === null) continue;
    scanned += 1;
    findings.push(...scanText(path, text));
  }
  return { findings, scanned };
}

/** Allowlist entries that do not explain themselves, which are findings too. */
export function unexplainedAllowlistEntries(allowlist = ALLOWLIST) {
  return allowlist
    .filter((entry) => !entry.reason || !entry.reason.trim() || !entry.rules.length)
    .map((entry) => ({ path: entry.path, rule: 'allowlist', line: 0, detail: 'is allowlisted without a stated reason' }));
}

/** One line per finding, in the order a person would want to act on them. */
export function summarise(findings) {
  const order = ['firmware', 'capture', 'private', 'allowlist'];
  return [...findings]
    .sort((left, right) => (order.indexOf(left.rule) + 1 || 99) - (order.indexOf(right.rule) + 1 || 99) || left.path.localeCompare(right.path) || left.line - right.line)
    .map((finding) => `${finding.path}${finding.line ? `:${finding.line}` : ''} ${finding.detail}`);
}
