export type AnalysisKind = 'bbc-basic' | 'text' | 'machine-code';
export type Processor = '6502' | '65c02';
export type AnalysisProcessor = Processor | 'arm2' | 'arm3';

export interface BasicLine {
  lineNumber: number;
  source: string;
  offset: number;
  byteLength: number;
  label?: string;
  references?: string[];
}

export interface BasicListing {
  kind: 'bbc-basic';
  dialect: 'BBC BASIC II' | 'Atom BASIC';
  encoding: 'tokenized' | 'plain-text' | 'atom-text';
  lines: BasicLine[];
  programLength: number;
  trailingByteCount: number;
  warnings: string[];
}

export type DisassemblyRowKind = 'instruction' | 'bytes' | 'text';

export interface DisassemblyRow {
  address: number;
  offset: number;
  bytes: number[];
  kind: DisassemblyRowKind;
  mnemonic: string;
  operand: string;
  target?: number;
  label?: string;
  comment?: string;
  references: number[];
  reachable: boolean;
}

export interface Disassembly {
  kind: 'machine-code';
  processor: AnalysisProcessor;
  origin: number;
  entryPoint: number;
  rows: DisassemblyRow[];
  labels: Record<number, string>;
  codeByteCount: number;
  dataByteCount: number;
  warnings: string[];
}

export interface TextListing {
  kind: 'text';
  text: string;
  lineCount: number;
}

export type FileAnalysis = BasicListing | TextListing | Disassembly;

export type MetadataSource = 'sidecar' | 'container' | 'project-manifest' | 'filename' | 'manual-default';

export interface AcornFileMetadata {
  source: MetadataSource;
  catalogueName?: string;
  load?: number;
  execute?: number;
  declaredLength?: number;
  locked?: boolean;
  sidecarName?: string;
  containerFormat?: 'Atom ATM' | 'DFS SSD' | 'DFS DSD' | 'ADFS D' | 'ADFS E';
  containerByteLength?: number;
  filetype?: number;
  buildTargetId?: string;
  buildFingerprint?: string;
  addressSpace?: string;
  bank?: string;
  warnings: string[];
}

export interface LoadedFile {
  name: string;
  bytes: Uint8Array;
  analysis: FileAnalysis;
  metadata: AcornFileMetadata;
}
