# What fits in a frame on a BBC Model B

<!-- Generated from src/emulator/frameBudgetMeasurements.ts. Edit the catalogue, not this file. -->

Measured on a BBC Model B with OS 1.20 and BASIC II by running each routine from its own entry and counting the cycles it took to reach its exit.

A Model B runs at 2 MHz and its display is 50 frames a second, so one frame is 40,000 cycles. Everything below is measured against that.

## Moving bytes

| What | Cycles a byte | Bytes in one frame |
| --- | --- | --- |
| Store a byte to the screen | 5.59 | 7,155 |
| Copy a byte from host memory to the screen | 9.70 | 4,123 |
| Pull a byte across the Tube to the screen | 9.31 | 4,296 |

- **Store a byte to the screen**: An unrolled absolute indexed store and nothing else. This is the floor: nothing that draws anything can beat it, and it is what clearing or flat-filling costs.
- **Copy a byte from host memory to the screen**: What showing an already-composed frame costs when the bytes are in the host's own memory.
- **Pull a byte across the Tube to the screen**: The same, with the bytes arriving from the second processor through register 3 at &FEE5. Cheaper than the local copy, because a read from a fixed address needs no index.

## How much of a screen that is

Taking the Tube figure, which is the one a game built around a second processor pays.

| Mode | Screen bytes | At 50 Hz | At 25 Hz | Frames for a full redraw |
| --- | --- | --- | --- | --- |
| MODE 2 | 20,480 | 21% | 42% | 4.8 |
| MODE 1 | 20,480 | 21% | 42% | 4.8 |
| MODE 5 | 10,240 | 42% | 84% | 2.4 |
| MODE 4 | 10,240 | 42% | 84% | 2.4 |

For scale, a ZX Spectrum screen is 6,912 bytes, which is 1.6 frames at the same rate. A machine that ran well-regarded arcade conversions had two thirds of a MODE 5 screen to move, and did not move all of it every frame either.

## The two things that are free

- **The hardware scroll**: 35 cycles for the two 6845 start-address registers, which is 0.088 per cent of a frame.
- **The NuLA palette**: 208 cycles to reload all sixteen colours, so 192 full reloads fit in one frame. That is more than there are scanlines.

## What follows

- The Tube is not a bottleneck for pixels. A byte arriving from the second processor costs the host 9.31 cycles against 9.70 for one already in its own memory, so composing on the parasite is never worse and the composition is free.
- No mode can be fully redrawn in one frame. The best case is a flat fill, and even that covers only 70 per cent of a ten-kilobyte screen.
- The hardware scroll is free. Two 6845 register writes cost 35 cycles, which is under a tenth of a per cent of a frame.
- Reloading the whole NuLA palette costs 208 cycles, and 192 reloads fit in a frame. That is more reloads than there are scanlines, so a four-colour mode can carry a different four colours on every band of the screen.
- That last point is what decides the mode. MODE 5 has the same 160 pixel width as MODE 2 for half the bytes, and per-band palettes turn its four-colour limit into a per-band limit rather than a screen limit.
