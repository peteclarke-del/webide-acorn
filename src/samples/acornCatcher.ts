import type { SampleProject } from './sampleProjects';

const MAIN_BAS = `   10 REM Acorn Catcher - 8bit-net Dev sample
   20 REM Catch the falling acorns in the basket.
   30 REM Move with Z and X or the cursor keys.
   40 REM Press ESCAPE to stop.
   50 MODE 5
   60 PROCcharacters
   70 PROCsounds
   80 PROCnewgame
   90 REPEAT
  100 PROCinput
  110 PROCdrop
  120 PROCshow
  130 pause%=INKEY(speed%)
  140 UNTIL lives%=0
  150 PROCgameover
  160 END
  200 REM --- Set up the display characters -------------------------------
  210 DEF PROCcharacters
  220 VDU 23,224,&18,&3C,&7E,&7E,&3C,&18,&18,&00
  230 VDU 23,225,&00,&00,&81,&81,&C3,&7E,&3C,&00
  240 VDU 23,1,0;0;0;0;
  250 ENDPROC
  300 REM --- Sound envelopes --------------------------------------------
  310 DEF PROCsounds
  320 ENVELOPE 1,1,0,0,0,0,0,0,126,-6,0,-6,126,60
  330 ENDPROC
  400 REM --- Start a new game -------------------------------------------
  410 DEF PROCnewgame
  420 score%=0
  430 lives%=3
  440 speed%=6
  450 bx%=9
  460 ox%=9
  470 PROCnewacorn
  480 CLS
  490 ENDPROC
  500 REM --- Place the next acorn at the top ----------------------------
  510 DEF PROCnewacorn
  520 ax%=RND(19)-1
  530 ay%=0
  540 ENDPROC
  600 REM --- Read the steering keys -------------------------------------
  610 DEF PROCinput
  620 step%=0
  630 IF INKEY(-98) THEN step%=-1
  640 IF INKEY(-26) THEN step%=-1
  650 IF INKEY(-67) THEN step%=1
  660 IF INKEY(-122) THEN step%=1
  670 bx%=bx%+step%
  680 IF bx%<0 THEN bx%=0
  690 IF bx%>18 THEN bx%=18
  700 ENDPROC
  800 REM --- Move the falling acorn -------------------------------------
  810 DEF PROCdrop
  820 PRINT TAB(ax%,ay%);" ";
  830 ay%=ay%+1
  840 IF ay%>27 THEN PROCland ELSE PRINT TAB(ax%,ay%);CHR$(224);
  850 ENDPROC
  900 REM --- Decide whether the acorn was caught ------------------------
  910 DEF PROCland
  920 IF ABS(ax%-bx%)<2 THEN PROCcatch ELSE PROCmiss
  930 PROCnewacorn
  940 ENDPROC
 1000 DEF PROCcatch
 1010 score%=score%+10
 1020 SOUND 1,1,180,3
 1030 IF speed%>2 THEN speed%=speed%-1
 1040 ENDPROC
 1100 DEF PROCmiss
 1110 lives%=lives%-1
 1120 SOUND 1,1,60,8
 1130 ENDPROC
 1200 REM --- Redraw the basket and the status line ----------------------
 1210 DEF PROCshow
 1220 IF bx%<>ox% THEN PRINT TAB(ox%,28);" ";
 1230 ox%=bx%
 1240 PRINT TAB(bx%,28);CHR$(225);
 1250 PRINT TAB(0,31);"SCORE ";score%;" LIVES ";lives%;" ";
 1260 ENDPROC
 1300 REM --- Final screen ----------------------------------------------
 1310 DEF PROCgameover
 1320 VDU 23,1,1;0;0;0;
 1330 PRINT TAB(5,14);"GAME OVER"
 1340 PRINT TAB(4,16);"SCORE ";score%
 1350 SOUND 1,1,100,20
 1360 ENDPROC
`;

export const ACORN_CATCHER: SampleProject = {
  id: 'acorn-catcher',
  name: 'Acorn Catcher',
  language: 'BBC BASIC II',
  machine: 'BBC Model B · OS 1.20 · MODE 5',
  summary: 'A short arcade game in structured BBC BASIC II with user-defined graphics, a sound envelope and procedure-per-job layout.',
  highlights: [
    'Builds through the BBC BASIC II tokenizer to a real tokenized program rather than a text listing.',
    'Defines its two display characters with VDU 23 and shapes its notes with ENVELOPE.',
    'Uses DEF PROC blocks, REPEAT/UNTIL and integer variables, so completion, signature help and the outline all have real structure to work with.',
    'Reads Z, X and the cursor keys through negative INKEY rather than blocking on input.',
  ],
  requiresRoms: true,
  project: {
    format: '8bit-net-dev-project-21',
    name: 'Acorn Catcher',
    files: [{ id: 'main.bas', name: 'main.bas', content: MAIN_BAS }].map((file) => ({ ...file, language: 'bbc-basic' as const, modified: false, saved: true, savedName: file.name, savedContent: file.content, encoding: 'utf-8' as const, lineEnding: 'lf' as const, kind: 'authored' as const, access: 'editable' as const })),
    target: { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'Model B · 8271 DFS', romId: 'os12-basic2-dfs', enabledCapabilities: ['dfs', 'sideways'] },
    breakpoints: {},
    bookmarks: [
      { id: 'catcher-loop', fileId: 'main.bas', line: 9, column: 1, name: 'Main loop', description: 'Input, drop, redraw and pace the frame.', scope: 'project', enabled: true, anchor: 'REPEAT' },
    ],
    buildTargets: [
      { schemaVersion: 5, id: 'catcher-game', name: 'Acorn Catcher', entryFileId: 'main.bas', sourceFileIds: ['main.bas'], toolchainId: '8bit-net.basic.bbc2', outputName: 'acorn-catcher.bbc' },
    ],
    activeBuildTargetId: 'catcher-game',
    testPlans: [],
    armBreakpoints: {}, armBreakpointGroups: {}, breakpoints6502: {}, breakpointGroups6502: {}, analysisAnnotations: {}, diskSets: [], settings: {}, trash: [],
  },
};
