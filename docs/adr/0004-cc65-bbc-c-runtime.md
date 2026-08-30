# ADR 0004: cc65 C adapter and WebIDE BBC runtime

Status: Accepted for the BBC B/B+/Master 8-bit C vertical slice  
Date: 21 August 2026  
Requirements: BLD-001–BLD-015, EDT-001–EDT-028, SEC-001–SEC-003

## Context

The pinned Debian cc65 package `2.19-1` contains a `bbc` compiler target and
linker configuration, but no `bbc.lib` target runtime. An audit of current
upstream cc65 commit `e11fb5c39371046ebe25485f984f644c5a0d65d3` found the same
boundary: `cfg/bbc.cfg` exists, while `libsrc/bbc` does not. Calling `cl65 -t
bbc` therefore fails at link time. The IDE must not advertise that incomplete
package surface as runnable C support.

## Decision

The independently selected `cc65.c-bbc` adapter uses the pinned suite for each
real translation stage:

1. cc65 compiles each declared `.c` translation unit to retained assembly;
2. ca65 assembles each generated unit with BBC target and debug metadata;
3. ld65 links the objects, cc65's generic `none.lib`, and a small, versioned
   `8bit-net.cc65-bbc-runtime` owned by this project.

The runtime supplies only the platform layer absent upstream: a CALL-compatible
startup, BBC MOS character input/output primitives, `cputc`/`putchar`, and the
public `<acorn.h>` declarations. It is not described as an upstream cc65 BBC
library or as complete ISO C/stdio/conio platform support.

Startup preserves the caller's hardware stack pointer and BBC zero-page bytes
`&70–&8F`, initializes cc65's software stack at `&7200`, clears BSS, runs cc65
constructors, calls `main`, runs destructors, restores BBC state, and returns
the low-byte result in A/X through the caller's original RTS frame. Code/data
load at or above `&0E00` and must finish below `&7200`; the default build range
is `&1900–&69FF`.

The initial validated machine set is BBC B, BBC B+ and Master. This is an ABI
and build/runtime claim, not a claim that every selected machine already has a
qualified full-system emulator. Atom, Electron and ARM targets require their
own runtime/ABI decisions.

## Security and reproducibility

- The manifest publishes cc65/ca65/ld65 versions and executable SHA-256s plus
  every runtime/header/library digest and the packaged cc65 licence digest.
- All three stages use fixed argv arrays in the existing non-root,
  network-disabled, read-only-root Symfony worker; no shell text is accepted.
- `.c` units and `.h` inputs are bounded by the common native request contract.
- Quoted includes must be static, safe, supplied project paths. Angle includes
  must resolve inside the immutable cc65/WebIDE SDK roots. Computed, absolute,
  traversing and unknown includes are rejected before compilation.
- Comment-separated include directives are normalized before policy checks;
  `#line` is rejected so source/debug paths cannot be forged.
- Profiles map to real compiler behavior: Debug is unoptimized, Size uses
  `-O`, Speed uses `-Oi`, and Custom resolves its explicit balanced/size/speed
  goal. Custom metadata `none` omits compiler/assembler/linker debug data.
  Numeric target defines enter the real preprocessor.
- Identical declared inputs reproduce identical binary bytes, normalized
  artifact records and provenance fingerprints. Per-request workspaces are
  always removed.

## Evidence and editor behavior

The linked ld65 debug file maps machine addresses back to original `.c` lines;
generated assembly, listings, map, labels, debug data and effective linker
configuration are retained as read-only documents. Compiler/assembler/linker
diagnostics use the common navigable no-artifact result contract.

C is a distinct project language and target dialect. Completion, hover and
signature help cover cc65 declaration/control tokens and the supported Acorn
SDK calls; current-file functions/macros enter completion and function calls
navigate to their definitions. Headers enter the target dependency graph but
cannot be selected as translation units.

## Deferred scope

The WebIDE runtime does not yet provide a complete BBC implementation of
stdio, files, every conio call, command-line arguments, floating point, heap
policy, joystick/mouse/graphics drivers, overlays or Tube transfer. Those APIs
must be implemented and hardware-tested individually before being advertised.
The cc65 C dialect is not full modern ISO C; the editor and documentation must
retain that distinction. ARM/RISC OS C remains BLD-329.
