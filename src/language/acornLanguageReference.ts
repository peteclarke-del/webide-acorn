import { MOS_CALLS, MOS_PURPOSES } from '../analysis/disassembler6502';
import type { LanguageItem, LanguageItemDocumentation } from './languageService';
import { bbcBasicDialect, isBbcMosTarget, type LanguageTargetContext } from './languageTarget';
import { atomBasicLanguageItem, atomBasicLanguageItems } from './atomBasicReference';

import { basicKeywordAvailability } from '../analysis/basicKeywordAvailability';

const BASIC_REFERENCE_VERSION = 'acorn-bbc-user-guide-1984+ide-1';
const MOS_REFERENCE_VERSION = 'acorn-bbc-aug+mos-table-1';
const BASIC_GUIDE = 'https://bbc.nvg.org/doc/BBCUserGuide-1.00.pdf';
const ADVANCED_GUIDE = 'https://stardot.org.uk/mirrors/www.bbcdocs.com/filebase/essentials/BBC%20Microcomputer%20Advanced%20User%20Guide.pdf';

interface BasicRecord {
  signature: string;
  signatureForms?: Array<{ signature: string; parameters: string[]; detail?: string }>;
  detail: string;
  parameters?: Array<{ name: string; detail: string; range?: string }>;
  result?: string;
  examples: string[];
  sideEffects?: string[];
  related?: string[];
  section: string;
}

const BASIC: Record<string, BasicRecord> = {
  MODE: { signature: 'MODE mode', detail: 'Select a display mode and clear the screen.', parameters: [{ name: 'mode', detail: 'Display mode number.', range: 'BBC Micro 0–7; Electron 0–6. Master profiles also support documented shadow-mode selection.' }], result: 'The display adopts the selected geometry, colour depth and memory layout.', examples: ['MODE 7', 'MODE 2'], sideEffects: ['Clears the screen, resets text and graphics windows, changes screen-memory use and homes the cursors.'], related: ['VDU', 'PRINT'], section: 'MODE statement and display-mode chapters' },
  PRINT: { signature: 'PRINT [expression][,|; expression…]', signatureForms: [{ signature: 'PRINT', parameters: [], detail: 'Output a newline.' }, { signature: 'PRINT expression[,|; expression…]', parameters: ['expression…'], detail: 'Output one or more formatted expressions.' }], detail: 'Write text or formatted expression values to the current output stream.', parameters: [{ name: 'expression', detail: 'Numeric or string expression; commas and semicolons control formatting.', range: 'Zero or more expressions.' }], result: 'Characters are sent through the active output stream.', examples: ['PRINT "HELLO"', 'PRINT ~address%', 'PRINT A%;B$'], sideEffects: ['Usually advances to a new line unless formatting punctuation suppresses it.'], related: ['VDU', 'OSCLI'], section: 'PRINT statement' },
  PROC: { signature: 'PROCname[(argument, …)]', detail: 'Call a named BBC BASIC procedure declared with DEF PROC.', parameters: [{ name: 'arguments', detail: 'Values corresponding to the procedure declaration.', range: 'Arity and types come from the matching DEF PROC declaration.' }], result: 'Execution resumes after the call when ENDPROC is reached.', examples: ['PROCdraw(10,20)', 'PROCsetup'], sideEffects: ['Procedure code may alter global variables, I/O and machine state.'], related: ['DEF', 'RETURN'], section: 'Procedures and functions' },
  DEF: { signature: 'DEF PROCname[(parameters)] | DEF FNname[(parameters)]', detail: 'Declare a named procedure or function.', parameters: [{ name: 'parameters', detail: 'Optional local formal parameter names.', range: 'Names follow BBC BASIC variable suffix rules.' }], result: 'Introduces a callable PROC or FN declaration.', examples: ['DEF PROCdraw(x%,y%)', 'DEF FNdouble(n)=n*2'], related: ['PROC'], section: 'DEF, PROC and FN' },
  GOSUB: { signature: 'GOSUB line', detail: 'Call a numbered BASIC subroutine and retain a return point.', parameters: [{ name: 'line', detail: 'Existing numbered line in the same program.', range: '0–32767 in the supported tokenised format.' }], result: 'Execution continues at the target until RETURN.', examples: ['GOSUB 1000'], sideEffects: ['Pushes a BASIC return record; unmatched nesting eventually raises an error.'], related: ['RETURN', 'GOTO'], section: 'GOSUB statement' },
  RETURN: { signature: 'RETURN', detail: 'Return from the most recent GOSUB.', result: 'Execution resumes after the calling GOSUB.', examples: ['RETURN'], sideEffects: ['Consumes one BASIC subroutine return record.'], related: ['GOSUB'], section: 'RETURN statement' },
  GOTO: { signature: 'GOTO line', detail: 'Continue execution at a numbered BASIC line.', parameters: [{ name: 'line', detail: 'Existing numbered line in the same program.', range: '0–32767 in the supported tokenised format.' }], result: 'Program control moves to the target line.', examples: ['GOTO 200'], related: ['GOSUB', 'IF'], section: 'GOTO statement' },
  VDU: { signature: 'VDU byte[, byte…] | VDU word;', signatureForms: [{ signature: 'VDU byte[, byte…]', parameters: ['byte…'], detail: 'Send one or more individual bytes.' }, { signature: 'VDU word;', parameters: ['word'], detail: 'Send a 16-bit word low byte first.' }], detail: 'Send bytes directly through the MOS VDU driver.', parameters: [{ name: 'byte', detail: 'Control code, character or parameter byte.', range: '0–255; a semicolon sends a 16-bit value low byte first.' }], result: 'The selected VDU control sequence changes output or display state.', examples: ['VDU 22,2', 'VDU 31,x%,y%', 'VDU x%;'], sideEffects: ['Can change mode, colours, windows, cursor position, palette or plotted graphics.'], related: ['MODE', 'PRINT', 'OSWRCH'], section: 'VDU statement and VDU control-code table' },
  OSCLI: { signature: 'OSCLI command$', detail: 'Pass a command string to the Machine Operating System command-line interpreter.', parameters: [{ name: 'command$', detail: 'Star command without the leading asterisk.', range: 'Command availability comes from the selected MOS, filing system and service ROMs.' }], result: 'The selected MOS/ROM command executes or raises a MOS error.', examples: ['OSCLI "CAT"', 'OSCLI "FX 15,0"'], sideEffects: ['May perform filing-system I/O, alter system configuration or invoke a service ROM.'], related: ['PRINT', 'CALL', 'OSCLI'], section: 'OSCLI statement and operating-system commands' },
  CALL: { signature: 'CALL address[, variable…]', signatureForms: [{ signature: 'CALL address', parameters: ['address'], detail: 'Call machine code without a BASIC parameter block.' }, { signature: 'CALL address, variable…', parameters: ['address', 'variable…'], detail: 'Call machine code with variable references available through the parameter block.' }], detail: 'Transfer control to a 6502 machine-code subroutine, optionally exposing BASIC variables through the parameter block.', parameters: [{ name: 'address', detail: 'Machine-code entry address.', range: '&0000–&FFFF; routine must return with RTS.' }, { name: 'variables', detail: 'Optional variable references described in a parameter block at &0600.', range: 'Zero or more variables; the called code may modify them.' }], result: 'Returns to BASIC after RTS; no packed register result is produced.', examples: ['CALL &FFF4', 'CALL routine%,A%,name$'], sideEffects: ['Initialises A/X/Y from A%/X%/Y% and carry from C%; arbitrary machine code can change memory, hardware and variables.'], related: ['OSCLI', 'PROC'], section: 'CALL statement and machine-code interface' },
  SOUND: { signature: 'SOUND channel, amplitude, pitch, duration', detail: 'Queue a sound request on one of the four BBC sound channels.', parameters: [{ name: 'channel', detail: 'Noise/tone channel plus optional queue-control bits.', range: 'Simple form 0–3; advanced H/S/F/C bit fields are documented by Acorn.' }, { name: 'amplitude', detail: 'Fixed amplitude or envelope selection.', range: '-15 (loud) to 0 (silent), or a valid envelope number.' }, { name: 'pitch', detail: 'Pitch/noise selector.', range: '0–255.' }, { name: 'duration', detail: 'Duration in twentieths of a second by default.', range: '1–255 in the original BBC guide.' }], result: 'A sound event is queued or synchronised.', examples: ['SOUND 1,-15,53,20', 'SOUND 0,-10,4,5'], sideEffects: ['Updates the MOS sound queues and sound-generator state.'], related: ['ENVELOPE'], section: 'Chapter 30: Sound' },
  ENVELOPE: { signature: 'ENVELOPE n,t,pi1,pi2,pi3,pn1,pn2,pn3,aa,ad,as,ar,ala,ald', detail: 'Define pitch and amplitude phases for a later SOUND request.', parameters: [{ name: 'n', detail: 'Envelope number.', range: '1–4.' }, { name: 't', detail: 'Step duration and pitch auto-repeat control.', range: 'Low 7 bits 0–127; bit 7 disables auto-repeat.' }, { name: 'pi1…pi3', detail: 'Pitch change per step.', range: '-128–127.' }, { name: 'pn1…pn3', detail: 'Pitch-section step counts.', range: '0–255.' }, { name: 'aa…ar', detail: 'Amplitude attack/decay/sustain/release rates.', range: 'AA/AD -127–127; AS/AR -127–0.' }, { name: 'ala, ald', detail: 'Attack and decay target levels.', range: '0–126.' }], result: 'Stores an envelope definition used when SOUND selects it.', examples: ['ENVELOPE 1,1,4,-4,4,10,20,10,127,0,0,-5,126,126'], sideEffects: ['Replaces the selected sound envelope definition.'], related: ['SOUND'], section: 'Chapter 30: ENVELOPE' },
  FOR: { signature: 'FOR variable = start TO end [STEP increment]', detail: 'Begin a counted loop.', parameters: [{ name: 'variable', detail: 'Numeric loop control variable.' }, { name: 'start/end/increment', detail: 'Numeric expressions evaluated for loop control.' }], result: 'Executes the loop body until the limit is passed.', examples: ['FOR I%=1 TO 10', 'FOR X=10 TO 0 STEP -0.5'], sideEffects: ['Creates a loop-control record and updates the control variable.'], related: ['NEXT', 'REPEAT'], section: 'FOR and NEXT statements' },
  NEXT: { signature: 'NEXT [variable]', detail: 'Advance and test the active FOR loop.', parameters: [{ name: 'variable', detail: 'Optional loop variable used to identify the loop.' }], result: 'Repeats the loop body or continues after NEXT.', examples: ['NEXT', 'NEXT I%'], related: ['FOR'], section: 'FOR and NEXT statements' },
  REPEAT: { signature: 'REPEAT', detail: 'Begin a post-tested loop terminated by UNTIL.', result: 'Marks the point to which a false UNTIL condition returns.', examples: ['REPEAT'], related: ['UNTIL', 'FOR'], section: 'REPEAT and UNTIL statements' },
  UNTIL: { signature: 'UNTIL condition', detail: 'Finish a REPEAT loop when its condition becomes true.', parameters: [{ name: 'condition', detail: 'Numeric false/true expression.' }], result: 'Returns to REPEAT while false, then continues when true.', examples: ['UNTIL key$<>""'], related: ['REPEAT', 'IF'], section: 'REPEAT and UNTIL statements' },
  IF: { signature: 'IF condition THEN statement [ELSE statement]', detail: 'Conditionally execute a statement or line branch.', parameters: [{ name: 'condition', detail: 'Numeric false/true expression.' }, { name: 'statement', detail: 'Statement or line target executed when true.' }, { name: 'else statement', detail: 'Optional false branch.' }], result: 'Exactly the selected branch executes.', examples: ['IF lives%=0 THEN GOTO 900', 'IF A%=1 THEN PRINT "YES" ELSE PRINT "NO"'], related: ['GOTO', 'UNTIL'], section: 'IF statement' },
  REM: { signature: 'REM comment', detail: 'Begin source commentary extending to the physical end of the line.', parameters: [{ name: 'comment', detail: 'Unexecuted source text.' }], result: 'No runtime operation.', examples: ['REM Initialise sprite data'], sideEffects: [], related: [], section: 'REM statement' },
};

export function basicLanguageItems(target?: LanguageTargetContext) {
  if (target?.machineId === 'atom') return atomBasicLanguageItems(target);
  return Object.keys(BASIC).map((token) => bbcBasicLanguageItem(token, target)!);
}

export function basicLanguageItem(token: string, target?: LanguageTargetContext): LanguageItem | undefined {
  const written = target?.machineId === 'atom'
    ? atomBasicLanguageItem(token, target) ?? bbcBasicLanguageItem(token, target)
    : bbcBasicLanguageItem(token, target) ?? atomBasicLanguageItem(token, target);

  return written ?? romOnlyBasicItem(token);
}

/*
 * A keyword the ROMs have and nobody has written up.
 *
 * Eighteen BBC BASIC keywords have cited prose here and there are a hundred and
 * twenty-one in BASIC II alone. Writing the rest would mean citing sections of
 * a manual this build does not have, which is inventing a citation rather than
 * writing documentation.
 *
 * What can be said exactly is what the ROM tables say: which machines have the
 * keyword and what token each uses. That is the difference between a hover
 * that says nothing at all and one that says this exists, here is where, and
 * nobody has described it yet — and the last part is said rather than left for
 * somebody to conclude from an empty panel.
 */
function romOnlyBasicItem(token: string): LanguageItem | undefined {
  const availability = basicKeywordAvailability(token);
  if (!availability) return undefined;

  return {
    token: availability.keyword,
    kind: 'command',
    detail: `${availability.summary} No description of what it does is documented in this build yet.`,
    languages: ['bbc-basic'],
    documentation: {
      category: 'BBC BASIC keyword',
      compatibility: {
        supported: true,
        appliesTo: availability.dialects.map((entry) => entry.label),
      },
      citations: [{
        title: 'Read from the language ROM keyword tables',
        section: availability.dialects.map((entry) => `${entry.label} ${entry.tokens.map((value) => `&${value.toString(16).toUpperCase().padStart(2, '0')}`).join('/')}`).join(', '),
      }],
    },
    source: { kind: 'builtin', label: 'Language ROM keyword table', version: BASIC_REFERENCE_VERSION },
  };
}

function bbcBasicLanguageItem(token: string, target?: LanguageTargetContext): LanguageItem | undefined {
  const canonical = token.toUpperCase(); const record = BASIC[canonical]; if (!record) return undefined;
  const supported = isBbcMosTarget(target); const dialect = bbcBasicDialect(target);
  const warnings = [!supported ? `BBC BASIC source is not compatible with the selected ${target?.machineLabel ?? 'target'} profile.` : undefined,
    supported && !target?.romReady && target ? `${target.romLabel} is selected, but its required local ROM set is not ready for execution.` : undefined,
    target?.machineId === 'electron' && canonical === 'ENVELOPE' ? 'The Electron implements pitch-envelope behavior but not the BBC Micro amplitude-envelope phases; all 14 parameters remain syntactically required.' : undefined,
    target?.machineId === 'electron' && canonical === 'MODE' ? 'The Electron does not provide BBC Micro MODE 7.' : undefined].filter(Boolean).join(' ');
  const documentation: LanguageItemDocumentation = {
    category: 'BBC BASIC statement', parameters: record.parameters, result: record.result, examples: record.examples, sideEffects: record.sideEffects,
    compatibility: { supported, appliesTo: target ? [dialect, target.machineLabel, target.romLabel] : ['BBC BASIC I/II/IV', 'Acorn Electron BBC BASIC II'], warning: warnings || undefined },
    related: record.related, citations: [{ title: 'BBC Microcomputer System User Guide', url: BASIC_GUIDE, section: record.section, version: 'Acorn issue 1 / October 1984' }],
  };
  return { token: canonical, kind: 'command', detail: record.detail, signature: record.signature, signatureForms: record.signatureForms, parameters: record.parameters?.map((parameter) => parameter.name), languages: ['bbc-basic'], documentation, source: { kind: 'builtin', label: `Acorn BBC User Guide · ${record.section}`, version: BASIC_REFERENCE_VERSION } };
}

const MOS_INTERFACE: Record<string, { parameters: Array<{ name: string; detail: string; range?: string }>; result: string; effects?: string[]; related?: string[] }> = {
  OSWRCH: { parameters: [{ name: 'A', detail: 'Character or VDU control byte.', range: '&00–&FF.' }], result: 'Character is written through the selected output stream.', effects: ['May change VDU state, display memory or redirected output.'], related: ['OSASCI', 'VDUCHR'] },
  OSASCI: { parameters: [{ name: 'A', detail: 'Character byte.', range: '&00–&FF.' }], result: 'Character is written; carriage return is expanded to the MOS newline sequence.', effects: ['Writes through OSWRCH.'], related: ['OSWRCH', 'OSNEWL'] },
  OSNEWL: { parameters: [], result: 'Writes the MOS newline sequence to the selected output stream.', effects: ['Changes output/cursor state.'], related: ['OSASCI', 'OSWRCH'] },
  OSRDCH: { parameters: [], result: 'Returns a character in A; escape/error status is reported by the MOS calling convention.', effects: ['May block while waiting for the selected input stream.'], related: ['OSWRCH'] },
  OSBYTE: { parameters: [{ name: 'A', detail: 'OSBYTE reason code.', range: '&00–&FF.' }, { name: 'X', detail: 'Call-specific parameter.' }, { name: 'Y', detail: 'Call-specific parameter.' }], result: 'Call-specific X/Y values and status are returned.', effects: ['May read or change MOS configuration, input, display or hardware state according to A.'], related: ['OSWORD'] },
  OSWORD: { parameters: [{ name: 'A', detail: 'OSWORD reason code.', range: '&00–&FF.' }, { name: 'X/Y', detail: 'Low/high bytes of the parameter-block address.', range: '&0000–&FFFF.' }], result: 'The call-specific parameter block is read and/or updated.', effects: ['May perform buffered I/O or hardware operations according to A.'], related: ['OSBYTE'] },
  OSCLI: { parameters: [{ name: 'X/Y', detail: 'Low/high bytes of a carriage-return-terminated command string.', range: '&0000–&FFFF.' }], result: 'The MOS or a service ROM executes the command or raises an error.', effects: ['May invoke filing systems and service ROMs or alter system configuration.'], related: ['OSBYTE'] },
  OSFILE: { parameters: [{ name: 'A', detail: 'Whole-file operation reason code.' }, { name: 'X/Y', detail: 'Low/high bytes of the OSFILE control block.' }], result: 'A and the control block return operation-specific file metadata.', effects: ['Reads, writes, loads, saves or catalogues a whole file through the active filing system.'], related: ['OSFIND', 'OSGBPB'] },
  OSFIND: { parameters: [{ name: 'A', detail: 'Open/close operation and access mode.' }, { name: 'X/Y', detail: 'Filename pointer when opening; Y carries the handle when closing.' }], result: 'Returns a file handle in A when opening.', effects: ['Changes the active filing system’s open-file state.'], related: ['OSBGET', 'OSBPUT', 'OSARGS'] },
  OSBPUT: { parameters: [{ name: 'A', detail: 'Byte to write.' }, { name: 'Y', detail: 'Open file handle.' }], result: 'Byte is written or a filing-system error is raised.', effects: ['Advances the file’s sequential pointer.'], related: ['OSBGET', 'OSFIND'] },
  OSBGET: { parameters: [{ name: 'Y', detail: 'Open file handle.' }], result: 'Returns the byte in A and end/error state through the MOS convention.', effects: ['Advances the file’s sequential pointer.'], related: ['OSBPUT', 'OSFIND'] },
  OSARGS: { parameters: [{ name: 'A', detail: 'Operation reason code.' }, { name: 'Y', detail: 'Open file handle, or zero for filing-system information.' }, { name: 'X', detail: 'Pointer to a four-byte data word where required.' }], result: 'Reads or changes file-pointer/extent or filing-system information.', effects: ['May update an open file’s sequential pointer.'], related: ['OSFIND', 'OSGBPB'] },
  OSGBPB: { parameters: [{ name: 'A', detail: 'Block-operation reason code.' }, { name: 'X/Y', detail: 'Low/high bytes of the OSGBPB control block.' }], result: 'Updates the block with transferred count, address and file pointer.', effects: ['Transfers a block through the active filing system.'], related: ['OSFILE', 'OSARGS'] },
};

export function mosLanguageItems(target?: LanguageTargetContext) { return Object.values(MOS_CALLS).map((token) => mosLanguageItem(token, target)!); }

export function mosLanguageItem(token: string, target?: LanguageTargetContext): LanguageItem | undefined {
  const canonical = token.toUpperCase(); const addressEntry = Object.entries(MOS_CALLS).find(([, name]) => name === canonical); if (!addressEntry) return undefined;
  const address = Number(addressEntry[0]); const supported = isBbcMosTarget(target); const interfaceData = MOS_INTERFACE[canonical] ?? { parameters: [{ name: 'A/X/Y', detail: 'Entry-specific register interface; consult the cited MOS call table before use.' }], result: 'Entry-specific register and status results.' };
  const warning = !supported ? `${canonical} is a BBC-family MOS entry point and is not compatible with ${target?.machineLabel ?? 'the selected target'}.` : target && !target.romReady ? `${target.romLabel} supports the BBC MOS interface, but the required local ROM set is not ready for execution.` : undefined;
  const purpose = MOS_PURPOSES[address] ?? 'Machine Operating System call';
  const documentation: LanguageItemDocumentation = {
    category: 'BBC MOS entry point', parameters: interfaceData.parameters, result: interfaceData.result, examples: [`JSR ${canonical}`], sideEffects: interfaceData.effects ?? [`${purpose}; exact register effects are call-specific.`],
    compatibility: { supported, appliesTo: target ? ['BBC MOS call table', target.machineLabel, target.romLabel] : ['BBC Micro MOS', 'Electron OS', 'Master MOS'], warning }, related: interfaceData.related ?? [],
    citations: [{ title: 'Advanced User Guide for the BBC Microcomputer', url: ADVANCED_GUIDE, section: `MOS call table · ${canonical} at &${address.toString(16).toUpperCase().padStart(4, '0')}`, version: 'Acorn / Cambridge Microcomputer Centre' }],
  };
  return { token: canonical, kind: 'mos', detail: `${purpose}. BBC MOS entry point at &${address.toString(16).toUpperCase().padStart(4, '0')}.`, signature: `JSR ${canonical}`, parameters: interfaceData.parameters.map((parameter) => parameter.name), languages: ['6502'], documentation, source: { kind: 'builtin', label: `Acorn MOS call table · &${address.toString(16).toUpperCase().padStart(4, '0')}`, version: MOS_REFERENCE_VERSION } };
}
