import type { ProjectFile } from '../project/project';
import type { LanguageItem } from './languageService';
import type { LanguageTargetContext } from './languageTarget';

const VERSION = 'acorn-snippets-2026.08.1';

export function languageSnippetItems(file: ProjectFile, target?: LanguageTargetContext): LanguageItem[] {
  const source = { kind: 'builtin' as const, label: '8bit-net Acorn snippet library', version: VERSION };
  const common = { kind: 'snippet' as const, languages: [file.language], commitCharacters: ['Enter', 'Tab'] as Array<'Enter' | 'Tab'>, source };
  if (file.language === 'bbc-basic') return [
    { ...common, token: 'FOR_LOOP', detail: 'Insert a complete single-line counted loop that remains compatible with automatic BASIC line numbering.', signature: 'FOR variable=start TO end:statements:NEXT', insertText: 'FOR I%=0 TO 10:PRINT I%:NEXT', documentation: { category: 'BBC BASIC statement snippet', parameters: [{ name: 'I%', detail: 'Rename the integer loop variable after insertion.' }], examples: ['10 FOR I%=0 TO 10:PRINT I%:NEXT'], compatibility: { supported: target?.machineId !== 'atom', appliesTo: [target?.machineLabel ?? 'BBC BASIC II'] } } },
    { ...common, token: 'IF_THEN_ELSE', detail: 'Insert a complete single-line conditional with an explicit ELSE branch.', signature: 'IF condition THEN statement ELSE statement', insertText: 'IF condition THEN statement ELSE statement', documentation: { category: 'BASIC control-flow snippet', examples: ['20 IF score%>high% THEN high%=score% ELSE PRINT score%'], compatibility: { supported: true, appliesTo: [target?.machineLabel ?? 'BBC BASIC'] } } },
  ].filter((item) => item.documentation.compatibility.supported);
  if (file.language === '6502') {
    const bbcMos = !!target && ['bbc-a', 'bbc-b', 'bbc-bplus', 'master', 'electron'].includes(target.machineId);
    const byte = target?.toolchainId === 'cc65.ca65-ld65' ? '$41' : '&41';
    return bbcMos ? [{ ...common, token: 'MOS_WRITE_CHAR', detail: 'Load one character and call the selected machine MOS OSWRCH entry point.', signature: 'LDA #character; JSR OSWRCH', insertText: `LDA #${byte}\n  JSR OSWRCH`, documentation: { category: '6502 BBC MOS snippet', parameters: [{ name: 'character', detail: 'Change the inserted value to the required VDU byte.' }], sideEffects: ['Writes to the active MOS output streams and may alter VDU state.'], examples: [`LDA #${byte}\n  JSR OSWRCH`], compatibility: { supported: true, appliesTo: [target.machineLabel, target.toolchainId ?? '6502 assembler'], warning: 'The second line uses OSWRCH and therefore requires a BBC-family MOS runtime.' } } }] : [];
  }
  if (file.language === 'arm') return [
    { ...common, token: 'RISCOS_WRITE_CHAR', detail: 'Load an ASCII character into R0 and call the numeric RISC OS OS_WriteC SWI.', signature: 'MOV R0, #character; SWI 0x00', insertText: 'MOV R0, #65\n  SWI 0x00', documentation: { category: 'RISC OS ARM snippet', parameters: [{ name: 'character', detail: 'Change 65 to the required character code.' }], sideEffects: ['Writes one character through the active RISC OS output streams.'], examples: ['MOV R0, #65\n  SWI 0x00'], compatibility: { supported: !!target && ['archimedes-a300', 'archimedes-a400', 'a3000', 'a5000'].includes(target.machineId), appliesTo: [target?.machineLabel ?? 'RISC OS'], warning: target?.romReady ? 'Uses the GNU as numeric SWI operand accepted by the active adapter.' : 'Buildable source can be authored, but emulator testing requires the selected RISC OS ROM.' } } },
    { ...common, token: 'ARM_LEAF_RETURN', detail: 'Insert the ARM2 return instruction used by a leaf routine whose link register has not been overwritten.', signature: 'MOV PC, LR', insertText: 'MOV PC, LR', documentation: { category: 'ARM2 routine snippet', sideEffects: ['Copies R14 into R15 and returns using the current 26-bit processor state rules.'], examples: ['MOV PC, LR'], compatibility: { supported: true, appliesTo: ['ARM2', 'ARM3 executing the ARM2 subset'] } } },
  ].filter((item) => item.documentation.compatibility.supported);
  if (file.language === 'c') {
    const items: LanguageItem[] = [{ ...common, token: 'MAIN_FUNCTION', detail: 'Insert a complete cc65-compatible program entry function.', signature: 'int main(void)', insertText: 'int main(void) {\n    return 0;\n}', documentation: { category: 'cc65 C snippet', result: 'Returns zero to the target runtime.', examples: ['int main(void) {\n    return 0;\n}'], compatibility: { supported: target?.toolchainId === 'cc65.c-bbc', appliesTo: [target?.toolchainId ?? 'C toolchain'] } } }];
    if (target && ['bbc-a', 'bbc-b', 'bbc-bplus', 'master', 'electron'].includes(target.machineId)) items.push({ ...common, token: 'MOS_WRITE_CHAR', detail: 'Call the 8bit-net BBC C SDK OSWRCH bridge.', signature: "acorn_oswrch('A');", insertText: "acorn_oswrch('A');", documentation: { category: 'BBC C SDK snippet', sideEffects: ['Writes one byte through BBC MOS OSWRCH.'], examples: ["#include <acorn.h>\nacorn_oswrch('A');"], compatibility: { supported: target.toolchainId === 'cc65.c-bbc', appliesTo: [target.machineLabel, 'cc65.c-bbc'], warning: 'Include <acorn.h> before using the inserted call.' } } });
    return items.filter((item) => item.documentation?.compatibility?.supported);
  }
  return [];
}
