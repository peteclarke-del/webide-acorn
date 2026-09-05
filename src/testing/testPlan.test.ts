import { describe, expect, it } from 'vitest';
import { MOS_TEST_EVENT_ADDRESSES, parseTestPlan } from './testPlan';
import { bytesToBase64 } from './screenAssertion';

const symbols = { start: 0x1900, done: 0x1910, buffer: 0x2000 };

describe('hardware test plan parser', () => {
  it('resolves build symbols, registers and bounded memory byte assertions', () => {
    const result = parseTestPlan('.done', 'A = &41\nX == 5\nPC = done\nMEM[buffer] = A9 41 00', symbols);
    expect(result.errors).toEqual([]);
    expect(result.stopAddress).toBe(0x1910);
    expect(result.assertions).toEqual([
      { kind: 'register', register: 'a', expected: 0x41, source: 'A = &41' },
      { kind: 'register', register: 'x', expected: 5, source: 'X == 5' },
      { kind: 'register', register: 'pc', expected: 0x1910, source: 'PC = done' },
      { kind: 'memory', address: 0x2000, expected: [0xa9, 0x41, 0], source: 'MEM[buffer] = A9 41 00' },
    ]);
  });

  it('reports line-addressed invalid syntax and range errors', () => {
    const result = parseTestPlan('missing', 'A = &100\nMEM[&FFFF] = 01 02\nbanana', symbols);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Stop address'),
      expect.stringContaining('Line 1'),
      expect.stringContaining('Line 2'),
      expect.stringContaining('Line 3'),
    ]));
  });

  it('requires at least one assertion', () => {
    expect(parseTestPlan('&1900', '; comment only', symbols).errors).toContain('Add at least one register, memory, output, screen, event or cycle assertion');
  });

  it('parses bounded exact textual output assertions', () => {
    expect(parseTestPlan('done', 'OUTPUT = "HELLO\\r"', symbols)).toMatchObject({ errors: [], assertions: [{ kind: 'output', expected: 'HELLO\r', source: 'OUTPUT = "HELLO\\r"' }] });
    expect(parseTestPlan('done', `OUTPUT = "${'x'.repeat(4097)}"`, symbols).errors[0]).toContain('4,096');
  });

  it('parses exact and bounded cycle assertions', () => {
    expect(parseTestPlan('done', 'CYCLES <= 726\nCYCLES >= 700\nCYCLES = 726', symbols)).toMatchObject({ errors: [], assertions: [{ kind: 'cycles', operator: 'lte', expected: 726 }, { kind: 'cycles', operator: 'gte', expected: 700 }, { kind: 'cycles', operator: 'eq', expected: 726 }] });
    expect(parseTestPlan('done', 'CYCLES <= 10000001', symbols).errors[0]).toContain('10,000,000');
  });

  it('parses bounded exact framebuffer-region digests', () => {
    expect(parseTestPlan('done', 'SCREEN[0, 1, 16, 8] = FNV32:deadbeef', symbols)).toMatchObject({ errors: [], assertions: [{ kind: 'screen', x: 0, y: 1, width: 16, height: 8, expected: 'DEADBEEF' }] });
    expect(parseTestPlan('done', 'SCREEN[1020,0,8,1] = 12345678', symbols).errors[0]).toContain('1024 by 625');
  });

  it('binds tolerant screen assertions to portable RGBA goldens', () => {
    const golden = { id: 'title', name: 'Title', width: 2, height: 1, rgbaBase64: bytesToBase64(new Uint8Array(8)) };
    expect(parseTestPlan('done', 'SCREEN_IMAGE[title,10,20] TOLERANCE[4,1]', symbols, [golden])).toMatchObject({ errors: [], assertions: [{ kind: 'screen-golden', goldenId: 'title', x: 10, y: 20, width: 2, height: 1, allowedChannelDelta: 4, allowedDifferingPixels: 1 }] });
    expect(parseTestPlan('done', 'SCREEN_IMAGE[missing,0,0] TOLERANCE[0,0]', symbols, [golden]).errors[0]).toContain('not attached');
  });

  it('parses bounded authoritative event counts', () => {
    expect(parseTestPlan('done', 'EVENT[OSWRCH] = 2\nEVENT[osbyte] = 1\nEVENT[OSCLI] = 0', symbols)).toMatchObject({ errors: [], assertions: [{ kind: 'event', event: 'oswrch', expected: 2 }, { kind: 'event', event: 'osbyte', expected: 1 }, { kind: 'event', event: 'oscli', expected: 0 }] });
    expect(parseTestPlan('done', 'EVENT[OSWRCH] = 65536', symbols).errors[0]).toContain('65,535');
    expect(parseTestPlan('done', 'EVENT[UNKNOWN] = 1', symbols).errors[0]).toContain('must name a MOS call, a 16-bit address or a build symbol');
    expect(MOS_TEST_EVENT_ADDRESSES).toEqual({ osrdch: 0xffe0, osasci: 0xffe3, osnewl: 0xffe7, oswrcr: 0xffea, oswrch: 0xffee, osword: 0xfff1, osbyte: 0xfff4, oscli: 0xfff7 });
  });

  it('parses an exact sound-command digest', () => {
    expect(parseTestPlan('done', 'AUDIO[WRITES] = FNV32:deadbeef', symbols)).toMatchObject({ errors: [], assertions: [{ kind: 'audio', expected: 'DEADBEEF' }] });
    expect(parseTestPlan('done', 'AUDIO[WRITES] = short', symbols).errors[0]).toContain('AUDIO[WRITES]');
  });
});

describe('assertions for protocols and machines beyond the BBC MOS', () => {
  const parse = (source: string, symbols: Record<string, number> = {}) => parseTestPlan('&1900', source, symbols);

  it('accepts a cycle range and keeps both bounds', () => {
    const plan = parse('CYCLES IN 100..250');
    expect(plan.errors).toEqual([]);
    expect(plan.assertions[0]).toEqual({ kind: 'cycles', operator: 'range', expected: 100, expectedMaximum: 250, source: 'CYCLES IN 100..250' });
  });

  it('accepts the other range spellings a person would reach for', () => {
    expect(parse('CYCLES IN 10-20').assertions[0]).toMatchObject({ operator: 'range', expected: 10, expectedMaximum: 20 });
    expect(parse('CYCLES IN 10 TO 20').assertions[0]).toMatchObject({ operator: 'range', expected: 10, expectedMaximum: 20 });
  });

  it('refuses a range whose bounds are the wrong way round or out of range', () => {
    expect(parse('CYCLES IN 250..100').errors[0]).toMatch(/upper bound must not be below/);
    expect(parse('CYCLES IN 0..10000001').errors[0]).toMatch(/between 0 and 10,000,000/);
  });

  it('counts entries at an address the author names, so a non-MOS protocol can be asserted', () => {
    const plan = parse('EVENT[&2000] = 3');
    expect(plan.errors).toEqual([]);
    expect(plan.assertions[0]).toEqual({ kind: 'event-address', address: 0x2000, expected: 3, source: 'EVENT[&2000] = 3' });
  });

  it('resolves an event address from a build symbol', () => {
    const plan = parse('EVENT[dispatch] = 1', { dispatch: 0x1930 });
    expect(plan.assertions[0]).toMatchObject({ kind: 'event-address', address: 0x1930, expected: 1 });
  });

  it('still prefers the named MOS entries over the address form', () => {
    const plan = parse('EVENT[OSWRCH] = 2');
    expect(plan.assertions[0]).toEqual({ kind: 'event', event: 'oswrch', expected: 2, source: 'EVENT[OSWRCH] = 2' });
  });

  it('refuses an event target that is neither a MOS call, an address nor a symbol', () => {
    expect(parse('EVENT[nowhere] = 1').errors[0]).toMatch(/must name a MOS call, a 16-bit address or a build symbol/);
  });

  it('accepts a one-bit speaker transition count for machines that have one', () => {
    const plan = parse('AUDIO[SPEAKER] = 128');
    expect(plan.errors).toEqual([]);
    expect(plan.assertions[0]).toEqual({ kind: 'audio-speaker', expected: 128, source: 'AUDIO[SPEAKER] = 128' });
  });

  it('bounds the speaker transition count', () => {
    expect(parse('AUDIO[SPEAKER] = 1000001').errors[0]).toMatch(/between 0 and 1,000,000/);
  });

  it('names every accepted form when a line is not one of them', () => {
    expect(parse('NONSENSE = 1').errors[0]).toMatch(/AUDIO\[SPEAKER\].*EVENT\[address\].*CYCLES IN low\.\.high/);
  });
});

describe('which processor a plan is about', () => {
  it('is the host unless the plan says otherwise', () => {
    /* Every plan written before there was a second processor means the host,
     * and has to keep meaning it. */
    expect(parseTestPlan('&2000', 'A = 1', {}).processor).toBe('host');
  });

  it('takes the processor from a declaration, in either spelling', () => {
    expect(parseTestPlan('&2000', 'PROCESSOR = PARASITE\nA = 1', {})).toMatchObject({ processor: 'parasite', errors: [] });
    expect(parseTestPlan('&2000', 'PROCESSOR PARASITE\nA = 1', {}).processor).toBe('parasite');
    expect(parseTestPlan('&2000', 'processor = host\nA = 1', {}).processor).toBe('host');
  });

  it('refuses a second declaration rather than letting one silently win', () => {
    const plan = parseTestPlan('&2000', 'PROCESSOR = PARASITE\nA = 1\nPROCESSOR = HOST', {});
    expect(plan.errors).toEqual(['Line 3: PROCESSOR is already declared on line 1']);
    expect(plan.processor).toBe('parasite');
  });

  it('refuses assertions about host hardware in a parasite plan, saying why', () => {
    /* These would each answer confidently about the wrong machine: a parasite
     * program executes none of the host MOS and has none of its hardware. */
    const plan = parseTestPlan('&2000', [
      'PROCESSOR = PARASITE',
      'A = 1',
      'OUTPUT = "hello"',
      'EVENT[OSWRCH] = 5',
      'SCREEN[0,0,8,8] = FNV32:11223344',
      'AUDIO[WRITES] = 11223344',
    ].join('\n'), {});
    expect(plan.errors).toEqual([
      expect.stringContaining('OUTPUT captures the host MOS OSWRCH entry'),
      expect.stringContaining('EVENT[MOS_CALL] counts entries to the host MOS'),
      expect.stringContaining('SCREEN reads the host video hardware'),
      expect.stringContaining('AUDIO[WRITES] counts writes to the host sound chip'),
    ]);
    expect(plan.errors.every((error) => error.includes('can assert registers, memory and cycles'))).toBe(true);
  });

  it('accepts what the parasite actually has', () => {
    const plan = parseTestPlan('.done', 'PROCESSOR = PARASITE\nA = &42\nMEM[&2100] = 01 02\nCYCLES <= 100000', { done: 0x2000 });
    expect(plan.errors).toEqual([]);
    expect(plan.stopAddress).toBe(0x2000);
    expect(plan.assertions.map((assertion) => assertion.kind)).toEqual(['register', 'memory', 'cycles']);
  });

  it('leaves the same assertions alone on a host plan', () => {
    const plan = parseTestPlan('&2000', 'OUTPUT = "hello"\nEVENT[OSWRCH] = 5', {});
    expect(plan.errors).toEqual([]);
    expect(plan.processor).toBe('host');
  });
});
