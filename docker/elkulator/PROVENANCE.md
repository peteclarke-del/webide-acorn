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
