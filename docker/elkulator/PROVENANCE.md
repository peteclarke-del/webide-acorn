# Elkulator for WebAssembly

An Acorn Electron core that models the expansions ElkJS does not: Plus 1,
Plus 3, ADFS, sideways ROM and RAM slots, the AP5 and AP6 boards, and the
cartridge interface. EMU-423 has wanted one since the Electron slice shipped.

## What is proved

`Dockerfile.wasm` builds `elkulator.wasm` — 1,301,872 bytes — and its JavaScript
glue, from `demrepofdave/elkulator` at branch `demrepofdave/allegro5_integration`
against Allegro 5.2.9.1 with Allegro's own SDL backend, under
`emscripten/emsdk:3.1.29`. `configure` exits zero and `make` exits zero.

## What is not

**It has not been run.** `main()` still ends in `while (!quited)`, a loop that
never returns, which in a browser means a tab that never paints and never
responds. Arculator did not have this problem because its upstream had already
been given `emscripten_set_main_loop`; Elkulator has not. That is the next
piece of work, and it is a real one: either restructure the loop into a
per-frame callback, or link with `-sASYNCIFY`, which is cheaper to write and
costs binary size and speed.

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
