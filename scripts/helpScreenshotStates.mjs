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
];
