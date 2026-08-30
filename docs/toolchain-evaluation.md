# Native toolchain evaluation

Status: Accepted; ca65/ld65 and BeebAsm local native slices implemented  
Date: 21 August 2026  
Scope: P0-013, P0-014, BLD-001–BLD-004, BLD-300–BLD-305, BLD-327,
BLD-329, DEC-005 and DEC-010

## Decision

The first independent native 6502 toolchain adapter is **ca65 + ld65 from the
cc65 suite**, pinned to Debian package `2.19-1` in the isolated Symfony worker.
The separate BBC-dialect adapter is **BeebAsm 1.11**, built from pinned upstream
commit `ca2cc5fd2fa3f73da3b0682ad004b2aca99840c3` in that same isolated image.

BeebAsm is retained as a distinct compatibility adapter because its BBC
Micro/BBC BASIC-like dialect, direct DFS construction and established Acorn
workflow are materially different from ca65. It is not selected as the second
adapter because the browser-local assembler already covers the first
BeebAsm-style source slice, while ca65 proves the harder multi-stage
assemble/link contract and can later be reused by an 8-bit C pipeline.

Both are now advertised only after their exact readiness manifests pass. Their
parsers, generated documents, normalized results and real browser build/debug
flows have passed that gate. The later cc65 C and bounded ARM2 binutils slices
use the same gate; this does not complete RISC OS C/application packaging,
Archimedes execution, media-output or multi-tenant worker work.

## Evidence and primary sources

- The [cc65 repository](https://github.com/cc65/cc65) describes a complete
  65(C)02 cross-development suite, including assembler, compiler, linker,
  archiver and simulator, and explicitly lists the Acorn BBC series among its
  supported targets. It is distributed under the zlib licence.
- The [ca65 user guide](https://cc65.github.io/doc/ca65.html) documents NMOS
  6502, 65SC02, 65C02 and W65C02 modes; listing generation; make-style
  dependency output; include paths; command-line defines; macros; and source
  positions/local symbols in debug-enabled object files.
- The [ld65 user guide](https://cc65.github.io/doc/ld65.html) documents linker
  configuration, map/label output and `--dbgfile`. It also warns that its debug
  file format is still subject to change, so the IDE must parse only the pinned
  version and retain the raw file as an immutable generated document.
- The [BeebAsm repository and manual](https://github.com/stardot/beebasm)
  describe version 1.11 as a GPL-3.0-or-later portable 6502 assembler with BBC
  Micro-style syntax. Its native workflow includes standalone output, direct
  DFS SSD/DSD creation, verbose listings and global/local label exports. Its CPU
  directive covers original 6502 and a 65C02 subset but excludes Rockwell bit
  operations.

These sources were reviewed on 21 August 2026. Version and licence facts must
be revalidated at the actual image pin; a moving branch or host package is not
acceptable provenance.

## Scored comparison

Scores use 0 (absent), 1 (weak), 2 (usable with significant adapter work), 3
(good), and 4 (strong). Weight reflects the first native-adapter slice, not a
claim that one assembler is universally better.

| Criterion | Weight | ca65 + ld65 | BeebAsm | Consequence |
| --- | ---: | ---: | ---: | --- |
| Distinct dialect proves adapter coexistence | 5 | 4 | 2 | ca65 exercises project-level dialect selection instead of extending the existing BBC-style grammar. |
| Structured multi-file/object/link flow | 5 | 4 | 2 | ca65/ld65 validates staged artifacts, dependency edges and linker configuration. |
| Source, symbol and address evidence | 5 | 4 | 3 | Both expose useful data; ca65 adds debug-enabled objects/linker data, while its evolving debug format requires a pinned parser. |
| 6502/65C02 CPU coverage | 4 | 4 | 3 | ca65 has separately selectable CMOS variants; BeebAsm's documented 65C02 mode omits Rockwell additions. |
| BBC-native syntax and legacy source fit | 4 | 1 | 4 | BeebAsm is the later compatibility winner and must not be replaced by automatic syntax translation. |
| BBC media construction | 3 | 1 | 4 | BeebAsm can write emulator-ready DFS images; the IDE's independent media layer can package ca65 output. |
| Future C-toolchain reuse | 5 | 4 | 0 | ca65/ld65 are the assembler/linker stages used by cc65. |
| Deterministic, bounded invocation potential | 5 | 3 | 3 | Both are native executables and require the same no-network, quota and output-validation boundary. |
| Licence integration | 3 | 4 | 2 | zlib is straightforward; GPL-3.0-or-later is usable in a distributed container but needs corresponding-source and notice compliance. |
| Browser-only feasibility | 2 | 1 | 1 | Neither is accepted as browser-local without a separately reviewed WASM port and equivalent isolation. |
| Weighted total |  | **138** | **98** | ca65/ld65 is selected for the second adapter; BeebAsm stays on the roadmap. |

## Required adapter contract

The adapter will implement the existing `8bit-net.build-result` schema rather
than leaking command-line details into the project or UI. A ca65 target consists
of source units plus one linker configuration and produces, at minimum:

1. One ca65 object per source unit, built with debug information and bounded
   listing/dependency outputs.
2. One ld65 link invocation producing the requested binary plus a map, labels
   and pinned-version debug file.
3. Parsed diagnostics with severity, stage, file, line and column where the
   tool provides them; unparsed output is retained in bounded logs.
4. A normalized symbol table and source/address map. Ambiguous, optimized or
   unmapped ranges remain explicitly unmapped rather than being guessed.
5. Immutable generated documents for every accepted listing, dependency file,
   linker map, label file, debug file and effective linker configuration.
6. SHA-256 input, pinned-toolchain-manifest and artifact provenance, including
   the exact worker image digest and argv vector (never a shell command string).
7. A size/memory report derived from linker segments and the selected Acorn
   machine profile, with overlaps and out-of-profile regions diagnosed.

The project manifest owns the explicit dialect/toolchain choice. Existing
BBC-style files are never silently rewritten into ca65 syntax. Mixed-dialect
projects use separate build targets and may share only declared binary or
library artifacts through target dependencies.

## Native sandbox boundary

Native execution belongs behind a supported PHP/Symfony API and a disposable,
non-root build worker. It must not be added to the current nginx browser image
or invoked by browser-controlled shell text.

The worker contract requires:

- an immutable toolchain filesystem and an empty writable job directory;
- normalized project-relative inputs only, with symlink/hardlink escape checks;
- argv-array process creation with an allowlist for the pinned `ca65` and
  `ld65` paths; no shell, user scripts, response files or environment expansion;
- network disabled by default and no credentials or host ROM mounts;
- CPU, wall-clock, memory, process, open-file, input-byte, output-byte and output-
  count limits, with concurrent stdout/stderr draining;
- cancellation that terminates the complete process group and deterministic
  cleanup of the job volume;
- output collection by an explicit manifest, rejecting symlinks, devices,
  unexpected paths and files changed after validation;
- tenant and job identity on structured logs without source, ROM or artifact
  content;
- identical normalized success and no-artifact failure envelopes to the current
  browser adapters.

The native cache key may reuse the browser content-addressing rules only after
adding toolchain image digest, linker configuration, target dependencies and
sandbox-policy version. Cache entries are tenant-separated and revalidated by
SHA-256 before return.

## Proof plan and acceptance evidence

The adapter is not complete until all of the following are automated:

- golden 6502 and 65C02 multi-file projects build and run in the matching real
  ROM-aware machine profile;
- a deliberate syntax error, unresolved import, branch-range error, linker
  overflow and invalid linker configuration produce navigable diagnostics and
  no implied executable artifact;
- listings, dependencies, symbols, map and source/address records survive
  includes, local scopes and macros without fabricated mappings;
- two clean builds are byte-identical and have identical normalized metadata
  apart from permitted duration/cache fields;
- source, define, CPU, linker config, dependency artifact and machine-profile
  changes invalidate the correct cache entry; unrelated files do not;
- path traversal, absolute paths, symlinks, include cycles, fork attempts,
  output floods, memory pressure, timeouts, cancellation and malformed native
  output are rejected and cleaned up;
- the worker runs without network or elevated privileges and cannot see local
  ROM storage;
- licence notices, source-offer obligations where applicable, SBOM and pinned
  image provenance are present;
- Playwright proves toolchain selection, build, navigable error recovery,
  generated documents, run/debug and accessible keyboard operation on port
  8090.

## Implemented BeebAsm binary slice

The implemented binary slice preserves BBC-style source, labels, expressions,
literal project `INCLUDE`, filename-free `SAVE`, conditionals and macros. It
exports labels and verbose output as read-only evidence and maps emitted bytes
to source only when the source row is unambiguous. `INCBIN`, host-writing
directives, source-controlled output filenames and `TIME$` are rejected.
Direct SSD/DSD creation remains behind the independent media-validation gate.
The runtime image includes the GPL-3.0-or-later licence and exact corresponding
source archive; that licence does not cover Acorn ROMs or user projects.

## Implemented ARM2 assembler/linker slice

Debian Bookworm `binutils-arm-none-eabi` `2.40-2+18+b1` is pinned as adapter
`gnu.arm-none-eabi-binutils` `2026.08.1`. GNU assembly units are assembled
little-endian with `-mcpu=arm2`, linked at a validated word-aligned address in
the 26-bit ARM2 range, and extracted as a raw binary. The retained ELF, linker
map, symbol table, disassembly, attributes and decoded DWARF rows provide
evidence without becoming the runtime artifact.

The adapter was selected because the Debian package is maintained, immutable
at the image pin, scriptable through fixed argv, and exposes the diagnostics,
symbols and source metadata needed by the common result contract. It is not a
RISC OS compiler or packager. The artifact schema records processor `arm2`, raw
container format and `riscOsFiletype: null`; the IDE disables Run, Debug and
Test until a qualified Acorn Archimedes runtime is integrated. The complete
boundary and proof are recorded in `docs/adr/0005-arm2-build-boundary.md`.

## Open work

- Record the Debian source-package archive/commit hash and formal update policy;
  the deployed package version, executable hashes, manifest digest and image
  digest are already emitted and verified by readiness and build provenance.
- Extend the pinned diagnostic/debug parsers with additional adversarial
  fixture families; malformed paths, diagnostics, missing artifacts and output
  bounds already have contract coverage.
- Add public multi-tenant job persistence/fairness only with a separate threat
  model and persistence ADR. Local mode deliberately stays synchronous and
  ephemeral.
- Decide whether a reviewed WASM build could later offer an optional local ca65
  path without weakening the common adapter result contract.
- Complete a separate primary-source evaluation for RISC OS C, ABI/runtime
  libraries, AIF/filetype/application packaging and the first genuine
  Archimedes runtime. Bare-metal GNU ARM output must not be relabelled as any of
  those capabilities.
