# ADR 0005: ARM2 build boundary before Archimedes execution

Status: accepted; raw ARM2 assembler/linker and bounded live-debug handoff implemented  
Date: 21 August 2026

## Context

The IDE must eventually build and run Archimedes and RISC OS software. Those are
different claims. A cross-assembler can produce valid ARM instructions without
producing a RISC OS Absolute/AIF file, an application directory, a filetype, or
a binary that can safely be started under RISC OS. Likewise, generic ARM
emulation is not evidence that an Acorn MEMC/IOC/VIDC machine is emulated.

The first toolchain increment needs a real ARM2 instruction/link lifecycle and
source evidence while the RISC OS C ABI/runtime, application packaging and
qualified Archimedes engine remain under evaluation.

## Decision

Use Debian Bookworm `binutils-arm-none-eabi` `2.40-2+18+b1` as the first ARM
assembler/linker adapter, identified as `gnu.arm-none-eabi-binutils` version
`2026.08.1`. It runs in the existing non-root, read-only, network-disabled
Symfony builder and is invoked only with argv arrays and fixed executable paths.

The accepted source dialect is GNU ARM assembly in `.arm` or `.sarm` files.
Every unit is assembled with little-endian output and `-mcpu=arm2`, then linked
by a generated script into an ELF evidence file. `objcopy` extracts a raw
little-endian binary. `objdump`, `nm`, `readelf`, the linker map and decoded
DWARF lines supply retained evidence and normalized symbols/source locations.
The project selects a word-aligned origin and inclusive maximum within the ARM2
26-bit address space; the default bounded range is `&00008000–&000FFFFF`.

The normalized artifact kind is `arm-binary`, processor `arm2`, container format
`raw`, and `riscOsFiletype: null`. The UI states that this is not a RISC OS
application. Run, Debug and Test remain disabled for it until a qualified
Archimedes runtime implements those capabilities. No substitute machine or
fabricated ARM register state is exposed.

Static quoted `.include` paths may reference supplied project files. Absolute,
traversing, dynamic and missing includes are rejected. `.incbin` remains denied
until bounded binary project inputs have their own validated transport. The
linker script, output bounds, process limits and collected output allowlist stay
adapter-owned rather than source-controlled.

## Consequences

- ARM editing, completion, hover/signature help, labels, branch navigation,
  multi-unit assembly, linking, diagnostics, symbols, source maps and binary
  inspection are genuine and usable now.
- The emitted instruction bytes are suitable for the qualified A310 core's
  explicitly labelled mapped-RAM debug handoff, but that handoff is not a RISC
  OS application launch and does not complete BLD-329, MED-307 or EMU-426.
- RISC OS C requires a separate maintained toolchain/ABI/runtime decision. GNU
  bare-metal C is not relabelled as RISC OS C.
- RISC OS filetype/AIF/application-directory and ADFS packaging require their
  own byte-level validators before an artifact can be launched.
- The first production ARM emulator must still prove Acorn hardware, ROM,
  video, audio, input, storage, state and debugger hooks for an exact profile.
- The A310 slice now proves byte-identical RAM load/readback, 26-bit PC pipeline
  handoff, an exact breakpoint and one ARM instruction step. Ordinary RISC OS
  application Run remains a separate packaging and environment contract.

## Evidence

The container manifest publishes the Debian package version, every binutils
executable SHA-256, packaged copyright SHA-256, sandbox limits and canonical
manifest digest. Automated contracts cover request/address policy, include
isolation, diagnostics, source lines, symbols, entry point, byte reproducibility,
custom no-debug metadata and cleanup. A deployed port-8090 build produced the
12 bytes `01 00 A0 E3 02 10 80 E2 FE FF FF EA`, ARM2 ELF attributes, `_start`
at `&00008000`, complete byte/source mapping and no warnings or errors.
