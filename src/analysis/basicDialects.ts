/*
 * The keyword tables of each 6502-family BBC BASIC, and what is not here.
 *
 * These are read out of language ROMs by `scripts/extractBasicTokens.mjs`
 * rather than transcribed. A hand-copied table of a hundred and twenty entries
 * has a typo in it, and nothing would find that typo until somebody's program
 * decoded wrongly in one place.
 *
 * What makes the reading trustworthy is that the same reader reproduces the
 * BASIC II table this repository already carried, transcribed independently and
 * by hand, and a contract checks that it still does. All four tables also end
 * at the same keyword, `HIMEM`, which is corroboration that the rule for where
 * a table stops belongs to the table and not to the reader.
 *
 * BASIC V is here now, and what took so long was not the table. Its table has
 * the same shape as these — keyword, token, flag — and the same reader takes all
 * 161 entries of it. What was missing is that an ARM BASIC writes some keywords
 * as two bytes, so twenty-three token bytes in that table are shared by two or
 * three entries each, and reading the flag bits was not enough to settle which
 * prefix each takes: the obvious reading put `APPEND` and `SUM` in the same
 * group under the same token.
 *
 * So it was measured. Every distinct flag value was typed into a real RISC OS
 * 3.11 machine, running on this build's own A310 core, and the tokenised
 * program was read back out of its memory. Sixty-seven keywords across all
 * seventeen flag values, plus both sides of every pseudo-variable and both
 * forms of `ELSE`. `scripts/extractBasicTokens.mjs` carries the rule that
 * measurement established.
 *
 * The BASIC V table has since been read out of two more ROMs, from a different
 * machine and two later operating systems: the Risc PC's RISC OS 4.02 and 4.39.
 * Both give 161 entries ending at `WIDTH`, and both agree with the table above
 * on 160 of them. The differences are the two this file already explains — one
 * ROM lists `COLOR` where another lists `COLOUR` at the same &FB, and the six
 * pseudo-variable and second-`ELSE` forms are not in a ROM's linear keyword
 * table because they were measured on a running machine. Three ROMs across
 * three operating systems is better corroboration than any published table.
 *
 * BASIC VI is here, and the note that used to stand in its place was wrong. It
 * said BASIC64 "was supplied on disc rather than burnt into the ROM", which is
 * not something a search can establish: what had actually been searched was the
 * images then held, RISC OS 2.00 to 4.39, and BASIC64 genuinely is absent from
 * all of those. Worse, most Acorn ARM ROM images are stored interleaved, so a
 * plain string search over them reads scrambled bytes — `BASIC` itself does not
 * appear in the A310 or A5000 images until they are de-interleaved four ways.
 *
 * With a complete RISC OS ROM set, `BASIC64` appears in seven images, all of
 * them RISC OS 6, carrying a module header that reads BASIC64 / BASIC VI /
 * 1.37. Each of those images holds *two* keyword tables, one in the `BASIC`
 * module and one in `BASIC64`, which is what makes the identity everybody
 * asserts checkable rather than assumable: the two can be compared inside a
 * single image. They are identical in all seven, and against the table above
 * every keyword and every token agrees, with one flag byte that does not —
 * `STRING$(` is &80 here and &82 there, at the same token, and nothing derived
 * from the flag changes. So BASIC VI shares this table rather than copying it.
 *
 * Two spellings can share one token: `COLOUR` and `COLOR` are both &FB, and
 * which one a ROM lists first is which one that machine would list back. Both
 * are kept — the token map holds the spelling the ROM lists first, and the
 * order holds every spelling, because an abbreviation resolves against the
 * order and not against the map.
 *
 * No ROM is in this repository and none is needed to build: these are the
 * tables, and the digests say which firmware each came from.
 */

export type BasicDialectId = 'bbc-basic-1' | 'bbc-basic-2' | 'bbc-basic-3' | 'bbc-basic-4' | 'bbc-basic-5-riscos2' | 'bbc-basic-5' | 'bbc-basic-6' | 'atom-basic';

export interface BasicDialect {
  id: BasicDialectId;
  label: string;
  /** Token to the keyword the ROM lists first for it. */
  tokens: Record<number, string>;
  /*
   * Keywords the ROM writes as two bytes, by the prefix that introduces them.
   *
   * Only an ARM BASIC has these. A 6502 BASIC has one byte per keyword, so this
   * is absent there rather than empty: a dialect that has no two-byte tokens and
   * a dialect whose two-byte tokens nobody has established are different things,
   * and only the first should read as settled.
   */
  extended?: Record<number, Record<number, string>>;
  /*
   * Tokens that appear only where a statement begins, and are in no table.
   *
   * A keyword can have two tokens: one for where it is read and one for where it
   * is written to or where it opens a statement. The table carries the first;
   * these are the second, and a reader without them prints nothing sensible for
   * a program that assigns to `HIMEM` or uses a multi-line `ELSE`.
   */
  statementForms?: Record<number, string>;
  /** Every keyword, in the ROM's own order, which is how an abbreviation resolves. */
  order: string[];
  /** Spellings that share a token with an earlier one, and what they share it with. */
  aliases: Array<{ keyword: string; sameAs: string; token: number }>;
  provenance: { source: string; sha256: string; detail: string };
}


const BBC_BASIC_1_TOKENS: Record<number, string> = {
  0x80: "AND",
  0x81: "DIV",
  0x82: "EOR",
  0x83: "MOD",
  0x84: "OR",
  0x85: "ERROR",
  0x86: "LINE",
  0x87: "OFF",
  0x88: "STEP",
  0x89: "SPC",
  0x8a: "TAB(",
  0x8b: "ELSE",
  0x8c: "THEN",
  0x8f: "PTR",
  0x90: "PAGE",
  0x91: "TIME",
  0x92: "LOMEM",
  0x93: "HIMEM",
  0x94: "ABS",
  0x95: "ACS",
  0x96: "ADVAL",
  0x97: "ASC",
  0x98: "ASN",
  0x99: "ATN",
  0x9a: "BGET",
  0x9b: "COS",
  0x9c: "COUNT",
  0x9d: "DEG",
  0x9e: "ERL",
  0x9f: "ERR",
  0xa0: "EVAL",
  0xa1: "EXP",
  0xa2: "EXT",
  0xa3: "FALSE",
  0xa4: "FN",
  0xa5: "GET",
  0xa6: "INKEY",
  0xa7: "INSTR(",
  0xa8: "INT",
  0xa9: "LEN",
  0xaa: "LN",
  0xab: "LOG",
  0xac: "NOT",
  0xad: "OPENIN",
  0xae: "OPENOUT",
  0xaf: "PI",
  0xb0: "POINT(",
  0xb1: "POS",
  0xb2: "RAD",
  0xb3: "RND",
  0xb4: "SGN",
  0xb5: "SIN",
  0xb6: "SQR",
  0xb7: "TAN",
  0xb8: "TO",
  0xb9: "TRUE",
  0xba: "USR",
  0xbb: "VAL",
  0xbc: "VPOS",
  0xbd: "CHR$",
  0xbe: "GET$",
  0xbf: "INKEY$",
  0xc0: "LEFT$(",
  0xc1: "MID$(",
  0xc2: "RIGHT$(",
  0xc3: "STR$",
  0xc4: "STRING$(",
  0xc5: "EOF",
  0xc6: "AUTO",
  0xc7: "DELETE",
  0xc8: "LOAD",
  0xc9: "LIST",
  0xca: "NEW",
  0xcb: "OLD",
  0xcc: "RENUMBER",
  0xcd: "SAVE",
  0xcf: "PTR",
  0xd0: "PAGE",
  0xd1: "TIME",
  0xd2: "LOMEM",
  0xd3: "HIMEM",
  0xd4: "SOUND",
  0xd5: "BPUT",
  0xd6: "CALL",
  0xd7: "CHAIN",
  0xd8: "CLEAR",
  0xd9: "CLOSE",
  0xda: "CLG",
  0xdb: "CLS",
  0xdc: "DATA",
  0xdd: "DEF",
  0xde: "DIM",
  0xdf: "DRAW",
  0xe0: "END",
  0xe1: "ENDPROC",
  0xe2: "ENVELOPE",
  0xe3: "FOR",
  0xe4: "GOSUB",
  0xe5: "GOTO",
  0xe6: "GCOL",
  0xe7: "IF",
  0xe8: "INPUT",
  0xe9: "LET",
  0xea: "LOCAL",
  0xeb: "MODE",
  0xec: "MOVE",
  0xed: "NEXT",
  0xee: "ON",
  0xef: "VDU",
  0xf0: "PLOT",
  0xf1: "PRINT",
  0xf2: "PROC",
  0xf3: "READ",
  0xf4: "REM",
  0xf5: "REPEAT",
  0xf6: "REPORT",
  0xf7: "RESTORE",
  0xf8: "RETURN",
  0xf9: "RUN",
  0xfa: "STOP",
  0xfb: "COLOUR",
  0xfc: "TRACE",
  0xfd: "UNTIL",
  0xfe: "WIDTH",
};

const BBC_BASIC_1_ORDER: string[] = ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN", "AUTO", "BGET", "BPUT", "COLOUR", "CALL", "CHAIN", "CHR$", "CLEAR", "CLOSE", "CLG", "CLS", "COS", "COUNT", "DATA", "DEG", "DEF", "DELETE", "DIV", "DIM", "DRAW", "ENDPROC", "END", "ENVELOPE", "ELSE", "EVAL", "ERL", "ERROR", "EOF", "EOR", "ERR", "EXP", "EXT", "FOR", "FALSE", "FN", "GOTO", "GET$", "GET", "GOSUB", "GCOL", "HIMEM", "INPUT", "IF", "INKEY$", "INKEY", "INT", "INSTR(", "LIST", "LINE", "LOAD", "LOMEM", "LOCAL", "LEFT$(", "LEN", "LET", "LOG", "LN", "MID$(", "MODE", "MOD", "MOVE", "NEXT", "NEW", "NOT", "OLD", "ON", "OFF", "OR", "OPENIN", "OPENOUT", "PRINT", "PAGE", "PTR", "PI", "PLOT", "POINT(", "PROC", "POS", "RETURN", "REPEAT", "REPORT", "READ", "REM", "RUN", "RAD", "RESTORE", "RIGHT$(", "RND", "RENUMBER", "STEP", "SAVE", "SGN", "SIN", "SQR", "SPC", "STR$", "STRING$(", "SOUND", "STOP", "TAN", "THEN", "TO", "TAB(", "TRACE", "TIME", "TRUE", "UNTIL", "USR", "VDU", "VAL", "VPOS", "WIDTH", "PAGE", "PTR", "TIME", "LOMEM", "HIMEM"];

export const BBC_BASIC_1: BasicDialect = {
  id: "bbc-basic-1",
  label: "BBC BASIC I",
  tokens: BBC_BASIC_1_TOKENS,
  order: BBC_BASIC_1_ORDER,
  aliases: [],
  provenance: { source: "basic1.rom", sha256: "6dccf62d34a90fc16f102f9dbb3431bbf084e4edcbc21a5f059bbdf6af35b566", detail: "The original BBC Micro language ROM." },
};


const BBC_BASIC_2_TOKENS: Record<number, string> = {
  0x80: "AND",
  0x81: "DIV",
  0x82: "EOR",
  0x83: "MOD",
  0x84: "OR",
  0x85: "ERROR",
  0x86: "LINE",
  0x87: "OFF",
  0x88: "STEP",
  0x89: "SPC",
  0x8a: "TAB(",
  0x8b: "ELSE",
  0x8c: "THEN",
  0x8e: "OPENIN",
  0x8f: "PTR",
  0x90: "PAGE",
  0x91: "TIME",
  0x92: "LOMEM",
  0x93: "HIMEM",
  0x94: "ABS",
  0x95: "ACS",
  0x96: "ADVAL",
  0x97: "ASC",
  0x98: "ASN",
  0x99: "ATN",
  0x9a: "BGET",
  0x9b: "COS",
  0x9c: "COUNT",
  0x9d: "DEG",
  0x9e: "ERL",
  0x9f: "ERR",
  0xa0: "EVAL",
  0xa1: "EXP",
  0xa2: "EXT",
  0xa3: "FALSE",
  0xa4: "FN",
  0xa5: "GET",
  0xa6: "INKEY",
  0xa7: "INSTR(",
  0xa8: "INT",
  0xa9: "LEN",
  0xaa: "LN",
  0xab: "LOG",
  0xac: "NOT",
  0xad: "OPENUP",
  0xae: "OPENOUT",
  0xaf: "PI",
  0xb0: "POINT(",
  0xb1: "POS",
  0xb2: "RAD",
  0xb3: "RND",
  0xb4: "SGN",
  0xb5: "SIN",
  0xb6: "SQR",
  0xb7: "TAN",
  0xb8: "TO",
  0xb9: "TRUE",
  0xba: "USR",
  0xbb: "VAL",
  0xbc: "VPOS",
  0xbd: "CHR$",
  0xbe: "GET$",
  0xbf: "INKEY$",
  0xc0: "LEFT$(",
  0xc1: "MID$(",
  0xc2: "RIGHT$(",
  0xc3: "STR$",
  0xc4: "STRING$(",
  0xc5: "EOF",
  0xc6: "AUTO",
  0xc7: "DELETE",
  0xc8: "LOAD",
  0xc9: "LIST",
  0xca: "NEW",
  0xcb: "OLD",
  0xcc: "RENUMBER",
  0xcd: "SAVE",
  0xcf: "PTR",
  0xd0: "PAGE",
  0xd1: "TIME",
  0xd2: "LOMEM",
  0xd3: "HIMEM",
  0xd4: "SOUND",
  0xd5: "BPUT",
  0xd6: "CALL",
  0xd7: "CHAIN",
  0xd8: "CLEAR",
  0xd9: "CLOSE",
  0xda: "CLG",
  0xdb: "CLS",
  0xdc: "DATA",
  0xdd: "DEF",
  0xde: "DIM",
  0xdf: "DRAW",
  0xe0: "END",
  0xe1: "ENDPROC",
  0xe2: "ENVELOPE",
  0xe3: "FOR",
  0xe4: "GOSUB",
  0xe5: "GOTO",
  0xe6: "GCOL",
  0xe7: "IF",
  0xe8: "INPUT",
  0xe9: "LET",
  0xea: "LOCAL",
  0xeb: "MODE",
  0xec: "MOVE",
  0xed: "NEXT",
  0xee: "ON",
  0xef: "VDU",
  0xf0: "PLOT",
  0xf1: "PRINT",
  0xf2: "PROC",
  0xf3: "READ",
  0xf4: "REM",
  0xf5: "REPEAT",
  0xf6: "REPORT",
  0xf7: "RESTORE",
  0xf8: "RETURN",
  0xf9: "RUN",
  0xfa: "STOP",
  0xfb: "COLOUR",
  0xfc: "TRACE",
  0xfd: "UNTIL",
  0xfe: "WIDTH",
  0xff: "OSCLI",
};

const BBC_BASIC_2_ORDER: string[] = ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN", "AUTO", "BGET", "BPUT", "COLOUR", "CALL", "CHAIN", "CHR$", "CLEAR", "CLOSE", "CLG", "CLS", "COS", "COUNT", "DATA", "DEG", "DEF", "DELETE", "DIV", "DIM", "DRAW", "ENDPROC", "END", "ENVELOPE", "ELSE", "EVAL", "ERL", "ERROR", "EOF", "EOR", "ERR", "EXP", "EXT", "FOR", "FALSE", "FN", "GOTO", "GET$", "GET", "GOSUB", "GCOL", "HIMEM", "INPUT", "IF", "INKEY$", "INKEY", "INT", "INSTR(", "LIST", "LINE", "LOAD", "LOMEM", "LOCAL", "LEFT$(", "LEN", "LET", "LOG", "LN", "MID$(", "MODE", "MOD", "MOVE", "NEXT", "NEW", "NOT", "OLD", "ON", "OFF", "OR", "OPENIN", "OPENOUT", "OPENUP", "OSCLI", "PRINT", "PAGE", "PTR", "PI", "PLOT", "POINT(", "PROC", "POS", "RETURN", "REPEAT", "REPORT", "READ", "REM", "RUN", "RAD", "RESTORE", "RIGHT$(", "RND", "RENUMBER", "STEP", "SAVE", "SGN", "SIN", "SQR", "SPC", "STR$", "STRING$(", "SOUND", "STOP", "TAN", "THEN", "TO", "TAB(", "TRACE", "TIME", "TRUE", "UNTIL", "USR", "VDU", "VAL", "VPOS", "WIDTH", "PAGE", "PTR", "TIME", "LOMEM", "HIMEM"];

export const BBC_BASIC_2: BasicDialect = {
  id: "bbc-basic-2",
  label: "BBC BASIC II",
  tokens: BBC_BASIC_2_TOKENS,
  order: BBC_BASIC_2_ORDER,
  aliases: [],
  provenance: { source: "basic2.rom", sha256: "45bd55dc0f6f0f8f1fe9e2481de7def206565eec8f600ba3068b849ca4132079", detail: "The BBC Micro language ROM this build already carried a hand transcription of." },
};


const BBC_BASIC_3_TOKENS: Record<number, string> = {
  0x80: "AND",
  0x81: "DIV",
  0x82: "EOR",
  0x83: "MOD",
  0x84: "OR",
  0x85: "ERROR",
  0x86: "LINE",
  0x87: "OFF",
  0x88: "STEP",
  0x89: "SPC",
  0x8a: "TAB(",
  0x8b: "ELSE",
  0x8c: "THEN",
  0x8e: "OPENIN",
  0x8f: "PTR",
  0x90: "PAGE",
  0x91: "TIME",
  0x92: "LOMEM",
  0x93: "HIMEM",
  0x94: "ABS",
  0x95: "ACS",
  0x96: "ADVAL",
  0x97: "ASC",
  0x98: "ASN",
  0x99: "ATN",
  0x9a: "BGET",
  0x9b: "COS",
  0x9c: "COUNT",
  0x9d: "DEG",
  0x9e: "ERL",
  0x9f: "ERR",
  0xa0: "EVAL",
  0xa1: "EXP",
  0xa2: "EXT",
  0xa3: "FALSE",
  0xa4: "FN",
  0xa5: "GET",
  0xa6: "INKEY",
  0xa7: "INSTR(",
  0xa8: "INT",
  0xa9: "LEN",
  0xaa: "LN",
  0xab: "LOG",
  0xac: "NOT",
  0xad: "OPENUP",
  0xae: "OPENOUT",
  0xaf: "PI",
  0xb0: "POINT(",
  0xb1: "POS",
  0xb2: "RAD",
  0xb3: "RND",
  0xb4: "SGN",
  0xb5: "SIN",
  0xb6: "SQR",
  0xb7: "TAN",
  0xb8: "TO",
  0xb9: "TRUE",
  0xba: "USR",
  0xbb: "VAL",
  0xbc: "VPOS",
  0xbd: "CHR$",
  0xbe: "GET$",
  0xbf: "INKEY$",
  0xc0: "LEFT$(",
  0xc1: "MID$(",
  0xc2: "RIGHT$(",
  0xc3: "STR$",
  0xc4: "STRING$(",
  0xc5: "EOF",
  0xc6: "AUTO",
  0xc7: "DELETE",
  0xc8: "LOAD",
  0xc9: "LIST",
  0xca: "NEW",
  0xcb: "OLD",
  0xcc: "RENUMBER",
  0xcd: "SAVE",
  0xcf: "PTR",
  0xd0: "PAGE",
  0xd1: "TIME",
  0xd2: "LOMEM",
  0xd3: "HIMEM",
  0xd4: "SOUND",
  0xd5: "BPUT",
  0xd6: "CALL",
  0xd7: "CHAIN",
  0xd8: "CLEAR",
  0xd9: "CLOSE",
  0xda: "CLG",
  0xdb: "CLS",
  0xdc: "DATA",
  0xdd: "DEF",
  0xde: "DIM",
  0xdf: "DRAW",
  0xe0: "END",
  0xe1: "ENDPROC",
  0xe2: "ENVELOPE",
  0xe3: "FOR",
  0xe4: "GOSUB",
  0xe5: "GOTO",
  0xe6: "GCOL",
  0xe7: "IF",
  0xe8: "INPUT",
  0xe9: "LET",
  0xea: "LOCAL",
  0xeb: "MODE",
  0xec: "MOVE",
  0xed: "NEXT",
  0xee: "ON",
  0xef: "VDU",
  0xf0: "PLOT",
  0xf1: "PRINT",
  0xf2: "PROC",
  0xf3: "READ",
  0xf4: "REM",
  0xf5: "REPEAT",
  0xf6: "REPORT",
  0xf7: "RESTORE",
  0xf8: "RETURN",
  0xf9: "RUN",
  0xfa: "STOP",
  0xfb: "COLOR",
  0xfc: "TRACE",
  0xfd: "UNTIL",
  0xfe: "WIDTH",
  0xff: "OSCLI",
};

const BBC_BASIC_3_ORDER: string[] = ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN", "AUTO", "BGET", "BPUT", "COLOR", "CALL", "CHAIN", "CHR$", "CLEAR", "CLOSE", "CLG", "CLS", "COS", "COUNT", "COLOUR", "DATA", "DEG", "DEF", "DELETE", "DIV", "DIM", "DRAW", "ENDPROC", "END", "ENVELOPE", "ELSE", "EVAL", "ERL", "ERROR", "EOF", "EOR", "ERR", "EXP", "EXT", "FOR", "FALSE", "FN", "GOTO", "GET$", "GET", "GOSUB", "GCOL", "HIMEM", "INPUT", "IF", "INKEY$", "INKEY", "INT", "INSTR(", "LIST", "LINE", "LOAD", "LOMEM", "LOCAL", "LEFT$(", "LEN", "LET", "LOG", "LN", "MID$(", "MODE", "MOD", "MOVE", "NEXT", "NEW", "NOT", "OLD", "ON", "OFF", "OR", "OPENIN", "OPENOUT", "OPENUP", "OSCLI", "PRINT", "PAGE", "PTR", "PI", "PLOT", "POINT(", "PROC", "POS", "RETURN", "REPEAT", "REPORT", "READ", "REM", "RUN", "RAD", "RESTORE", "RIGHT$(", "RND", "RENUMBER", "STEP", "SAVE", "SGN", "SIN", "SQR", "SPC", "STR$", "STRING$(", "SOUND", "STOP", "TAN", "THEN", "TO", "TAB(", "TRACE", "TIME", "TRUE", "UNTIL", "USR", "VDU", "VAL", "VPOS", "WIDTH", "PAGE", "PTR", "TIME", "LOMEM", "HIMEM"];

export const BBC_BASIC_3: BasicDialect = {
  id: "bbc-basic-3",
  label: "BBC BASIC III",
  tokens: BBC_BASIC_3_TOKENS,
  order: BBC_BASIC_3_ORDER,
  aliases: [{ keyword: "COLOUR", sameAs: "COLOR", token: 0xfb }],
  provenance: { source: "usbasic3.rom", sha256: "bc6a8d00030ec8478c84bcd03980e0424305d78827ce2a3afb1dd39b1a91a923", detail: "The US BBC Micro language ROM." },
};


const BBC_BASIC_4_TOKENS: Record<number, string> = {
  0x80: "AND",
  0x81: "DIV",
  0x82: "EOR",
  0x83: "MOD",
  0x84: "OR",
  0x85: "ERROR",
  0x86: "LINE",
  0x87: "OFF",
  0x88: "STEP",
  0x89: "SPC",
  0x8a: "TAB(",
  0x8b: "ELSE",
  0x8c: "THEN",
  0x8e: "OPENIN",
  0x8f: "PTR",
  0x90: "PAGE",
  0x91: "TIME",
  0x92: "LOMEM",
  0x93: "HIMEM",
  0x94: "ABS",
  0x95: "ACS",
  0x96: "ADVAL",
  0x97: "ASC",
  0x98: "ASN",
  0x99: "ATN",
  0x9a: "BGET",
  0x9b: "COS",
  0x9c: "COUNT",
  0x9d: "DEG",
  0x9e: "ERL",
  0x9f: "ERR",
  0xa0: "EVAL",
  0xa1: "EXP",
  0xa2: "EXT",
  0xa3: "FALSE",
  0xa4: "FN",
  0xa5: "GET",
  0xa6: "INKEY",
  0xa7: "INSTR(",
  0xa8: "INT",
  0xa9: "LEN",
  0xaa: "LN",
  0xab: "LOG",
  0xac: "NOT",
  0xad: "OPENUP",
  0xae: "OPENOUT",
  0xaf: "PI",
  0xb0: "POINT(",
  0xb1: "POS",
  0xb2: "RAD",
  0xb3: "RND",
  0xb4: "SGN",
  0xb5: "SIN",
  0xb6: "SQR",
  0xb7: "TAN",
  0xb8: "TO",
  0xb9: "TRUE",
  0xba: "USR",
  0xbb: "VAL",
  0xbc: "VPOS",
  0xbd: "CHR$",
  0xbe: "GET$",
  0xbf: "INKEY$",
  0xc0: "LEFT$(",
  0xc1: "MID$(",
  0xc2: "RIGHT$(",
  0xc3: "STR$",
  0xc4: "STRING$(",
  0xc5: "EOF",
  0xc6: "AUTO",
  0xc7: "DELETE",
  0xc8: "LOAD",
  0xc9: "LIST",
  0xca: "NEW",
  0xcb: "OLD",
  0xcc: "RENUMBER",
  0xcd: "SAVE",
  0xce: "EDIT",
  0xcf: "PTR",
  0xd0: "PAGE",
  0xd1: "TIME",
  0xd2: "LOMEM",
  0xd3: "HIMEM",
  0xd4: "SOUND",
  0xd5: "BPUT",
  0xd6: "CALL",
  0xd7: "CHAIN",
  0xd8: "CLEAR",
  0xd9: "CLOSE",
  0xda: "CLG",
  0xdb: "CLS",
  0xdc: "DATA",
  0xdd: "DEF",
  0xde: "DIM",
  0xdf: "DRAW",
  0xe0: "END",
  0xe1: "ENDPROC",
  0xe2: "ENVELOPE",
  0xe3: "FOR",
  0xe4: "GOSUB",
  0xe5: "GOTO",
  0xe6: "GCOL",
  0xe7: "IF",
  0xe8: "INPUT",
  0xe9: "LET",
  0xea: "LOCAL",
  0xeb: "MODE",
  0xec: "MOVE",
  0xed: "NEXT",
  0xee: "ON",
  0xef: "VDU",
  0xf0: "PLOT",
  0xf1: "PRINT",
  0xf2: "PROC",
  0xf3: "READ",
  0xf4: "REM",
  0xf5: "REPEAT",
  0xf6: "REPORT",
  0xf7: "RESTORE",
  0xf8: "RETURN",
  0xf9: "RUN",
  0xfa: "STOP",
  0xfb: "COLOUR",
  0xfc: "TRACE",
  0xfd: "UNTIL",
  0xfe: "WIDTH",
  0xff: "OSCLI",
};

const BBC_BASIC_4_ORDER: string[] = ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN", "AUTO", "BGET", "BPUT", "COLOUR", "CALL", "CHAIN", "CHR$", "CLEAR", "CLOSE", "CLG", "CLS", "COS", "COUNT", "COLOR", "DATA", "DEG", "DEF", "DELETE", "DIV", "DIM", "DRAW", "ENDPROC", "END", "ENVELOPE", "ELSE", "EVAL", "ERL", "ERROR", "EOF", "EOR", "ERR", "EXP", "EXT", "EDIT", "FOR", "FALSE", "FN", "GOTO", "GET$", "GET", "GOSUB", "GCOL", "HIMEM", "INPUT", "IF", "INKEY$", "INKEY", "INT", "INSTR(", "LIST", "LINE", "LOAD", "LOMEM", "LOCAL", "LEFT$(", "LEN", "LET", "LOG", "LN", "MID$(", "MODE", "MOD", "MOVE", "NEXT", "NEW", "NOT", "OLD", "ON", "OFF", "OR", "OPENIN", "OPENOUT", "OPENUP", "OSCLI", "PRINT", "PAGE", "PTR", "PI", "PLOT", "POINT(", "PROC", "POS", "RETURN", "REPEAT", "REPORT", "READ", "REM", "RUN", "RAD", "RESTORE", "RIGHT$(", "RND", "RENUMBER", "STEP", "SAVE", "SGN", "SIN", "SQR", "SPC", "STR$", "STRING$(", "SOUND", "STOP", "TAN", "THEN", "TO", "TAB(", "TRACE", "TIME", "TRUE", "UNTIL", "USR", "VDU", "VAL", "VPOS", "WIDTH", "PAGE", "PTR", "TIME", "LOMEM", "HIMEM"];

export const BBC_BASIC_4: BasicDialect = {
  id: "bbc-basic-4",
  label: "BBC BASIC IV",
  tokens: BBC_BASIC_4_TOKENS,
  order: BBC_BASIC_4_ORDER,
  aliases: [{ keyword: "COLOR", sameAs: "COLOUR", token: 0xfb }],
  provenance: { source: "mos3.20", sha256: "66f86b1161e2c91328755466a286523cdf7c37e155f2a3418c59768cf0733560", detail: "The Master 128 combined MOS image, which carries BASIC IV inside it." },
};


const BBC_BASIC_5_TOKENS: Record<number, string> = {
  0x7f: "OTHERWISE",
  0x80: "AND",
  0x81: "DIV",
  0x82: "EOR",
  0x83: "MOD",
  0x84: "OR",
  0x85: "ERROR",
  0x86: "LINE",
  0x87: "OFF",
  0x88: "STEP",
  0x89: "SPC",
  0x8a: "TAB(",
  0x8b: "ELSE",
  0x8c: "THEN",
  0x8e: "OPENIN",
  0x8f: "PTR",
  0x90: "PAGE",
  0x91: "TIME",
  0x92: "LOMEM",
  0x93: "HIMEM",
  0x94: "ABS",
  0x95: "ACS",
  0x96: "ADVAL",
  0x97: "ASC",
  0x98: "ASN",
  0x99: "ATN",
  0x9a: "BGET",
  0x9b: "COS",
  0x9c: "COUNT",
  0x9d: "DEG",
  0x9e: "ERL",
  0x9f: "ERR",
  0xa0: "EVAL",
  0xa1: "EXP",
  0xa2: "EXT",
  0xa3: "FALSE",
  0xa4: "FN",
  0xa5: "GET",
  0xa6: "INKEY",
  0xa7: "INSTR(",
  0xa8: "INT",
  0xa9: "LEN",
  0xaa: "LN",
  0xab: "LOG",
  0xac: "NOT",
  0xad: "OPENUP",
  0xae: "OPENOUT",
  0xaf: "PI",
  0xb0: "POINT(",
  0xb1: "POS",
  0xb2: "RAD",
  0xb3: "RND",
  0xb4: "SGN",
  0xb5: "SIN",
  0xb6: "SQR",
  0xb7: "TAN",
  0xb8: "TO",
  0xb9: "TRUE",
  0xba: "USR",
  0xbb: "VAL",
  0xbc: "VPOS",
  0xbd: "CHR$",
  0xbe: "GET$",
  0xbf: "INKEY$",
  0xc0: "LEFT$(",
  0xc1: "MID$(",
  0xc2: "RIGHT$(",
  0xc3: "STR$",
  0xc4: "STRING$(",
  0xc5: "EOF",
  0xc9: "WHEN",
  0xca: "OF",
  0xcb: "ENDCASE",
  0xcd: "ENDIF",
  0xce: "ENDWHILE",
  0xd4: "SOUND",
  0xd5: "BPUT",
  0xd6: "CALL",
  0xd7: "CHAIN",
  0xd8: "CLEAR",
  0xd9: "CLOSE",
  0xda: "CLG",
  0xdb: "CLS",
  0xdc: "DATA",
  0xdd: "DEF",
  0xde: "DIM",
  0xdf: "DRAW",
  0xe0: "END",
  0xe1: "ENDPROC",
  0xe2: "ENVELOPE",
  0xe3: "FOR",
  0xe4: "GOSUB",
  0xe5: "GOTO",
  0xe6: "GCOL",
  0xe7: "IF",
  0xe8: "INPUT",
  0xe9: "LET",
  0xea: "LOCAL",
  0xeb: "MODE",
  0xec: "MOVE",
  0xed: "NEXT",
  0xee: "ON",
  0xef: "VDU",
  0xf0: "PLOT",
  0xf1: "PRINT",
  0xf2: "PROC",
  0xf3: "READ",
  0xf4: "REM",
  0xf5: "REPEAT",
  0xf6: "REPORT",
  0xf7: "RESTORE",
  0xf8: "RETURN",
  0xf9: "RUN",
  0xfa: "STOP",
  0xfb: "COLOUR",
  0xfc: "TRACE",
  0xfd: "UNTIL",
  0xfe: "WIDTH",
  0xff: "OSCLI",
};

/*
 * The keywords BASIC V writes as two bytes, by the prefix that introduces them.
 *
 * Which prefix an entry takes is carried in its flag byte, and the mapping was
 * measured rather than read off the bits: every distinct flag value was typed
 * into a real RISC OS 3.11 machine and the tokenised program read back out of
 * its memory. See `scripts/extractBasicTokens.mjs`.
 */
const BBC_BASIC_5_EXTENDED: Record<number, Record<number, string>> = {
  0xc6: {
    0x8e: "SUM",
    0x8f: "BEAT",
  },
  0xc7: {
    0x8e: "APPEND",
    0x8f: "AUTO",
    0x90: "CRUNCH",
    0x91: "DELETE",
    0x92: "EDIT",
    0x93: "HELP",
    0x94: "LIST",
    0x95: "LOAD",
    0x96: "LVAR",
    0x97: "NEW",
    0x98: "OLD",
    0x99: "RENUMBER",
    0x9a: "SAVE",
    0x9b: "TEXTLOAD",
    0x9c: "TEXTSAVE",
    0x9d: "TWIN",
    0x9e: "TWINO",
    0x9f: "INSTALL",
  },
  0xc8: {
    0x8e: "CASE",
    0x8f: "CIRCLE",
    0x90: "FILL",
    0x91: "ORIGIN",
    0x92: "POINT",
    0x93: "RECTANGLE",
    0x94: "SWAP",
    0x95: "WHILE",
    0x96: "WAIT",
    0x97: "MOUSE",
    0x98: "QUIT",
    0x99: "SYS",
    0x9b: "LIBRARY",
    0x9c: "TINT",
    0x9d: "ELLIPSE",
    0x9e: "BEATS",
    0x9f: "TEMPO",
    0xa0: "VOICES",
    0xa1: "VOICE",
    0xa2: "STEREO",
    0xa3: "OVERLAY",
  },
};

/*
 * Tokens that appear only where a statement begins, and are in no table.
 *
 * Two kinds, both measured. The five pseudo-variables take these when they are
 * assigned to and their table tokens — &8F to &93 — when they are read; typing
 * `LOMEM=HIMEM` produced `D2 3D 93`. And `ELSE` takes &CC at the start of a
 * statement and its table token &8B inside a one-line `IF`; typing
 * `IF A=1 THEN 920 ELSE 930` produced &8B, and `ELSE` alone produced &CC.
 */
const BBC_BASIC_5_STATEMENT_FORMS: Record<number, string> = {
  0xcc: "ELSE",
  0xcf: "PTR",
  0xd0: "PAGE",
  0xd1: "TIME",
  0xd2: "LOMEM",
  0xd3: "HIMEM",
};

const BBC_BASIC_5_ORDER: string[] = ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN", "AUTO", "APPEND", "BGET", "BPUT", "BEATS", "BEAT", "COLOUR", "CALL", "CASE", "CHAIN", "CHR$", "CLEAR", "CLOSE", "CLG", "CLS", "COS", "COUNT", "CIRCLE", "CRUNCH", "COLOR", "DATA", "DEG", "DEF", "DELETE", "DIV", "DIM", "DRAW", "ENDPROC", "EDIT", "ENDWHILE", "ENDCASE", "ENDIF", "END", "ENVELOPE", "ELSE", "EVAL", "ERL", "ERROR", "EOF", "EOR", "ERR", "EXP", "EXT", "ELLIPSE", "FOR", "FALSE", "FILL", "FN", "GOTO", "GET$", "GET", "GOSUB", "GCOL", "HIMEM", "HELP", "INPUT", "IF", "INKEY$", "INKEY", "INT", "INSTR(", "INSTALL", "LIST", "LINE", "LOAD", "LOMEM", "LOCAL", "LEFT$(", "LEN", "LET", "LOG", "LN", "LIBRARY", "LVAR", "MID$(", "MODE", "MOD", "MOVE", "MOUSE", "NEXT", "NEW", "NOT", "OLD", "ON", "OFF", "OF", "ORIGIN", "OR", "OPENIN", "OPENOUT", "OPENUP", "OSCLI", "OTHERWISE", "OVERLAY", "PRINT", "PAGE", "PTR", "PI", "PLOT", "POINT(", "POINT", "PROC", "POS", "QUIT", "RETURN", "REPEAT", "REPORT", "READ", "REM", "RUN", "RAD", "RESTORE", "RIGHT$(", "RND", "RECTANGLE", "RENUMBER", "STEP", "SAVE", "SGN", "SIN", "SQR", "SOUND", "SPC", "STR$", "STRING$(", "STOP", "STEREO", "SUM", "SWAP", "SYS", "TAN", "TAB(", "TEMPO", "TEXTLOAD", "TEXTSAVE", "THEN", "TIME", "TINT", "TO", "TRACE", "TRUE", "TWINO", "TWIN", "UNTIL", "USR", "VDU", "VAL", "VPOS", "VOICES", "VOICE", "WHILE", "WHEN", "WAIT", "WIDTH"];

/*
 * BBC BASIC V as RISC OS 2 shipped it, which is not the table above.
 *
 * The tables were assumed to be one table per language and they are one per ROM
 * generation. Reading every ARM ROM held here found five distinct ones: 157
 * entries in the three Arthur ROMs, 158 in RISC OS 2.00, and 161 in three later
 * variants.
 *
 * That would be a gap and not a defect if the growth were additive, and it is
 * not. RISC OS 3.11 inserted CRUNCH at &C7 &90 and shifted every two-byte token
 * after it, so the same bytes mean different keywords on the two machines:
 *
 *   &C7 &94   RISC OS 2: LOAD    RISC OS 3.11: LIST
 *   &C7 &95   RISC OS 2: LVAR    RISC OS 3.11: LOAD
 *   &C7 &96   RISC OS 2: NEW     RISC OS 3.11: LVAR
 *
 * A tokenised RISC OS 2 program read with the later table therefore prints
 * keywords the program does not contain, and prints them confidently. The A310
 * this build qualifies is a machine that shipped with RISC OS 2, so it is
 * somebody's actual file rather than a hypothetical one.
 *
 * Read by the same reader as the others, and the reason to trust it on this ROM
 * is that it reproduces the RISC OS 3.11 table above exactly — every keyword,
 * every token and every two-byte group — from a different image.
 *
 * It is read from the four byte-lane ROMs interleaved into the image the A310
 * core is actually given, rather than from a flat dump, because that is the
 * firmware this product boots for its `riscos200` profile. The first attempt
 * was read from a flat image named ROM030 in a collection whose names are the
 * version times a hundred — so ROM030 is Arthur 0.30, not RISC OS 2.00, and the
 * table shipped for a moment under the wrong firmware's name. Arthur's table is
 * this one less `OVERLAY`, with no token meaning anything different, so this
 * dialect reads an Arthur program correctly too; that is measured rather than
 * assumed, and it is why the mistake produced no wrong keyword.
 *
 * The statement forms are absent rather than empty, which is the same thing the
 * 6502 dialects say by leaving them out. BASIC V's were not read from a ROM at
 * all: they were measured by typing into a running RISC OS 3.11 machine on this
 * build's own A310 core, because a ROM's linear table does not carry them.
 * Nobody has done that on RISC OS 2, so nothing is claimed. It would be done
 * the same way, with ROM030 in place of ROM311.
 */
const BBC_BASIC_5_RISCOS2_TOKENS: Record<number, string> = {
  0x7f: "OTHERWISE",
  0x80: "AND",
  0x81: "DIV",
  0x82: "EOR",
  0x83: "MOD",
  0x84: "OR",
  0x85: "ERROR",
  0x86: "LINE",
  0x87: "OFF",
  0x88: "STEP",
  0x89: "SPC",
  0x8a: "TAB(",
  0x8b: "ELSE",
  0x8c: "THEN",
  0x8e: "OPENIN",
  0x8f: "PTR",
  0x90: "PAGE",
  0x91: "TIME",
  0x92: "LOMEM",
  0x93: "HIMEM",
  0x94: "ABS",
  0x95: "ACS",
  0x96: "ADVAL",
  0x97: "ASC",
  0x98: "ASN",
  0x99: "ATN",
  0x9a: "BGET",
  0x9b: "COS",
  0x9c: "COUNT",
  0x9d: "DEG",
  0x9e: "ERL",
  0x9f: "ERR",
  0xa0: "EVAL",
  0xa1: "EXP",
  0xa2: "EXT",
  0xa3: "FALSE",
  0xa4: "FN",
  0xa5: "GET",
  0xa6: "INKEY",
  0xa7: "INSTR(",
  0xa8: "INT",
  0xa9: "LEN",
  0xaa: "LN",
  0xab: "LOG",
  0xac: "NOT",
  0xad: "OPENUP",
  0xae: "OPENOUT",
  0xaf: "PI",
  0xb0: "POINT(",
  0xb1: "POS",
  0xb2: "RAD",
  0xb3: "RND",
  0xb4: "SGN",
  0xb5: "SIN",
  0xb6: "SQR",
  0xb7: "TAN",
  0xb8: "TO",
  0xb9: "TRUE",
  0xba: "USR",
  0xbb: "VAL",
  0xbc: "VPOS",
  0xbd: "CHR$",
  0xbe: "GET$",
  0xbf: "INKEY$",
  0xc0: "LEFT$(",
  0xc1: "MID$(",
  0xc2: "RIGHT$(",
  0xc3: "STR$",
  0xc4: "STRING$(",
  0xc5: "EOF",
  0xc9: "WHEN",
  0xca: "OF",
  0xcb: "ENDCASE",
  0xcd: "ENDIF",
  0xce: "ENDWHILE",
  0xd4: "SOUND",
  0xd5: "BPUT",
  0xd6: "CALL",
  0xd7: "CHAIN",
  0xd8: "CLEAR",
  0xd9: "CLOSE",
  0xda: "CLG",
  0xdb: "CLS",
  0xdc: "DATA",
  0xdd: "DEF",
  0xde: "DIM",
  0xdf: "DRAW",
  0xe0: "END",
  0xe1: "ENDPROC",
  0xe2: "ENVELOPE",
  0xe3: "FOR",
  0xe4: "GOSUB",
  0xe5: "GOTO",
  0xe6: "GCOL",
  0xe7: "IF",
  0xe8: "INPUT",
  0xe9: "LET",
  0xea: "LOCAL",
  0xeb: "MODE",
  0xec: "MOVE",
  0xed: "NEXT",
  0xee: "ON",
  0xef: "VDU",
  0xf0: "PLOT",
  0xf1: "PRINT",
  0xf2: "PROC",
  0xf3: "READ",
  0xf4: "REM",
  0xf5: "REPEAT",
  0xf6: "REPORT",
  0xf7: "RESTORE",
  0xf8: "RETURN",
  0xf9: "RUN",
  0xfa: "STOP",
  0xfb: "COLOUR",
  0xfc: "TRACE",
  0xfd: "UNTIL",
  0xfe: "WIDTH",
  0xff: "OSCLI",
};

const BBC_BASIC_5_RISCOS2_EXTENDED: Record<number, Record<number, string>> = {
  0xc6: {
    0x8e: "SUM",
    0x8f: "BEAT",
  },
  0xc7: {
    0x8e: "APPEND",
    0x8f: "AUTO",
    0x90: "DELETE",
    0x91: "EDIT",
    0x92: "HELP",
    0x93: "LIST",
    0x94: "LOAD",
    0x95: "LVAR",
    0x96: "NEW",
    0x97: "OLD",
    0x98: "RENUMBER",
    0x99: "SAVE",
    0x9a: "TWIN",
    0x9b: "TWINO",
  },
  0xc8: {
    0x8e: "CASE",
    0x8f: "CIRCLE",
    0x90: "FILL",
    0x91: "ORIGIN",
    0x92: "POINT",
    0x93: "RECTANGLE",
    0x94: "SWAP",
    0x95: "WHILE",
    0x96: "WAIT",
    0x97: "MOUSE",
    0x98: "QUIT",
    0x99: "SYS",
    0x9a: "INSTALL",
    0x9b: "LIBRARY",
    0x9c: "TINT",
    0x9d: "ELLIPSE",
    0x9e: "BEATS",
    0x9f: "TEMPO",
    0xa0: "VOICES",
    0xa1: "VOICE",
    0xa2: "STEREO",
    0xa3: "OVERLAY",
  },
};

const BBC_BASIC_5_RISCOS2_ORDER: string[] = ["AND","ABS","ACS","ADVAL","ASC","ASN","ATN","AUTO","APPEND","BGET","BPUT","BEATS","BEAT","COLOUR","CALL","CASE","CHAIN","CHR$","CLEAR","CLOSE","CLG","CLS","COS","COUNT","CIRCLE","COLOR","DATA","DEG","DEF","DELETE","DIV","DIM","DRAW","ENDPROC","EDIT","ENDWHILE","ENDCASE","ENDIF","END","ENVELOPE","ELSE","EVAL","ERL","ERROR","EOF","EOR","ERR","EXP","EXT","ELLIPSE","FOR","FALSE","FILL","FN","GOTO","GET$","GET","GOSUB","GCOL","HIMEM","HELP","INPUT","IF","INKEY$","INKEY","INT","INSTR(","INSTALL","LIST","LINE","LOAD","LOMEM","LOCAL","LEFT$(","LEN","LET","LOG","LN","LIBRARY","LVAR","MID$(","MODE","MOD","MOVE","MOUSE","NEXT","NEW","NOT","OLD","ON","OFF","OF","ORIGIN","OR","OPENIN","OPENOUT","OPENUP","OSCLI","OTHERWISE","OVERLAY","PRINT","PAGE","PTR","PI","PLOT","POINT(","POINT","PROC","POS","QUIT","RETURN","REPEAT","REPORT","READ","REM","RUN","RAD","RESTORE","RIGHT$(","RND","RECTANGLE","RENUMBER","STEP","SAVE","SGN","SIN","SQR","SOUND","SPC","STR$","STRING$(","STOP","STEREO","SUM","SWAP","SYS","TAN","TAB(","TEMPO","THEN","TIME","TINT","TO","TRACE","TRUE","TWINO","TWIN","UNTIL","USR","VDU","VAL","VPOS","VOICES","VOICE","WHILE","WHEN","WAIT","WIDTH"];

export const BBC_BASIC_5_RISCOS2: BasicDialect = {
  id: "bbc-basic-5-riscos2",
  label: "BBC BASIC V (RISC OS 2)",
  tokens: BBC_BASIC_5_RISCOS2_TOKENS,
  extended: BBC_BASIC_5_RISCOS2_EXTENDED,
  order: BBC_BASIC_5_RISCOS2_ORDER,
  aliases: [{keyword: "COLOR", sameAs: "COLOUR", token: 251}],
  provenance: {
    source: "riscos200",
    sha256: "b2658bb1d30ea0d5e322dca2895ec969d9a28695f96726da119e08fb3aa068d3",
    detail: "BBC BASIC V as shipped in RISC OS 2.00 (05 Oct 1988). 158 entries ending at WIDTH. Read from the four byte-lane ROMs 0283,022-01 to 0283,025-01 interleaved into the image the A310 core is given, which is the firmware this product's riscos200 profile actually boots; the digest is that reconstructed image. The same reader reproduces the RISC OS 3.11 table exactly from ROM311, which is why it is trusted here. Statement forms are not established for this ROM: BASIC V's were measured on a running machine rather than read, and that has not been done for RISC OS 2.",
  },
};

export const BBC_BASIC_5: BasicDialect = {
  id: "bbc-basic-5",
  label: "BBC BASIC V",
  tokens: BBC_BASIC_5_TOKENS,
  extended: BBC_BASIC_5_EXTENDED,
  statementForms: BBC_BASIC_5_STATEMENT_FORMS,
  order: BBC_BASIC_5_ORDER,
  aliases: [{keyword: "COLOR", sameAs: "COLOUR", token: 251}],
  provenance: { source: "riscos311", sha256: "e916a0b84a2c8d96d43731ec9a02c9dff31312c95bca725b2b60e7eb3bfe7384", detail: "BBC BASIC V 1.05 inside the RISC OS 3.11 image, whose four byte-lane ROMs this build already interleaves for the A310 core." },
};

/*
 * BBC BASIC VI, which is BASIC V with eight-byte reals.
 *
 * It shares BASIC V's tables here, and that sharing is the measured result
 * rather than the assumption it is usually stated as. Every RISC OS 6 ROM
 * carries two keyword tables, one in the `BASIC` module and one in `BASIC64`,
 * so the two can be compared inside a single image without trusting anything:
 * they are identical in all seven images this was read from, all seven give the
 * same 161-entry table, and that table matches the BASIC V table above position
 * for position — which was itself read independently out of RISC OS 3.11.
 *
 * So the constants are shared rather than copied. Two copies of a table that
 * has been shown to be one table is how the copies come to disagree.
 *
 * What differs between the two dialects is the number format, not the tokens:
 * BASIC VI stores reals in eight bytes rather than five. Nothing in a keyword
 * table says that, which is why this shares one and still needs its own entry —
 * a reader has to know which it is looking at before it decodes a number.
 */
export const BBC_BASIC_6: BasicDialect = {
  id: "bbc-basic-6",
  label: "BBC BASIC VI",
  tokens: BBC_BASIC_5_TOKENS,
  extended: BBC_BASIC_5_EXTENDED,
  statementForms: BBC_BASIC_5_STATEMENT_FORMS,
  order: BBC_BASIC_5_ORDER,
  aliases: [{keyword: "COLOR", sameAs: "COLOUR", token: 251}],
  provenance: {
    source: "riscos616",
    sha256: "b79498e1d5cdf0dd184ea11b070fb224f3f0c86bc558f57d6dd5154fa255db2b",
    detail: "BASIC VI 1.37 (05 Mar 2007), read from the BASIC64 module of the RISC OS 6.16 ROM. The module header reads BASIC64 / BASIC VI / 1.37 and its banner reads \"BASIC VI (64 bit FP) assembled on 05 Mar 2007.\". Corroborated against ROM606, both ROM610 builds, both ROM614 builds and both ROM616 builds, which give the same table.",
  },
};

export const BASIC_DIALECTS: BasicDialect[] = [BBC_BASIC_1, BBC_BASIC_2, BBC_BASIC_3, BBC_BASIC_4, BBC_BASIC_5_RISCOS2, BBC_BASIC_5, BBC_BASIC_6];

export function basicDialect(id: BasicDialectId): BasicDialect | undefined {
  return BASIC_DIALECTS.find((dialect) => dialect.id === id);
}
