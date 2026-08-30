# ADR 0003: pinned BeebAsm compatibility adapter

Status: Accepted for the local binary-output vertical slice  
Date: 21 August 2026  
Requirements: BLD-001–BLD-014, MED-001–MED-003, SEC-001–SEC-003

## Context and decision

BBC-style assembly is a distinct source dialect and cannot be translated to
ca65 without changing project semantics. The IDE therefore adds BeebAsm 1.11 at
upstream commit `ca2cc5fd2fa3f73da3b0682ad004b2aca99840c3` as a separate adapter
inside the existing network-disabled native-builder container.

The Docker build compiles that exact commit in a dedicated stage. The runtime
image contains the resulting executable, GPL-3.0-or-later licence and a source
archive for the exact commit. The manifest publishes the commit, executable
SHA-256 and licence/source locations. No host BeebAsm installation is used.

`GET /api/v1/toolchains/beebasm` advertises readiness and
`POST /api/v1/builds/beebasm` accepts the common native-build request. The first
slice produces a standalone `6502-binary`; DFS/DSD creation is deliberately a
later media-adapter operation so generated images pass the IDE's independent
catalogue/geometry validation before retention or mounting.

## Source and filesystem policy

BeebAsm's language includes filesystem operations. A compromised source must
not read the builder image or select arbitrary output paths. This adapter:

- accepts exactly one root source unit using `.asm`, `.6502` or `.a65`;
- permits only literal, quoted, safe project-relative `INCLUDE` paths naming a
  supplied source file;
- rejects dynamic/absolute/traversing includes and include cycles;
- rejects `INCBIN` until bounded binary project-file transport is available;
- rejects `PUTFILE`, `PUTTEXT` and `PUTBASIC` in the binary-output slice;
- requires exactly one filename-free `SAVE start,end[,exec[,reload]]` and
  rejects source-controlled SAVE filenames;
- tokenizes colon-separated statements before applying the directive policy, so
  a label or earlier statement cannot hide a filesystem operation;
- rejects `TIME$` until a target-controlled deterministic clock exists;
- supplies the only output path through fixed `-o <job>/.build/output.bin` argv;
- never exposes disc-image, boot, title, cycle or host-input command options;
- retains the existing request, process, log, artifact and cleanup limits.

The service invokes a fixed argv vector with `-w -vc -v -dd -labels`; no shell,
response file, user environment or command fragment is accepted.

## Evidence fidelity

Visual-C++-style output provides authoritative file/line diagnostics. The label
export provides global/local numeric symbols. Verbose output provides emitted
addresses and exact bytes but not an authoritative file/line map. The parser
therefore associates a row only when its normalized source text occurs exactly
once among supplied files; ambiguous macro/include rows remain visibly unmapped.
No address is guessed. Symbol entry points are validated against the output
range, and diagnostic-only builds return no artifact.

## Remaining work

The media slice must add a typed DFS output request, validate every generated
catalogue and extent with the independent DFS parser, reject unexpected files,
and only then expose an image for download/mount. `INCBIN`/asset transport needs
a separate bounded binary-input schema. Multi-block SAVE artifacts require a
declared multi-artifact contract rather than silently retaining one file.
