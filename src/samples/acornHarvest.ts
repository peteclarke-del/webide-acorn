import type { SampleProject } from './sampleProjects';

const MAIN_ASM = `; Acorn Harvest - a BBC Model B maze collection game in MODE 5.
;
; Guide the forager around the maze with the cursor keys and pick up every
; acorn. Each acorn scores ten points and plays a note; clearing the maze
; prints a message and plays a fanfare.
;
; Build this file with the browser-local 6502 assembler. The companion
; selftest.asm target proves the engine routines on the same real hardware.

ORG &1900

.start
  JSR set_mode
  JSR draw_map
  JSR init_state
  JSR draw_player
  JSR show_score
.game_ready
.main_loop
  JSR wait_vsync
  JSR read_input
  CMP #&FF
  BEQ frame_end
  JSR try_move
.frame_end
  LDA &7A
  BNE main_loop
  JSR finished
.halt
  JMP halt

; Scan the four cursor keys with OSBYTE 129 and return the first direction that
; is held, or &FF when none of them is.
.read_input
  LDX #0
.read_input_loop
  STX &7B
  LDA key_codes,X
  TAX
  LDY #&FF
  LDA #129
  JSR &FFF4
  CPX #&FF
  BNE read_input_next
  CPY #&FF
  BNE read_input_next
  LDA &7B
  RTS
.read_input_next
  LDX &7B
  INX
  CPX #4
  BNE read_input_loop
  LDA #&FF
  RTS

.finished
  LDX #0
.finished_loop
  LDA done_text,X
  JSR &FFEE
  INX
  CPX #done_text_end - done_text
  BNE finished_loop
  JMP sound_fanfare

; Negative INKEY numbers for the cursor keys, held as their two's-complement
; low byte: up -58, down -42, left -26 and right -122.
.key_codes
  EQUB &C6, &D6, &E6, &86

.done_text
  EQUB 31, 4, 28
  EQUS "WELL DONE!"
.done_text_end

INCLUDE "screen.asm"
INCLUDE "engine.asm"
INCLUDE "player.asm"
INCLUDE "score.asm"
INCLUDE "sound.asm"
INCLUDE "level.asm"

INCLUDEASSET "player.asset.json"
`;
const SELFTEST_ASM = `; Acorn Harvest - on-hardware self test.
;
; This target links the same engine, player, score, sound and level modules as
; the game and exercises them on the real machine, writing each observation to
; the results block. The Tests workspace stops at selftest_done and compares
; those bytes, so every expectation is checked against genuine 6502 execution
; rather than a model of it.

ORG &1900

.selftest
  JSR set_mode
  JSR clear_results

  ; Grid cell (0,0) is the first block of grid row 0.
  LDA #0
  STA &74
  STA &75
  JSR cell_address
  LDA &70
  STA results
  LDA &71
  STA results + 1

  ; Grid cell (9,11) is the last cell of the play field.
  LDA #9
  STA &74
  LDA #11
  STA &75
  JSR cell_address
  LDA &70
  STA results + 2
  LDA &71
  STA results + 3

  ; Map offsets are row * 10 + column.
  LDA #3
  STA &80
  LDA #4
  STA &81
  JSR map_offset
  STA results + 4

  ; Two awards must carry through decimal mode to a score of 20.
  LDA #0
  STA &78
  STA &79
  JSR add_score
  JSR add_score
  LDA &78
  STA results + 5
  LDA &79
  STA results + 6

  ; The acorns present in the map must match the declared total.
  LDX #0
  LDY #0
.count_loop
  LDA map_level_layer0,X
  CMP #2
  BNE count_next
  INY
.count_next
  INX
  CPX #120
  BNE count_loop
  STY results + 7
  LDA level_acorns
  STA results + 8

  ; The declared start cell must be clear ground.
  LDA level_start_column
  STA &80
  LDA level_start_row
  STA &81
  JSR map_offset
  TAY
  LDA map_level_layer0,Y
  STA results + 9

  ; Moving up from the start collects the acorn above it.
  JSR init_state
  LDA #0
  JSR try_move
  LDA &74
  STA results + 10
  LDA &75
  STA results + 11
  LDA &7A
  STA results + 12
  LDA &78
  STA results + 13
  LDA map_level_layer0 + 51
  STA results + 14

  ; Walking into the outer wall must be refused and change nothing.
  LDA #2
  JSR try_move
  LDA &74
  STA results + 15
  LDA &75
  STA results + 16

  ; The move left the screen pointer on the new cell, and the first byte there
  ; must be the first packed byte of animation frame 0.
  LDA &70
  STA results + 17
  LDA &71
  STA results + 18
  LDY #0
  LDA (&70),Y
  STA results + 19

  ; A successful move advances the animation frame.
  LDA &7E
  STA results + 20

.selftest_done
  RTS

.clear_results
  LDA #0
  LDX #31
.clear_results_loop
  STA results,X
  DEX
  BPL clear_results_loop
  RTS

.results
  SKIP 32

INCLUDE "screen.asm"
INCLUDE "engine.asm"
INCLUDE "player.asm"
INCLUDE "score.asm"
INCLUDE "sound.asm"
INCLUDE "level.asm"

INCLUDEASSET "player.asset.json"
`;
const SCREEN_ASM = `; Acorn Harvest - display setup shared by the game and its self test.

.set_mode
  LDX #0
.set_mode_loop
  LDA vdu_setup,X
  JSR &FFEE
  INX
  CPX #vdu_setup_end - vdu_setup
  BNE set_mode_loop
  RTS

; OSBYTE 19 returns at the next vertical sync, which paces the game at 50 Hz
; without a timing loop that would depend on the host machine.
.wait_vsync
  LDA #19
  JMP &FFF4

; VDU 22,5 selects MODE 5; VDU 23,1,0;0;0;0; hides the text cursor.
.vdu_setup
  EQUB 22, 5
  EQUB 23, 1, 0, 0, 0, 0, 0, 0, 0, 0
.vdu_setup_end
`;
const ENGINE_ASM = `; Acorn Harvest - shared screen engine for the BBC Model B in MODE 5.
;
; MODE 5 stores the screen as 8-byte blocks. One block is 4 pixels wide and 8
; rows tall, so an 8x8 sprite occupies two adjacent blocks:
;   block address = &5800 + block_row * 320 + block_column * 8
; The play grid is 10 columns by 12 rows of 8x8 cells starting at block row 8,
; so grid cell (gx, gy) begins at row_high/row_low[gy] + gx * 16.
;
; Zero-page workspace. The BBC reserves &70-&8F for user machine code, and this
; assembler only selects zero-page addressing for literal operands, so the
; workspace is addressed by literal address throughout.
;   &70/&71  screen address of the current cell
;   &72/&73  address of the sprite pixels being plotted
;   &74      player grid column          &75  player grid row
;   &78/&79  score packed as BCD         &7A  acorns still on the map
;   &7B      loop scratch                &7C  loop scratch
;   &7D      requested direction        &7E  current player animation frame
;   &80      candidate column            &81  candidate row
;   &82      tile under the candidate cell

; Point &70/&71 at the grid cell named by &74 (column) and &75 (row).
.cell_address
  LDX &75
  LDA row_low,X
  STA &70
  LDA row_high,X
  STA &71
  LDA &74
  ASL A
  ASL A
  ASL A
  ASL A
  CLC
  ADC &70
  STA &70
  BCC cell_address_done
  INC &71
.cell_address_done
  RTS

; Copy the 16 packed bytes at &72/&73 into the two blocks at &70/&71.
; The generated asset stores each pixel row as a left byte then a right byte,
; while the screen wants all eight left bytes and then all eight right bytes.
.plot_sprite
  LDX #0
.plot_sprite_row
  TXA
  ASL A
  TAY
  LDA (&72),Y
  STA &7B
  INY
  LDA (&72),Y
  STA &7C
  TXA
  TAY
  LDA &7B
  STA (&70),Y
  TYA
  CLC
  ADC #8
  TAY
  LDA &7C
  STA (&70),Y
  INX
  CPX #8
  BNE plot_sprite_row
  RTS

.erase_cell
  LDA #0
  LDY #15
.erase_cell_loop
  STA (&70),Y
  DEY
  BPL erase_cell_loop
  RTS

; Map index of the candidate cell in &80/&81, returned in A as row * 10 + column.
.map_offset
  LDA &81
  ASL A
  STA &7B
  ASL A
  ASL A
  CLC
  ADC &7B
  CLC
  ADC &80
  RTS

; The player is an animated sprite, so its pixel pointer comes from the frame
; table the asset pipeline generates. Each entry is a pixel pointer, a mask
; pointer, a two-byte hotspot and a two-byte duration: eight bytes per frame.
; This plotter copies the block opaquely and does not read the generated mask.
.select_player
  LDA &7E
  ASL A
  ASL A
  ASL A
  TAY
  LDA asset_player_frames,Y
  STA &72
  INY
  LDA asset_player_frames,Y
  STA &73
  RTS

.select_acorn
  LDA #<asset_acorn_pixels
  STA &72
  LDA #>asset_acorn_pixels
  STA &73
  RTS

.select_wall
  LDA #<asset_wall_pixels
  STA &72
  LDA #>asset_wall_pixels
  STA &73
  RTS

.draw_player
  JSR cell_address
  JSR select_player
  JMP plot_sprite

; Draw every map cell. This uses &74/&75 as scratch, so the caller places the
; player afterwards.
.draw_map
  LDA #0
  STA &81
.draw_map_row
  LDA #0
  STA &80
.draw_map_column
  JSR map_offset
  TAY
  LDA map_level_layer0,Y
  STA &82
  LDA &80
  STA &74
  LDA &81
  STA &75
  JSR cell_address
  LDA &82
  BEQ draw_map_empty
  CMP #1
  BEQ draw_map_wall
  JSR select_acorn
  JSR plot_sprite
  JMP draw_map_next
.draw_map_wall
  JSR select_wall
  JSR plot_sprite
  JMP draw_map_next
.draw_map_empty
  JSR erase_cell
.draw_map_next
  INC &80
  LDA &80
  CMP #10
  BNE draw_map_column
  INC &81
  LDA &81
  CMP #12
  BNE draw_map_row
  RTS

; Screen address of the first block of each grid row: &5800 + (8 + row) * 320.
.row_low
  EQUB &00, &40, &80, &C0, &00, &40, &80, &C0, &00, &40, &80, &C0
.row_high
  EQUB &62, &63, &64, &65, &67, &68, &69, &6A, &6C, &6D, &6E, &6F
`;
const PLAYER_ASM = `; Acorn Harvest - player state and movement rules.
;
; Directions are 0 up, 1 down, 2 left and 3 right. try_move returns with the
; carry clear when the player moved and set when the move was refused.

.init_state
  LDA level_start_column
  STA &74
  LDA level_start_row
  STA &75
  LDA #0
  STA &78
  STA &79
  STA &7E
  LDA level_acorns
  STA &7A
  RTS

.try_move
  STA &7D
  LDA &74
  STA &80
  LDA &75
  STA &81
  LDA &7D
  BEQ move_up
  CMP #1
  BEQ move_down
  CMP #2
  BEQ move_left
  LDA &80
  CMP #9
  BCS move_reject
  INC &80
  JMP move_check
.move_up
  LDA &81
  BEQ move_reject
  DEC &81
  JMP move_check
.move_down
  LDA &81
  CMP #11
  BCS move_reject
  INC &81
  JMP move_check
.move_left
  LDA &80
  BEQ move_reject
  DEC &80
.move_check
  JSR map_offset
  TAY
  LDA map_level_layer0,Y
  CMP #1
  BEQ move_reject
  CMP #2
  BNE move_apply
  LDA #0
  STA map_level_layer0,Y
  JSR add_score
  DEC &7A
  JSR sound_pickup
.move_apply
  JSR cell_address
  JSR erase_cell
  LDA &80
  STA &74
  LDA &81
  STA &75
  LDA &7E
  EOR #1
  STA &7E
  JSR draw_player
  JSR show_score
  CLC
  RTS
.move_reject
  SEC
  RTS
`;
const SCORE_ASM = `; Acorn Harvest - score keeping and display.
;
; The score is held as two packed binary-coded-decimal bytes so that the 6502
; decimal mode does the carrying and printing is a nibble-to-digit conversion.

.add_score
  SED
  CLC
  LDA &78
  ADC #&10
  STA &78
  LDA &79
  ADC #0
  STA &79
  CLD
  RTS

.show_score
  LDX #0
.show_score_loop
  LDA score_text,X
  JSR &FFEE
  INX
  CPX #score_text_end - score_text
  BNE show_score_loop
  LDA &79
  JSR print_bcd
  LDA &78
  JSR print_bcd
  RTS

.print_bcd
  PHA
  LSR A
  LSR A
  LSR A
  LSR A
  JSR print_digit
  PLA
  AND #&0F
.print_digit
  CLC
  ADC #48
  JMP &FFEE

.score_text
  EQUB 31, 2, 1
  EQUS "SCORE "
.score_text_end
`;
const SOUND_ASM = `; Acorn Harvest - sound effects through OSWORD 7.
;
; Each control block is channel, amplitude, pitch and duration as four 16-bit
; little-endian words. Amplitude -15 is written as its two's complement &FFF1
; because this assembler takes unsigned constants.

.sound_pickup
  LDX #<sound_pickup_block
  LDY #>sound_pickup_block
  LDA #7
  JMP &FFF1

.sound_fanfare
  LDX #<sound_fanfare_block
  LDY #>sound_fanfare_block
  LDA #7
  JMP &FFF1

.sound_pickup_block
  EQUW 1, &FFF1, 150, 3
.sound_fanfare_block
  EQUW 1, &FFF1, 200, 20
`;
const LEVEL_ASM = `; Acorn Harvest - level data.
;
; The maze itself lives in level.map.json and is edited in the Maps workspace.
; INCLUDEMAP emits its header, its layer and a tile pointer table, and pulls in
; the wall and acorn artwork the tileset names, so this file only has to declare
; where the player starts and how many acorns the maze holds.
;
; The generated layer bytes are 0 clear ground, 1 wall and 2 acorn, in row order.
; The self test counts them and compares the total with level_acorns.

INCLUDEMAP "level.map.json"

.level_start_column
  EQUB 1
.level_start_row
  EQUB 6
.level_acorns
  EQUB 11
`;
const LEVEL_MAP_JSON = `{
  "schema": "8bit-net.tile-map",
  "version": 1,
  "name": "level",
  "width": 10,
  "height": 12,
  "tileWidth": 8,
  "tileHeight": 8,
  "layers": [
    {
      "id": "layer-1",
      "name": "Maze",
      "visible": true,
      "cells": [
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        2,
        0,
        0,
        2,
        0,
        0,
        0,
        2,
        1,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        2,
        1,
        0,
        0,
        2,
        0,
        1,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        1,
        0,
        1,
        1,
        2,
        1,
        1,
        0,
        1,
        0,
        0,
        2,
        1,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        1,
        1,
        0,
        2,
        1,
        1,
        1,
        0,
        1,
        0,
        1,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        1,
        1,
        1,
        1,
        0,
        1,
        1,
        1,
        0,
        0,
        1,
        1,
        2,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1
      ]
    }
  ],
  "tileset": [
    {
      "index": 1,
      "assetFile": "wall.asset.json"
    },
    {
      "index": 2,
      "assetFile": "acorn.asset.json"
    }
  ],
  "objects": [
    {
      "id": "start",
      "name": "Player start",
      "kind": "point",
      "x": 1,
      "y": 6,
      "width": 1,
      "height": 1,
      "properties": []
    }
  ],
  "extensions": {}
}
`;
const PLAYER_ASSET_JSON = `{
  "schema": "8bit-net.pixel-asset",
  "version": 1,
  "name": "player",
  "kind": "sprite",
  "width": 8,
  "height": 8,
  "pixels": [
    0,
    0,
    3,
    3,
    3,
    3,
    0,
    0,
    0,
    3,
    3,
    3,
    3,
    3,
    3,
    0,
    0,
    3,
    0,
    3,
    3,
    0,
    3,
    0,
    0,
    3,
    3,
    3,
    3,
    3,
    3,
    0,
    0,
    0,
    3,
    3,
    3,
    3,
    0,
    0,
    0,
    3,
    1,
    1,
    1,
    1,
    3,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0
  ],
  "palette": {
    "indices": [
      0,
      1,
      2,
      3
    ],
    "interpretation": "logical-acorn-colours"
  },
  "target": {
    "family": "acorn-8-bit",
    "packing": "bbc-mode-5-hardware-interleaved-2bpp",
    "previewPixelAspect": "square-editor-preview"
  },
  "sprite": {
    "hotspot": {
      "x": 0,
      "y": 0
    },
    "mask": [
      0,
      0,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      0,
      1,
      1,
      0,
      1,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0
    ],
    "maskSemantics": "1-opaque-0-transparent",
    "frame": {
      "name": "Stand",
      "durationMs": 120
    },
    "animation": {
      "playback": "loop",
      "frames": [
        {
          "id": "frame-2",
          "name": "Step",
          "durationMs": 120,
          "pixels": [
            0,
            0,
            3,
            3,
            3,
            3,
            0,
            0,
            0,
            3,
            3,
            3,
            3,
            3,
            3,
            0,
            0,
            3,
            0,
            3,
            3,
            0,
            3,
            0,
            0,
            3,
            3,
            3,
            3,
            3,
            3,
            0,
            0,
            0,
            3,
            3,
            3,
            3,
            0,
            0,
            0,
            3,
            1,
            1,
            1,
            1,
            3,
            0,
            0,
            0,
            1,
            1,
            1,
            1,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0
          ],
          "mask": [
            0,
            0,
            1,
            1,
            1,
            1,
            0,
            0,
            0,
            1,
            1,
            1,
            1,
            1,
            1,
            0,
            0,
            1,
            0,
            1,
            1,
            0,
            1,
            0,
            0,
            1,
            1,
            1,
            1,
            1,
            1,
            0,
            0,
            0,
            1,
            1,
            1,
            1,
            0,
            0,
            0,
            1,
            1,
            1,
            1,
            1,
            1,
            0,
            0,
            0,
            1,
            1,
            1,
            1,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0
          ],
          "hotspot": {
            "x": 0,
            "y": 0
          }
        }
      ]
    }
  },
  "extensions": {}
}
`;
const ACORN_ASSET_JSON = `{
  "schema": "8bit-net.pixel-asset",
  "version": 1,
  "name": "acorn",
  "kind": "tile",
  "width": 8,
  "height": 8,
  "pixels": [
    0,
    0,
    0,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    2,
    2,
    2,
    2,
    0,
    0,
    0,
    2,
    2,
    2,
    2,
    2,
    2,
    0,
    0,
    2,
    2,
    2,
    2,
    2,
    2,
    0,
    0,
    0,
    2,
    2,
    2,
    2,
    0,
    0,
    0,
    0,
    0,
    2,
    2,
    0,
    0,
    0
  ],
  "palette": {
    "indices": [
      0,
      1,
      2,
      3
    ],
    "interpretation": "logical-acorn-colours"
  },
  "target": {
    "family": "acorn-8-bit",
    "packing": "bbc-mode-5-hardware-interleaved-2bpp",
    "previewPixelAspect": "square-editor-preview"
  },
  "extensions": {}
}
`;
const WALL_ASSET_JSON = `{
  "schema": "8bit-net.pixel-asset",
  "version": 1,
  "name": "wall",
  "kind": "tile",
  "width": 8,
  "height": 8,
  "pixels": [
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  ],
  "palette": {
    "indices": [
      0,
      1,
      2,
      3
    ],
    "interpretation": "logical-acorn-colours"
  },
  "target": {
    "family": "acorn-8-bit",
    "packing": "bbc-mode-5-hardware-interleaved-2bpp",
    "previewPixelAspect": "square-editor-preview"
  },
  "extensions": {}
}
`;

/* Every identifier below is a fixed string rather than a generated UUID so the
 * sample builds to the same bytes and its test plan stays bound to its target
 * however many times it is opened. */
export const ACORN_HARVEST: SampleProject = {
  id: 'acorn-harvest',
  name: 'Acorn Harvest',
  language: '6502 assembly',
  machine: 'BBC Model B · OS 1.20 · MODE 5',
  summary: 'A maze collection game built from an editable tile map, editable sprite and tile assets, MOS sound and a second build target that proves the engine on real hardware.',
  highlights: [
    'The maze is a real tile-map document edited in the Maps workspace. INCLUDEMAP generates its header, layer and tile pointer table, and pulls in the wall and acorn artwork its tileset names.',
    'A two-frame animated player sprite is compiled in by INCLUDEASSET, and the game reads its generated frame table to advance the animation.',
    'Editing a tile, the map or the sprite stales the build, because all three are tracked as real inputs.',
    'Acorns score in 6502 decimal mode and play a note through OSWORD 7.',
    'A separate self-test target links the same modules and writes its observations to memory, so the Tests workspace checks them against a genuinely executed BBC.',
  ],
  requiresRoms: true,
  project: {
    format: '8bit-net-dev-project-21',
    name: 'Acorn Harvest',
    files: [
    { id: "main.asm", name: "main.asm", content: MAIN_ASM },
    { id: "selftest.asm", name: "selftest.asm", content: SELFTEST_ASM },
    { id: "screen.asm", name: "screen.asm", content: SCREEN_ASM },
    { id: "engine.asm", name: "engine.asm", content: ENGINE_ASM },
    { id: "player.asm", name: "player.asm", content: PLAYER_ASM },
    { id: "score.asm", name: "score.asm", content: SCORE_ASM },
    { id: "sound.asm", name: "sound.asm", content: SOUND_ASM },
    { id: "level.asm", name: "level.asm", content: LEVEL_ASM },
    { id: "level.map.json", name: "level.map.json", content: LEVEL_MAP_JSON },
    { id: "player.asset.json", name: "player.asset.json", content: PLAYER_ASSET_JSON },
    { id: "acorn.asset.json", name: "acorn.asset.json", content: ACORN_ASSET_JSON },
    { id: "wall.asset.json", name: "wall.asset.json", content: WALL_ASSET_JSON }
    ].map((file) => ({ ...file, language: file.name.endsWith('.asm') ? '6502' as const : 'text' as const, modified: false, saved: true, savedName: file.name, savedContent: file.content, encoding: 'utf-8' as const, lineEnding: 'lf' as const, kind: 'authored' as const, access: 'editable' as const })),
    target: { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'Model B · 8271 DFS', romId: 'os12-basic2-dfs', enabledCapabilities: ['dfs', 'sideways'] },
    breakpoints: {},
    bookmarks: [
      { id: 'harvest-loop', fileId: 'main.asm', line: 17, column: 1, name: 'Main game loop', description: 'One frame: wait for vertical sync, read the keys, then move.', scope: 'project', enabled: true, anchor: '.main_loop' },
      { id: 'harvest-collect', fileId: 'player.asm', line: 51, column: 1, name: 'Acorn collection', description: 'Clears the tile, scores in decimal mode and plays the pickup note.', scope: 'project', enabled: true, anchor: 'CMP #2' },
    ],
    buildTargets: [
      { schemaVersion: 5, id: 'harvest-game', name: 'Acorn Harvest game', entryFileId: 'main.asm', sourceFileIds: ['main.asm'], toolchainId: '8bit-net.asm.6502', outputName: 'acorn-harvest.bin' },
      { schemaVersion: 5, id: 'harvest-selftest', name: 'Acorn Harvest self test', entryFileId: 'selftest.asm', sourceFileIds: ['selftest.asm'], toolchainId: '8bit-net.asm.6502', outputName: 'acorn-harvest-selftest.bin' },
    ],
    activeBuildTargetId: 'harvest-game',
    testPlans: [
      {
        schemaVersion: 2, id: 'harvest-engine', targetId: 'harvest-selftest', name: 'Engine contract', suite: 'Acorn Harvest',
        setup: { reset: 'hard', media: 'eject' }, inputs: [], stop: 'selftest_done',
        assertions: 'PC = selftest_done\nMEM[results] = &00 &62 &50 &70 &2B &20 &00 &0B &0B &00 &01 &05 &0A &10 &00 &01 &05 &50 &68 &33 &01\nCYCLES <= 4000000',
        screenGoldens: [], cycleBudget: 6000000,
        captures: [{ id: 'harvest-registers', kind: 'registers' }],
        teardown: { action: 'pause' }, enabled: true,
      },
    ],
    armBreakpoints: {}, armBreakpointGroups: {}, breakpoints6502: {}, breakpointGroups6502: {}, analysisAnnotations: {}, diskSets: [], settings: {}, trash: [],
  },
};
