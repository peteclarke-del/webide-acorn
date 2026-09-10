# What fits in a frame on a BBC Model B

<!-- Generated from src/emulator/frameBudgetMeasurements.ts. Edit the catalogue, not this file. -->

Measured on a BBC Model B with OS 1.20 and BASIC II by running each routine from its own entry and counting the cycles it took to reach its exit.

A Model B runs at 2 MHz and its display is 50 frames a second, so one frame is 40,000 cycles. Everything below is measured against that.

## Moving bytes

| What | Cycles a byte | Bytes in one frame |
| --- | --- | --- |
| Store a byte to the screen | 5.59 | 7,155 |
| Copy a byte from host memory to the screen | 9.70 | 4,123 |
| Pull a byte across the Tube to the screen, blind | 9.31 | 4,296 |
| Pull a byte across the Tube to the screen, kept in step | 16.14 | 2,478 |

- **Store a byte to the screen**: An unrolled absolute indexed store and nothing else. This is the floor: nothing that draws anything can beat it, and it is what clearing or flat-filling costs.
- **Copy a byte from host memory to the screen**: What showing an already-composed frame costs when the bytes are in the host's own memory.
- **Pull a byte across the Tube to the screen, blind**: The same, reading register 3 at &FEE5 with nothing on the other end and nothing keeping the two sides in step. Cheaper than the local copy, because a read from a fixed address needs no index. This is a ceiling, not a rate a program can run at: a byte read before the second processor has written it is a stale one.
- **Pull a byte across the Tube to the screen, kept in step**: A 65C102 at 4 MHz sends a byte whenever register 3 has room; the host waits on the data-available flag before every byte. Every byte received is checked against the one sent. This is what a game pays for a byte the second processor composed. The ULA's two-byte mode measures the same: it raises the host's flag once two bytes are in, which invites reading two for one check, and that is a race the check before every byte is there to avoid.

## How much of a screen that is

Taking the kept-in-step Tube figure, which is the one a game built around a second processor pays. The blind figure is a ceiling.

| Mode | Screen bytes | At 50 Hz | At 25 Hz | Frames for a full redraw |
| --- | --- | --- | --- | --- |
| MODE 2 | 20,480 | 12% | 24% | 8.3 |
| MODE 1 | 20,480 | 12% | 24% | 8.3 |
| MODE 5 | 10,240 | 24% | 48% | 4.1 |
| MODE 4 | 10,240 | 24% | 48% | 4.1 |

For scale, a ZX Spectrum screen is 6,912 bytes, which is 2.8 frames at the same rate. A machine that ran well-regarded arcade conversions had two thirds of a MODE 5 screen to move, and did not move all of it every frame either.

The kept-in-step figure was measured with a 65C102 at 4 MHz sending through a loop of five instructions and the host storing through sixteen unrolled absolute indexed stores, and every byte received was checked against the one sent. A sender that does more per byte, or a receiver that counts and branches for every byte, is slower than this: the first game program to stream rows this way measured 24 cycles a byte. The link is the floor; the loops on both sides are what a program pays on top, and a transfer that runs past the end of a frame waits a whole frame for the next vertical sync.

## The two things that are free

- **The hardware scroll**: 35 cycles for the two 6845 start-address registers, which is 0.088 per cent of a frame.
- **The NuLA palette**: 208 cycles to reload all sixteen colours, so 192 full reloads fit in one frame. That is more than there are scanlines.

## What follows

- A byte from the second processor costs the host 16.14 cycles when the two sides are kept in step, against 9.70 for one already in its own memory. The 9.31 of a blind read is a ceiling no program can run at. So the Tube is a bottleneck for pixels after all: 2,477 bytes a frame, a quarter of a MODE 5 screen, half of it at 25 Hz.
- What crosses the Tube is therefore what is expensive to compute and cheap to move: composed sprites, and descriptors for what the host can fill from a table. The host draws the ground from a per-row descriptor at the fill cost, not the Tube cost.
- No mode can be fully redrawn in one frame. The best case is a flat fill, and even that covers only 70 per cent of a ten-kilobyte screen.
- The loops on both sides of the Tube matter as much as the link. The 16.14 is a five-instruction sender and a receiver unrolled sixteen stores deep; a receiver that counts and branches for every byte measured 24 cycles a byte on the same machine, and a transfer that runs past the end of a frame costs a whole second frame waiting for the next vertical sync.
- The hardware scroll is free. Two 6845 register writes cost 35 cycles, which is under a tenth of a per cent of a frame.
- Reloading the whole NuLA palette costs 208 cycles, and 192 reloads fit in a frame. That is more reloads than there are scanlines, so a four-colour mode can carry a different four colours on every band of the screen.
- That last point is what decides the mode. MODE 5 has the same 160 pixel width as MODE 2 for half the bytes, and per-band palettes turn its four-colour limit into a per-band limit rather than a screen limit.
