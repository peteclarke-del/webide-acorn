# ADR 0009: RISC OS C toolchain candidate boundary

> Renumbered from 0006. Two records were written with that number, and a
> decision log whose identifiers are ambiguous cannot be cited. The
> Archimedes browser runtime keeps 0006 because it was referenced first;
> this record takes the next free number. Nothing in the decision changed.

Status: accepted direction, toolchain unavailable  
Date: 25 August 2026

## Context

BLD-329 requires a genuine RISC OS C compiler, ABI, headers, libraries and
application image. The existing `gnu.arm-none-eabi-binutils` adapter proves
ARM2 assembly and raw linking only. It cannot supply the RISC OS procedure-call
contract, C runtime, SharedCLibrary or UnixLib bindings, AIF startup, filetype or
application-directory behavior.

The first supported runtime target is the qualified Archimedes A310 profile
running RISC OS 3.11. A compiler that only targets APCS-32, later RISC OS,
ARMv4 or VFP hardware is therefore insufficient for this slice.

## Decision

The product will preserve the Archimedes A310, ARM2 and 26-bit RISC OS 3.11 as
the primary RISC OS C target. A licensed Acorn Desktop Development Environment
compiler and SDK, commonly identified by the Norcroft compiler name, is the
selected toolchain family for evaluation. The compiler, headers and libraries
are user-supplied licensed inputs. They MUST NOT be committed, copied from an
unverified installation, included in the public image, or represented as
available before their licence permits the intended local container use.

The selection fixes the required execution target and ABI direction. It does
not accept any particular compiler release, grant redistribution rights, or
complete BLD-329. Until licensed inputs are supplied and the proof below
passes, RISC OS C remains visibly unavailable while ARM2 assembly and Absolute
application packaging continue to work independently.

## Open-source alternative assessed

GCCSDK is the leading open-source candidate for a later 32-bit RISC OS target
because its cross tools use the `arm-unknown-riscos` target and its build
environment is used by maintained RISC OS projects. The upstream service
currently publishes source through the GCCSDK Subversion repository rather
than a signed, immutable container release. Repository revision 7800 was
queried directly on 25 August 2026. `trunk/gcc4` last changed at revision 7800
on 17 October 2024; `trunk/autobuilder` last changed at revision 7799 on 8
October 2024; the newest listed compiler tag is `release_4_7_4_v6`, last changed
at revision 7666 on 24 December 2021.

The pinned revision's README identifies GCC 4.7.4 release 6, binutils 2.24,
UnixLib 5.0 and an **APCS-32 compliant** `arm-unknown-riscos` target. APCS-32
cannot execute on the ARM2 processor in the A310. GNU also records the GCC 4.7
series as unsupported. GCCSDK revision 7800 is therefore rejected for the
current A310 and RISC OS 3.11 execution slice. It remains a candidate only when
a qualified 32-bit Acorn and RISC OS runtime, plus its required loader and
library modules, are in scope.

GCCSDK is not accepted merely because it can produce an ARM object. Acceptance
requires one pinned source revision, a reproducible source archive, hashes for
every installed cross tool and runtime input, a licence inventory, and an
automated proof that its selected mode runs on the exact selected 32-bit Acorn
and RISC OS environment. It cannot be used to satisfy the A310 proof below.

## Required decision evidence

The evaluation must determine and record:

1. The exact GCCSDK repository revision and all fetched component revisions.
2. Whether the compiler can emit ARM2-compatible, little-endian, 26-bit code
   without ARMv3, ARMv4, Thumb or VFP instructions.
3. The selected calling convention and the size, alignment and signedness of
   every public C scalar type.
4. Whether the first runtime uses UnixLib, SharedCLibrary stubs or a smaller
   reviewed application startup, including the exact RISC OS module versions
   required in the guest.
5. The produced object and executable formats, relocation model, AIF header,
   entry behavior, stack and heap ownership, environment handlers and exit
   path.
6. The SDK header and library redistribution terms and corresponding-source
   obligations for the complete container image.
7. Diagnostic, symbol and source-line formats that can enter the common build
   result without guessed mappings.

## Rejected shortcuts

- Generic GNU `arm-none-eabi-gcc` remains a bare-metal compiler and will not be
  exposed as RISC OS C.
- The selected Acorn/Norcroft toolchain will not be copied into the image
  without licensed inputs and a separately reviewed sandbox adapter.
- A raw Absolute file wrapped from arbitrary C output is not an AIF and will
  not be labelled as one.
- A compiler mode that requires a later SharedCLibrary, 32-bit RISC OS or a
  newer ARM processor will not be used for the A310 profile.

## First executable proof

Before the adapter is shown in the target selector, a pinned builder must:

1. Compile two C translation units and one project header using fixed argv
   arrays in the existing network-disabled worker.
2. Retain compiler assembly, objects, link map, symbols, source lines, effective
   specs and the final application image as bounded immutable evidence.
3. Independently validate every AIF header word, image extent, entry, zero-init
   extent, relocation/debug fields and filetype before launch.
4. Package a typed `!RunImage` and `!Run`, stage them through the existing
   HostFS contract, and launch only through RISC OS FileSwitch.
5. Demonstrate a C call across translation units, one OS SWI, initialized and
   zero-initialized data, stack use and a clean return to the desktop on the
   live A310 core.
6. Rebuild byte-identically, reject a deliberate compiler and linker failure,
   navigate the exact original C source, and pass the native sandbox adversarial
   suite.

Only that proof can unblock the RISC OS C completion, types, hover, signature
and target-jump cells in EDT-222.

## Sources reviewed

- [RISC OS PRM code file formats](https://www.riscos.com/support/developers/prm/objectformat.html)
- [RISC OS PRM Shared C Library](https://www.riscos.com/support/developers/prm/sharedclibrary.html)
- [RISC OS Desktop Tools Link documentation](https://www.riscos.com/support/developers/dde/link.html)
- [GNU GCC 4.7 release status](https://gcc.gnu.org/gcc-4.7/)
- GCCSDK source service: `svn://svn.riscos.info/gccsdk/`
