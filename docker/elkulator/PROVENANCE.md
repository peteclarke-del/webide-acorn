# Elkulator for WebAssembly

An Acorn Electron core that models the expansions ElkJS does not: Plus 1,
Plus 3, ADFS, sideways ROM and RAM slots, the AP5 and AP6 boards, and the
cartridge interface. EMU-423 has wanted one since the Electron slice shipped.

## What is proved

`Dockerfile.wasm` builds `elkulator.wasm` — 1,301,872 bytes — and its JavaScript
glue, from `demrepofdave/elkulator` at branch `demrepofdave/allegro5_integration`
against Allegro 5.2.9.1 with Allegro's own SDL backend, under
`emscripten/emsdk:3.1.29`. `configure` exits zero and `make` exits zero.

## What it does when run

It boots as far as executing 6502 code and faults in one identified place.

A headless Chromium run staged fifteen expansion ROMs and `elk.cfg` into the
virtual file system, called `main`, and observed: the Allegro display created a
WebGL context, the firmware loaded, and execution reached `exec6502` — the
machine is running the Electron's own operating system — before trapping with
`memory access out of bounds` inside `yield`, the ULA's raster renderer in
`src/ula.c`. The browser kept its thread throughout, which was the point of the
loop change: a frame counter advanced from 696 to 937 while the emulator ran.

**The blocking loop is solved.** `al_wait_for_event` never returns until
something arrives, and a page inside it never paints. Under Emscripten the
same wait is now a poll that yields — `emscripten_sleep` hands control back and
ASYNCIFY resumes the C stack where it left off — so the loop above is unchanged
and every local it holds is still valid. That costs about 500 KB of binary.

**What remains is the event source.** The emulator initialises, loads its
firmware, creates a WebGL display and enters its event loop, and then waits
forever: instrumenting the loop shows `event_await` entered once and no Allegro
event ever delivered, so `runelk` is never called, nothing is rendered and the
canvas stays black. No error is produced because nothing has gone wrong as far
as the code is concerned — it is waiting for a timer that does not tick.

Allegro's timer is an event source registered on a queue, and under its SDL
backend on Emscripten that source is not producing events. That is the next
thing to fix, and it is bounded: either the timer is started differently for
this backend, or the loop is driven from `requestAnimationFrame` through
`emscripten_set_main_loop` and the Allegro timer is not used at all. The second
is what the eventual IDE integration wants anyway, since the IDE will decide
when the machine steps.

**Also found and fixed along the way.** `yield` walks the screen writing through
`put_pixel_line` and reading video memory. `put_pixel_line` guarded only the upper end of its range — `x + width` past 640, `y` past 256 — and not the
lower, so a negative coordinate indexed `electron_screen` below its start. On a
native heap that writes into whatever sits in front of it and is never noticed;
WebAssembly traps it. The guard is completed here, which is a real latent bug
found by the port, but it is not the fault that remains: the trap survives it,
so something else in the same function — most likely a video-memory read
through an address the ULA has not finished setting up — is still reaching
outside its array. That is the next thing to find, and it is an ordinary
debugging job now that it is this precisely located.

## After that

A bridge in the shape of `webide_bridge.c`, registers and memory exposed to the
debugger, and the capability and command classification the ElkJS adapter
already carries. Elkulator has a genuine `debugger.c`, which is more than ElkJS
offers, so that part starts from something rather than nothing.

Nothing here is wired into the product image. Building a core that cannot yet
run on every image build would add minutes and risk for no benefit, so the
recipe is kept and exercised deliberately until it runs.

## The three traps, so they cost nobody else a day

1. **emcc offers SDL *1* headers unless told `-sUSE_SDL=2`.** Allegro's
   `<SDL.h>` then resolves to SDL1 and every SDL2 symbol — `SDL_GetBasePath`,
   `SDL_GetPrefPath`, `SDL_GetDisplayDPI` — appears unimplemented. Shims were
   written for all three and deleted once the flag was right. With the flag,
   Allegro 5 needs **no source changes at all**.
2. **Allegro's cmake adds `-msse` on x86** unless `WANT_ALLOW_SSE` is off,
   which Emscripten rejects without `-msimd128`.
3. **Allegro's audio addon enables every driver it detects.** Emscripten ships
   an OpenAL library but no `al.h`, so detection succeeds and the build then
   fails. The native drivers are turned off and SDL audio left to it.

## The two shims, and why they are not gaps

`webide_alut_shim.h` — Elkulator calls `alutInit` and `alutExit`; ALUT has no
Emscripten port. Both are thin wrappers over ALC and are implemented directly,
which removes the dependency rather than working around it.

`allegro_native_dialog_stub.h` — Allegro builds no native-dialog library for
SDL at all, so the linker cannot find one. This is not a gap to fill: a native
file chooser and a native menu bar are the host operating system's furniture,
and a page has neither. The IDE supplies its own, exactly as it does for the
Archimedes core, so Elkulator's menu layer has nothing to draw and nothing to
ask. Every entry point answers the way its caller already handles a refused
dialog.

## Licence

Elkulator is GPL-3.0 and Allegro 5 is zlib. Conveying `elkulator.wasm` means
conveying its corresponding source, as this build already does for jsbeeb,
Arculator and ElkJS: the pinned revision, this patch set, and the upstream
archive travel with the image.

The branch is a fork rather than upstream. So is `pdjstone/arculator-wasm`,
which this build already pins, but it is a standing maintenance cost and was
accepted deliberately rather than by omission.
