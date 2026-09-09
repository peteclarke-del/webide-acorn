import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The state each help screenshot is a picture of, and how to reach it.
 *
 * One entry per image in `src/help/helpTopics.ts`. `steps` are the things a
 * person does, in the product's own words; `shows` is what has to be on screen
 * before the shutter opens, so a capture of the wrong state fails rather than
 * quietly replacing a good image with a picture of an empty panel.
 *
 * Keep an entry's `shows` specific to what its caption claims. That is the only
 * thing standing between this and a folder of confident, wrong pictures.
 */

/** A short BASIC program with the shapes the editor topics talk about. */
export const SAMPLE_BASIC = [
  '10 REM Acorn workbench sample',
  '20 MODE 1',
  '30 FOR I% = 1 TO 10',
  '40   PRINT "HELLO ";I%',
  '50 NEXT I%',
  '60 GOSUB 100',
  '70 END',
  '100 PRINT "SUBROUTINE"',
  '110 RETURN',
].join('\n');

/*
 * Put the machine runtime away.
 *
 * The workbench opens with the emulator across the bottom half, which is right
 * for somebody running code and wrong for a picture of the source editor: it
 * leaves the text a few lines tall and pushes completion lists and previews out
 * of the frame. Somebody editing source hides it, and so do these captures.
 */
export const HIDE_RUNTIME = { click: 'button[aria-label="Hide machine runtime"]' };

/*
 * Open the Acorn Harvest sample.
 *
 * The empty project the workbench starts with has one BASIC file and no
 * structure, which is the right picture for first run and the wrong one for
 * every topic about navigating, renaming or building across files. Harvest is a
 * real eight-file 6502 project with build targets, bookmarks, test plans and
 * generated sources, and it opens through the ordinary project parser, so
 * nothing in these pictures is a fixture.
 */
export const OPEN_HARVEST = [
  { clickText: { selector: '.workbench-menu button, .menu-bar button, button', text: 'Project' } },
  { clickText: { selector: 'button', text: 'Start from a sample...' } },
  { clickText: { selector: 'button', text: 'Open Acorn Harvest' } },
  { waitForText: 'Acorn Harvest' },
];

/* Close whatever the last keystroke opened. Typing into the editor asks for
 * completion, which is right in the product and wrong in a picture of something
 * else. */
export const DISMISS = { key: { key: 'Escape', code: 'Escape' } };

/** A short BASIC program with a named procedure called from two places. */
export const SAMPLE_BASIC_PROCEDURES = [
  '10 REM Acorn workbench sample',
  '20 MODE 1',
  '30 PROCdraw(10, 10)',
  '40 PROCdraw(20, 14)',
  '50 END',
  '100 DEF PROCdraw(x%, y%)',
  '110 PRINT TAB(x%, y%); "*"',
  '120 ENDPROC',
].join('\n');

/*
 * A BASIC program with the line faults the diagnostics topic names: two lines
 * numbered 50, and a GOSUB to a line that was never written.
 */
export const SAMPLE_BASIC_LINE_FAULTS = [
  '10 REM Acorn workbench sample',
  '20 MODE 1',
  '30 GOSUB 500',
  '40 PRINT "BACK"',
  '50 PRINT "FIRST FIFTY"',
  '50 PRINT "SECOND FIFTY"',
  '60 GOTO 40',
  '70 END',
].join('\n');

/*
 * Supply the BBC Model B firmware the default profile asks for.
 *
 * These are real ROM images from the machine this runs on, handed to the same
 * file inputs a person uses. Nothing is stubbed: after this the emulator boots
 * for real, which is the only way a picture of a running machine can be honest.
 * The vault is cleared before every shot, so a picture that is meant to show an
 * unsupplied machine still shows one.
 */
const ROMS = resolve(dirname(fileURLToPath(import.meta.url)), '../local-roms/normalized');
export const SUPPLY_BBC_ROMS = [
  { workspace: 'Settings' },
  { waitFor: '.rom-workspace' },
  /* One at a time. The vault checks each image before it accepts the next, and
   * disables every Choose ROM control while it does, so handing all three over
   * at once loses two of them. */
  { files: { selector: '.rom-requirements section:nth-of-type(1) input[type="file"]', paths: [`${ROMS}/os.rom`] } },
  { waitFor: '.rom-requirements section:nth-of-type(1).supplied' },
  { files: { selector: '.rom-requirements section:nth-of-type(2) input[type="file"]', paths: [`${ROMS}/BASIC.ROM`] } },
  { waitFor: '.rom-requirements section:nth-of-type(2).supplied' },
  { files: { selector: '.rom-requirements section:nth-of-type(3) input[type="file"]', paths: [`${ROMS}/b/DFS-0.9.rom`] } },
  { waitFor: '.rom-requirements section:nth-of-type(3).supplied' },
  { waitForText: 'ROM SET READY' },
];

/* Everything a picture of a running Model B needs: firmware supplied, the
 * machine booted, and the workbench back on the source it was opened with. */
export const RUN_BBC = [
  ...SUPPLY_BBC_ROMS,
  { workspace: 'Code' },
  { waitForText: 'RUNNING' },
  { wait: 4000 },
];

/*
 * A two-file C project, written the way the topics describe one: a header the
 * other file includes, a typedef, a structure and a function declaration.
 */
export const SAMPLE_C_HEADER = [
  '#ifndef ACORN_API_H',
  '#define ACORN_API_H',
  '',
  'typedef unsigned char byte;',
  '',
  'struct Sprite {',
  '  byte x;',
  '  byte y;',
  '  byte frame;',
  '};',
  '',
  'void draw_sprite(struct Sprite *sprite, byte colour);',
  '',
  '#endif',
].join('\n');

export const SAMPLE_C_SOURCE = [
  '#include <acorn.h>',
  '#include "api.h"',
  '',
  'static struct Sprite player;',
  '',
  'void move_player(byte step) {',
  '  int drift = 0;',
  '  struct Sprite *target = &player;',
  '  target->x = target->x + step;',
  '  draw_sprite(target, 1);',
  '  acorn_oswrch(step);',
  '}',
].join('\n');

/* Create the header and the source, through the ordinary New file command. */
export const OPEN_C_PROJECT = [
  { prompt: 'api.h' },
  { clickText: { selector: 'button', text: 'File' } },
  { clickText: { selector: 'button', text: 'New file' } },
  { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_C_HEADER } },
  { prompt: 'main.c' },
  { clickText: { selector: 'button', text: 'File' } },
  { clickText: { selector: 'button', text: 'New file' } },
  { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_C_SOURCE } },
];

/* Build every target of the open project, from the control that says so. */
export const BUILD_ALL = [
  { workspace: 'Build targets' },
  { clickText: { selector: 'button', text: 'Build all' } },
  { waitForText: 'Build all finished' },
  { wait: 1200 },
];

/*
 * A source file over the 256 KiB the editor calls large, built from the same
 * shapes as the short sample so it reads like a real listing rather than
 * padding. Around 6,500 lines gets there.
 */
export const SAMPLE_BASIC_LARGE = Array.from(
  { length: 6500 },
  (_, index) => `${(index + 1) * 10} PRINT "ACORN WORKBENCH LINE ";${index + 1};" OF A LARGE LISTING"`,
).join('\n');

/*
 * The Archimedes firmware, which this machine holds only half of.
 *
 * The four byte lanes are in the MAME set at local-roms/mame/aa310.zip, and the
 * Archimedes vault accepts that ZIP directly. The 256-byte CMOS image it also
 * requires is an Arculator file rather than a MAME one, and no cmos_riscos3.bin
 * or cmos_riscos2.bin exists anywhere under local-roms on this machine; the
 * importer refuses a blank one, so nothing can stand in for it. The three
 * pictures that need a booted A310 therefore name what they need and are
 * reported as not attempted rather than quietly skipped or faked.
 */
const ARCHIMEDES_LANES = resolve(dirname(fileURLToPath(import.meta.url)), '../local-roms/mame/aa310.zip');
const ARCHIMEDES_CMOS = resolve(dirname(fileURLToPath(import.meta.url)), '../local-roms/arculator/cmos_riscos3.bin');

export const SUPPLY_A310_FIRMWARE = [
  { setValue: { selector: 'select[aria-label="Platform class"]', value: '32-bit' } },
  { wait: 900 },
  { workspace: 'Settings' },
  { waitFor: '.archimedes-rom-lanes' },
  { files: { selector: 'input[aria-label^="Import"]', paths: [ARCHIMEDES_LANES, ARCHIMEDES_CMOS] } },
  { waitForText: 'FIRMWARE READY' },
];

export const SHOTS = [
  {
    file: 'workbench-overview.png',
    topics: ['first-run', 'emulator'],
    steps: [],
    shows: ['Untitled Acorn Project', 'Inspector'],
  },
  {
    file: 'help-search.png',
    topics: ['using-help'],
    steps: [
      { workspace: 'Help' },
      { setValue: { selector: 'input[aria-label="Search in-app help"]', value: 'breakpoint' } },
    ],
    shows: ['Search help', 'breakpoint'],
  },
  {
    file: 'target-selection.png',
    topics: ['target-selection'],
    steps: [
      { waitFor: 'select[aria-label="Acorn system"]' },
      { scrollTo: 'select[aria-label="Acorn system"]' },
    ],
    shows: ['Machine setup', 'Capabilities'],
  },
  {
    file: 'rom-settings.png',
    topics: ['rom-import'],
    steps: [
      { workspace: 'Settings' },
      { waitFor: '.rom-workspace' },
      { scrollTo: '.rom-workspace' },
    ],
    shows: ['FIRMWARE VAULT'],
  },
  {
    file: 'appearance.png',
    topics: ['appearance'],
    steps: [
      { workspace: 'Settings' },
      { waitFor: '.appearance-panel' },
      { scrollTo: '.appearance-panel' },
    ],
    shows: ['Appearance', 'Theme', 'Contrast', 'Text size'],
  },
  {
    file: 'project-search.png',
    topics: ['projects'],
    steps: [
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC } },
      { workspace: 'Search' },
      { setValue: { selector: 'input[aria-label="Find in project"]', value: 'PRINT' } },
    ],
    shows: ['Search and replace across files', 'PRINT', 'Replace'],
  },
  {
    file: 'hardware-tests.png',
    topics: ['tests'],
    steps: [
      /* The empty project has no target a hardware test can be written against,
       * so this is the Harvest sample, which carries a real plan of its own. */
      ...OPEN_HARVEST,
      ...SUPPLY_BBC_ROMS,
      /* The plan belongs to the self-test target rather than the game, and the
       * workspace shows the plans of the target that is active. */
      { clickText: { selector: 'button.tree-item', text: 'Acorn Harvest self test' } },
      { workspace: 'Tests' },
      { wait: 1500 },
    ],
    shows: ['Acorn Harvest', 'Engine contract'],
  },
  {
    file: 'research-reference.png',
    topics: ['research'],
    steps: [
      { workspace: 'Research' },
      { setValue: { selector: 'input[aria-label="Search reference"]', value: 'MODE' } },
    ],
    /* The language filters and one command's detail, which is what the caption
     * says this picture is of. */
    shows: ['Acorn reference', 'Search reference', 'BBC BASIC', 'MODE'],
  },
  {
    file: 'build-targets.png',
    topics: ['build-targets'],
    steps: [
      /* An unbuilt project has no provenance and no diagnostics to show, so
       * this is the Harvest sample after a real build of both its targets. */
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      ...BUILD_ALL,
    ],
    shows: ['VERSIONED BUILD TARGET', 'Acorn Harvest game', 'Retain artifact', 'Analyse artifact', 'SUCCEEDED'],
  },
  {
    file: 'media-workspace.png',
    topics: ['media'],
    steps: [
      { workspace: 'Media' },
      { waitFor: 'section[aria-label="Edit DFS SSD image"]' },
      { scrollTo: { selector: 'section[aria-label="Edit DFS SSD image"]', block: 'top' } },
    ],
    /* The logical-file editor the caption is about, not whatever the workspace
     * happens to open on. */
    shows: ['DFS SSD/DSD logical-file editor', 'Format', 'Rebuild'],
  },
  {
    file: 'sprite-editor.png',
    topics: ['assets'],
    steps: [{ clickText: { selector: '.mode-tab', text: 'Sprites' } }],
    shows: ['Sprites editor', 'Animation frames', 'Palette index', 'Generated output'],
  },
  {
    file: 'editor-completion-snippet.png',
    topics: ['completion-snippets'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: `${SAMPLE_BASIC}\n120 FOR` } },
      { focus: 'textarea.source-textarea' },
      { key: { key: 'ArrowDown', code: 'ArrowDown' } },
    ],
    shows: ['FOR_LOOP', 'snippet', 'NEXT'],
  },
  {
    file: 'editor-token-help.png',
    topics: ['token-help'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button.tree-item', text: 'engine.asm' } },
      { caret: { selector: 'textarea.source-textarea', after: 'ADC' } },
    ],
    shows: ['ADC', 'FLAGS', 'CYCLES'],
  },
  {
    file: 'editor-context-completion.png',
    topics: ['context-completion'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button.tree-item', text: 'engine.asm' } },
      /* A branch wants a label, so this is the position where the editor has
       * the most to say about what may legally follow. */
      { type: { selector: 'textarea.source-textarea', text: '\n  BNE dr' } },
    ],
    shows: ['draw_map', 'draw_player', 'mos'],
  },
  {
    file: 'editor-symbol-navigation.png',
    topics: ['symbol-navigation'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { disclose: 'Project symbol selector' },
      { setValue: { selector: 'input[aria-label="Find project symbol"]', value: 'draw' } },
      { scrollTo: { selector: 'details.symbol-selector', block: 'top' } },
    ],
    shows: ['Find project symbol', 'draw_map', 'engine.asm'],
  },
  {
    file: 'editor-call-hierarchy.png',
    topics: ['call-hierarchy'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button.tree-item', text: 'engine.asm' } },
      /* draw_player is called from elsewhere and calls two routines of its
       * own, so the peek has something to show in both directions. */
      { caret: { selector: 'textarea.source-textarea', after: 'draw_player' } },
      { disclose: 'Navigate' },
      { clickText: { selector: 'button', text: 'Call hierarchy' } },
    ],
    shows: ['Incoming callers', 'Outgoing callees', 'draw_player', 'cell_address'],
  },
  {
    file: 'editor-signature-help.png',
    topics: ['signature-help'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: `${SAMPLE_BASIC}\n120 CALL &2000,` } },
      { clickText: { selector: 'button', text: 'Signature help' } },
    ],
    shows: ['SIGNATURE', 'CALL'],
  },
  {
    file: 'editor-source-comparison.png',
    topics: ['source-comparison'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button.tree-item', text: 'score.asm' } },
      /* One line added and one line rewritten, near the top of the file, so the
       * comparison opens on the changes rather than on identical text. */
      { type: { selector: 'textarea.source-textarea', text: '\n; Two packed BCD bytes, low byte first.', at: '; Acorn Harvest - score keeping and display.' } },
      { replace: { selector: 'textarea.source-textarea', find: '.add_score', text: '.add_to_score' } },
      { clickText: { selector: 'button', text: 'Compare saved' } },
    ],
    shows: ['SAVED BASELINE', 'WORKING COPY', 'added', 'removed'],
  },
  {
    file: 'editor-split-history.png',
    topics: ['editor-splits'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button', text: 'Split editor' } },
      /* Two panes on one file prove nothing. The second pane goes to the file
       * the first one calls into. */
      { clickText: { selector: 'button.tree-item', text: 'player.asm' } },
      { caret: { selector: 'textarea.source-textarea', after: '.move_check' } },
    ],
    shows: ['main.asm', 'player.asm', 'move_check'],
  },
  {
    file: 'editor-basic-numbering.png',
    topics: ['basic-numbering'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC } },
      /* Off the last token, or its documentation covers the source the preview
       * is about. */
      { caret: { selector: 'textarea.source-textarea', after: '10 REM' } },
      { key: { key: 'Escape', code: 'Escape' } },
      { clickText: { selector: 'button', text: 'Preview renumber' } },
    ],
    shows: ['renumber', 'Auto number after Enter'],
  },
  {
    file: 'go-to-source.png',
    topics: ['go-to-source'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button', text: 'Edit' } },
      { clickText: { selector: 'button', text: 'Go to line' } },
      { setValue: { selector: 'input[aria-label="File, symbol, line or address"]', value: 'cell' } },
    ],
    shows: ['Go to file, symbol, line or address', 'cell_address', 'engine.asm'],
  },
  {
    file: 'editor-clipboard-fallback.png',
    topics: ['clipboard-safety'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC } },
      DISMISS,
      { clickText: { selector: 'button', text: 'Paste plain text' } },
    ],
    shows: ['paste'],
  },
  {
    file: 'editor-intelligence.png',
    topics: ['editor'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button.tree-item', text: 'engine.asm' } },
      { caret: { selector: 'textarea.source-textarea', after: 'cell_address' } },
      { disclose: 'Navigate' },
      { clickText: { selector: 'button', text: 'References' } },
      { setValue: { selector: 'input[aria-label="Replacement symbol name"]', value: 'grid_address' } },
      { clickText: { selector: 'button', text: 'Preview rename' } },
    ],
    shows: ['cell_address', 'grid_address', 'Apply project rename'],
  },
  {
    file: 'editor-safe-rename-quick-fix.png',
    topics: ['safe-rename-quick-fixes'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC_PROCEDURES } },
      DISMISS,
      { caret: { selector: 'textarea.source-textarea', after: 'PROCdraw' } },
      { disclose: 'Navigate' },
      { clickText: { selector: 'button', text: 'References' } },
      { setValue: { selector: 'input[aria-label="Replacement symbol name"]', value: 'PROCrender' } },
      { clickText: { selector: 'button', text: 'Preview rename' } },
    ],
    shows: ['PROCdraw', 'PROCrender', 'Apply project rename'],
  },
  {
    file: 'editor-basic-range-renumber.png',
    topics: ['basic-range-renumber'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC } },
      DISMISS,
      { caret: { selector: 'textarea.source-textarea', after: '10 REM' } },
      { setValue: { selector: 'select[aria-label="BASIC renumber scope"]', value: 'range' } },
      /* Physical rows 7 to 9 hold 70, 100 and 110, and the GOSUB on row 6
       * outside the range refers into it, so the preview has to show both the
       * three renumbered lines and the reference it corrects. */
      { setValue: { selector: 'input[aria-label="BASIC renumber first physical line"]', value: '7' } },
      { setValue: { selector: 'input[aria-label="BASIC renumber last physical line"]', value: '9' } },
      /* Starting at 10 would land the range on numbers the lines above it
       * already use, and the preview refuses rather than colliding. */
      { setValue: { selector: 'input[aria-label="BASIC numbering start"]', value: '200' } },
      { clickText: { selector: 'button', text: 'Preview renumber' } },
    ],
    shows: ['3 lines', 'reference', 'SOURCE ROW'],
  },
  {
    file: 'editor-basic-line-diagnostics.png',
    topics: ['basic-line-diagnostics'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC_LINE_FAULTS } },
      DISMISS,
      /* Off the last statement: the caret's own documentation is not what this
       * picture is of. */
      { caret: { selector: 'textarea.source-textarea', after: '10 REM' } },
      { scrollTo: { selector: '.basic-reference-diagnostics', block: 'top' } },
    ],
    shows: ['line issue', 'LINE REFERENCES'],
  },
  {
    file: 'emulator-power-speed.png',
    topics: ['emulator-power-speed'],
    steps: [
      ...SUPPLY_BBC_ROMS,
      { workspace: 'Code' },
      /* Long enough for the machine to boot and print its banner, which is what
       * proves the picture is of a running machine and not of a black canvas. */
      { waitForText: 'RUNNING' },
      { wait: 4000 },
      { setValue: { selector: 'select[aria-label="Runtime speed"]', value: '2' } },
      { wait: 2000 },
    ],
    shows: ['RUNNING', 'Runtime speed', 'Framebuffer scaling'],
  },
  {
    file: 'emulator-audio-filter.png',
    topics: ['emulator-audio-filter'],
    steps: [
      ...RUN_BBC,
      { setValue: { selector: 'select[aria-label="Framebuffer filter"]', value: 'linear' } },
      { wait: 1200 },
    ],
    shows: ['audio muted', 'SMOOTH', 'Machine volume'],
  },
  {
    file: 'emulator-display-effects.png',
    topics: ['emulator-display-effects'],
    steps: [
      ...RUN_BBC,
      { setValue: { selector: 'select[aria-label="Display presentation effect"]', value: 'soft-crt' } },
      { wait: 1500 },
    ],
    shows: ['SOFT CRT', 'RUNNING'],
  },
  {
    file: 'emulator-display-scaling.png',
    topics: ['emulator-display-scaling'],
    steps: [
      ...RUN_BBC,
      { setValue: { selector: 'select[aria-label="Framebuffer scaling"]', value: '1x' } },
      { wait: 1500 },
    ],
    shows: ['RUNNING', 'Framebuffer scaling'],
  },
  {
    file: 'emulator-session-provenance.png',
    topics: ['emulator-session-provenance'],
    steps: [
      ...RUN_BBC,
      { disclose: 'SESSION' },
      { wait: 800 },
    ],
    shows: ['ROM digests', 'exact resolved profile'],
  },
  {
    file: 'emulator-keyboard-input.png',
    topics: ['emulator-keyboard-input'],
    steps: [
      ...RUN_BBC,
      { clickText: { selector: 'button.emulator-input-button', text: 'KEYS' } },
      { wait: 900 },
    ],
    shows: ['Machine input', 'keyboard'],
  },
  {
    file: 'emulator-wav-capture.png',
    topics: ['emulator-wav-capture'],
    steps: [
      ...RUN_BBC,
      { click: 'button[aria-label="Enable machine audio"]' },
      { wait: 1200 },
      { click: 'button[aria-label="Start machine audio capture"]' },
      { wait: 1800 },
    ],
    shows: ['RUNNING'],
  },
  {
    file: 'emulator-machine-state.png',
    topics: ['emulator-machine-state'],
    steps: [
      ...RUN_BBC,
      { click: 'button[aria-label="Save machine state"]' },
      { wait: 2500 },
    ],
    shows: ['Machine state v1 saved', 'ROM digests'],
  },
  {
    file: 'emulator-storage-quota.png',
    topics: ['emulator-storage-quota'],
    steps: [
      ...SUPPLY_BBC_ROMS,
      /* Long enough for the machine below to boot on the firmware just stored,
       * so a panel about stored ROMs is not photographed beside a machine
       * saying its ROM set is not ready. */
      { workspace: 'Code' },
      { waitForText: 'RUNNING' },
      { wait: 3000 },
      { workspace: 'Settings' },
      { waitFor: 'section[aria-label="Browser storage quota"]' },
      { disclose: 'Browser-reported usage categories' },
      { scrollTo: { selector: 'section[aria-label="Browser storage quota"]', block: 'top' } },
    ],
    shows: ['quota', 'IndexedDB'],
  },
  {
    file: 'emulator-key-remap.png',
    topics: ['emulator-key-remap'],
    steps: [
      ...RUN_BBC,
      { clickText: { selector: 'button.emulator-input-button', text: 'KEYS' } },
      { wait: 900 },
      { scrollTo: { selector: '.machine-key-remaps', block: 'top' } },
    ],
    shows: ['Custom key mappings', 'HOST KEY'],
  },
  {
    file: 'emulator-gamepad.png',
    topics: ['emulator-gamepad'],
    steps: [
      ...RUN_BBC,
      { clickText: { selector: 'button.emulator-input-button', text: 'KEYS' } },
      { wait: 900 },
      { scrollTo: { selector: '.machine-gamepad', block: 'top' } },
    ],
    shows: ['gamepad'],
  },
  {
    file: 'emulator-program-provenance.png',
    topics: ['emulator-program-provenance'],
    steps: [
      ...OPEN_HARVEST,
      ...SUPPLY_BBC_ROMS,
      { workspace: 'Code' },
      { waitForText: 'RUNNING' },
      { clickText: { selector: 'button', text: 'Build' } },
      { clickText: { selector: 'button', text: 'Build and run' } },
      { waitForText: 'PROGRAM' },
      { wait: 3000 },
      { disclose: 'PROGRAM' },
      { wait: 800 },
    ],
    shows: ['PROGRAM', 'acorn-harvest'],
  },
  {
    file: 'editor-c-member-completion.png',
    topics: ['c-scope-completion'],
    steps: [
      HIDE_RUNTIME,
      ...OPEN_C_PROJECT,
      /* Inside the function, where the pointer is in scope. An arrow leaves no
       * prefix behind it, so completion is asked for rather than automatic. */
      { type: { selector: 'textarea.source-textarea', text: '\n  target->', at: 'struct Sprite *target = &player;' } },
      { clickText: { selector: 'button', text: 'Suggest completions' } },
    ],
    shows: ['frame', 'Sprite'],
  },
  {
    file: 'editor-c-type-hints.png',
    topics: ['source-type-hints'],
    steps: [
      HIDE_RUNTIME,
      ...OPEN_C_PROJECT,
      DISMISS,
      /* Authoritative C type sizes come from the active toolchain, so the
       * project needs a cc65 target with main.c as its entry before the hints
       * can say anything an author should rely on. */
      { workspace: 'Build targets' },
      { clickText: { selector: 'button', text: 'New target' } },
      { wait: 700 },
      { workspace: 'Code' },
      { disclose: 'Preferences' },
      { click: 'input[aria-label="Decorate type hints beside the source"]' },
      { conceal: 'Preferences' },
      { caret: { selector: 'textarea.source-textarea', after: 'int drift' } },
      { click: '.type-hints-toggle input' },
      { wait: 600 },
      { scrollTo: { selector: '.source-type-hints', block: 'top' } },
    ],
    shows: ['TYPE HINTS', 'drift', '2 bytes'],
  },
  {
    file: 'editor-c-relationships.png',
    topics: ['c-source-relationships'],
    steps: [
      HIDE_RUNTIME,
      ...OPEN_C_PROJECT,
      DISMISS,
      { caret: { selector: 'textarea.source-textarea', after: 'void move_player(byte' } },
      { disclose: 'Navigate' },
      { clickText: { selector: 'button', text: 'Type definition' } },
      { wait: 700 },
    ],
    shows: ['api.h', 'byte'],
  },
  {
    file: 'editor-completion-validity.png',
    topics: ['language-request-safety'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: `${SAMPLE_BASIC}\n120 PR` } },
    ],
    shows: ['PRINT', 'command'],
  },
  {
    file: 'editor-completion-unavailable.png',
    topics: ['completion-interaction'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'select[aria-label="Acorn system"]', value: 'atom' } },
      { wait: 900 },
      { setValue: { selector: 'textarea.source-textarea', value: '10 REM Acorn workbench sample\n20 SOU' } },
      { clickText: { selector: 'button', text: 'Suggest completions' } },
      { wait: 900 },
    ],
    shows: ['SOUND', 'UNAVAILABLE'],
  },
  {
    file: 'editor-source-navigation.png',
    topics: ['source-navigation-workflow'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC } },
      DISMISS,
      { caret: { selector: 'textarea.source-textarea', after: '40   PRINT' } },
    ],
    shows: ['SCOPE', 'FOR'],
  },
  {
    file: 'editor-target-navigation.png',
    topics: ['target-navigation'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC } },
      DISMISS,
      { caret: { selector: 'textarea.source-textarea', after: '60 GOSUB 10', click: true } },
      { wait: 700 },
    ],
    shows: ['Numbered line declared at main.bas:8', 'GOSUB 100'],
  },
  {
    file: 'editor-bookmark-privacy.png',
    topics: ['bookmarks'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      { clickText: { selector: 'button', text: 'Project' } },
      { clickText: { selector: 'button', text: 'Export...' } },
      { wait: 900 },
    ],
    shows: ['bookmark'],
  },
  {
    file: 'editor-generated-read-only.png',
    topics: ['source-provenance'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      ...BUILD_ALL,
      { clickText: { selector: 'button.tree-item', text: 'acorn-harvest.bin.listing.txt' } },
      { wait: 800 },
    ],
    shows: ['GENERATED', 'READ ONLY'],
  },
  {
    file: 'editor-generated-symbol-navigation.png',
    topics: ['generated-symbol-navigation'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      ...BUILD_ALL,
      { clickText: { selector: 'button.tree-item', text: 'acorn-harvest.bin.source-map.txt' } },
      { wait: 800 },
    ],
    shows: ['READ ONLY', 'source-map'],
  },
  {
    file: 'analysis-disassembly.png',
    topics: ['analysis'],
    steps: [
      ...OPEN_HARVEST,
      HIDE_RUNTIME,
      ...BUILD_ALL,
      { clickText: { selector: 'button', text: 'Analyse artifact' } },
      { wait: 1500 },
      { clickText: { selector: 'button', text: 'Re-analyse' } },
      { wait: 4000 },
    ],
    shows: ['acorn-harvest.bin', 'JSR'],
  },
  {
    file: 'debugger-6502.png',
    topics: ['debugger-6502'],
    steps: [
      ...OPEN_HARVEST,
      ...SUPPLY_BBC_ROMS,
      { workspace: 'Code' },
      { waitForText: 'RUNNING' },
      { clickText: { selector: 'button', text: 'Debug' } },
      { clickText: { selector: 'button', text: 'Build and debug' } },
      { wait: 4000 },
      { workspace: 'Debugger' },
      { wait: 1500 },
    ],
    shows: ['session', 'ROM'],
  },
  {
    file: 'emulator-media-eject.png',
    topics: ['emulator-media-eject'],
    steps: [
      ...RUN_BBC,
      { workspace: 'Media' },
      { waitFor: 'section[aria-label="Edit DFS SSD image"]' },
      { clickText: { selector: 'button', text: 'New blank image' } },
      { wait: 1200 },
      { clickText: { selector: 'button', text: 'Rebuild / validate' } },
      { wait: 1500 },
      { clickText: { selector: 'button', text: 'Mount disk' } },
      { waitForText: 'Accepted' },
      { wait: 1200 },
      { scrollTo: { selector: '.mounted-media-list', block: 'top' } },
    ],
    shows: ['Eject', 'Accepted'],
  },
  {
    file: 'editor-source-format-large.png',
    topics: ['source-text-format'],
    steps: [
      HIDE_RUNTIME,
      { setValue: { selector: 'textarea.source-textarea', value: SAMPLE_BASIC_LARGE } },
      DISMISS,
      { setValue: { selector: 'select[aria-label="Source encoding for main.bas"]', value: 'windows-1252' } },
      { setValue: { selector: 'select[aria-label="Line endings for main.bas"]', value: 'crlf' } },
      { wait: 1200 },
    ],
    shows: ['Windows-1252', 'CRLF'],
  },
  {
    file: 'editor-sdk-navigation.png',
    topics: ['sdk-document-navigation'],
    steps: [
      HIDE_RUNTIME,
      ...OPEN_C_PROJECT,
      DISMISS,
      /* The cc65 target is what makes the SDK the one this build would compile
       * against rather than a guess. */
      { workspace: 'Build targets' },
      { clickText: { selector: 'button', text: 'New target' } },
      { wait: 700 },
      { workspace: 'Code' },
      { caret: { selector: 'textarea.source-textarea', after: '  acorn_oswrch' } },
      { disclose: 'Navigate' },
      { clickText: { selector: 'button', text: 'Definition / Research' } },
      { wait: 2500 },
    ],
    shows: ['acorn.h', 'READ ONLY'],
  },
  {
    file: 'editor-target-reference-completion.png',
    topics: ['target-reference-completion'],
    steps: [
      HIDE_RUNTIME,
      /* RISC OS SWIs belong to a 32-bit Acorn, and the completion is filtered by
       * the selected machine, so the target profile comes first. */
      { setValue: { selector: 'select[aria-label="Platform class"]', value: '32-bit' } },
      { wait: 900 },
      { prompt: 'main.arm' },
      { clickText: { selector: 'button', text: 'File' } },
      { clickText: { selector: 'button', text: 'New file' } },
      { setValue: { selector: 'textarea.source-textarea', value: '  .text\n  .global _start\n_start:\n  SWI OS_Wri' } },
      { clickText: { selector: 'button', text: 'Suggest completions' } },
      { wait: 1200 },
    ],
    shows: ['SWI', 'OS_Write'],
  },
  {
    file: 'emulator-guest-disk-export.png',
    topics: ['emulator-guest-disk-export'],
    steps: [
      ...RUN_BBC,
      { workspace: 'Media' },
      { waitFor: 'section[aria-label="Edit DFS SSD image"]' },
      { clickText: { selector: 'button', text: 'New blank image' } },
      { wait: 1200 },
      { clickText: { selector: 'button', text: 'Rebuild / validate' } },
      { wait: 1500 },
      { clickText: { selector: 'button', text: 'Mount disk' } },
      { waitForText: 'Accepted' },
      { wait: 1500 },
      /* The guest writes to the disc itself: a short program saved from BASIC
       * through the live FDC, which is the only thing that can mark the image
       * as modified by the machine rather than by this workbench. */
      { clickText: { selector: 'button.emulator-input-button', text: 'KEYS' } },
      { wait: 900 },
      { setValue: { selector: '#machine-input-controls textarea', value: '10 PRINT "GUEST"\nSAVE "TEST"\n' } },
      { clickText: { selector: 'button', text: 'Queue text to live machine' } },
      { wait: 6000 },
      { click: 'button[aria-label="Close machine input controls"]' },
      { wait: 1500 },
      { scrollTo: { selector: '.mounted-media-list', block: 'top' } },
    ],
    shows: ['GUEST MODIFIED', 'Export current'],
  },
  {
    file: 'emulator-bbc-mouse-joystick.png',
    topics: ['emulator-bbc-mouse-joystick'],
    steps: [
      ...RUN_BBC,
      { clickText: { selector: 'button.emulator-input-button', text: 'KEYS' } },
      { wait: 900 },
      { scrollTo: { selector: '.machine-bbc-mouse-joystick', block: 'top' } },
    ],
    shows: ['analogue'],
  },
  {
    file: 'emulator-atom-atommc.png',
    topics: ['emulator-atom-atommc'],
    steps: [
      { setValue: { selector: 'select[aria-label="Acorn system"]', value: 'atom' } },
      { wait: 900 },
      { workspace: 'Settings' },
      { waitFor: '.rom-workspace' },
      { files: { selector: '.rom-requirements section:nth-of-type(1) input[type="file"]', paths: [`${ROMS}/atom/Atom_Kernel.rom`] } },
      { waitFor: '.rom-requirements section:nth-of-type(1).supplied' },
      { files: { selector: '.rom-requirements section:nth-of-type(2) input[type="file"]', paths: [`${ROMS}/atom/Atom_Basic.rom`] } },
      { waitFor: '.rom-requirements section:nth-of-type(2).supplied' },
      { waitForText: 'ROM SET READY' },
      { workspace: 'Code' },
      { wait: 5000 },
      { clickText: { selector: 'button.emulator-input-button', text: 'KEYS' } },
      { wait: 900 },
    ],
    shows: ['Machine input', 'Atom'],
  },
  {
    file: 'emulator-a310-mouse.png',
    topics: ['emulator-a310-mouse'],
    needs: [ARCHIMEDES_LANES, ARCHIMEDES_CMOS],
    steps: [
      ...SUPPLY_A310_FIRMWARE,
      { workspace: 'Code' },
      { waitForText: 'RUNNING' },
      { wait: 8000 },
      { clickText: { selector: 'button.emulator-input-button', text: 'KEYS' } },
      { wait: 900 },
      { scrollTo: { selector: '.machine-a310-mouse', block: 'top' } },
    ],
    shows: ['mouse'],
  },
  {
    file: 'emulator-a310-wav-capture.png',
    topics: ['emulator-a310-wav-capture'],
    needs: [ARCHIMEDES_LANES, ARCHIMEDES_CMOS],
    steps: [
      ...SUPPLY_A310_FIRMWARE,
      { workspace: 'Code' },
      { waitForText: 'RUNNING' },
      { wait: 8000 },
      { click: 'button[aria-label="Enable machine audio"]' },
      { wait: 1200 },
      { click: 'button[aria-label="Start machine audio capture"]' },
      { wait: 1800 },
    ],
    shows: ['REC'],
  },
  {
    file: 'debugger-arm.png',
    topics: ['debugger-arm'],
    needs: [ARCHIMEDES_LANES, ARCHIMEDES_CMOS],
    steps: [
      ...SUPPLY_A310_FIRMWARE,
      { workspace: 'Debugger' },
      { wait: 2500 },
    ],
    shows: ['ARM'],
  },
];
