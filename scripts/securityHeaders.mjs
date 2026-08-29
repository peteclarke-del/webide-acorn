/* The response headers this service serves, read from the files that serve them.
 *
 * A content security policy is only worth anything if the application actually
 * runs under it. A policy written once and never exercised is the common case,
 * and it fails in the least useful way: everything works in development, where
 * no policy is applied, and the first person to load the deployed build gets a
 * blank page and a console full of violations.
 *
 * So the policy is parsed out of the nginx snippets that serve it, checked
 * against the rules below, and — in the release gate — actually applied to the
 * built application while a browser loads and exercises it. The gate fails on a
 * violation, which means the policy and the product cannot drift apart.
 *
 * There are two policies because there are two things being served. The main
 * document is the workbench. The embedded one serves the emulator runtime,
 * which is framed by the workbench and executes recompiled machine code, so it
 * needs `unsafe-eval` and must be framable by its own origin. Every difference
 * between them is enumerated below with the reason, because an unexplained
 * relaxation is how a policy quietly becomes decoration.
 */

/** Directives every policy this service serves must set, and to what. */
export const REQUIRED_DIRECTIVES = {
  "default-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "img-src": ["'self'", 'data:'],
  "font-src": ["'self'"],
};

/**
 * Where the two policies are allowed to differ, and why. A difference not
 * listed here fails: a relaxation nobody wrote down is one nobody reviewed.
 */
export const ALLOWED_DIFFERENCES = [
  {
    directive: 'script-src',
    reason: "The emulator runtime compiles machine code to JavaScript at run time, which is what an emulator is. The workbench document does not, and does not get 'unsafe-eval'.",
  },
  {
    directive: 'frame-ancestors',
    reason: 'The runtime is framed by the workbench on the same origin, so it permits its own origin. The workbench itself is framed by nothing.',
  },
  {
    directive: 'connect-src',
    reason: 'The workbench opens a WebSocket for build and debug streaming. The runtime frame makes no connections of its own.',
  },
  {
    directive: 'form-action',
    reason: 'The workbench posts to its own origin. The runtime frame has no forms at all, so it permits none.',
  },
];

/** Other headers that must be present, with the value required. */
export const REQUIRED_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** Parse `add_header` lines out of an nginx snippet. */
export function parseHeaders(text) {
  const headers = {};
  for (const line of text.split('\n')) {
    const match = /^\s*add_header\s+(\S+)\s+"([^"]*)"/.exec(line);
    if (match) headers[match[1]] = match[2];
  }
  return headers;
}

/** Split a policy string into directive name to source list. */
export function parsePolicy(policy) {
  const directives = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name] = sources;
  }
  return directives;
}

/**
 * Everything wrong with one snippet, as a list. A list rather than the first
 * problem, so one run tells someone everything they have to fix.
 */
export function auditSnippet(name, text) {
  const problems = [];
  const headers = parseHeaders(text);

  for (const [header, expected] of Object.entries(REQUIRED_HEADERS)) {
    if (headers[header] !== expected) problems.push(`${name} does not set ${header} to "${expected}"`);
  }
  const policy = headers['Content-Security-Policy'];
  if (!policy) return [...problems, `${name} sets no Content-Security-Policy`];

  const directives = parsePolicy(policy);
  for (const [directive, expected] of Object.entries(REQUIRED_DIRECTIVES)) {
    const actual = directives[directive];
    if (!actual) { problems.push(`${name} sets no ${directive}`); continue; }
    for (const source of expected) {
      if (!actual.includes(source)) problems.push(`${name} ${directive} does not include ${source}`);
    }
  }

  /* The relaxations that matter most, checked by name so a future edit that
   * adds one has to be deliberate. */
  if (directives['script-src']?.includes("'unsafe-inline'")) {
    problems.push(`${name} allows 'unsafe-inline' scripts, which defeats the policy`);
  }
  for (const [directive, sources] of Object.entries(directives)) {
    if (sources.includes('*')) problems.push(`${name} ${directive} allows any origin`);
    if (sources.some((source) => source.startsWith('http://') && !source.startsWith('http://localhost'))) {
      problems.push(`${name} ${directive} permits an insecure origin`);
    }
  }
  return problems;
}

/** Differences between two policies that no entry in the register explains. */
export function unexplainedDifferences(documentPolicy, embeddedPolicy) {
  const left = parsePolicy(documentPolicy);
  const right = parsePolicy(embeddedPolicy);
  const explained = new Set(ALLOWED_DIFFERENCES.filter((entry) => entry.reason.trim()).map((entry) => entry.directive));
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  const differences = [];
  for (const name of names) {
    const a = (left[name] ?? []).join(' ');
    const b = (right[name] ?? []).join(' ');
    if (a === b) continue;
    if (explained.has(name)) continue;
    differences.push(`${name} differs between the two policies (${a || 'unset'} against ${b || 'unset'}) with no recorded reason`);
  }
  return differences;
}

/** The header set to serve, as name/value pairs, for a real browser check. */
export function headerPairs(text) {
  return Object.entries(parseHeaders(text));
}
