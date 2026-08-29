# ADR 0008 — ElkJS Electron adapter, and the GPL position

Status: **accepted, with the licence position pending sign-off**  
Date: 27 August 2026  
Relates to: EMU-423, EMU-428, P0-018, SEC-903

## Context

The product describes an Acorn Electron profile, but jsbeeb 1.19.1 publishes no
Electron model, so the profile could be selected and never run. Two candidate
routes were surveyed rather than assumed.

**ElkJS** (`dmcoles/elkjs`, GPL-2.0) is the only maintained emulator that runs an
Electron in a browser today. Reading its memory model settles what it provides: a
fixed 32 KB machine with exactly two ROM images, the operating system and BASIC.
Its ROM-bank decode returns BASIC for every bank the keyboard does not claim, and
the author's own commented-out code shows real sideways-ROM paging was begun and
not finished. It therefore has no Plus 1, no Plus 3, no AP5 or AP6, no ADFS, no
cartridge and no usable expansion ROM slot.

**Elkulator** (`stardot/elkulator`, GPL-2.0) does model those expansions, and the
sibling bit-chat tests already build and patch it. It has no WebAssembly port and
is built on Allegro 4, so a browser slice needs that port doing first, in the way
`pdjstone/arculator-wasm` was ported to SDL2 before this build could use it.

## Decision

Adopt ElkJS now as an explicitly base-machine Electron slice, and keep the
Elkulator port as the route to the expansions. Ship the limitation as data, not
as prose a user has to find.

### What is vendored

Only the six hardware modules — processor, memory, sheila, display, sound and
keyboard — pinned to revision `ff123355407f79a91f808e31222dcca5d51ea87f`, with a
SHA-256 recorded for each pristine file in
`public/electron/elkjs/PROVENANCE.md`. The upstream user interface, its jQuery
and jQuery UI copies, its tape and UEF modules and their two third-party
decompression libraries are not taken; this build supplies its own driver and
does not offer tape on this slice.

**No firmware and no software is vendored.** Upstream ships Acorn's operating
system and BASIC images and seven commercial game snapshots. None of them are
copied here. ROMs come from the user's own browser-local firmware vault, which is
why the local change to `memory.js`, recorded in
`docker/elkjs/elkjs-webide.patch`, replaces its hard-coded fetch of `./os.rom`
and `./basic.rom` with images supplied by the caller. No emulation behaviour is
changed by that patch.

A second change to `processor.js` is recorded in the same patch. Inside
`exec6502`, the deferred reset that `reset6502e` requests calls a bare
`reset6502()`. That name is a property of the module instance, not a global, so
the call is a `ReferenceError` in any page that does not also define a global of
that name — which upstream's own user interface happens to. Because this build
loads only the hardware modules, the machine halted on its first deferred reset
until the reference was qualified to `self.reset6502()`. It is the same
function; the reset semantics are unchanged.

### Declared capability, not silent approximation

ElkJS keeps its registers in closure variables reachable only through
`makeSnapshotData()`, and runs a batch of cycles per call with no per-instruction
hook. The adapter therefore offers execution, reset, register read, memory read
and write, program load, keyboard input and display, and declares instruction
stepping, breakpoints, watchpoints, logpoints, tracing, register write, hardware
inspection, media, audio capture, machine-state save and hardware test execution
as unavailable, each with the reason. Asking for one is refused with that reason
rather than accepted and approximated.

The adapter support matrix records the Electron as runnable on ElkJS and names
the expansions the core does not model, so the firmware vault tells a user that
supplying a Plus 1 ROM will not produce a Plus 1.

## The GPL position — pending sign-off

This is recorded so it can be reviewed, not treated as settled.

- ElkJS is **GPL-2.0**. jsbeeb, already used, is **GPL-3.0**. The two are not
  combined into one program: each runs in its own document, loaded separately,
  with no shared linkage, communicating only with the workbench over
  `postMessage`. On that basis the well-known incompatibility between GPL-2.0-only
  and GPL-3.0 is not engaged, because there is no combined work.
- The vendored files are the complete corresponding source in their delivered
  form, and are shipped with the upstream `LICENSE`, the pinned revision, the
  per-file checksums and the one local patch. That is what GPL-2.0 asks of a
  distributor.
- **Open question for review:** the page that loads the GPL-2.0 modules,
  `public/electron.html` and `public/electron-runtime.js`, is plausibly a work
  based on them. This repository currently declares no licence of its own —
  there is no `LICENSE` file and `package.json` has no `license` field — so the
  obligation cannot be assessed against a stated position. Declaring the
  product's licence is a prerequisite for closing P0-018, and this decision
  should not be treated as accepted until that is done.
- SEC-903 is unaffected and reinforced: no proprietary ROM, manual or commercial
  program enters the repository or the container image from this work.

## Consequences

- The Electron becomes a machine this build can genuinely run, with its limits
  stated in the interface rather than discovered. Selecting it in the workbench
  routes the emulator panel to the ElkJS surface, and a project builds, loads
  and executes on it end to end.
- The Elkulator port remains the only route to Plus 1, Plus 3 and AP5 or AP6,
  and the backlog says so.
- A second emulator licence now needs carrying in the container's licence set
  alongside jsbeeb's.
- Until the product declares its own licence, the position above is provisional.
