import { validateScreenRegion, type ScreenGolden } from './screenAssertion';

export type TestRegister = 'a' | 'x' | 'y' | 's' | 'p' | 'pc';
export type MosTestEvent = 'osrdch' | 'osasci' | 'osnewl' | 'oswrcr' | 'oswrch' | 'osword' | 'osbyte' | 'oscli';
/* These are BBC MOS entry addresses. The Atom is a different operating system,
 * so the runtime refuses OUTPUT and EVENT assertions on that machine rather
 * than counting whatever occupies the same addresses there. */
export const MOS_TEST_EVENT_ADDRESSES: Readonly<Record<MosTestEvent, number>> = {
  osrdch: 0xffe0,
  osasci: 0xffe3,
  osnewl: 0xffe7,
  oswrcr: 0xffea,
  oswrch: 0xffee,
  osword: 0xfff1,
  osbyte: 0xfff4,
  oscli: 0xfff7,
};
export type MachineAssertion =
  | { kind: 'register'; register: TestRegister; expected: number; source: string }
  | { kind: 'memory'; address: number; expected: number[]; source: string }
  | { kind: 'output'; expected: string; source: string }
  | { kind: 'audio'; expected: string; source: string }
  | { kind: 'screen'; x: number; y: number; width: number; height: number; expected: string; source: string }
  | { kind: 'screen-golden'; goldenId: string; x: number; y: number; width: number; height: number; expectedRgbaBase64: string; allowedChannelDelta: number; allowedDifferingPixels: number; source: string }
  | { kind: 'event'; event: MosTestEvent; expected: number; source: string }
  /* An entry count at an address the author names, so a protocol that is not
   * the BBC MOS — an Atom vector, a program's own dispatcher, a sideways ROM
   * service entry — can be asserted without this build pretending to know what
   * lives there. The address is the claim; nothing is named for the user. */
  | { kind: 'event-address'; address: number; expected: number; source: string }
  /* The speaker on an Acorn Atom is one bit of a PPIA port rather than a sound
   * chip, so its faithful observation is a transition count, not a command
   * digest. Counted from real port writes; no waveform is synthesised. */
  | { kind: 'audio-speaker'; expected: number; source: string }
  | { kind: 'cycles'; operator: 'eq' | 'lte' | 'gte'; expected: number; source: string }
  | { kind: 'cycles'; operator: 'range'; expected: number; expectedMaximum: number; source: string };

/**
 * Which processor a plan is about.
 *
 * A machine with a second processor fitted has two, and almost nothing a test
 * can observe means the same thing on both: the MOS entry points, the screen
 * and the sound chip are all the host's. So the plan names the processor and
 * the assertions available follow from it, rather than a parasite test quietly
 * asserting host state and passing for the wrong reason.
 */
export type TestProcessor = 'host' | 'parasite';

/** Assertions whose subject is host hardware or the host's operating system. */
const HOST_ONLY_ASSERTIONS: Readonly<Record<string, string>> = {
  output: 'OUTPUT captures the host MOS OSWRCH entry, which the parasite does not execute',
  event: 'EVENT[MOS_CALL] counts entries to the host MOS, which the parasite does not execute',
  'event-address': 'EVENT[address] counts host program counter values, and the parasite has its own',
  screen: 'SCREEN reads the host video hardware, which the parasite does not have',
  'screen-golden': 'SCREEN_IMAGE reads the host video hardware, which the parasite does not have',
  audio: 'AUDIO[WRITES] counts writes to the host sound chip, which the parasite does not have',
  'audio-speaker': 'AUDIO[SPEAKER] counts transitions of a host speaker, which the parasite does not have',
};

export interface ParsedTestPlan {
  stopAddress: number | null;
  processor: TestProcessor;
  assertions: MachineAssertion[];
  errors: string[];
}

export function resolveTestValue(input: string, symbols: Record<string, number>): number | null {
  const value = input.trim();
  const normalizedSymbol = value.replace(/^\./, '').toUpperCase();
  const symbol = Object.entries(symbols).find(([name]) => name.replace(/^\./, '').toUpperCase() === normalizedSymbol);
  if (symbol) return symbol[1];
  if (/^&[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  if (/^\$[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
  if (/^\d+$/.test(value)) return Number(value);
  return null;
}

function resolveByte(input: string): number | null {
  const token = input.trim();
  if (/^(?:&|\$)[0-9a-f]{1,2}$/i.test(token)) return Number.parseInt(token.slice(1), 16);
  if (/^0x[0-9a-f]{1,2}$/i.test(token)) return Number.parseInt(token.slice(2), 16);
  if (/^[0-9a-f]{2}$/i.test(token)) return Number.parseInt(token, 16);
  if (/^\d{1,3}$/.test(token)) return Number(token);
  return null;
}

export function parseTestPlan(stop: string, source: string, symbols: Record<string, number>, screenGoldens: readonly ScreenGolden[] = []): ParsedTestPlan {
  const errors: string[] = [];
  const stopAddress = resolveTestValue(stop, symbols);
  if (stopAddress === null || !Number.isInteger(stopAddress) || stopAddress < 0 || stopAddress > 0xffff) errors.push('Stop address must be a 16-bit address or a symbol from the current build');
  const assertions: MachineAssertion[] = [];
  let processor = 'host' as TestProcessor;
  let processorLine: number | null = null;
  let memoryBytes = 0;
  source.split(/\r?\n/).forEach((rawLine, index) => {
    const text = rawLine.replace(/\s*(?:;|#).*$/, '').trim();
    if (!text) return;
    const declared = /^PROCESSOR\s*(?:==|=)?\s*(HOST|PARASITE)$/i.exec(text);
    if (declared) {
      /* Once, or two lines disagree and nothing says which won. */
      if (processorLine !== null) errors.push(`Line ${index + 1}: PROCESSOR is already declared on line ${processorLine}`);
      else { processor = declared[1]!.toLowerCase() as TestProcessor; processorLine = index + 1; }
      return;
    }
    if (assertions.length >= 64) { errors.push('Assertion plans are limited to 64 assertions'); return; }
    const register = /^(A|X|Y|S|P|PC)\s*(?:==|=)\s*(.+)$/i.exec(text);
    if (register) {
      const name = register[1]!.toLowerCase() as TestRegister;
      const expected = resolveTestValue(register[2]!, symbols);
      const maximum = name === 'pc' ? 0xffff : 0xff;
      if (expected === null || expected < 0 || expected > maximum) errors.push(`Line ${index + 1}: ${name.toUpperCase()} expectation is invalid or out of range`);
      else assertions.push({ kind: 'register', register: name, expected, source: rawLine.trim() });
      return;
    }
    const output = /^OUTPUT\s*(?:==|=)\s*("(?:[^"\\]|\\.)*")$/i.exec(text);
    if (output) {
      try { const expected = JSON.parse(output[1]!) as unknown; if (typeof expected !== 'string' || expected.length > 4096) throw new Error(); assertions.push({ kind: 'output', expected, source: rawLine.trim() }); }
      catch { errors.push(`Line ${index + 1}: OUTPUT requires a JSON string no longer than 4,096 characters`); }
      return;
    }
    const cycleRange = /^CYCLES\s+IN\s+(\d+)\s*(?:\.\.|-|TO\s)\s*(\d+)$/i.exec(text);
    if (cycleRange) {
      const minimum = Number(cycleRange[1]); const maximum = Number(cycleRange[2]);
      if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || maximum > 10_000_000) errors.push(`Line ${index + 1}: CYCLES range bounds must be between 0 and 10,000,000`);
      else if (maximum < minimum) errors.push(`Line ${index + 1}: CYCLES range upper bound must not be below its lower bound`);
      else assertions.push({ kind: 'cycles', operator: 'range', expected: minimum, expectedMaximum: maximum, source: rawLine.trim() });
      return;
    }
    const cycles = /^CYCLES\s*(==|=|<=|>=)\s*(\d+)$/i.exec(text);
    if (cycles) {
      const expected = Number(cycles[2]);
      if (!Number.isSafeInteger(expected) || expected < 0 || expected > 10_000_000) errors.push(`Line ${index + 1}: CYCLES expectation must be between 0 and 10,000,000`);
      else assertions.push({ kind: 'cycles', operator: cycles[1] === '<=' ? 'lte' : cycles[1] === '>=' ? 'gte' : 'eq', expected, source: rawLine.trim() });
      return;
    }
    const audio = /^AUDIO\[\s*WRITES\s*\]\s*(?:==|=)\s*(?:FNV32:)?([0-9a-f]{8})$/i.exec(text);
    if (audio) {
      assertions.push({ kind: 'audio', expected: audio[1]!.toUpperCase(), source: rawLine.trim() });
      return;
    }
    const speaker = /^AUDIO\[\s*SPEAKER\s*\]\s*(?:==|=)\s*(\d+)$/i.exec(text);
    if (speaker) {
      const expected = Number(speaker[1]);
      if (!Number.isSafeInteger(expected) || expected < 0 || expected > 1_000_000) errors.push(`Line ${index + 1}: AUDIO[SPEAKER] transition count must be between 0 and 1,000,000`);
      else assertions.push({ kind: 'audio-speaker', expected, source: rawLine.trim() });
      return;
    }
    const screen = /^SCREEN\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]\s*(?:==|=)\s*(?:FNV32:)?([0-9a-f]{8})$/i.exec(text);
    if (screen) {
      const [x, y, width, height] = screen.slice(1, 5).map(Number) as [number, number, number, number];
      const regionError = validateScreenRegion({ x, y, width, height });
      if (regionError) errors.push(`Line ${index + 1}: ${regionError}`);
      else assertions.push({ kind: 'screen', x, y, width, height, expected: screen[5]!.toUpperCase(), source: rawLine.trim() });
      return;
    }
    const screenGolden = /^SCREEN_IMAGE\[\s*([A-Za-z0-9][A-Za-z0-9_-]{0,39})\s*,\s*(\d+)\s*,\s*(\d+)\s*\]\s+TOLERANCE\[\s*(\d+)\s*,\s*(\d+)\s*\]$/i.exec(text);
    if (screenGolden) {
      const golden = screenGoldens.find((item) => item.id.toLowerCase() === screenGolden[1]!.toLowerCase());
      const x = Number(screenGolden[2]); const y = Number(screenGolden[3]); const allowedChannelDelta = Number(screenGolden[4]); const allowedDifferingPixels = Number(screenGolden[5]);
      if (!golden) errors.push(`Line ${index + 1}: screen golden ${screenGolden[1]} is not attached to this test`);
      else {
        const regionError = validateScreenRegion({ x, y, width: golden.width, height: golden.height });
        if (regionError) errors.push(`Line ${index + 1}: ${regionError}`);
        else if (allowedChannelDelta < 0 || allowedChannelDelta > 255) errors.push(`Line ${index + 1}: screen channel tolerance must be between 0 and 255`);
        else if (allowedDifferingPixels < 0 || allowedDifferingPixels > golden.width * golden.height) errors.push(`Line ${index + 1}: allowed differing pixels must fit within the ${golden.width * golden.height}-pixel golden`);
        else assertions.push({ kind: 'screen-golden', goldenId: golden.id, x, y, width: golden.width, height: golden.height, expectedRgbaBase64: golden.rgbaBase64, allowedChannelDelta, allowedDifferingPixels, source: rawLine.trim() });
      }
      return;
    }
    const event = /^EVENT\[\s*(OSRDCH|OSASCI|OSNEWL|OSWRCR|OSWRCH|OSWORD|OSBYTE|OSCLI)\s*\]\s*(?:==|=)\s*(\d+)$/i.exec(text);
    if (event) {
      const expected = Number(event[2]);
      if (!Number.isSafeInteger(expected) || expected < 0 || expected > 65_535) errors.push(`Line ${index + 1}: EVENT count must be between 0 and 65,535`);
      else assertions.push({ kind: 'event', event: event[1]!.toLowerCase() as MosTestEvent, expected, source: rawLine.trim() });
      return;
    }
    const eventAddress = /^EVENT\[([^\]]+)\]\s*(?:==|=)\s*(\d+)$/i.exec(text);
    if (eventAddress) {
      const address = resolveTestValue(eventAddress[1]!, symbols);
      const expected = Number(eventAddress[2]);
      if (address === null || address < 0 || address > 0xffff) errors.push(`Line ${index + 1}: EVENT[${eventAddress[1]!.trim()}] must name a MOS call, a 16-bit address or a build symbol`);
      else if (!Number.isSafeInteger(expected) || expected < 0 || expected > 65_535) errors.push(`Line ${index + 1}: EVENT count must be between 0 and 65,535`);
      else assertions.push({ kind: 'event-address', address, expected, source: rawLine.trim() });
      return;
    }
    const memory = /^MEM\[([^\]]+)\]\s*(?:==|=)\s*(.+)$/i.exec(text);
    if (memory) {
      const address = resolveTestValue(memory[1]!, symbols);
      const tokens = memory[2]!.trim().split(/[\s,]+/).filter(Boolean);
      const expected = tokens.map(resolveByte);
      if (address === null || address < 0 || address > 0xffff) errors.push(`Line ${index + 1}: memory address is invalid`);
      else if (!tokens.length || expected.some((byte) => byte === null || byte < 0 || byte > 0xff)) errors.push(`Line ${index + 1}: memory expectation must contain byte values`);
      else if (address + expected.length > 0x10000) errors.push(`Line ${index + 1}: memory expectation crosses the 16-bit address boundary`);
      else {
        memoryBytes += expected.length;
        assertions.push({ kind: 'memory', address, expected: expected as number[], source: rawLine.trim() });
      }
      return;
    }
    errors.push(`Line ${index + 1}: use PROCESSOR, REGISTER, MEM[address], OUTPUT, AUDIO[WRITES], AUDIO[SPEAKER], SCREEN[x,y,width,height], SCREEN_IMAGE[id,x,y] TOLERANCE[channel,pixels], EVENT[MOS_CALL], EVENT[address], CYCLES or CYCLES IN low..high assertions`);
  });
  if (!assertions.length) errors.push('Add at least one register, memory, output, screen, event or cycle assertion');
  if (memoryBytes > 1024) errors.push('Memory assertions are limited to 1,024 bytes per test');
  if (processor === 'parasite') {
    /* Refused here rather than at the machine, so an author sees why while
     * writing the plan instead of after a run that could not have meant
     * anything. Registers, memory and cycles are what the parasite has. */
    for (const assertion of assertions) {
      const reason = HOST_ONLY_ASSERTIONS[assertion.kind];
      if (reason) errors.push(`${assertion.source}: ${reason}. A PROCESSOR = PARASITE plan can assert registers, memory and cycles.`);
    }
  }
  return { stopAddress: stopAddress !== null && stopAddress >= 0 && stopAddress <= 0xffff ? stopAddress : null, processor, assertions, errors };
}
