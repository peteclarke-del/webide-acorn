/*
 * Punctuation that reads as machine-written, and where it may still appear.
 *
 * The em dash is the tell. A language model reaches for it constantly, and a
 * document full of them reads as generated whatever it actually says. The same
 * goes for the en dash, the ellipsis character, curly quotes and the true minus
 * sign: each has an ASCII spelling that says the same thing, and the typographic
 * one is the one nobody typed.
 *
 * Removing them once is not enough, because the next document written brings
 * them back. So this is a rule the gate enforces, and the allowlist below is the
 * complete set of places where such a character is doing a job that its ASCII
 * spelling could not do.
 *
 * The replacement is never mechanical. A hyphen substituted for an em dash
 * reads exactly the way the em dash did; the sentence has to be repunctuated,
 * with a full stop, a colon, brackets or the word the dash was standing in for.
 */

/** The characters, and what to write instead of each. */
export const MACHINE_PUNCTUATION = [
  { character: '—', name: 'em dash', instead: 'a full stop, a colon, brackets, or the word the dash replaced' },
  { character: '–', name: 'en dash', instead: 'a hyphen between the ends of a range, or a comma in prose' },
  { character: '…', name: 'ellipsis', instead: 'three full stops' },
  { character: '‘', name: 'opening single quote', instead: "an apostrophe" },
  { character: '’', name: 'closing single quote', instead: "an apostrophe" },
  { character: '“', name: 'opening double quote', instead: 'a double quote' },
  { character: '”', name: 'closing double quote', instead: 'a double quote' },
  { character: '−', name: 'minus sign', instead: 'a hyphen' },
  { character: ' ', name: 'non-breaking space', instead: 'an ordinary space' },
];

const BY_CHARACTER = new Map(MACHINE_PUNCTUATION.map((entry) => [entry.character, entry]));

/*
 * Where such a character is the point rather than an accident.
 *
 * Every entry says why, because an allowlist without a reason is a list of
 * things nobody dares to touch. A file is listed only when the character it
 * holds is the subject of the code, not merely present in it.
 */
export const ALLOWLIST = [
  {
    path: 'src/editor/sourceTextFormat.ts',
    reason: 'Holds the Windows-1252 character table itself, so it must spell out the characters it decodes.',
  },
  {
    path: 'src/help/helpTopics.test.ts',
    reason: 'Asserts that no help topic carries an em dash, which needs an em dash to assert against.',
  },
  {
    path: 'src/cloud/projectStoreClient.test.ts',
    reason: 'Round-trips deliberately exotic characters through the store, so the characters are the fixture.',
  },
  {
    path: 'src/editor/sourceTextFormat.test.ts',
    reason: 'Asserts what decoding Windows-1252 bytes produces, which is curly quotes.',
  },
  {
    path: 'src/emulator/keyboardInputModel.test.ts',
    reason: 'Asserts that a curly quote is refused before it reaches a machine that cannot represent it.',
  },
  {
    path: 'scripts/writingStyle.mjs',
    reason: 'Declares the characters it looks for.',
  },
  {
    path: 'scripts/writingStyle.test.ts',
    reason: 'Exercises the scanner, so it has to contain what the scanner looks for.',
  },
];

const TEXT_EXTENSIONS = /\.(m?[jt]sx?|json|md|ya?ml|toml|css|html?|php|sh|mjs|cjs|txt|ini|conf|xml|asm|s|bas|c|h|py)$/i;

/** Whether a path is one this rule applies to. */
export const scannable = (path) => TEXT_EXTENSIONS.test(path) && !ALLOWLIST.some((entry) => entry.path === path);

/**
 * Every occurrence in one file's text, as the character and as a \\u escape.
 *
 * The escaped spelling counts because it reaches the reader as the character:
 * a description written with \\u2019 in it puts a curly apostrophe on screen
 * just as surely as typing one would.
 */
export function scanText(path, text) {
  const findings = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    for (const [column, character] of [...line].entries()) {
      const entry = BY_CHARACTER.get(character);
      if (entry) findings.push({ path, line: index + 1, column: column + 1, name: entry.name, instead: entry.instead, escaped: false });
    }
    for (const match of line.matchAll(/\\u([0-9a-fA-F]{4})/g)) {
      const entry = BY_CHARACTER.get(String.fromCharCode(parseInt(match[1], 16)));
      if (entry) findings.push({ path, line: index + 1, column: match.index + 1, name: entry.name, instead: entry.instead, escaped: true });
    }
  }
  return findings;
}

/** Every occurrence across the files given, using the reader supplied. */
export async function scanRepository(paths, read) {
  const findings = [];
  let scanned = 0;
  for (const path of paths) {
    if (!scannable(path)) continue;
    const text = await read(path);
    if (text === null) continue;
    scanned += 1;
    findings.push(...scanText(path, text));
  }
  return { findings, scanned };
}

/** One line per finding, for a person reading a failure. */
export function summarise(findings) {
  return findings.map((finding) => `${finding.path}:${finding.line}:${finding.column} ${finding.name}${finding.escaped ? ' (written as an escape)' : ''}; write ${finding.instead}`);
}

/** Allowlist entries that do not explain themselves, which are findings too. */
export function unexplainedAllowlistEntries(allowlist = ALLOWLIST) {
  return allowlist.filter((entry) => !entry.path || !entry.reason || !entry.reason.trim());
}
