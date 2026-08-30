import { describe, expect, it } from 'vitest';
import { armDirectiveItems, armInstructionItems } from './instructionReferenceArm';

describe('ARM2 language reference', () => {
  it('documents the core ARM2 instruction surface with signatures and compatibility', () => {
    expect(armInstructionItems.find((item) => item.token === 'LDR')).toMatchObject({ signature: expect.stringMatching(/LDR/), documentation: { parameters: expect.any(Array), compatibility: { supported: true, appliesTo: expect.arrayContaining(['ARM2']) } } });
    expect(armInstructionItems.find((item) => item.token === 'BL')?.detail).toMatch(/link/i);
    expect(new Set(armInstructionItems.map((item) => item.token)).size).toBe(armInstructionItems.length);
  });

  it('makes the sandboxed include and ARM2 CPU directives explicit', () => {
    expect(armDirectiveItems.find((item) => item.token === '.INCLUDE')?.documentation?.compatibility?.warning).toMatch(/traversal.*incbin/i);
    expect(armDirectiveItems.find((item) => item.token === '.CPU')?.signature).toBe('.cpu arm2');
  });
});
