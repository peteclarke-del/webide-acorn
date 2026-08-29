export interface LiveDisassemblyRequest { address: number; instructionCount: number; requestId: string }

export function validateLiveDisassemblyRequest(input: LiveDisassemblyRequest) {
  if (!Number.isInteger(input.address) || input.address < 0 || input.address > 0xffff) throw new Error('Disassembly start must be a 16-bit address');
  if (!Number.isInteger(input.instructionCount) || input.instructionCount < 1 || input.instructionCount > 256) throw new Error('Disassembly requires 1–256 instructions');
  if (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 128) throw new Error('Disassembly request ID must contain 1–128 characters');
  return input;
}

export function estimate6502Cycles(mnemonic: string, addressingMode: string) {
  const operation = mnemonic.toUpperCase();
  if (operation === 'BRK') return { minimum: 7, maximum: 7 };
  if (operation === 'JSR' || operation === 'RTS' || operation === 'RTI') return { minimum: 6, maximum: 6 };
  if (operation === 'JMP') return addressingMode.includes('indirect') ? { minimum: 5, maximum: 6 } : { minimum: 3, maximum: 3 };
  if (addressingMode.includes('branch')) return operation === 'BRA' ? { minimum: 3, maximum: 4 } : { minimum: 2, maximum: 4 };
  if (['PHA', 'PHP', 'PHX', 'PHY'].includes(operation)) return { minimum: 3, maximum: 3 };
  if (['PLA', 'PLP', 'PLX', 'PLY'].includes(operation)) return { minimum: 4, maximum: 4 };
  const readModifyWrite = ['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC', 'TSB', 'TRB'].includes(operation) && addressingMode !== 'Accumulator';
  if (readModifyWrite) {
    if (addressingMode.includes('Absolute')) return { minimum: 6, maximum: addressingMode.includes('indexed') || addressingMode.includes(', X') ? 7 : 6 };
    return { minimum: 5, maximum: addressingMode.includes(', X') ? 6 : 5 };
  }
  const store = ['STA', 'STX', 'STY', 'STZ'].includes(operation);
  if (addressingMode === 'Implied' || addressingMode === 'Accumulator') return { minimum: 2, maximum: 2 };
  if (addressingMode === 'Immediate') return { minimum: 2, maximum: 2 };
  if (addressingMode.includes('Zero page')) return { minimum: 3, maximum: addressingMode.includes(',') ? 4 : 3 };
  if (addressingMode.includes('Indexed indirect')) return { minimum: 6, maximum: 6 };
  if (addressingMode.includes('Indirect indexed')) return store ? { minimum: 6, maximum: 6 } : { minimum: 5, maximum: 6 };
  if (addressingMode.includes('Absolute')) return store ? { minimum: addressingMode.includes(',') ? 5 : 4, maximum: addressingMode.includes(',') ? 5 : 4 } : { minimum: 4, maximum: addressingMode.includes(',') ? 5 : 4 };
  return { minimum: 2, maximum: 8 };
}

export function formatCycleEstimate(estimate: { minimum: number; maximum: number }) {
  return estimate.minimum === estimate.maximum ? String(estimate.minimum) : `${estimate.minimum}–${estimate.maximum}`;
}
