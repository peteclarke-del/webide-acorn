import type { LanguageItem, LanguageItemDocumentation } from './languageService';
import type { LanguageTargetContext } from './languageTarget';

const ATOM_GUIDE = 'https://vintagecomputer.net/fjkraan/comp/atom/atap/atap03.html';
const ATOM_REFERENCE_VERSION = 'atomic-theory-and-practice-ch20-26+ide-1';

interface AtomRecord {
  signature: string;
  detail: string;
  parameters?: Array<{ name: string; detail: string; range?: string }>;
  result?: string;
  examples: string[];
  sideEffects?: string[];
  related?: string[];
  category?: 'command' | 'statement' | 'function' | 'connective';
  section?: string;
}

const ATOM: Record<string, AtomRecord> = {
  ABS: record('ABS factor', 'Return the absolute value of a signed integer expression.', ['factor'], ['PRINT ABS(-12)'], 'function'),
  AND: record('relation AND relation', 'Logical AND used between relational expressions.', ['left relation', 'right relation'], ['IF A=B AND C=D PRINT "EQUAL PAIRS"'], 'connective'),
  BGET: record('BGET handle', 'Read and return one byte from a random input file.', ['handle'], ['A=FIN"FRED"; B=BGET A'], 'function'),
  BPUT: record('BPUT handle, expression', 'Write the least-significant byte of an expression to a random output file.', ['handle', 'expression'], ['A=FOUT"FRED"; BPUT A,23']),
  CH: record('CH string', 'Return the character code of the first character in a string.', ['string'], ['C=CH"A"'], 'function'),
  CLEAR: { signature: 'CLEAR mode', detail: 'Clear the screen and select an Atom graphics mode.', parameters: [{ name: 'mode', detail: 'Graphics mode or parenthesised expression.', range: '0–4 in the standard ROM; available resolution depends on fitted RAM. Modes 1a–4a require direct display setup and colour support.' }], result: 'The display is cleared and graphics coordinates are reset.', examples: ['CLEAR 0', 'CLEAR 4'], sideEffects: ['Changes display memory use and clears the screen.'], related: ['PLOT', 'MOVE', 'DRAW'], category: 'statement', section: 'CLEAR and graphics modes' },
  COUNT: record('COUNT', 'Return the number of characters printed since the most recent carriage return.', [], ['DO PRINT"="; UNTIL COUNT=20'], 'function'),
  DIM: { signature: 'DIM declaration[, declaration…]', detail: 'Allocate storage after the BASIC text for vectors, arrays, strings or machine code.', parameters: [{ name: 'declaration', detail: 'Single-letter byte/word vector, doubled-letter array, or allocation expression.', range: 'The allocation must fit below the current memory limit.' }], result: 'Sets the declared base address and advances the free-space pointer.', examples: ['DIM A(40)', 'DIM AA(10)', 'DIM V(11),C(0),P(-1)'], sideEffects: ['Consumes workspace above TOP; only valid while running a program.'], related: ['TOP'], category: 'statement' },
  DO: record('DO statement…; UNTIL condition', 'Begin an Atom BASIC post-tested loop.', [], ['DO PRINT "ATOM-"; UNTIL 0']),
  DRAW: coordinates('DRAW', 'Draw a line from the graphics cursor to the supplied coordinates, then move the cursor there.'),
  END: record('END', 'Terminate program execution and reset TOP to the end of the current BASIC text.', [], ['100 END']),
  EXT: record('EXT handle', 'Return the extent of a random-access file when the filing system supports it.', ['handle'], ['L=EXT A'], 'function'),
  FIN: record('FIN string', 'Open or select a file for sequential input and return its handle.', ['filename string'], ['A=FIN"FRED"'], 'function'),
  FOR: { signature: 'FOR variable=start TO limit [STEP increment]; statement…; NEXT variable', detail: 'Begin a counted loop using an Atom single-letter control variable.', parameters: [{ name: 'variable', detail: 'A single-letter integer variable.' }, { name: 'start', detail: 'Initial integer expression.' }, { name: 'limit', detail: 'Inclusive loop limit.' }, { name: 'increment', detail: 'Optional step; defaults to +1.' }], result: 'Repeats until the control variable passes the limit.', examples: ['FOR N=1 TO 15; PRINT N; NEXT N'], related: ['NEXT', 'STEP', 'TO'], category: 'statement' },
  FOUT: record('FOUT string', 'Open or select a file for sequential output and return its handle.', ['filename string'], ['A=FOUT"FRED"'], 'function'),
  GET: record('GET handle', 'Read and return one 32-bit word from a sequential input file.', ['handle'], ['W=GET A'], 'function'),
  GOSUB: branch('GOSUB', 'Call a numbered, computed or labelled subroutine and retain a return point.'),
  GOTO: branch('GOTO', 'Continue at a numbered, computed or labelled BASIC line.'),
  IF: { signature: 'IF condition [THEN] statement', detail: 'Execute the remainder of the line only when the condition is true; THEN is optional.', parameters: [{ name: 'condition', detail: 'A testable integer or relational expression; zero is false.' }, { name: 'statement', detail: 'The statement executed when true.' }], result: 'False skips to the next physical program line.', examples: ['IF A>B PRINT "HIGH"', 'IF A=0 THEN GOTO 100'], related: ['THEN', 'GOTO'], category: 'statement' },
  INPUT: { signature: 'INPUT [prompt] variable[, variable…]', detail: 'Read numeric or string-addressed input, with an optional prompt in the same statement.', parameters: [{ name: 'prompt', detail: 'Optional quoted output and print-format controls.' }, { name: 'variable', detail: 'Destination variable or string location.' }], result: 'Stores entered values in the destinations.', examples: ['INPUT A', 'INPUT "MONTH "M'], sideEffects: ['Waits for keyboard input and may print a prompt.'], category: 'statement' },
  LEN: record('LEN string', 'Return the length of a carriage-return-terminated string.', ['string'], ['L=LEN(A)'], 'function'),
  LET: record('[LET] variable=expression', 'Assign a value; the LET keyword is optional.', ['variable', 'expression'], ['LET A=10', 'A=10']),
  LINK: record('LINK address', 'Call a 6502 machine-code routine at an address.', ['address'], ['LINK #2800']),
  LIST: record('LIST [first][,last]', 'List some or all of the BASIC text in memory.', ['first line', 'last line'], ['LIST', 'LIST 100,200'], 'command'),
  LOAD: record('LOAD string', 'Load BASIC text with the specified filename through the current operating system.', ['filename string'], ['LOAD"GAME"'], 'command'),
  MOVE: coordinates('MOVE', 'Move the graphics cursor without drawing.'),
  NEW: record('NEW', 'Delete the current BASIC text by resetting its end marker.', [], ['NEW'], 'command'),
  NEXT: record('NEXT variable', 'Advance and test the matching FOR loop.', ['variable'], ['NEXT N']),
  OLD: record('OLD', 'Recover BASIC text after an accidental NEW or break where the text remains intact.', [], ['OLD'], 'command'),
  OR: record('relation OR relation', 'Logical OR used between relational expressions.', ['left relation', 'right relation'], ['IF A=1 OR B=1 PRINT "YES"'], 'connective'),
  PLOT: { signature: 'PLOT mode,x,y', detail: 'Plot, move or draw using an operation mode and coordinates.', parameters: [{ name: 'mode', detail: 'Plot operation: move/draw, absolute/relative, set/clear/invert.' }, { name: 'x', detail: 'Horizontal coordinate or displacement.' }, { name: 'y', detail: 'Vertical coordinate or displacement.' }], result: 'Updates pixels and the graphics cursor according to the mode.', examples: ['PLOT 13,32,24'], sideEffects: ['Writes display memory.'], related: ['CLEAR', 'MOVE', 'DRAW'], category: 'statement' },
  PRINT: { signature: 'PRINT item[, item…][\' formatting]', detail: 'Print integer expressions or strings. Atom BASIC does not add a newline automatically; an apostrophe in the print list emits carriage return/line feed.', parameters: [{ name: 'item', detail: 'Expression, string, comma-tabbed item, space-separated item, or print-format control.', range: 'Zero or more items.' }], result: 'Characters are sent to the Atom output stream.', examples: ['PRINT "HELLO"\'', 'PRINT A,B', 'PRINT "ABC" "DEF"'], sideEffects: ['Changes COUNT and the text cursor.'], related: ['COUNT', 'INPUT'], category: 'statement' },
  PTR: record('PTR handle', 'Return the current sequential pointer of a random-access file.', ['handle'], ['P=PTR A'], 'function'),
  PUT: record('PUT handle, expression', 'Write one 32-bit word to a sequential output file.', ['handle', 'expression'], ['PUT A,W']),
  REM: record('REM comment', 'Ignore commentary up to the physical end of the line.', ['comment'], ['10 REM INITIALISE']),
  RETURN: record('RETURN', 'Return from the most recent GOSUB.', [], ['RETURN']),
  RND: record('RND', 'Return the next signed pseudo-random integer.', [], ['A=ABS(RND)%10'], 'function'),
  RUN: record('RUN', 'Reset BASIC workspace and execute the current program from its lowest line.', [], ['RUN'], 'command'),
  SAVE: record('SAVE string', 'Save the current BASIC text through the current operating system.', ['filename string'], ['SAVE"GAME"'], 'command'),
  SGET: record('SGET handle, address', 'Read a carriage-return-terminated string into memory.', ['handle', 'destination address'], ['SGET A,S']),
  SHUT: record('SHUT handle', 'Close one random file, or all files when the handle is zero.', ['handle'], ['SHUT A', 'SHUT 0']),
  SPUT: record('SPUT handle, string', 'Write a string including its terminating carriage return to a sequential output file.', ['handle', 'string'], ['SPUT A,"THIS IS FILE FRED"']),
  STEP: record('STEP increment', 'Specify a non-default increment in a FOR statement.', ['increment'], ['FOR N=10 TO 0 STEP -1'], 'connective'),
  THEN: record('THEN statement', 'Optional connective between an IF condition and its true statement.', ['statement'], ['IF A=1 THEN PRINT "YES"'], 'connective'),
  TO: record('TO limit', 'Separate the initial value and limit in a FOR statement.', ['limit'], ['FOR N=1 TO 10'], 'connective'),
  TOP: record('TOP', 'Return the first free byte immediately after the current BASIC text.', [], ['PRINT #TOP'], 'function'),
  UNTIL: record('UNTIL condition', 'End a DO loop and repeat it while the condition is false.', ['condition'], ['DO A=A+1; UNTIL A=10']),
  WAIT: record('WAIT', 'Pause execution until the next 60 Hz timing tick.', [], ['WAIT']),
};

const ATOM_FP: Record<string, AtomRecord> = {
  ACS: fpFunction('ACS expression', 'Return the arc cosine in radians.', 'FPRINT ACS 1'),
  ASN: fpFunction('ASN expression', 'Return the arc sine in radians.', 'FPRINT ASN 1'),
  ATN: fpFunction('ATN expression', 'Return the arc tangent in radians.', 'FPRINT ATN 1'),
  COLOUR: { signature: 'COLOUR colour', detail: 'Select the drawing colour used by the Atom colour-graphics extension.', parameters: [{ name: 'colour', detail: 'Colour number.', range: '0 green/background, 1 yellow, 2 blue, 3 red.' }], result: 'Subsequent DRAW and set-mode PLOT operations use the selected colour.', examples: ['COLOUR 3'], sideEffects: ['Changes the extension ROM colour plotting state.'], related: ['CLEAR', 'PLOT', 'DRAW'], category: 'statement', section: 'Chapter 22.2 · COLOUR' },
  COS: fpFunction('COS expression', 'Return the cosine of an angle in radians.', 'FPRINT COS 1'),
  DEG: fpFunction('DEG expression', 'Convert radians to degrees.', 'FPRINT DEG PI'),
  EXP: fpFunction('EXP expression', 'Return e raised to the supplied power.', 'FPRINT EXP 1'),
  FDIM: { signature: 'FDIM %array(limit)[, %array(limit)…]', detail: 'Allocate five-byte elements for floating-point arrays.', parameters: [{ name: 'array', detail: 'A doubled-letter floating-point array name from %@@ or %AA–%ZZ.' }, { name: 'limit', detail: 'Highest inclusive subscript.' }], result: 'Allocates 5 × (limit + 1) bytes per array.', examples: ['FDIM %JJ(5)'], sideEffects: ['Consumes workspace above the BASIC text.'], category: 'statement', section: 'Chapter 22.1.2 · FDIM' },
  FGET: fpFunction('FGET handle', 'Read five bytes from a sequential file and return the floating-point value.', 'X=FGET A'),
  FIF: { signature: 'FIF relation statement', detail: 'Floating-point conditional; unlike integer IF, AND and OR connectives are not allowed.', parameters: [{ name: 'relation', detail: 'A floating-point relational expression.' }, { name: 'statement', detail: 'Statement executed when the relation is true.' }], examples: ['FIF %A<%B FPRINT %A'], related: ['IF', 'FUNTIL'], category: 'statement', section: 'Chapter 22.1.2 · FIF' },
  FINPUT: record('FINPUT [prompt] %variable[, %variable…]', 'Read floating-point values; strings are not valid destinations.', ['prompt', 'floating-point variable'], ['FINPUT"YOUR WEIGHT "%A']),
  FLT: fpFunction('FLT integer-expression', 'Convert an integer result to floating point after the integer expression has been evaluated.', 'FPRINT FLT(4/3)'),
  FPRINT: record('FPRINT item[, item…]', 'Print items using floating-point evaluation and formatting; $ expressions are not accepted.', ['item'], ['FPRINT"PI="PI\'']),
  FPUT: record('FPUT handle, expression', 'Write the five-byte representation of a floating-point value to a sequential file.', ['handle', 'floating-point expression'], ['FPUT A,2^32+1']),
  FUNTIL: record('FUNTIL relation', 'Terminate a DO loop using a floating-point relation; AND and OR are not accepted.', ['relation'], ['DO %A=%A+.1; FUNTIL %A>2']),
  HTN: fpFunction('HTN expression', 'Return the hyperbolic tangent.', 'FPRINT HTN 1'),
  LOG: fpFunction('LOG expression', 'Return the natural logarithm.', 'FPRINT LOG 1'),
  PI: fpFunction('PI', 'Return the floating-point constant π.', 'FPRINT PI'),
  RAD: fpFunction('RAD expression', 'Convert degrees to radians.', 'FPRINT RAD 90'),
  SGN: fpFunction('SGN expression', 'Return -1, 0 or 1 according to the sign of the floating-point argument.', 'FPRINT SGN %A'),
  SIN: fpFunction('SIN expression', 'Return the sine of an angle in radians.', 'FPRINT SIN PI'),
  SQR: fpFunction('SQR expression', 'Return the square root.', 'FPRINT SQR 2'),
  STR: record('STR expression, address', 'Convert a floating-point expression to a carriage-return-terminated string in memory.', ['floating-point expression', 'destination address'], ['STR PI,TOP; PRINT $TOP\'']),
  TAN: fpFunction('TAN expression', 'Return the tangent of an angle in radians.', 'FPRINT TAN PI'),
  VAL: fpFunction('VAL string', 'Convert the numeric prefix of a string to floating point, returning zero when no number is present.', 'FPRINT VAL "2.2#"'),
};

export function atomBasicLanguageItems(target?: LanguageTargetContext) {
  const tokens = [...Object.keys(ATOM), ...(hasFloatingPointRom(target) ? Object.keys(ATOM_FP) : [])];
  return tokens.map((token) => atomBasicLanguageItem(token, target)!);
}

export function atomBasicLanguageItem(token: string, target?: LanguageTargetContext): LanguageItem | undefined {
  const canonical = token.toUpperCase();
  const entry = ATOM[canonical] ?? ATOM_FP[canonical];
  if (!entry) return undefined;
  const requiresFloatingPointRom = canonical in ATOM_FP;
  const machineSupported = !target || target.machineId === 'atom';
  const supported = machineSupported && (!requiresFloatingPointRom || hasFloatingPointRom(target));
  const warning = !machineSupported
    ? `Atom BASIC is not compatible with the selected ${target?.machineLabel ?? 'target'} profile.`
    : requiresFloatingPointRom && !hasFloatingPointRom(target) ? `${canonical} requires the Atom floating-point extension ROM; enable the FP ROM capability and select its ROM profile.`
    : target && !target.romReady ? `${target.romLabel} is selected, but its required local ROM set is not ready for execution.` : undefined;
  const documentation: LanguageItemDocumentation = {
    category: `Atom BASIC ${entry.category ?? 'statement'}`,
    parameters: entry.parameters,
    result: entry.result,
    examples: entry.examples,
    sideEffects: entry.sideEffects,
    compatibility: { supported, appliesTo: target ? [requiresFloatingPointRom ? 'Atom floating-point BASIC extension' : 'Atom BASIC', target.machineLabel, target.romLabel] : [requiresFloatingPointRom ? 'Acorn Atom floating-point extension ROM' : 'Acorn Atom BASIC'], warning },
    related: entry.related,
    citations: [{ title: 'Atomic Theory and Practice', url: ATOM_GUIDE, section: `Chapter 20 · ${entry.section ?? canonical}`, version: 'Acorn Computers, 1980' }],
  };
  return {
    token: canonical, kind: 'command', detail: entry.detail, signature: entry.signature,
    parameters: entry.parameters?.map((parameter) => parameter.name), languages: ['bbc-basic'], documentation,
    source: { kind: 'builtin', label: `Atomic Theory and Practice · ${entry.section ?? canonical}`, version: ATOM_REFERENCE_VERSION },
  };
}

function record(signature: string, detail: string, parameters: string[], examples: string[], category: AtomRecord['category'] = 'statement'): AtomRecord {
  return { signature, detail, parameters: parameters.map((name) => ({ name, detail: `Atom BASIC ${name}.` })), examples, category };
}

function coordinates(token: 'MOVE' | 'DRAW', detail: string): AtomRecord {
  return { signature: `${token} x,y`, detail, parameters: [{ name: 'x', detail: 'Horizontal coordinate expression.' }, { name: 'y', detail: 'Vertical coordinate expression.' }], examples: [`${token} 0,0`], sideEffects: token === 'DRAW' ? ['Writes display memory and changes the graphics cursor.'] : ['Changes the graphics cursor.'], related: ['CLEAR', 'PLOT'], category: 'statement' };
}

function branch(token: 'GOTO' | 'GOSUB', detail: string): AtomRecord {
  return { signature: `${token} line-expression | ${token} label`, detail, parameters: [{ name: 'target', detail: 'A line-number expression or lower-case line label.' }], result: token === 'GOSUB' ? 'Execution resumes after the call when RETURN is reached.' : 'Execution continues at the resolved line.', examples: [`${token} 100`, `${token} (A*10+100)`, `${token} a`], related: token === 'GOSUB' ? ['RETURN', 'GOTO'] : ['GOSUB', 'IF'], category: 'statement' };
}

function fpFunction(signature: string, detail: string, example: string): AtomRecord {
  const parameter = signature.includes(' ') ? ['expression'] : [];
  return record(signature, detail, parameter, [example], 'function');
}

function hasFloatingPointRom(target?: LanguageTargetContext) {
  return !target || target.romId === 'atom-fp' || target.enabledCapabilities.includes('fp-rom');
}
