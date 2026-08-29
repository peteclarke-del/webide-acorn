import type { ProjectFile } from '../project/project';
import type { LanguageItem } from './languageService';
import type { LanguageTargetContext } from './languageTarget';

const BBC_CITATION = [{ title: 'BBC Microcomputer User Guide', url: 'https://www.bbcmicrobot.com/docs/BBC_User_Guide.pdf', section: 'Memory map assignments' }];
const MASTER_CITATION = [{ title: 'BBC Master Advanced Reference Manual', url: 'https://www.bbproj.org/files/computer/machine-bbc-micro/manuals/advanced-master-reference-manual.pdf', section: 'Memory mapped hardware' }];
const ARCHIMEDES_CITATION = [{ title: 'Acorn Archimedes 300 Series Service Manual', url: 'https://chrisacorns.computinghistory.org.uk/docs/Acorn/Manuals/Acorn_A300_SM.pdf', section: 'System memory map' }];
const SWI_CITATION = [{ title: 'RISC OS 3 Programmer’s Reference Manual', url: 'https://www.riscos.com/support/developers/prm/swis.html', section: 'An introduction to SWIs' }, { title: 'RISC OS numeric SWI index', url: 'https://www.riscos.com/support/developers/prm_index/numswilist.html', section: 'OS SWIs' }];

interface HardwareRecord { token: string; address: number; detail: string; machines: string[]; citations: LanguageItem['documentation'] extends infer Documentation ? Documentation extends { citations?: infer Citations } ? Citations : never : never; }

const HARDWARE: HardwareRecord[] = [
  { token: 'CRTC_ADDRESS', address: 0xfe00, detail: '6845 CRTC address register. Selects the CRTC register accessed through CRTC_DATA.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'CRTC_DATA', address: 0xfe01, detail: '6845 CRTC data register for the index selected through CRTC_ADDRESS.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'ACIA_STATUS', address: 0xfe08, detail: '6850 ACIA status on read and control on write. Access may affect serial or cassette operation.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'ACIA_DATA', address: 0xfe09, detail: '6850 ACIA receive data on read and transmit data on write.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'SERIAL_ULA', address: 0xfe10, detail: 'Serial ULA control latch for cassette and RS423 routing and clock selection.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'VIDEO_ULA_CONTROL', address: 0xfe20, detail: 'Video ULA control latch. Writes change the display mode, clock and teletext selection.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'VIDEO_ULA_PALETTE', address: 0xfe21, detail: 'Video ULA palette write latch. The written byte maps a logical colour to a physical colour.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'ROMSEL', address: 0xfe30, detail: 'Paged ROM selection latch. Exact writable bits depend on the selected BBC family machine.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: MASTER_CITATION },
  { token: 'ACCCON', address: 0xfe34, detail: 'BBC Master ACCCON latch controlling shadow, private, Hazel and display memory selection.', machines: ['master'], citations: MASTER_CITATION },
  { token: 'SYSVIA_ORB', address: 0xfe40, detail: 'System 6522 VIA output register B and input register B.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'SYSVIA_ORA', address: 0xfe41, detail: 'System 6522 VIA output register A and input register A.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'SYSVIA_DDRB', address: 0xfe42, detail: 'System 6522 VIA data-direction register B.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'SYSVIA_DDRA', address: 0xfe43, detail: 'System 6522 VIA data-direction register A.', machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'USERVIA_ORB', address: 0xfe60, detail: 'User 6522 VIA output register B and input register B.', machines: ['bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'USERVIA_ORA', address: 0xfe61, detail: 'User 6522 VIA output register A and input register A.', machines: ['bbc-b', 'bbc-bplus', 'master'], citations: BBC_CITATION },
  { token: 'ELECTRON_ULA', address: 0xfe00, detail: 'Base of the Electron ULA register block at &FE00 to &FE0F. Use the hardware inspector before relying on a read because several registers are access-sensitive.', machines: ['electron'], citations: BBC_CITATION },
  { token: 'ATOM_PPIA', address: 0xb000, detail: 'Base of the Atom 8255 PPIA register block used for keyboard, cassette and video control.', machines: ['atom'], citations: BBC_CITATION },
  { token: 'ATOM_VIA', address: 0xb800, detail: 'Base of the optional Atom 6522 VIA register block.', machines: ['atom'], citations: BBC_CITATION },
  { token: 'IOC_BASE', address: 0x03200000, detail: 'Base of IOC-mapped peripheral space in the A300 series physical I/O map.', machines: ['archimedes-a300', 'archimedes-a400', 'a3000'], citations: ARCHIMEDES_CITATION },
  { token: 'VIDC_WRITE', address: 0x03400000, detail: 'VIDC write region. Register identity is encoded in the written word, not an address offset.', machines: ['archimedes-a300', 'archimedes-a400', 'a3000'], citations: ARCHIMEDES_CITATION },
  { token: 'MEMC_CONTROL', address: 0x03600000, detail: 'MEMC DMA address-generator and control write region.', machines: ['archimedes-a300', 'archimedes-a400', 'a3000'], citations: ARCHIMEDES_CITATION },
  { token: 'MEMC_PAGE', address: 0x03800000, detail: 'MEMC logical-to-physical address translator write region.', machines: ['archimedes-a300', 'archimedes-a400', 'a3000'], citations: ARCHIMEDES_CITATION },
];

const SWIS = [
  ['OS_WriteC', 0x00, 'Write the character in R0 to the active output streams.', ['R0: character byte'], 'R0 preserved'],
  ['OS_WriteS', 0x01, 'Write the inline string immediately following the SWI instruction.', [], 'Execution resumes after the word-aligned string'],
  ['OS_Write0', 0x02, 'Write the null-terminated string addressed by R0.', ['R0: string pointer'], 'R0 points after the terminating null'],
  ['OS_NewLine', 0x03, 'Write the system newline sequence.', [], 'No value result'],
  ['OS_ReadC', 0x04, 'Read a character from the current input stream.', [], 'R0 contains the character'],
  ['OS_CLI', 0x05, 'Run the null-terminated command line addressed by R0.', ['R0: command string pointer'], 'Command-specific'],
  ['OS_Byte', 0x06, 'Perform the OS_Byte operation selected by R0.', ['R0: reason code', 'R1, R2: operation parameters'], 'R1 and R2 are operation-specific'],
  ['OS_Word', 0x07, 'Perform the OS_Word operation selected by R0.', ['R0: reason code', 'R1: parameter block pointer'], 'Parameter block is operation-specific'],
  ['OS_File', 0x08, 'Perform a whole-file operation selected by R0.', ['R0: reason code', 'R1: filename pointer'], 'Registers depend on the reason code'],
  ['OS_Args', 0x09, 'Read or alter information associated with an open file.', ['R0: reason code', 'R1: file handle', 'R2: operation parameter'], 'Registers depend on the reason code'],
  ['OS_BGet', 0x0a, 'Read one byte from an open file.', ['R1: file handle'], 'R0 contains the byte; C reports end of file'],
  ['OS_BPut', 0x0b, 'Write one byte to an open file.', ['R0: byte', 'R1: file handle'], 'File state is updated'],
  ['OS_GBPB', 0x0c, 'Transfer a block of bytes or read filing-system catalogue data.', ['R0: reason code', 'R1: file handle', 'R2: data pointer', 'R3: count', 'R4: file pointer'], 'Registers depend on the reason code'],
  ['OS_Find', 0x0d, 'Open or close a file according to the reason code in R0.', ['R0: reason code', 'R1: filename pointer or handle'], 'R0 contains an open-file handle when opening'],
  ['OS_ReadLine', 0x0e, 'Read an editable line into a bounded caller-supplied buffer.', ['R0: buffer', 'R1: maximum length', 'R2, R3: character bounds'], 'R1 contains the line length'],
  ['OS_GetEnv', 0x10, 'Read the current command environment.', [], 'R0 is command string, R1 is RAM limit, R2 is time'],
  ['OS_Exit', 0x11, 'Exit the current program through the RISC OS environment.', [], 'Does not normally return'],
] as const;

export function acornTargetReferenceItems(file: ProjectFile, target?: LanguageTargetContext): LanguageItem[] {
  if (!target) return [];
  const hardware = HARDWARE.filter((record) => record.machines.includes(target.machineId)).map((record): LanguageItem => ({
    token: record.token, kind: 'hardware', detail: record.detail, signature: `${record.token} = ${formatAddress(record.address, file, target)}`,
    insertText: formatAddress(record.address, file, target), languages: [file.language], commitCharacters: ['Enter', 'Tab'],
    source: { kind: 'builtin', label: `${target.machineLabel} hardware map`, version: 'acorn-hardware-2026.08.1' },
    documentation: { category: `${target.machineLabel} hardware address`, sideEffects: ['Memory-mapped I/O reads and writes can acknowledge interrupts, consume data, alter latches or change the display. Inspect the register semantics before access.'], compatibility: { supported: true, appliesTo: [target.machineLabel] }, citations: record.citations },
  }));
  if (file.language !== 'arm' || !target.machineId.startsWith('archimedes-') && !['a3000', 'a5000'].includes(target.machineId)) return hardware;
  return [...hardware, ...SWIS.map(([token, number, detail, parameters, result]): LanguageItem => ({
    token, kind: 'swi', detail: `${detail} ${parameters.length ? `Entry ${parameters.join('; ')}. ` : 'No entry registers. '}${result}.`, signature: `${token} (SWI &${number.toString(16).toUpperCase().padStart(2, '0')})`, parameters: [...parameters], insertText: `0x${number.toString(16).toUpperCase().padStart(2, '0')}`, languages: ['arm'], commitCharacters: ['Enter', 'Tab'],
    source: { kind: 'builtin', label: 'RISC OS 3 Programmer’s Reference Manual', version: target.romId },
    documentation: { category: 'RISC OS kernel SWI', parameters: parameters.map((parameter) => ({ name: parameter.split(':')[0]!, detail: parameter })), result, sideEffects: ['The SWI may enter SVC mode and may return an error through V when called without the X bit.'], examples: [`SWI 0x${number.toString(16).toUpperCase().padStart(2, '0')}  @ ${token}`], compatibility: { supported: true, appliesTo: [target.machineLabel, target.romLabel], warning: target.romReady ? 'The completion inserts the numeric GNU as operand so the selected native assembler can resolve it without an external header.' : 'Authoring is available, but the selected RISC OS ROM is not ready, so this SWI cannot be tested in the emulator yet.' }, citations: SWI_CITATION },
  }))];
}

function formatAddress(address: number, file: ProjectFile, target: LanguageTargetContext) {
  const width = address > 0xffff ? 8 : 4; const digits = address.toString(16).toUpperCase().padStart(width, '0');
  if (file.language === 'c' || file.language === 'arm') return `0x${digits}`;
  if (file.language === '6502' && target.toolchainId === 'cc65.ca65-ld65') return `$${digits}`;
  return `&${digits}`;
}
