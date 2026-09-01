# Elkulator for WebAssembly

An Acorn Electron core that models the expansions ElkJS does not: Plus 1,
Plus 3, ADFS, sideways ROM and RAM slots, the AP5 and AP6 boards, and the
cartridge interface. EMU-423 has wanted one since the Electron slice shipped.

## What is proved

`Dockerfile.wasm` builds `elkulator.wasm` — 1,302,443 bytes — and its JavaScript
glue, from `demrepofdave/elkulator` at commit
`6785521aba2c237861f29d9dee9cfc6725989b1e` on branch
`demrepofdave/allegro5_integration`, against Allegro 5.2.9.1 with Allegro's own
SDL backend, under `emscripten/emsdk:3.1.29`. `configure` exits zero, `make`
exits zero, and the build fails rather than continuing if either produces no
`.wasm`.

## What it does when run

**It boots an Acorn Electron and draws its screen.**

A headless Chromium run staged the operating system and BASIC ROMs into the
virtual file system, called `main`, and let it run for twelve seconds. The
browser kept its thread throughout — 470 animation frames, about 39 a second —
and the drawing buffer, read back inside the emulator's own draw call, held 882
white pixels on black which read:

```
Acorn Electron        [cursor]
BASIC
```

That is the machine's own boot banner, produced by its own operating system ROM.
No page exception, no console error, and every WebGL draw call succeeded.

## The five faults that stood between the build and that picture

Each was found by running it, and none of them is visible in a native build.

1. **`fclose(NULL)` on a missing `elk.cfg`.** `loadconfig` opens the file and
   closes it unconditionally. Every accessor between the two already returns its
   default when the handle is NULL — so an absent config is a case the code
   otherwise handles correctly — but the close aborts the WebAssembly instance
   before anything is drawn. Natively it is undefined behaviour that happens to
   be survivable, so nobody has met it. A page has no home directory to have put
   a config in, so this is the ordinary path here. `saveconfig` closes the same
   way and is reached whenever the machine is stopped.

2. **A missing expansion ROM killed the machine.** `loadrom` prints and calls
   `exit(1)`, and `loadroms` calls it for the Master RAM Board OS, ADFS, DFS, the
   sound ROM and the Plus 1 support ROM as well as for the operating system and
   BASIC. On a desktop those five sit in a directory beside the binary and are
   simply always there. Here they are whichever ROMs the person owns, so the
   ordinary case is that most are absent. A missing expansion is now an absent
   expansion, named on stderr; only the operating system and BASIC are required,
   which is what this build already means by an Electron.

3. **ASYNCIFY could not carry the main loop.** The first attempt turned
   `al_wait_for_event` into a poll that yielded through `emscripten_sleep`, and
   it half worked: `event_await` was entered and returned two hundred times over
   twelve seconds, and the statement immediately after `elkEvent = event_await()`
   never executed once. On rewind, execution resumes inside the frame that
   unwound and returns from it, but `main`'s frame was never saved, so control
   goes back to the runtime rather than into the loop body.
   `-sASYNCIFY_ADD=["main"]` does not help. The loop is now turned inside out:
   `event_await` returns whether or not anything happened, `main` hands its body
   to `emscripten_set_main_loop`, and no C stack is ever unwound. That takes
   ASYNCIFY out of the build along with 520 KB — 1,822,049 bytes became
   1,302,443 — and it is what the IDE integration wants anyway, since the IDE
   decides when the machine steps.

4. **The 50 Hz timer never ticked.** Allegro's SDL backend registers the timer's
   event source and never posts to it, because it has no thread to tick it from,
   and the whole emulator is driven from those events. The tick is supplied from
   the clock the browser does have. This is a platform service the backend does
   not implement rather than emulator state being invented: the event carries
   nothing beyond "20 ms passed", which is what the real timer would have said.

5. **Every WebGL draw call failed, and nothing said so.** With the loop running
   and the machine executing, the canvas stayed black. Instrumenting the context
   showed 638 `drawArrays` calls and 638 `GL_INVALID_OPERATION`s: Allegro's
   primitives addon hands `glVertexAttribPointer` a pointer into client memory,
   which desktop GL accepts and GLES2 does not. `-sFULL_ES2=1` emulates
   client-side vertex arrays by copying them into a buffer, which is the
   behaviour Allegro is written against. With it, every draw succeeds and the
   picture appears.

## Two more, found while proving the above

**A latent out-of-bounds the browser catches and a native build does not.**
`put_pixel_line` guarded the upper end of its range — `x + width` past 640, `y`
past 256 — and not the lower, so a negative coordinate indexed
`electron_screen` below its start. On a native heap that writes into whatever
sits in front of it and is never noticed; WebAssembly traps it. Separately, the
ULA brings a video address back inside memory by subtracting the mode's screen
length once, which is only correct while the address is at most `0x8000` plus
that length — mode 6's length is `0x2000`, so an address near `0xFFFF` is still
above `0x8000` after one subtraction, and the read lands outside a 32 KB `ram`.
On a native build `ram2` is declared immediately after `ram` and the read
quietly returns a neighbouring array. It wraps as many times as it takes now,
which is what the hardware does.

**An unchecked bitmap lock.** Both blit routines call `al_lock_bitmap` and
dereference the result without checking it. Allegro is entitled to refuse a lock
and under this backend it does — exactly once, on the first frame, before the
bitmap's texture exists; counting it gave one refusal against a hundred
successes. The lock is checked now and a refused frame is skipped. Making the
surface a memory bitmap also stops the refusal and was tried: it costs two and a
half times the frame rate, because a memory source drawn to a video target sends
Allegro down a path that reads the whole backbuffer back every frame. The bitmap
stays a video bitmap.

## What is not yet known

The frame rate above was measured in headless Chromium on a software renderer,
with only the operating system and BASIC fitted and nothing running. Neither
the expansions nor the machine under load has been measured, and no keyboard,
sound or disc path has been exercised.

## The bridge

`webide_bridge.c` is the whole of what the IDE may ask this core: run, pause,
step, reset, breakpoints, registers, memory and keys. Everything the workbench
can do to this machine is in one file, and anything it cannot do is absent
rather than half-answered.

Two of those are things ElkJS cannot offer at all, and they are why this core
exists alongside it. Elkulator calls its own debugger before every instruction,
so a hook in the same place is exact, and it returns a verdict rather than a
notification: non-zero means the instruction has not run and must not, so the
machine is left standing on it. That is what makes a step a step and a
breakpoint stop before rather than after. The hook is armed only while a
breakpoint, a step or an instruction count needs it, because the machine
executes a few hundred thousand instructions a second and a debugger nobody
opened should cost nothing.

Reading memory has two meanings and both are offered by name, because
conflating them would make the debugger lie. `elk_webide_read_memory` goes
through `readmem`, which is what the processor sees — paged ROM, the ULA and
the keyboard matrix answer, and a read can have a side effect.
`elk_webide_read_ram` reads the 32 KB array directly, which is what a memory
inspector wants, and says `-1` above `0x7fff` rather than returning the ROM byte
`readmem` would have given.

### What a run of it showed

A headless Chromium run drove all twenty-three entry points against a booted
machine. With counting armed it executed 135,069 instructions in half a second.
Pausing stopped it and it stayed stopped — same program counter and same count
three hundred milliseconds later. A single step executed exactly one
instruction and moved the program counter three bytes. Registers written while
it stood still read back. A ten-byte program was placed at `&1900`, a
breakpoint set on its halt loop, and the machine resumed: it stopped at `&1907`
with the breakpoint recording one hit, `A` and `X` holding `&42` and `7`, and
`&2000` holding `&42` — the program's own result, read out of RAM. Every
refusal refused: a register index of 99, a breakpoint slot of 99, an address
past `&FFFF`, key zero, a step of zero instructions.

Two defects of its own were found that way rather than reasoned about. The
instruction count read zero while the machine was plainly running, because the
counter lives in the hook and nothing had armed it — so counting is now asked
for explicitly and `elk_webide_counting` says whether the number means
anything, rather than zero being reported as though nothing had executed. And a
step resumed the machine and never stopped it, for the same reason: it now arms
the hook it depends on.

## The runtime page and the adapter

`public/elkulator.html` drives this core over the same envelope the workbench
already speaks, and `src/emulator/elkulatorAdapter.ts` classifies all
fifty-seven commands the emulator panel can emit: sixteen capabilities offered,
twenty refused with a reason. Where the ElkJS adapter has to refuse stepping,
breakpoints, register writing, key injection and stop-address tests, this one
offers them.

The refusals are of two kinds and both are said plainly, because "this core
cannot" and "this build does not" are different promises. The Electron has no
Tube; Elkulator's memory access has no hook to hang a watchpoint on. But
tracing, profiling and save-state are absent because the bridge deliberately
does not carry them, however capable the emulator underneath is.

Capturing the screen needed a decision rather than a call. A WebGL canvas
discards its drawing buffer at the end of every frame unless asked not to, and
SDL creates the context, so the page forces `preserveDrawingBuffer` before
anything can create one. It costs a copy per frame and buys a capture that is
the machine's picture rather than a black rectangle.

The canvas is called `canvas` and not something more descriptive because that is
the selector Allegro's SDL backend looks it up by. A canvas named anything else
is simply not the one the emulator renders into, which fails as a null
`addEventListener` deep inside SDL rather than as anything that names the cause.

### What a run of it showed

A headless Chromium run drove the shipped page in an iframe over its own message
channel, under the exact content security policy the image serves it with. The
machine initialised from two ROM images, booted, took a ten-byte program at
`&1900`, and stopped on a breakpoint at `&1907` with the slot recording the hit,
`A` and `X` at `&42` and `7`, and `&2000` reading `&42`. Three single steps
walked the program counter `&1900`, `&1902`, `&1905`, `&1907` — the three
instruction lengths — leaving the machine paused between each. A register write
took. A stop-address test reached its address in 20 ms, and one that could not
reach its address timed out at 614 ms rather than waiting. A watchpoint, an
unknown command and an unknown key were each refused with the reason recorded.
The screen capture came back as a 640×512 PNG holding the machine's own
`Acorn Electron` banner. No page error, no console error, no policy violation.

## Licence

Elkulator is GPL-3.0-or-later and Allegro 5 is zlib. Conveying `elkulator.wasm`
means conveying its corresponding source, as this build already does for jsbeeb,
Arculator and ElkJS.

Two things about that are not the usual case.

**Upstream has no licence file.** The README points at `COPYING`, but that file
was an autotools symlink and was deleted in commit `54b1bae` along with the
other generated links. So the text is supplied by this build rather than copied
from a fork that does not carry it. Which version is settled from the source
rather than assumed: `src/socket.c` and `src/serial.c` state "version 3 of the
License, or (at your option) any later version", and the imported
`src/fdi2raw.c`, which comes from UAE, states version 2 or later. Version 2 or
later is compatible with version 3, so the work as a whole is conveyed as
GPL-3.0-or-later.

**Upstream ships Acorn firmware.** `roms/` in that repository holds the real
operating system, BASIC, ADFS, DFS, Master RAM Board OS, Plus 1 support and
sound ROMs, under a note saying they are explicitly not covered by the GPL. None
of it is ours to distribute, so the corresponding source shipped here excludes
that directory and the build then proves it absent — the same guard jsbeeb
already has, for the same reason.

The branch is a fork rather than upstream. So is `pdjstone/arculator-wasm`,
which this build already pins, but it is a standing maintenance cost and was
accepted deliberately rather than by omission.

## After that

The workbench wiring: the emulator panel does not yet offer this core as a
choice beside ElkJS.

The core itself does ship. The product `Dockerfile` builds it in its own stage
from the files in this directory rather than a second copy of them, pins the
Elkulator revision instead of the branch tip, and copies the artefacts, the
licence, the corresponding source and the build hashes into the image beside
Arculator's. It was kept out of the image while it could not run; it runs.

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
