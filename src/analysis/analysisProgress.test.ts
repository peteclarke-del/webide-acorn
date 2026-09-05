// @vitest-environment node

/* Progress that is measured rather than estimated.
 *
 * The failure this guards against is not a bar that is slightly wrong. It is a
 * bar that moves when nothing is happening and stops when something is, which
 * makes the one question a person watching it has — is this going to finish —
 * unanswerable, and is what an invented percentage always does.
 */
import { describe, expect, it, vi } from 'vitest';
import { describeProgress, PROGRESS_INTERVAL_BYTES, throttleProgress, type AnalysisProgress } from './analysisProgress';
import { disassemble6502 } from './disassembler6502';
import { disassembleArm } from './disassemblerArm';

describe('throttling', () => {
  it('reports at its interval rather than on every step', () => {
    const seen: AnalysisProgress[] = [];
    const report = throttleProgress((progress) => seen.push(progress), 100);
    for (let done = 0; done < 500; done += 1) report({ stage: 'decoding', bytesDone: done, bytesTotal: 1000 });
    expect(seen.map((progress) => progress.bytesDone)).toEqual([0, 100, 200, 300, 400]);
  });

  it('always reports the end of a stage, so nothing appears to stall short of it', () => {
    const seen: AnalysisProgress[] = [];
    const report = throttleProgress((progress) => seen.push(progress), 1000);
    report({ stage: 'decoding', bytesDone: 0, bytesTotal: 400 });
    report({ stage: 'decoding', bytesDone: 399, bytesTotal: 400 });
    report({ stage: 'decoding', bytesDone: 400, bytesTotal: 400 });
    expect(seen.map((progress) => progress.bytesDone)).toEqual([0, 400]);
  });

  it('reports the first step of a new stage however recently it reported', () => {
    /* Which stage it is in matters more than how far through: a file can spend
     * all its time in one and none in the next. */
    const seen: AnalysisProgress[] = [];
    const report = throttleProgress((progress) => seen.push(progress), 1000);
    report({ stage: 'decoding', bytesDone: 0, bytesTotal: 400 });
    report({ stage: 'listing', bytesDone: 1, bytesTotal: 400 });
    expect(seen.map((progress) => progress.stage)).toEqual(['decoding', 'listing']);
  });

  it('costs nothing when nobody is listening', () => {
    const report = throttleProgress(undefined);
    expect(() => report({ stage: 'decoding', bytesDone: 0, bytesTotal: 1 })).not.toThrow();
  });

  it('names the stage and counts real bytes rather than only a percentage', () => {
    expect(describeProgress({ stage: 'decoding', bytesDone: 2048, bytesTotal: 8192 }))
      .toBe('Following reachable code · 2,048 of 8,192 bytes (25%)');
    /* A file of no bytes is finished, not divided by zero. */
    expect(describeProgress({ stage: 'listing', bytesDone: 0, bytesTotal: 0 })).toContain('(0%)');
  });
});

describe('what the readers report', () => {
  /* An image of one instruction repeated, so the reachability walk has real
   * work to do and the byte counts are predictable. */
  const sixteenKilobytes = Uint8Array.from({ length: 16 * 1024 }, (_byte, index) => (index % 2 === 0 ? 0xea : 0xea));

  it('reports every stage of a 6502 read, in order, ending at the whole file', () => {
    const seen: AnalysisProgress[] = [];
    disassemble6502(sixteenKilobytes, 0x1900, 0x1900, '6502', undefined, (progress) => seen.push(progress));

    expect(seen.length).toBeGreaterThan(3);
    /* Each stage appears, and none appears again after the next has started. */
    const order = seen.map((progress) => progress.stage).filter((stage, index, all) => stage !== all[index - 1]);
    expect(order).toEqual(['decoding', 'listing', 'labelling']);
    for (const stage of ['decoding', 'listing', 'labelling'] as const) {
      const last = [...seen].reverse().find((progress) => progress.stage === stage)!;
      expect(last.bytesDone, stage).toBe(last.bytesTotal);
    }
  });

  it('never reports more bytes than the file has, or a count that goes backwards', () => {
    /* A count that exceeded the total, or went down, would be an estimate
     * wearing a byte count's clothes. */
    const seen: AnalysisProgress[] = [];
    disassemble6502(sixteenKilobytes, 0x1900, 0x1900, '6502', undefined, (progress) => seen.push(progress));
    let previousStage = seen[0]!.stage;
    let previous = -1;
    for (const progress of seen) {
      expect(progress.bytesDone).toBeLessThanOrEqual(progress.bytesTotal);
      expect(progress.bytesTotal).toBe(sixteenKilobytes.length);
      if (progress.stage !== previousStage) { previousStage = progress.stage; previous = -1; }
      expect(progress.bytesDone).toBeGreaterThanOrEqual(previous);
      previous = progress.bytesDone;
    }
  });

  it('reports the same way for ARM', () => {
    const words = new Uint8Array(16 * 1024);
    /* MOV R0, #0 repeated: decodable, and it does not stop the walk. */
    for (let offset = 0; offset < words.length; offset += 4) {
      words[offset] = 0x00; words[offset + 1] = 0x00; words[offset + 2] = 0xa0; words[offset + 3] = 0xe3;
    }
    const seen: AnalysisProgress[] = [];
    disassembleArm(words, 0x8000, 0x8000, 'arm2', (progress) => seen.push(progress));
    const order = seen.map((progress) => progress.stage).filter((stage, index, all) => stage !== all[index - 1]);
    expect(order).toEqual(['decoding', 'labelling', 'listing']);
    expect(seen.at(-1)).toEqual({ stage: 'listing', bytesDone: words.length, bytesTotal: words.length });
  });

  it('reports nothing at all when no reporter is given, and still reads the file', () => {
    /* The reporter is optional and every existing caller omits it, so the
     * absence has to cost nothing and change nothing. */
    const report = vi.fn();
    const withReporter = disassemble6502(sixteenKilobytes, 0x1900, 0x1900, '6502', undefined, report);
    const without = disassemble6502(sixteenKilobytes, 0x1900, 0x1900, '6502');
    expect(report).toHaveBeenCalled();
    expect(without.rows.length).toBe(withReporter.rows.length);
    expect(without.codeByteCount).toBe(withReporter.codeByteCount);
  });

  it('reports often enough to be watched and rarely enough to be free', () => {
    /* One report per instruction would cost more than the decoding, across a
     * worker boundary; one report per file would be no better than none. */
    const seen: AnalysisProgress[] = [];
    disassemble6502(sixteenKilobytes, 0x1900, 0x1900, '6502', undefined, (progress) => seen.push(progress));
    const decoding = seen.filter((progress) => progress.stage === 'decoding');
    expect(decoding.length).toBeGreaterThan(1);
    expect(decoding.length).toBeLessThanOrEqual(Math.ceil(sixteenKilobytes.length / PROGRESS_INTERVAL_BYTES) + 2);
  });
});
