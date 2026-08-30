/* Templates: a starting point that matches the machine you have chosen.
 *
 * The samples are finished programs. They are the right thing for reading and
 * for proving the toolchain end to end, and the wrong thing for starting work:
 * someone who wants to write their own game has to delete a maze first.
 *
 * A template is the other half — a small, complete, buildable skeleton with the
 * machine it was written for recorded alongside it. "Target-aware" is the point
 * of the schema rather than a label on it: a template declares the machine,
 * variant, ROM set and hardware capabilities it needs, and the catalogue
 * reports whether the configuration in front of you actually offers them. A
 * template that needs a disk filing system is not offered silently on a
 * cassette-only machine and then found to fail at build time.
 *
 * Both templates here were written for this product. Nothing in them is
 * derived from Acorn's ROMs, from published listings, or from any other
 * project: they call documented OS entry points, which is an interface rather
 * than a work, and everything between those calls is original. The provenance
 * each template carries records that, so the licence review at the end of this
 * project has a statement to check rather than an assumption to make.
 */
import { PROJECT_FORMAT, parseProject, type LocalProject, type SourceLanguage } from './project';
import { machineProfiles } from '../data/machines';
import type { MachineProfile } from '../types';
import type { ToolchainId } from '../build/buildTarget';

export const TEMPLATE_CATALOGUE_SCHEMA = '8bit-net.template-catalogue';
export const TEMPLATE_CATALOGUE_VERSION = 1;

export interface TemplateProvenance {
  /** Who wrote it. Every template here is original to this product. */
  author: string;
  /** The licence it is offered under, recorded rather than assumed. */
  licence: string;
  /** What it does and does not derive from, in a sentence. */
  note: string;
}

export interface TemplateTarget {
  platformClass: string;
  machineId: string;
  variant: string;
  romId: string;
  /** Capabilities the template switches on when it opens. */
  enabledCapabilities: string[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  summary: string;
  language: SourceLanguage;
  target: TemplateTarget;
  /**
   * Capabilities the machine must actually offer for this template to build
   * and run. Distinct from `target.enabledCapabilities`, which is only what is
   * switched on: a template can enable something optional without requiring it.
   */
  requiredCapabilities: string[];
  toolchainId: ToolchainId;
  entryFileName: string;
  outputName: string;
  files: ReadonlyArray<{ name: string; content: string }>;
  /** What the template gives you, one claim per entry. */
  highlights: string[];
  provenance: TemplateProvenance;
}

/* ---- the templates -------------------------------------------------------- */

const MODE7_ASM = `; MODE 7 starter for the BBC Model B.
;
; A complete, buildable program that does the smallest useful thing: it selects
; the teletext screen, prints a line through the operating system, waits for a
; key, and returns to BASIC cleanly. Everything you write goes between .start
; and .finish; the routines below are yours to change or delete.
;
; Only documented OS entry points are used:
;   OSWRCH (&FFEE) writes one character to the current output stream.
;   OSRDCH (&FFE0) reads one character from the current input stream.
;   OSNEWL (&FFE7) writes a newline.
;
; Build this file, then press Run. &1900 is where a DFS machine loads a program
; that BASIC has not reserved space below.

; Zero-page workspace. &70 upwards is reserved for the user by the OS, so a
; program that stays inside it does not fight BASIC or the filing system.
string_pointer = &70

OSWRCH = &FFEE
OSRDCH = &FFE0
OSNEWL = &FFE7

ORG &1900

.start
  JSR select_mode7
  LDX #<banner
  LDY #>banner
  JSR print_string
  JSR OSNEWL
  LDX #<prompt
  LDY #>prompt
  JSR print_string
  JSR OSRDCH
  JSR OSNEWL
.finish
  RTS

; Select MODE 7. VDU 22 takes the mode as its one parameter, and MODE 7 is the
; teletext screen: one kilobyte of memory, forty columns, no pixel addressing.
.select_mode7
  LDA #22
  JSR OSWRCH
  LDA #7
  JSR OSWRCH
  RTS

; Print the zero-terminated string whose address is in X (low) and Y (high).
; The address is copied into zero page so it can be indexed; &70 to &8F is the
; block the operating system leaves to a user program.
.print_string
  STX string_pointer
  STY string_pointer + 1
  LDY #0
.print_string_loop
  LDA (string_pointer),Y
  BEQ print_string_done
  JSR OSWRCH
  INY
  BNE print_string_loop
.print_string_done
  RTS

.banner
  EQUS "8BIT-NET DEV"
  EQUB 0

.prompt
  EQUS "Press any key."
  EQUB 0

.program_end
`;

const DISK_BASIC = `   10 REM Disk starter for the BBC Model B.
   20 REM Reads a file's catalogue entry from disk without loading the file,
   30 REM as a starting point for anything that keeps its data on disk.
   40 REM OSFILE (&FFDD) with A%=5 returns the load address, execution address,
   50 REM length and attributes in a control block. It is a documented call.
   60 MODE 7
   70 PRINT "8BIT-NET DEV disk starter"
   80 PRINT
   90 DIM block% 17
  100 REPEAT
  110 INPUT "File name (RETURN to stop) " name$
  120 IF name$ <> "" THEN PROCcatalogue(name$)
  130 UNTIL name$ = ""
  140 END
  150 REM ----------------------------------------------------------------
  160 REM Print one file's catalogue entry, or say it is not on this disk.
  170 REM ----------------------------------------------------------------
  180 DEF PROCcatalogue(file$)
  190 LOCAL A%, X%, Y%, found%
  200 $&900 = file$
  210 block%!0 = &900
  220 A% = 5
  230 X% = block% AND &FF
  240 Y% = block% DIV 256
  250 found% = USR(&FFDD) AND &FF
  260 IF found% = 0 THEN PRINT file$; " is not on this disk" : ENDPROC
  270 PRINT file$; " load &"; ~block%!2
  280 PRINT "  exec &"; ~block%!6; "  length &"; ~block%!10
  290 ENDPROC
`;

export const TEMPLATE_CATALOGUE: readonly ProjectTemplate[] = Object.freeze([
  Object.freeze({
    id: 'bbc-b-mode7-6502',
    name: 'BBC Model B · MODE 7 starter',
    summary: 'A buildable 6502 program that selects the teletext screen, prints through the OS, and returns to BASIC.',
    language: '6502' as const,
    target: {
      platformClass: '8-16-bit',
      machineId: 'bbc-b',
      variant: 'Model B · 8271 DFS',
      romId: 'os12-basic2-dfs',
      enabledCapabilities: ['dfs'],
    },
    /* Nothing beyond the base machine: this runs on a cassette Model B too. */
    requiredCapabilities: [],
    toolchainId: '8bit-net.asm.6502' as ToolchainId,
    entryFileName: 'main.asm',
    outputName: 'TEMPLATE',
    files: [{ name: 'main.asm', content: MODE7_ASM }],
    highlights: [
      'Selects MODE 7 through VDU 22, so it runs in one kilobyte of screen memory',
      'Prints a zero-terminated string through OSWRCH with a zero-page pointer',
      'Waits for a key through OSRDCH and returns to BASIC rather than hanging',
      'Uses only &70 upwards in zero page, which the OS reserves for user programs',
    ],
    provenance: {
      author: '8bit-net Dev',
      licence: 'MIT',
      note: 'Written for this product. It calls documented OS entry points, which are an interface rather than a work; nothing is copied from Acorn firmware or from any published listing.',
    },
  }),
  Object.freeze({
    id: 'bbc-b-disk-basic',
    name: 'BBC Model B · disk catalogue starter',
    summary: 'A BASIC II program that reads file information from disk through OSFILE, as a starting point for anything that loads its own data.',
    language: 'bbc-basic' as const,
    target: {
      platformClass: '8-16-bit',
      machineId: 'bbc-b',
      variant: 'Model B · 8271 DFS',
      romId: 'os12-basic2-dfs',
      enabledCapabilities: ['dfs'],
    },
    /* This one genuinely needs a filing system, and says so, rather than being
     * offered on a cassette machine and failing when it is run. */
    requiredCapabilities: ['dfs'],
    toolchainId: '8bit-net.basic.bbc2' as ToolchainId,
    entryFileName: 'main.bas',
    outputName: 'TEMPLATE',
    files: [{ name: 'main.bas', content: DISK_BASIC }],
    highlights: [
      'Reads a file’s catalogue entry with OSFILE A=5, which does not load the file',
      'Prints the load address, execution address and length the disk records',
      'Keeps its control block and filename in the OS scratch area at &900',
      'One DEF PROC per job, so the structure survives being extended',
    ],
    provenance: {
      author: '8bit-net Dev',
      licence: 'MIT',
      note: 'Written for this product. OSFILE is a documented operating-system call; the program around it is original.',
    },
  }),
]);

/* ---- fit against a machine ------------------------------------------------ */

export interface TemplateFit {
  /** True when this build can offer the template against this machine. */
  fits: boolean;
  /** Why not, in the user's terms. Empty when it fits. */
  problems: string[];
}

/**
 * Whether a template can be offered for a machine, and what stops it.
 *
 * A capability the machine lists as `planned` is not a capability: the product
 * says elsewhere that planned means not fitted, and offering a template that
 * depends on one would be the same claim made twice as loudly. `preview` is
 * allowed, with the state named, because a preview capability does something.
 */
export function templateFit(template: ProjectTemplate, catalogue: readonly MachineProfile[] = machineProfiles): TemplateFit {
  const problems: string[] = [];
  const machine = catalogue.find((candidate) => candidate.id === template.target.machineId);
  if (!machine) {
    return { fits: false, problems: [`This build has no machine profile called ${template.target.machineId}.`] };
  }
  if (machine.platformClass !== template.target.platformClass) {
    problems.push(`${machine.label} is a ${machine.platformClass} machine, and this template declares ${template.target.platformClass}.`);
  }
  if (!machine.variants.includes(template.target.variant)) {
    problems.push(`${machine.label} has no variant called ${template.target.variant}.`);
  }
  if (!machine.roms.some((rom) => rom.id === template.target.romId)) {
    problems.push(`${machine.label} has no ROM set called ${template.target.romId}.`);
  }
  for (const required of template.requiredCapabilities) {
    const capability = machine.capabilities.find((candidate) => candidate.id === required);
    if (!capability) {
      problems.push(`${machine.label} does not offer ${required}, which this template needs.`);
      continue;
    }
    if (capability.state === 'planned') {
      problems.push(`${capability.label} is planned rather than fitted on ${machine.label}, so this template cannot run yet.`);
    }
  }
  return { fits: problems.length === 0, problems };
}

/** Every template that can be offered for a machine, with the rest reported. */
export function templatesForMachine(
  machineId: string,
  catalogue: readonly MachineProfile[] = machineProfiles,
  templates: readonly ProjectTemplate[] = TEMPLATE_CATALOGUE,
): { available: ProjectTemplate[]; unavailable: Array<{ template: ProjectTemplate; problems: string[] }> } {
  const available: ProjectTemplate[] = [];
  const unavailable: Array<{ template: ProjectTemplate; problems: string[] }> = [];
  for (const template of templates) {
    if (template.target.machineId !== machineId) continue;
    const fit = templateFit(template, catalogue);
    if (fit.fits) available.push(template);
    else unavailable.push({ template, problems: fit.problems });
  }
  return { available, unavailable };
}

/* ---- opening one ---------------------------------------------------------- */

/**
 * A real project from a template, parsed through the ordinary project parser so
 * it is validated and migrated exactly like any other project rather than
 * trusted because it shipped with the product.
 */
export function projectFromTemplate(template: ProjectTemplate, projectName = template.name): LocalProject {
  const fit = templateFit(template);
  if (!fit.fits) throw new Error(`${template.name} cannot be opened: ${fit.problems.join(' ')}`);

  const files = template.files.map((file, index) => ({
    id: `${template.id}-file-${index}`,
    name: file.name,
    content: file.content,
    savedName: file.name,
    savedContent: file.content,
  }));
  const entry = files.find((file) => file.name === template.entryFileName);
  if (!entry) throw new Error(`${template.name} names ${template.entryFileName} as its entry file, which is not among its files.`);

  return parseProject(JSON.stringify({
    format: PROJECT_FORMAT,
    name: projectName.trim() || template.name,
    files,
    target: template.target,
    buildTargets: [{
      id: `${template.id}-build`,
      name: `${template.entryFileName.replace(/\.[^.]+$/, '')} build`,
      entryFileId: entry.id,
      sourceFileIds: files.map((file) => file.id),
      toolchainId: template.toolchainId,
      outputName: template.outputName,
    }],
    activeBuildTargetId: `${template.id}-build`,
  }));
}

/* ---- catalogue validation -------------------------------------------------- */

export interface TemplateProblem {
  where: string;
  problem: string;
}

/**
 * Check the shipped catalogue against the rules the rest of this module
 * depends on. Run by a contract test rather than at startup: a broken
 * catalogue is a build defect, and failing a test says so at the right moment.
 */
export function validateTemplateCatalogue(
  templates: readonly ProjectTemplate[] = TEMPLATE_CATALOGUE,
  catalogue: readonly MachineProfile[] = machineProfiles,
): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const ids = new Set<string>();
  for (const template of templates) {
    const where = template.id || '(a template with no id)';
    if (!template.id) problems.push({ where, problem: 'has no identifier' });
    if (ids.has(template.id)) problems.push({ where, problem: 'shares its identifier with another template' });
    ids.add(template.id);
    if (!template.name.trim()) problems.push({ where, problem: 'has no name' });
    if (!template.summary.trim()) problems.push({ where, problem: 'has no summary' });
    if (!template.highlights.length) problems.push({ where, problem: 'claims nothing about what it offers' });
    if (!template.files.length) problems.push({ where, problem: 'carries no files' });
    if (!template.files.some((file) => file.name === template.entryFileName)) {
      problems.push({ where, problem: `names ${template.entryFileName} as its entry file, which is not among its files` });
    }
    if (!template.provenance.author.trim() || !template.provenance.licence.trim() || !template.provenance.note.trim()) {
      problems.push({ where, problem: 'does not record where its code came from and under what licence' });
    }
    const fit = templateFit(template, catalogue);
    if (!fit.fits) problems.push({ where, problem: `does not fit the machine it declares: ${fit.problems.join(' ')}` });
  }
  return problems;
}
