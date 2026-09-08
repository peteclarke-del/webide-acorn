/*
 * Working out which Acorn a codebase was written for, from the codebase.
 *
 * Importing a game used to leave the workbench pointed at whatever machine
 * happened to be selected, so a BBC game arrived configured as an Electron and
 * the first build failed for a reason that had nothing to do with the code. The
 * evidence needed to do better is sitting in the source: a program that pokes
 * &FE40 is talking to a BBC's System VIA, one that pokes &FE05 is talking to an
 * Electron's ULA, and one that assembles at &1900 expects a disc filing system
 * to have moved PAGE up for it.
 *
 * Two rules govern this, and they matter more than the size of the signal list.
 *
 * The first is that nothing is asserted without a reason that can be shown. Every
 * conclusion carries the signal that produced it, the file, and the line, so the
 * person importing can see why the workbench decided what it did and correct it
 * where the guess is wrong. An inference nobody can check is worse than no
 * inference, because it is believed.
 *
 * The second is that where the evidence runs out, the answer is the smallest
 * machine that could still run the program. A base 32K Electron with a cassette
 * interface, a Model B with nothing fitted. Guessing high fits hardware the
 * program may never have used, and a program built for a machine with more than
 * it needs will run; one built for a machine with less will not, and the
 * failure arrives much later and reads as a bug in the product.
 */
import { machineProfiles } from '../data/machines';
import type { ProjectFile } from './project';

/** What a machine is called, for text somebody reads. */
function labelOf(id: DetectedMachineId): string {
  return machineProfiles.find((profile) => profile.id === id)?.label ?? id;
}

/** What a fitting is called on that machine, rather than its identifier. */
function capabilityLabel(machineId: DetectedMachineId, capabilityId: string): string {
  const profile = machineProfiles.find((candidate) => candidate.id === machineId);
  return profile?.capabilities.find((candidate) => candidate.id === capabilityId)?.label ?? capabilityId;
}

export type DetectedMachineId =
  | 'atom' | 'electron' | 'bbc-b' | 'bbc-bplus' | 'master' | 'archimedes-a300';

export interface PlatformSignal {
  /** What was found, in the words somebody reading the source would use. */
  what: string;
  file: string;
  /** Counting from one, so it can be quoted. */
  line: number;
  /** The text that matched, trimmed, so the claim can be checked at a glance. */
  quote: string;
}

export interface DetectedPlatform {
  machineId: DetectedMachineId;
  /**
   * Why this machine. Empty when nothing in the codebase named one, in which
   * case `machineId` is the fallback rather than a finding.
   */
  machineEvidence: PlatformSignal[];
  /** Capability ids to fit, each with the evidence that it is needed. */
  capabilities: Array<{ id: string; because: PlatformSignal }>;
  /**
   * True when no machine signal was found at all, so the caller can say it is
   * showing a default rather than a conclusion.
   */
  guessed: boolean;
  /**
   * Other machines this codebase is evidenced for, weakest evidence last.
   *
   * A codebase with a `TARGET_ELECTRON` switch builds for two machines and
   * neither answer is wrong. The workbench sets up one of them and names the
   * rest, rather than picking silently and looking like it misread the source.
   */
  alsoEvidenced: Array<{ machineId: DetectedMachineId; because: PlatformSignal }>;
  /** What the caller should tell somebody, in one sentence. */
  summary: string;
}

/*
 * A signal is a machine or a fitting, a pattern, and what the pattern means.
 *
 * The addresses are the hardware itself and are the strongest evidence there
 * is: a program writing to a chip that only one machine has was written for
 * that machine. Text conventions are weaker and are only allowed to confirm
 * what an address already said, which is why each carries a weight.
 */
interface Rule {
  machine?: DetectedMachineId;
  capability?: string;
  pattern: RegExp;
  what: string;
  /** Hardware beats habit: an address is worth more than a word in a comment. */
  weight: number;
}

const MACHINE_RULES: readonly Rule[] = [
  /*
   * Only addresses that belong to one machine and no other.
   *
   * &FE00-&FE07 is not one of them, and getting that wrong is what this list
   * exists to prevent: it is the Electron's ULA and it is also the BBC's 6845
   * CRTC, so a write there says nothing about which machine is meant. The first
   * version of this called it decisive Electron evidence and read a BBC game
   * that blanks its display through the CRTC as an Electron game. The source it
   * misread says so in its own comment, two lines above.
   *
   * What is exclusive is the hardware one machine has and the other does not.
   * An Electron has no VIAs, no analogue port, no disc controller and no Tube;
   * a BBC has no ULA palette registers at &FE08-&FE0F, because that is its
   * serial chip and a game does not write to it.
   */
  { machine: 'bbc-b', pattern: /&FE4[0-9A-F]\b/i, what: 'writes to the System VIA at &FE40, which an Electron does not have', weight: 10 },
  { machine: 'bbc-b', pattern: /&FE6[0-9A-F]\b/i, what: 'writes to the User VIA at &FE60, which an Electron does not have', weight: 10 },
  { machine: 'bbc-b', pattern: /&FE2[0-9A-F]\b/i, what: 'writes to the video ULA at &FE20, which is a BBC chip', weight: 9 },
  { machine: 'bbc-b', pattern: /\bMODEL\s*B\b/i, what: 'names the Model B', weight: 5 },
  { machine: 'bbc-b', pattern: /\bBBC\b(?!\s*BASIC)/i, what: 'names the BBC', weight: 3 },

  { machine: 'electron', pattern: /&FE0[89A-F]\b/i, what: 'writes the Electron ULA palette at &FE08-&FE0F', weight: 9 },
  { machine: 'electron', pattern: /&FE0[567]\b/i, what: 'writes Electron ULA control at &FE05-&FE07', weight: 7 },
  { machine: 'electron', pattern: /\bELECTRON\b/i, what: 'names the Electron', weight: 5 },

  /* Shadow screen memory is the B+ and the Master; ACCCON is the Master's. */
  { machine: 'bbc-bplus', pattern: /&FE3[4-7]\b/i, what: 'pages shadow memory at &FE34-&FE37', weight: 8 },
  { machine: 'master', pattern: /\bMASTER\s*(128|COMPACT|TURBO)\b/i, what: 'names a Master model', weight: 6 },

  /* The Atom addresses its hardware elsewhere entirely and writes hex with a
   * hash, which no other Acorn assembler does. */
  { machine: 'atom', pattern: /#B00[0-3]\b/, what: 'writes to the Atom PPIA at #B000-#B003', weight: 10 },
  { machine: 'atom', pattern: /\bATOM\b/i, what: 'names the Atom', weight: 4 },

  /* A different instruction set and a different operating system. */
  { machine: 'archimedes-a300', pattern: /\bSWI\s+"?OS_/i, what: 'calls RISC OS through SWI OS_', weight: 10 },
  { machine: 'archimedes-a300', pattern: /\b(ARCHIMEDES|RISC\s*OS)\b/i, what: 'names the Archimedes or RISC OS', weight: 5 },
];

/*
 * Symbols a build sets to choose a machine.
 *
 * A codebase that assembles for more than one Acorn says so in its own
 * vocabulary (`TARGET_ELECTRON`, `BBC_BUILD`, `IF MASTER`), and that is better
 * evidence than any address, because it is the author naming the machine rather
 * than us inferring one. It also reveals that the codebase is for several
 * machines, which an address never can.
 */
const TARGET_SYMBOLS: ReadonlyArray<{ machine: DetectedMachineId; pattern: RegExp }> = [
  /*
   * One shape for all of them, because writing each by hand let the Electron's
   * miss both `:=` and a `_MAIN` suffix that the BBC's happened to allow, and a
   * codebase that builds for two machines was read as building for one.
   *
   * It matches a variable or define whose name contains the machine, with or
   * without a TARGET_ prefix and with any trailing word, being assigned, and
   * the conditional-assembly form an assembler uses to switch on one.
   */
  ...([
    ['electron', 'ELECTRON'],
    ['bbc-b', 'BBC'],
    ['master', 'MASTER'],
    ['bbc-bplus', 'B?PLUS'],
    ['atom', 'ATOM'],
  ] as const).map(([machine, name]) => ({
    machine: machine as DetectedMachineId,
    pattern: new RegExp(`\\b(?:TARGET_)?${name}[A-Z0-9_]*\\s*(?::=|\\?=|\\+=|=)|\\bIF\\s+[^\\n]{0,16}${name}\\b`, 'i'),
  })),
];


/*
 * What a program needs fitted, and how to tell.
 *
 * Each of these costs firmware or hardware that a bare machine does not have,
 * so each has to be earned by something in the source. Nothing here is fitted
 * because a machine could have it.
 */
const CAPABILITY_RULES: readonly Rule[] = [
  /* The 1770 and 8271 disc controllers, and the load address a disc filing
   * system leaves for a program: with DFS present PAGE moves to &1900. */
  { capability: 'dfs', pattern: /&FE8[0-4]\b/i, what: 'drives a disc controller at &FE80-&FE84', weight: 9 },
  { capability: 'dfs', pattern: /^\s*(?:ORG|\*=)\s*&1900\b/im, what: 'assembles at &1900, the load address DFS leaves', weight: 7 },
  { capability: 'dfs', pattern: /\*(?:DISC|DISK|DRIVE|DIR|TITLE)\b/i, what: 'uses a DFS command', weight: 6 },
  { capability: 'dfs', pattern: /\.(?:ssd|dsd)\b/i, what: 'ships a DFS disc image', weight: 5 },
  { capability: 'adfs', pattern: /\*ADFS\b|\.adf\b/i, what: 'uses ADFS or ships an ADFS image', weight: 7 },

  /* The analogue-to-digital converter is the joystick port. */
  { capability: 'joystick', pattern: /&FEC[0-3]\b/i, what: 'reads the analogue port at &FEC0-&FEC3', weight: 9 },
  { capability: 'joystick', pattern: /\bADVAL\b/i, what: 'calls ADVAL, which reads the joystick', weight: 7 },

  /* The Tube is a second processor across a parasite interface. */
  { capability: 'tube', pattern: /&FEE[0-7]\b/i, what: 'talks to the Tube at &FEE0-&FEE7', weight: 9 },
  { capability: 'tube', pattern: /\bTUBE\b/i, what: 'names the Tube', weight: 4 },

  /* Paging a bank into &8000 is sideways ROM or RAM. */
  { capability: 'sideways', pattern: /&FE30\b/i, what: 'selects a sideways bank at &FE30', weight: 8 },
  { capability: 'sideways', pattern: /\bSIDEWAYS\b/i, what: 'names sideways memory', weight: 4 },

  { capability: 'speech', pattern: /&FBFF\b|\bSPEECH\b/i, what: 'uses the speech system', weight: 6 },
  { capability: 'econet', pattern: /&FEA[0-3]\b|\bECONET\b/i, what: 'uses Econet', weight: 6 },
  { capability: 'shadow', pattern: /\bSHADOW\b/i, what: 'names shadow screen memory', weight: 5 },

  /* A tape is the machine's own interface and needs nothing fitted, but saying
   * it was found is still worth doing, because it is evidence the program was
   * meant to load from one. */
  { capability: 'cassette', pattern: /\*TAPE\b|\.uef\b/i, what: 'uses the cassette filing system', weight: 6 },

  { capability: 'plus1', pattern: /\bPLUS\s*1\b/i, what: 'names the Electron Plus 1', weight: 7 },
  { capability: 'plus3', pattern: /\bPLUS\s*3\b/i, what: 'names the Electron Plus 3', weight: 7 },
];

/** The machine to assume when the codebase names none. */
export const FALLBACK_MACHINE: DetectedMachineId = 'bbc-b';

/**
 * The capability every machine has without anything being fitted.
 *
 * A cassette interface is part of the machine rather than an expansion, so the
 * lowest configuration still has one and a program with no filing-system
 * evidence at all is assumed to load from tape.
 */
const ALWAYS_FITTED = 'cassette';

function scan(rules: readonly Rule[], files: readonly { name: string; content: string }[]) {
  const found = new Map<string, { rule: Rule; signal: PlatformSignal }>();
  for (const file of files) {
    const lines = file.content.split('\n');
    for (const rule of rules) {
      const key = rule.machine ?? rule.capability!;
      const existing = found.get(key);
      if (existing && existing.rule.weight >= rule.weight) continue;
      /* Matched against the whole file first, because some rules span lines,
       * and then located so the finding can be quoted. */
      if (!rule.pattern.test(file.content)) continue;
      const single = new RegExp(rule.pattern.source, rule.pattern.flags.replace(/[gm]/g, ''));
      const index = lines.findIndex((line) => single.test(line));
      const line = index >= 0 ? index : 0;
      found.set(key, {
        rule,
        signal: { what: rule.what, file: file.name, line: line + 1, quote: (lines[line] ?? '').trim().slice(0, 80) },
      });
    }
  }
  return found;
}

/**
 * Read a codebase and say which Acorn it is for, and what it needs fitted.
 *
 * `files` is what the import is about to bring in; only text is read, because
 * only text carries the evidence.
 */
export function detectPlatform(files: readonly Pick<ProjectFile, 'name' | 'content'>[]): DetectedPlatform {
  const readable = files.filter((file) => file.content.length > 0 && file.content.length < 400_000);
  const machines = scan(MACHINE_RULES, readable);
  const fittings = scan(CAPABILITY_RULES, readable);

  /* A build symbol is the author naming the machine, which outranks anything
   * inferred from an address, so these are scanned as rules of their own and
   * merged in above whatever the addresses said. */
  const symbolRules: Rule[] = TARGET_SYMBOLS.map((entry) => ({
    machine: entry.machine,
    pattern: entry.pattern,
    what: `has a build switch for the ${entry.machine}`,
    weight: 11,
  }));
  for (const [id, entry] of scan(symbolRules, readable)) {
    const existing = machines.get(id);
    if (!existing || existing.rule.weight < entry.rule.weight) machines.set(id, entry);
  }

  /*
   * The strongest evidence wins, and where two machines are evidenced equally
   * the smaller one is chosen.
   *
   * ORDER is least-equipped first, which is the whole of the rule the caller
   * asked for: a program built for a machine with more than it needs will run
   * on the larger one, and a program built for a machine with less will not.
   * So a codebase that builds for both a BBC and an Electron is set up as an
   * Electron, and the BBC is named as the other answer rather than lost.
   */
  const ORDER: DetectedMachineId[] = ['atom', 'electron', 'bbc-b', 'bbc-bplus', 'master', 'archimedes-a300'];
  const ranked = [...machines.entries()]
    .map(([id, entry]) => ({ id: id as DetectedMachineId, entry }))
    .sort((left, right) => right.entry.rule.weight - left.entry.rule.weight
      || ORDER.indexOf(left.id) - ORDER.indexOf(right.id));

  /* Anything within two of the best is a real second answer rather than a
   * stray word in a comment, and among those the least-equipped is taken. */
  const best = ranked[0]?.entry.rule.weight ?? 0;
  const credible = ranked.filter((entry) => entry.entry.rule.weight >= best - 2);
  const chosen = [...credible].sort((left, right) => ORDER.indexOf(left.id) - ORDER.indexOf(right.id))[0];
  const machineId = chosen?.id ?? FALLBACK_MACHINE;
  const guessed = !chosen;

  /* Every machine signal that agrees with the conclusion, so the reason shown
   * is all of the reason and not merely the strongest part of it. */
  const machineEvidence = ranked.filter((entry) => entry.id === machineId).map((entry) => entry.entry.signal);
  /* Only the machines the codebase is really for. A word in a planning document
   * is a finding worth keeping but it is not a second target, and saying "this
   * is also written for the Master" because a roadmap mentions one would be the
   * same overreach the address rules were corrected for. */
  const alsoEvidenced = credible
    .filter((entry) => entry.id !== machineId)
    .map((entry) => ({ machineId: entry.id, because: entry.entry.signal }));

  const capabilities = [...fittings.entries()]
    .filter(([id]) => id !== ALWAYS_FITTED)
    .map(([id, entry]) => ({ id, because: entry.signal }))
    .sort((left, right) => left.id.localeCompare(right.id));

  /*
   * What the code needs, not what was fitted.
   *
   * This said "fitted" and listed everything detected, including two things
   * the machine cannot currently be given because the firmware vault holds no
   * ROM for them. Whether a requirement can be met is the caller's to report,
   * and claiming it was met here made the summary confidently wrong.
   */
  const fittedNames = capabilities.map((entry) => capabilityLabel(machineId, entry.id));
  const fitted = fittedNames.length ? `. It needs ${fittedNames.join(', ')}` : ', needing nothing beyond its cassette interface';
  const others = alsoEvidenced.length
    ? ` This codebase is also written for ${[...new Set(alsoEvidenced.map((entry) => labelOf(entry.machineId)))].join(' and ')}; the least equipped is set up, so a build for it runs on the others too.`
    : '';
  const summary = guessed
    ? `Nothing in this codebase names a machine, so it is set up as ${labelOf(machineId)} with nothing fitted beyond its cassette interface. Change it if that is wrong.`
    : `It ${machineEvidence[0]!.what}, so it is set up as ${labelOf(machineId)}${fitted}.${others}`;

  return { machineId, machineEvidence, alsoEvidenced, capabilities, guessed, summary };
}
