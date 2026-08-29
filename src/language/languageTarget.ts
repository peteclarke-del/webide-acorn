import type { Processor } from '../analysis/types';

export interface LanguageTargetContext {
  processor: Processor;
  machineId: string;
  machineLabel: string;
  romId: string;
  romLabel: string;
  romReady: boolean;
  enabledCapabilities: string[];
  toolchainId?: string;
  buildDefines?: string[];
  includePaths?: string[];
  generatedSymbols?: Array<{ name: string; value: number }>;
}

export function languageTargetRevision(target: LanguageTargetContext) {
  return [target.processor, target.machineId, target.machineLabel, target.romId, target.romLabel, target.romReady ? 'ready' : 'missing', [...target.enabledCapabilities].sort().join(','), target.toolchainId ?? '', [...(target.buildDefines ?? [])].sort().join(','), [...(target.includePaths ?? [])].sort().join(','), [...(target.generatedSymbols ?? [])].sort((left, right) => left.name.localeCompare(right.name) || left.value - right.value).map((symbol) => `${symbol.name}=${symbol.value}`).join(',')].join('\0');
}

export function isBbcMosTarget(target?: LanguageTargetContext) {
  return !target || ['bbc-a', 'bbc-b', 'bbc-bplus', 'electron', 'master'].includes(target.machineId);
}

export function bbcBasicDialect(target?: LanguageTargetContext) {
  if (!target) return 'BBC BASIC (target not selected)';
  if (target.machineId === 'master') return 'BBC BASIC IV / Master profile';
  if (target.machineId === 'electron') return 'BBC BASIC II / Electron profile';
  if (target.machineId.startsWith('bbc-')) return target.romId.includes('basic1') ? 'BBC BASIC I' : 'BBC BASIC II';
  return `BBC BASIC unavailable on ${target.machineLabel}`;
}
