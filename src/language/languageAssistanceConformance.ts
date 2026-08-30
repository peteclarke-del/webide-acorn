import type { Processor } from '../analysis/types';
import type { ProjectFile } from '../project/project';
import type { LanguageTargetContext } from './languageTarget';

export type ConformanceState = 'supported' | 'not-applicable' | 'blocked';
export type ConformanceDimension = 'completion' | 'types' | 'hover' | 'signature' | 'target-jump' | 'bookmarks' | 'numbering' | 'editing' | 'accessibility' | 'stale-response';

export interface LanguageAssistanceFixture {
  id: '6502' | '65c02' | 'bbc-basic' | 'atom-basic' | '8bit-c' | 'arm-assembly' | 'risc-os-c';
  label: string;
  file: ProjectFile;
  processor: Processor;
  target: LanguageTargetContext;
  completionToken?: string;
  signature?: { source: string; token: string };
  navigation?: { source: string; reference: string; declarationLine: number; occurrence?: 'first' | 'last' };
  typeHint?: { source: string; token: string };
  dimensions: Record<ConformanceDimension, { state: ConformanceState; evidence: string }>;
}

const common = (overrides: Partial<Record<ConformanceDimension, { state: ConformanceState; evidence: string }>> = {}): LanguageAssistanceFixture['dimensions'] => ({
  completion: { state: 'supported', evidence: 'project language completion model' },
  types: { state: 'not-applicable', evidence: 'language has no authoritative source type contract' },
  hover: { state: 'supported', evidence: 'maintained token documentation' },
  signature: { state: 'supported', evidence: 'versioned signature provider' },
  'target-jump': { state: 'supported', evidence: 'parsed definition and reference ranges' },
  bookmarks: { state: 'supported', evidence: 'language-neutral anchored source bookmarks' },
  numbering: { state: 'not-applicable', evidence: 'numbering applies only to BASIC source' },
  editing: { state: 'supported', evidence: 'language-aware editor command adapter' },
  accessibility: { state: 'supported', evidence: 'combobox, active-descendant, labelled navigation and keyboard controls' },
  'stale-response': { state: 'supported', evidence: 'document, project, target and build revision identity' },
  ...overrides,
});

const target = (processor: Processor, machineId: string, machineLabel: string, toolchainId?: string): LanguageTargetContext => ({ processor, machineId, machineLabel, romId: 'fixture-rom', romLabel: 'Fixture ROM', romReady: true, enabledCapabilities: [], toolchainId });
const file = (id: string, name: string, content: string, language: ProjectFile['language']): ProjectFile => ({ id, name, content, language, modified: false, kind: 'authored', access: 'editable' });

export const LANGUAGE_ASSISTANCE_FIXTURES: LanguageAssistanceFixture[] = [
  { id: '6502', label: '6502 assembly', file: file('asm6502', 'main.asm', '.start\n LD', '6502'), processor: '6502', target: target('6502', 'bbc-b', 'BBC Model B', '8bit-net.asm.6502'), completionToken: 'LDA', signature: { source: '.start\n LDA ', token: 'LDA' }, navigation: { source: ' JSR draw\n.draw\n RTS', reference: 'draw', declarationLine: 2 }, dimensions: common() },
  { id: '65c02', label: '65C02 assembly', file: file('asm65c02', 'main.asm', '.start\n ST', '6502'), processor: '65c02', target: target('65c02', 'master', 'BBC Master', '8bit-net.asm.6502'), completionToken: 'STZ', signature: { source: '.start\n STZ ', token: 'STZ' }, navigation: { source: ' BRA ready\n.ready\n RTS', reference: 'ready', declarationLine: 2 }, dimensions: common() },
  { id: 'bbc-basic', label: 'BBC BASIC', file: file('bbc', 'main.bas', '10 PR', 'bbc-basic'), processor: '6502', target: target('6502', 'bbc-b', 'BBC Model B'), completionToken: 'PRINT', signature: { source: '10 SOUND 1,', token: 'SOUND' }, navigation: { source: '10 PROCdraw(1)\n100 DEF PROCdraw(colour%)', reference: 'PROCdraw', declarationLine: 2 }, typeHint: { source: '10 score%=1', token: 'score%' }, dimensions: common({ types: { state: 'supported', evidence: 'documented BASIC suffix and declaration rules' }, numbering: { state: 'supported', evidence: 'automatic numbering and previewed renumber model' } }) },
  { id: 'atom-basic', label: 'Atom BASIC', file: file('atom', 'main.bas', '10 PR', 'bbc-basic'), processor: '6502', target: target('6502', 'atom', 'Acorn Atom'), completionToken: 'PRINT', signature: { source: '10 PLOT 13,20,', token: 'PLOT' }, navigation: { source: '10 GOSUB a\n100aPRINT "READY"', reference: 'a', declarationLine: 2 }, typeHint: { source: '10 A=1', token: 'A' }, dimensions: common({ types: { state: 'supported', evidence: 'Atom integer and selected floating extension rules' }, numbering: { state: 'supported', evidence: 'Atom-specific persisted numbering and renumber model' } }) },
  { id: '8bit-c', label: 'cc65 BBC C', file: file('c6502', 'main.c', 'int main(void) { acorn_', 'c'), processor: '6502', target: target('6502', 'bbc-b', 'BBC Model B', 'cc65.c-bbc'), completionToken: 'acorn_oswrch', signature: { source: 'void draw(unsigned char colour) {}\nint main(void) { draw(', token: 'draw' }, navigation: { source: 'void draw(void) {}\nint main(void) { draw(); }', reference: 'draw', declarationLine: 1, occurrence: 'last' }, typeHint: { source: 'unsigned char colour;', token: 'colour' }, dimensions: common({ types: { state: 'supported', evidence: 'cc65 BBC source type and calling-convention model' }, numbering: { state: 'not-applicable', evidence: 'C source is not line numbered' } }) },
  { id: 'arm-assembly', label: 'ARM2 assembly', file: file('arm', 'main.arm', '_start:\n MO', 'arm'), processor: '6502', target: target('6502', 'archimedes-a310', 'Archimedes A310', 'gnu-as.arm2'), completionToken: 'MOV', signature: { source: '_start:\n MOV ', token: 'MOV' }, navigation: { source: ' B draw\ndraw:\n MOV PC,R14', reference: 'draw', declarationLine: 2 }, dimensions: common() },
  { id: 'risc-os-c', label: 'RISC OS C', file: file('riscos', 'main.c', 'int main(void) { return 0; }', 'c'), processor: '6502', target: target('6502', 'archimedes-a310', 'Archimedes A310', 'riscos.c'), dimensions: common({ completion: { state: 'blocked', evidence: 'BLD-329 requires an accepted RISC OS C ABI, compiler and SDK' }, types: { state: 'blocked', evidence: 'authoritative compiler type records are not integrated' }, hover: { state: 'blocked', evidence: 'the selected RISC OS C SDK reference pack is not integrated' }, signature: { state: 'blocked', evidence: 'the RISC OS C SDK declaration provider is not integrated' }, 'target-jump': { state: 'blocked', evidence: 'compiler and linker declaration records are not integrated' } }) },
];
