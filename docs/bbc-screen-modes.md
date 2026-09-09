# BBC Model B screen modes

<!-- Generated from src/data/bbcScreenModes.ts. Edit the catalogue, not this file. -->

Measured on a BBC Model B with OS 1.20, BASIC II and a DFS, by asking BASIC for PAGE and HIMEM in each mode and probing the screen with PLOT and POINT.

Every figure below was answered by the machine. Screen memory is &8000 minus HIMEM after the mode change. The resolution comes from plotting one point at the origin and walking away from it until POINT stops seeing it, against a graphics space that is always 1280 by 1024. The colour count comes from GCOL masking its argument to the mode's range. A mode listed as text only is listed that way because a point plotted at its origin was not there afterwards.

Bits per pixel and bytes per pixel row follow from those two measurements. Program space is HIMEM minus PAGE, with PAGE at &1900, which is a machine with a DFS in it. A cassette machine has PAGE at &0E00 and 2,816 bytes more.

| Mode | Kind | Pixels | Logical colours | Bits per pixel | Bytes per pixel row | Screen bytes | HIMEM | Program space |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | graphics | 640 x 256 | 2 | 1 | 80 | 20,480 | &3000 | 5,888 |
| 1 | graphics | 320 x 256 | 4 | 2 | 80 | 20,480 | &3000 | 5,888 |
| 2 | graphics | 160 x 256 | 16 | 4 | 80 | 20,480 | &3000 | 5,888 |
| 3 | text only | no graphics | n/a | n/a | n/a | 16,384 | &4000 | 9,984 |
| 4 | graphics | 320 x 256 | 2 | 1 | 40 | 10,240 | &5800 | 16,128 |
| 5 | graphics | 160 x 256 | 4 | 2 | 40 | 10,240 | &5800 | 16,128 |
| 6 | text only | no graphics | n/a | n/a | n/a | 8,192 | &6000 | 18,176 |
| 7 | teletext | no graphics | n/a | n/a | n/a | 1,024 | &7C00 | 25,344 |

## Choosing one for a game

The trade is between colours, resolution and what is left for the program. Modes 0, 1 and 2 take twenty kilobytes and leave 5,888 bytes below the screen; modes 4 and 5 take ten and leave 16,384.

Sideways RAM does not change any of those numbers. It adds sixteen kilobytes at &8000, above the screen, so it holds code and data that can be paged in rather than lowering what the screen costs. A tube second processor does change them: the program runs in the parasite and the whole of the host's memory below &8000 is the screen and the host's own workspace, so the mode is chosen for what it looks like rather than for what it leaves.

## With a VideoNuLA fitted

A VideoNuLA replaces the video ULA and changes none of the figures above: the 6845 and the screen RAM belong to the machine. What it changes is what a logical colour may be set to, from the machine's 16 physical colours to 4,096, four bits each of red, green and blue, written as a pair of bytes to &FE23.

| Mode | Logical colours | Each chosen from, without a NuLA | With one |
| --- | --- | --- | --- |
| 0 | 2 | 16 | 4,096 |
| 1 | 4 | 16 | 4,096 |
| 2 | 16 | 16 | 4,096 |
| 4 | 2 | 16 | 4,096 |
| 5 | 4 | 16 | 4,096 |

The NuLA's other features reached through &FE22, the attribute modes and the horizontal scroll and left blanking, are implemented by the pinned core and documented in the VideoNuLA user guide, which the target reference cites. No resolution or colour count for them is given here, because none has been measured.
