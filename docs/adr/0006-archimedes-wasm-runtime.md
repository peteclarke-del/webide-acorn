# ADR 0006: Archimedes browser runtime and firmware boundary

- Status: accepted for implementation
- Date: 2026-08-21

## Context

The ARM build and analyser paths need a real A300-series machine behind Run and
Debug. QEMU's installed ARM targets do not model Acorn MEMC, IOC and VIDC, and a
6502 emulator cannot be presented as an Archimedes. The candidate must run in a
same-origin browser frame, accept user-held ROMs, expose authoritative core state
to the debugger, and remain reproducible in the self-contained Docker build.

Arculator 2.2 models the relevant ARM2/ARM3, MEMC, IOC and VIDC-era machines.
`pdjstone/arculator-wasm` is a GPL-2.0 browser port; commit
`579ac437b9a4ebe83b9b5f9b8e50b0c9c530509e` is the evaluated runtime baseline.
`pdjstone/archimedes-live` commit
`98ba65a0188db2f97d567811b0f2d4ccc38a2076` demonstrates browser configuration,
HostFS and input integration, but its Makefile downloads an Arculator release
archive and copies its ROM directory into the deployed site. That firmware path
must not be inherited.

MAME's `aa310` definition identifies four physical byte-lane ROMs per operating
system using `ROM_SKIP(3)`. Arculator instead reads files alphabetically and
concatenates them. Passing the four MAME chip dumps directly to Arculator would
therefore produce a corrupt ROM image even though every file has the right size.

## Decision

1. Build the pinned Arculator WASM source in a dedicated Docker build stage.
   Retain its GPL licence and corresponding pinned source archive in the runtime
   image. Do not use Arculator's `FULL_FAT` target and do not copy proprietary
   machine firmware from any upstream package. The GPL support extension ROM
   may be built from this exact pinned source, checksum-verified and shipped
   with its corresponding source; it is not an Acorn operating-system ROM.
2. Serve a minimal same-origin `/archimedes.html` runtime. The parent passes a
   validated machine manifest and browser-local firmware bytes; the frame writes
   only those bytes, generated configuration and CMOS state into Emscripten FS.
3. Model physical four-chip sets explicitly. Validate equal lane size and exact
   membership, then produce a combined image in lane order 0, 1, 2, 3:
   `output[index * 4 + lane] = laneBytes[lane][index]`. Hash both source lanes
   and the derived image. Never export either with a project.
4. First qualification is A310/ARM2 with RISC OS 3.11, followed by the other
   A300 ROM profiles. A machine is runnable only after framebuffer, keyboard,
   reset, pause, genuine instruction step, register/memory read, breakpoint and
   application-load browser contracts pass.
5. Patch a narrow WebIDE bridge into the core. Register, PC, memory, instruction
   and breakpoint reports must be read directly from Arculator state while its
   execution loop is paused; the React application must not synthesise them.
6. HostFS is the first application-loading path. RISC OS filetype/load/execute
   metadata is retained explicitly, and application directories are packaged
   without flattening `!Boot`, `!Run`, `!Sprites` or typed files.
7. Before HostFS packaging is complete, a bounded raw-debug handoff may write a
   current ARM2 artifact only to `&00008000–&000FFFFF` while paused, read it
   back, refill the real 26-bit pipeline at its in-image entry point, install
   source breakpoints, and remain visibly labelled as raw machine code. It is
   not the RISC OS application-loading path.
8. The first packaged launch is deliberately narrower than the eventual full
   application model. It accepts a raw, little-endian ARM2 artifact only when
   both origin and entry are `&00008000`, generates a typed &FEB Obey `!Run` and
   &FF8 Absolute `RunImage`, and stages them in Emscripten HostFS. Run sends F12
   and the FileSwitch command through the emulated keyboard controller; the UI
   reports launch only when a core execution observer sees `&00008000`. This
   does not claim AIF or a RISC OS C ABI.
9. The support extension is enabled only for RISC OS 3 profiles, matching the
   pinned upstream component's documented compatibility boundary.
10. The first storage contract is intentionally limited to exact 800 KiB ADFS
    `.adf` images mounted through Arculator's native `disc_change` path. The
    bridge verifies that the controller accepted the selected drive before the
    parent records an acknowledgement. A browser-local read path validates D
    old maps or one-zone E new maps, recursively checks `Nick` directories,
    resolves indirect fragment addresses and extracts exact file extents.
    A bounded one-file E writer independently round-trips its fragment and
    payload and is qualified for drive-0 FileSwitch launch only after the core
    observes its &FF8 Absolute entry at `&00008000`. Write-back, multi-file
    authoring, automatic drive-1 launch and other geometries are not claimed.
11. Audio state comes from Arculator's SDL device and VIDC production path, and
    framebuffer capture comes from the live emulator canvas. Both begin under
    browser autoplay/security policy and are never represented by synthetic UI
    state.
12. Revision `579ac437b9a4` has no complete save-state/restore API. A raw WASM
    heap copy is specifically rejected because it cannot serialize SDL/browser
    objects, the Emscripten filesystem or external device ownership and can
    restore invalid handles. A310 save/load remains unavailable until a
    deterministic component-level core contract exists.

## Consequences

The WASM build is heavier and GPL source-offer obligations become part of image
production. A small maintained core patch is required for debugging. In return,
the product gains an exact browser machine rather than an ARM instruction demo,
while proprietary firmware remains origin-private and user supplied.

Archimedes Live code and branding are not copied wholesale. Its configuration
behaviour is a reference only; its remotely hosted ROM workflow is explicitly
excluded.
