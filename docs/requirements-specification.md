# Acorn Web IDE — Product Requirements Specification

Status: Draft for stakeholder review  
Version: 0.1  
Date: 20 August 2026  
Owner: Product and engineering  
Implementation gate: **No product code is to be written until this specification and the accompanying backlog are reviewed and accepted.**

## 1. Purpose

The Acorn Web IDE is a browser-based, integrated environment for researching,
creating, editing, building, testing, debugging, and packaging software for the
Acorn computer family. It must support projects ranging from small BASIC or
assembly programs through multi-file games, ROMs, disk images, Tube software,
and RISC OS applications.

The experience should be immediately familiar to users of the Web64 IDE at
`https://web64.nofs.ai/ide`, while being an independent Acorn product with its
own identity, implementation, documentation, and assets. The inspected Web64
experience is the minimum functional baseline, not a source of code, content,
branding, or inaccessible design decisions.

This document defines the product requirements. `docs/todo.md` turns them into
a traceable delivery plan.

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
used in their RFC 2119 sense. A requirement identifier is stable and may be
referenced by design records, issues, tests, and release evidence.

## 3. Product outcomes

### 3.1 Goals

- G-01: A user can begin with a machine-aware example, edit it, build it, run
  it in the matching emulator, set a source breakpoint, inspect state, fix the
  code, and export authentic media without leaving the application.
- G-02: Machine selection controls the complete development contract: CPU,
  instruction set, memory map, ROM assumptions, display and sound hardware,
  filing system, peripherals, build options, emulator, debugger, examples, and
  documentation.
- G-03: Advanced configurations—sideways ROM/RAM, shadow RAM, filing systems,
  Tube processors, expansions, and storage devices—are composable, validated,
  saved with the project, and reproducible.
- G-04: The IDE is equally credible for code, graphics, maps, sound, testing,
  and low-level investigation.
- G-05: The browser interface conforms to WCAG 2.2 AA and remains productive
  with keyboard, screen reader, zoom, reduced motion, and high contrast.
- G-06: Builds and test runs are deterministic, isolated, observable, and
  repeatable locally and in CI.
- G-07: The design is extensible: adding a machine, compiler, media format,
  emulator, inspector, or asset codec does not require duplicating the IDE.

### 3.2 Non-goals for the first production release

- NG-01: Cycle-perfect support for every Acorn machine and every historical
  expansion in one release. Unsupported combinations must be labelled, never
  silently approximated.
- NG-02: Browser-based electronic design, ROM redistribution, or provision of
  proprietary manuals and software without permission.
- NG-03: Copying Web64 source code, trademarks, text, project formats, private
  APIs, or assets.
- NG-04: Replacing specialist native tools where browser security or emulator
  maturity prevents an accurate workflow. Such tools may be integrated through
  declared adapters later.
- NG-05: A general-purpose cloud desktop or unrestricted remote shell.

## 4. Users and principal journeys

### 4.1 Personas

- P-01 Beginner: learns BASIC and machine fundamentals from examples and
  contextual documentation without first installing a toolchain.
- P-02 Retro developer: writes 6502/65C02 assembly and creates disk, tape, ROM,
  graphics, and sound assets with precise machine control.
- P-03 RISC OS developer: builds ARM assembly or C applications, packages RISC
  OS applications, and debugs ARM code and operating-system interactions.
- P-04 Educator: creates repeatable lessons, shares read-only templates, and
  assesses tests without exposing private student projects.
- P-05 Maintainer/porter: imports an existing source tree, configures its real
  toolchain, compares multiple machines, profiles, and regression-tests output.
- P-06 Researcher: searches licensed technical material by selected machine and
  follows citations to authoritative sources while examining live hardware
  state.
- P-07 Platform operator: monitors builds, quotas, toolchain health, audit
  events, and abuse through the shared 8bit-net administration plane.

### 4.2 Required end-to-end journeys

- J-01 Create project → select machine/configuration → choose language/template
  → edit → build → run → debug → export.
- J-02 Import a local project/folder/archive → resolve target and toolchain →
  preserve unknown files → build without unwanted source rewrites.
- J-03 Add graphics/audio/map asset → edit visually → generate deterministic
  binary and include metadata → inspect it in the running program.
- J-04 Create multiple build targets from shared sources, such as BBC B, Master,
  and Electron variants, then build and test all.
- J-05 Configure a host BBC and Tube second processor, debug the correct CPU,
  and inspect Tube communication from both sides.
- J-06 Save locally, export an entire portable project, optionally sign in,
  restore revision history, share within granted permissions, and return to a
  fully reproducible state.
- J-07 Search target-filtered documentation, insert or adapt an example with
  provenance, and retain citations/licensing metadata.
- J-08 Run automated unit, integration, screenshot, timing, and input-script
  tests headlessly and obtain machine-readable results.

## 5. Governing engineering constraints

- ARC-01: The repository `docs/architecture-contract.md` is authoritative.
- ARC-02: New browser code MUST use React, TypeScript, and Vite.
- ARC-03: New server-side application code MUST use a currently supported PHP
  release and Symfony.
- ARC-04: Every deployable component MUST be containerised, start with Docker
  Compose including declared dependencies, expose health checks, emit structured
  logs, provide migrations, and document local startup.
- ARC-05: Protocol/toolchain/emulator adapters MUST remain separate from the
  domain model. Core project concepts MUST NOT depend on a single emulator,
  assembler, CPU, or file format.
- ARC-06: Persistence MUST be chosen from workload evidence and recorded in an
  ADR; no repository-wide database default is to be assumed.
- ARC-07: Administration MUST use the shared administration application and
  backend-enforced capabilities scoped to service and resource.
- ARC-08: Credentials, proprietary ROMs, registration codes, private project
  contents, or live user data MUST NOT enter source control.
- ARC-09: Third-party dependencies, ROMs, manuals, examples, fonts, firmware,
  and codecs require a recorded provenance, version, licence, redistribution
  decision, integrity digest, and update policy.
- ARC-10: Components SHOULD be independently testable and share schemas,
  adapters, design tokens, and primitives instead of copied logic (DRY).

## 6. Web64 minimum baseline and Acorn translation

The baseline below was observed on 20 August 2026. Every row is required unless
explicitly deferred with an accepted product decision.

| Web64 baseline | Acorn IDE requirement |
|---|---|
| Dark, dense, resizable project/editor/emulator/inspector workbench | Acorn-themed, responsive, accessible workbench with saved layouts and equivalent information density |
| Open/save source and complete project | Open/save files, folders, archives, and a versioned portable Acorn project bundle |
| Project, import, SDK, and build trees | Project tree, external/import tree, read-only SDK/toolchain tree, generated tree, and artifacts tree |
| Source, origin, entry point, symbol navigation | Machine-aware load/exec addresses, entry point, language service outline, symbols, references, and source/address navigation |
| Native assembler and compatibility modes | Pluggable 6502/65C02 and ARM assemblers with explicit dialect/version/profile |
| C compiler, ABI, runtime, includes, optimizer, diagnostics settings | Toolchain-specific C profiles for 8-bit and ARM targets with ABI/runtime/optimization/debug controls |
| Multi-target build and build-all | Named build configurations with shared sources, target matrices, dependency graph, incremental build, and build-all/test-all |
| Defines, translation units, linked-on-use libraries | Defines, source sets, libraries, generated assets, linker layout, and dependency visibility |
| PRG/test/cartridge outputs | Executables, raw binaries, ROMs, tape/disk images, Tube programs, RISC OS modules/applications, and test artifacts |
| D64 disk mastering, logical files, disk sets, ZIP export, run disk | DFS/ADFS and machine-appropriate tape/disk/image mastering, logical files, boot configuration, set export, validation, and run-media |
| Live diagnostics, line map, artifact/file/symbol/line/asset counts | Severity-filtered diagnostics, source maps/listings, size/map reports, status provenance, and navigable build summary |
| Find/replace, function/symbol selectors, generated read-only files | Accessible editor search, project search, outline, references, generated-file policy, and multi-file editing |
| Embedded emulator with load/start/pause/reset/power, fit/scale, audio, input | Machine-matched emulator controls, video/audio/input/media options, full-screen, state save/load, rewind, and deterministic modes |
| Breakpoint address entry and source-line toggles | Address, source, symbol, conditional, hit-count, log, exception/interrupt, data watchpoints where supported |
| Continue, pause, instruction step, step over | Continue, pause, stop, restart, instruction/source step in/over/out, run-to-cursor/address, reverse controls where supported |
| Registers, globals, locals, memory | CPU/coprocessor registers, flags/status, stack, globals, locals, expressions, watches, bank-aware memory, and editable state |
| Character, sprite, block, map editors | Character/font/UDG, sprite/object, tile/block, screen and map editors matched to Acorn video capabilities |
| Tracker and chip sound editor | Target-aware music/SFX/sample tools for Atom, SN76489 systems, and Archimedes sound, with pluggable formats |
| Local settings import/export/reset | Layered defaults/user/workspace/project settings with schema versioning, validation, migration, import/export, and reset |
| Cloud projects, private assets/files, revision history, storage | Optional authenticated sync, revision history, sharing, quota, deletion/export, and offline conflict handling |
| Inspector diagnostics and line map always available | Contextual inspector with problems, source/address map, build/artifact facts, and pin-able debugger/hardware views |
| Keyboard shortcuts and compact icon toolbar | Complete command palette and remappable keyboard operation; icons always have accessible names and state |

## 7. Target and capability model

### 7.1 Definition of support

- TGT-001: A target shown as supported MUST have a versioned machine profile,
  at least one compatible build profile, at least one licensed emulator adapter,
  a debugger capability declaration, a media/export path, example project,
  automated smoke test, and user documentation.
- TGT-002: Target labels MUST distinguish `production`, `preview`,
  `experimental`, and `configuration only` states.
- TGT-003: The UI MUST display unsupported or inaccurate combinations before a
  build/run, explain why, and suggest valid alternatives.
- TGT-004: Each machine profile MUST declare CPU(s), clock and timing model,
  RAM layout, bank/overlay rules, ROM slots, OS/firmware requirements, video,
  audio, keyboard, input, ports, storage controllers, filing systems, network,
  expansions, legal asset prerequisites, and emulator/debugger capabilities.
- TGT-005: Profiles MUST use stable identifiers and a schema version, validate
  on load, migrate losslessly when possible, and retain unknown extension data.
- TGT-006: Configuration resolution MUST be deterministic and generate a human-
  and machine-readable manifest stored with build and test results.

### 7.2 Required machine catalogue

The catalogue is a scope commitment; rollout priority is defined in the TODO.

| Family | Required selectable profiles/variants |
|---|---|
| Atom | Atom RAM variants; tape; Atom DOS; floating-point ROM option; AtoMMC-compatible storage when adapter support permits |
| BBC Micro | Model A; Model B OS 1.2; common 8271 and 1770 DFS configurations; US/West German variants where emulator evidence permits |
| BBC B+ | B+ 64K and B+ 128K, including shadow and sideways memory behavior |
| Electron | Base Electron; Plus 1; Plus 3; common DFS/ADFS and sideways-memory expansions as separately validated capabilities |
| Master | Master 128; Master Turbo; Master 512; Master Compact; configurable filing systems and cartridge/sideways slots |
| Archimedes ARM2/ARM3 | A305/A310; A410/1/A420/1/A440/1; A3000; A540, grouped only where hardware behavior is equivalent and tested |
| Later ARM Acorn | A4; A3010/A3020/A4000; A5000; Risc PC/A7000 as a later compatibility tier rather than being mislabelled Archimedes |

- TGT-007: Closely related models MAY share a base profile, but differences in
  memory, chipset, OS, storage, CPU, timing, input, and packaging MUST remain
  explicit overrides with independent tests.
- TGT-008: Firmware/ROM selectors MUST show version, source/provenance, digest,
  licence status, compatibility, and whether the file is user-supplied.
- TGT-009: The product MUST provide lawful bring-your-own-ROM flows and MUST NOT
  imply that unavailable proprietary images are bundled.

### 7.3 Expansions and peripherals

- TGT-020: Sideways ROM/RAM MUST be modelled as ordered banks with slot number,
  size, write policy, image/source, title/version, and collision validation.
- TGT-021: Shadow/private/hazel/filing-system memory MUST be visible in the
  memory map and debugger when relevant.
- TGT-022: Tube configurations MUST separate host and parasite profiles and
  initially cover 6502/65C02, Z80, 80186, 32016, and ARM second processors as
  capability-gated options; release support depends on licensed, tested emulator
  adapters.
- TGT-023: Tube debugging MUST permit host/parasite focus, independent CPU
  pause/step where technically safe, both register sets, both address spaces,
  Tube ULA channel inspection, and timestamped cross-processor events.
- TGT-024: Storage options SHOULD cover cassette, DFS/ADFS drives, hard disks,
  SD/MMC adapters, and RISC OS storage where supported by the selected machine.
- TGT-025: Optional devices SHOULD include analogue/digital joystick, mouse,
  printer/serial, user port, 1 MHz bus, cartridge, Econet, and expansion-specific
  devices; each adapter declares input, emulation, debugger, and export support.
- TGT-026: A configuration comparison view MUST explain material differences
  between two targets and identify project features that prevent portability.

## 8. Project system

- PRJ-001: A project MUST have a versioned manifest containing identity,
  machine configurations, build/test targets, source sets, dependencies,
  toolchain pins, media layouts, assets, run/debug profiles, settings, and
  extension data.
- PRJ-002: Project paths MUST be relative, normalized, case-aware, traversal-
  safe, and portable across supported host file systems.
- PRJ-003: The file tree MUST support create, rename, move, duplicate, delete
  with recoverable undo, folders, multi-select, drag/drop, filtering, and type-
  appropriate previews.
- PRJ-004: The IDE MUST distinguish authored, imported, SDK, dependency,
  generated, build, and ignored files visually and semantically.
- PRJ-005: Generated and SDK files MUST default to read-only and link back to
  their generator/package; users may inspect and copy but cannot accidentally
  edit build output as source.
- PRJ-006: Import MUST support individual files, directories through browser
  file-system APIs where available, ZIP/project bundles, disk/tape images, and
  Git-based import when enabled. Import MUST preview conflicts and never discard
  unknown files.
- PRJ-007: Export MUST produce a self-describing portable bundle excluding
  secrets and unredistributable ROMs, and MUST include a dependency/ROM report.
- PRJ-008: Autosave, explicit save, dirty state, crash recovery, and quota state
  MUST be clear. Local work MUST remain usable without an account.
- PRJ-009: Multi-target projects MUST allow common and conditional source sets,
  target-specific generated assets, and matrix build/test without source forks.
- PRJ-010: Templates MUST state machine, configuration, toolchain, licence,
  expected output, tested version, learning level, and included capabilities.

## 9. Editor and language intelligence

- EDT-001: The editor MUST provide tabs, split views, diff view, minimap option,
  line numbers, gutters, folding, bracket matching, whitespace display, column
  selection, multi-cursor, undo/redo, indentation control, encoding and line-
  ending visibility, and large-file safeguards.
- EDT-002: Find/replace MUST cover current file and project, with literal,
  case-sensitive, whole-word, and regular-expression modes, previews, and
  keyboard/screen-reader operation.
- EDT-003: Language adapters MUST provide syntax highlighting, outline,
  go-to-definition, find references, hover, signature help, completion,
  snippets, rename where safe, and diagnostics to the degree supported; the UI
  MUST not claim unavailable semantic features.
- EDT-004: Required source types are 6502/65C02 assembly, BBC BASIC text and
  tokenized forms, Atom BASIC forms, C for supported 8-bit toolchains, ARM
  assembly, C for RISC OS toolchains, linker/configuration files, scripts,
  project manifests, test files, and asset metadata.
- EDT-005: Numeric values MUST be displayable and enterable using familiar
  Acorn conventions (`&` hex, `%` binary where applicable) plus `$`/`0x` when
  accepted by the selected toolchain; conversions are available without
  rewriting source unexpectedly.
- EDT-006: Source/address links MUST be based on toolchain-produced maps,
  listings, labels, or debug data and carry build provenance so stale mappings
  cannot be mistaken for the current build.
- EDT-007: Diagnostics MUST include severity, stable code, message, file/range,
  target, toolchain, build, related locations, help link, and safe quick-fix data.
- EDT-008: The command palette MUST expose every significant action with
  searchable names, shortcuts, enabled/disabled reasons, and no pointer-only
  commands.
- EDT-009: Editing fundamentals MUST include cut, copy, paste, paste as plain
  text, select all, undo/redo, duplicate selection/line, delete line, move line
  or selection, join/split lines, indent/outdent, tab-to-spaces conversion,
  toggle line/block comment, case conversion, trim trailing whitespace, format
  selection/document where the language adapter supports it, save, save all,
  revert with confirmation, and reopen recently closed editors. Every operation
  MUST have a keyboard path and preserve an expected, documented undo boundary.
- EDT-010: Clipboard behavior MUST preserve ordinary text interoperability,
  handle unavailable browser clipboard permissions with an accessible fallback,
  avoid copying hidden/stale/generated data unexpectedly, and never execute or
  transform pasted code without explicit user action.
- EDT-011: Completion MUST be contextual to language, dialect, selected CPU,
  machine profile, ROM/API version, toolchain, current scope, and build target.
  Candidate kinds MUST include, where applicable, opcodes, directives, commands,
  keywords, types, functions/procedures, variables, constants, labels, BASIC
  line targets, macros, registers, hardware/OS symbols, OS calls and SWIs,
  members, include paths, project files, build defines, and snippets.
- EDT-012: Completion MUST support automatic and explicit invocation, incremental
  filtering, ranked matches, kind/source icons with text equivalents, signature
  and summary, replacement range, commit characters, keyboard selection,
  acceptance and dismissal. It MUST identify ambiguous or unavailable candidates
  and MUST NOT insert target-incompatible syntax silently.
- EDT-013: Completion, hover, and signature data MUST identify their source and
  applicable version. Project symbols and current toolchain metadata take
  precedence according to documented rules; stale build-derived results MUST be
  marked and excluded when unsafe.
- EDT-014: Type information MUST be available as hover content and optional,
  separately configurable inlay hints. Depending on language support this MUST
  include declared/inferred type, storage size, signedness, address/address
  space, parameter names/types, return type, constant value, structure/record
  fields, calling convention, and optimized/unavailable status without inventing
  types for untyped assembly or BASIC values.
- EDT-015: Hovering or keyboard-focusing a recognized token/command MUST expose
  a dismissible, non-obscuring definition tooltip. It MUST include as applicable:
  canonical name, category, syntax/signature, concise definition, parameters and
  return/result, accepted ranges, examples, side effects, flags affected, cycle
  information and variability, memory/register effects, target/CPU/ROM/toolchain
  applicability, deprecation or incompatibility warnings, related commands, and
  links/citations to approved detailed documentation.
- EDT-016: Hover help MUST cover language keywords and commands, 6502/65C02 and
  ARM instructions, assembler directives, BASIC statements/functions, C symbols
  and types, macros, user-defined labels/functions/variables, hardware registers
  and bitfields, MOS calls, RISC OS SWIs, project settings, diagnostics, and
  generated symbols where authoritative metadata exists. Unknown tokens MUST be
  reported as unknown rather than supplied with guessed documentation.
- EDT-017: Signature help MUST follow the active argument while typing or on
  explicit request, show overloads/forms and optional/repeated parameters, and
  remain keyboard and screen-reader navigable without moving editor focus.
- EDT-018: Definitions and control-flow targets MUST be directly navigable.
  Activating a recognized operand or token by click/tap or keyboard equivalent
  MUST navigate or offer a choice for assembly branch/jump/call targets, BASIC
  `GOTO`/`GOSUB`/line-number targets, C/ARM functions and symbols, macros,
  includes, data labels, OS calls/SWIs and hardware symbols. Navigation MUST work
  across files and generated/SDK sources when mappings exist.
- EDT-019: Target navigation MUST support go-to-definition/declaration/
  implementation/type-definition, peek definition without losing context, find
  all references, symbol and call hierarchy where derivable, and a back/forward
  navigation stack that restores file, cursor, selection, scroll, and split.
  If a target is unresolved, ambiguous, conditional, banked, or stale, the IDE
  MUST explain that state rather than jumping to a plausible but wrong location.
- EDT-020: Code links MUST be visually identifiable on hover/focus without being
  colour-only, MUST not interfere with ordinary text selection, and MUST have the
  same functionality from the keyboard and command palette.
- EDT-021: Users MUST be able to create, remove, enable, disable, rename, and
  optionally describe source bookmarks; navigate next/previous or select from a
  searchable project bookmark list; and distinguish bookmarks from breakpoints,
  diagnostics, execution markers, and source-control changes by more than colour.
- EDT-022: Bookmarks MUST use edit-tracking anchors so they survive ordinary
  edits, persist at the documented user/workspace/project scope, report orphaned
  locations after destructive edits or file changes, and support explicit import/
  export or sharing without leaking private notes by default.
- EDT-023: BBC BASIC and Atom BASIC editing MUST support optional automatic line
  numbering with configurable start and increment, continuation after the
  preceding line, insertion into available gaps, preview, and one-step undo.
  Automatic numbering MUST be disabled for structured/line-number-free dialects
  or files unless the user explicitly chooses a compatible mode.
- EDT-024: BASIC renumber MUST support a selected range or complete program,
  configurable start/increment, collision/overflow detection, preview, cancel,
  and atomic undo. It MUST update every syntactically recognized line-number
  reference—including lists in computed branches—while preserving numbers in
  strings, comments, data, binary payloads, and other non-reference contexts.
  Unresolved or dynamically computed targets MUST be reported for manual review.
- EDT-025: BASIC line-number navigation MUST allow direct go-to-line, click or
  keyboard activation of recognized line references, next/previous reference,
  missing/duplicate target diagnostics, and a line-reference view. Plain-text
  and tokenized import/export MUST preserve program semantics and expose any
  lossy conversion before applying it.
- EDT-026: Navigation aids MUST include breadcrumbs, document symbols, matching
  bracket/block/loop navigation, next/previous diagnostic or change, recent
  files and locations, go-to file/symbol/line/address, and optional sticky scope
  headers. Features unsupported by a language MUST be disabled with an explanation.
- EDT-027: Refactoring/code-action support MUST include safe rename and quick
  fixes where the language service can prove scope and references. Every multi-
  file change MUST present a preview, permit exclusions, apply atomically, remain
  undoable, and avoid rewriting generated, imported read-only, or ambiguous code.
- EDT-028: Editor assistance MUST remain responsive and cancellable on large
  projects; completion/hover/navigation requests MUST carry document and build
  versions so late responses cannot decorate or modify newer content.

## 10. Toolchains and build system

- BLD-001: Toolchains MUST be adapters behind a common contract for detection,
  version/capabilities, configuration schema, dependency inputs, execution,
  diagnostics, source maps/symbols, outputs, cancellation, and health.
- BLD-002: Candidate adapters MUST be evaluated rather than assumed. The
  evaluation set includes BeebAsm-style 6502 development, a general 6502/65C02
  assembler/linker such as ca65, BBC BASIC tokenization, C toolchains suitable
  for 6502 targets, ARM assembly/linking, and a maintained RISC OS C toolchain.
- BLD-003: Every selected toolchain MUST be version-pinned and invoked without
  shell-string interpolation. Builds MUST enforce CPU/time/memory/process/file/
  output limits, network denial by default, cancellation, and isolated storage.
- BLD-004: Browser/Wasm builds MAY provide low-latency compilation; server
  builds MAY cover native toolchains. Both MUST implement the same build-result
  contract and identify engine/version in provenance.
- BLD-005: A build target MUST declare label, machine profile, root(s), language,
  toolchain/dialect/version, defines, include paths, source units, libraries,
  generated assets, linker/memory layout, output type/path, load/exec/entry,
  optimization/debug profiles, dependencies, and post-processors.
- BLD-006: Build dependencies form a validated directed acyclic graph. The IDE
  MUST detect cycles, show critical dependencies, and build only affected nodes
  when safe.
- BLD-007: Live build MUST be debounced, cancellable, opt-out, target-aware,
  quiet while typing, and unable to overwrite an explicitly retained artifact.
- BLD-008: Build-all and test-all MUST run a bounded parallel matrix and present
  per-target and aggregate status.
- BLD-009: Results MUST include command-independent invocation metadata,
  normalized diagnostics, logs, exit reason, durations, cache status, inputs and
  toolchain digests, artifacts, source maps, symbols, memory map, and size report.
- BLD-010: Repeated builds from identical declared inputs MUST be reproducible;
  timestamps/random seeds MUST be controlled or documented as nondeterministic.
- BLD-011: Build caching MUST be content-addressed, tenant-safe, invalidated by
  every declared input, and observable. Cached output is never trusted across a
  security boundary without integrity verification.
- BLD-012: Build profiles MUST include debug, size, speed, and custom modes when
  supported, and explain incompatible optimizations or missing debug fidelity.
- BLD-013: SDKs/libraries MUST be versioned, licence-scanned, integrity-checked,
  browsable read-only, and linked only when referenced where toolchains allow.
- BLD-014: A native test runtime comparable in intent to Web64's test target MUST
  support assertions, exit/result reporting, captured diagnostics, and
  machine-readable results on each feasible CPU family.
- BLD-015: An 8-bit C target MUST identify its compiler dialect, machine ABI,
  startup/runtime and supported library surface separately; compile every
  declared translation unit, dependency-track project/SDK headers, assemble and
  link genuine target code, retain original-C diagnostics/source maps, expose
  real optimization choices, and reject execution when its runtime memory or
  machine contract is incompatible. A compiler target name without a runnable
  target library MUST NOT be presented as complete platform support.
- BLD-016: ARM build artifacts MUST distinguish raw machine code, ELF/object
  evidence, RISC OS Absolute/AIF files, typed filing-system objects and complete
  application directories. An ARM assembler/linker MUST pin the CPU generation,
  endianness, address model, entry point, linker layout and source evidence. Raw
  ARM bytes MUST NOT be described as a RISC OS application until a validated
  packaging/ABI contract is attached. A qualified exact-machine runtime MAY
  expose a separately labelled raw debug handoff only after its mapped load
  range, byte readback, PC/pipeline handoff, pause, breakpoint and instruction-
  step contracts pass; that handoff MUST NOT claim RISC OS filetype, command-
  line environment, application lifecycle, or packaging semantics.

## 11. Media, file systems, and packaging

- MED-001: Media adapters MUST separate logical file metadata from physical
  image encoding and expose create, inspect, validate, import, edit, export,
  checksum, and emulator-mount capabilities.
- MED-002: The planned format catalogue MUST cover, subject to licence and
  adapter validation: Atom ATM/tape/container forms; UEF and raw/cassette forms;
  DFS SSD/DSD and common extended variants; ADFS images; ROM/raw binary; and
  Archimedes/RISC OS disk and application packaging formats.
- MED-003: A disk/media editor MUST expose title, geometry, catalogue/directory,
  boot option, file name/directory, load address, execution address, locked/type
  flags, order, free space, and format-specific metadata.
- MED-004: Users MUST be able to add project files and build artifacts as logical
  media files, configure transformations, and see stale/missing dependencies.
- MED-005: Boot/run profiles MUST define machine configuration, media slots,
  reset state, boot command/key sequence, entry point, and deterministic input.
- MED-006: Import/export MUST preserve unknown metadata when safe, report lossy
  conversions before committing them, and validate resulting images by parsing
  them independently of the writer.
- MED-007: Disk sets and multi-image projects MUST support ordering, labels,
  dependencies, run selection, and ZIP/project-bundle export.
- MED-008: RISC OS application packaging MUST preserve application directories,
  file types/metadata, boot/run files, module layout, and an interoperable host
  transfer representation.
- MED-009: A hex/binary viewer MUST inspect artifacts and media with address,
  ASCII/Acorn text view, selection, compare, search, and safe export.

## 12. Embedded emulation

- EMU-001: Emulator integrations MUST implement a common lifecycle and
  capability API: create, load configuration, mount media, load artifact, start,
  pause, resume, reset types, power off, step, serialize state, restore state,
  capture frame/audio, inject input, inspect state, and destroy.
- EMU-002: Candidate upstreams—including browser-native emulators—MUST undergo
  accuracy, licence, ROM, security, accessibility, maintenance, performance,
  debugger-hook, and embedding review before selection.
- EMU-003: The selected emulator instance MUST use the exact resolved machine
  manifest used by the build/run profile; substitutions require an explicit
  warning and cannot count as target support.
- EMU-004: Controls MUST include build-and-run, load-and-run, continue, pause,
  reset, power, speed/warp, fit/integer scale, full screen, audio/mute/volume,
  input capture/release, media insert/eject/write policy, and focus state.
- EMU-005: Host keyboard mapping MUST be inspectable, remappable, saved by scope,
  and provide an accessible on-screen Acorn keyboard. Browser shortcuts MUST not
  silently consume critical target keys.
- EMU-006: Gamepad, joystick, mouse, and analogue inputs MUST expose live state,
  mapping, calibration where appropriate, and deterministic scripted injection.
- EMU-007: Save state MUST be versioned with emulator/machine/ROM digests and
  reject incompatible restoration safely. Rewind SHOULD provide a bounded,
  memory-budgeted visual timeline where the adapter can serialize deterministically.
- EMU-008: The screen MUST support nearest-neighbour integer scaling, aspect
  correction, optional authentic display effects, screenshots, overscan/border,
  and target palette selection without making decorative effects the default.
- EMU-009: Audio MUST start only after user consent/gesture, expose latency and
  underrun state for diagnostics, suspend in the background according to policy,
  and provide deterministic muted/headless testing.
- EMU-010: Multiple runtime sessions MAY exist, but resource budgets and active
  audio/input ownership MUST be explicit.
- EMU-011: Emulator adapters MUST publish accuracy limitations and regression
  suites for CPU instructions, timing-sensitive video, sound, interrupts,
  banking, storage, and Tube behavior relevant to supported profiles.

## 13. Debugger, instruction spy, and inspectors

### 13.1 Core debugger

- DBG-001: Debug sessions MUST bind to an immutable build result, resolved
  machine manifest, emulator adapter/version, ROM digests, and run profile.
- DBG-002: The UI MUST clearly distinguish stopped, starting, running, paused,
  stepping, rewinding, terminated, crashed, and disconnected states.
- DBG-003: Controls MUST include continue, pause, stop, restart, instruction
  step, source step in/over/out, run to cursor/address/symbol, and skip statement
  only where semantics are safe. Unavailable actions explain why.
- DBG-004: Breakpoints MUST support source line, address, symbol, enabled state,
  condition, hit count, log message, temporary/run-to, and grouping. Adapter-
  supported interrupt/event and data breakpoints MUST use the same model.
- DBG-005: Breakpoint resolution MUST show requested versus resolved address,
  source-map build, bank/address space, verification state, and reason for moves
  or rejection after rebuild.
- DBG-006: Data watchpoints MUST declare access type (read/write/change/execute),
  address space/bank, width, condition, and hardware/emulated implementation.
- DBG-007: Editing registers or memory requires paused state, validation,
  confirmation for dangerous mapped I/O, an audit entry in shared sessions, and
  immediate visible feedback.

### 13.2 CPU state

- DBG-020: 6502 views MUST show PC, A, X, Y, S/SP, processor flags individually
  and as a byte, interrupt lines/state, current opcode/bytes, cycle count, and
  effective address where available.
- DBG-021: 65C02 views MUST reflect the selected core's actual instruction and
  interrupt behavior rather than presenting a generic 6502 label.
- DBG-022: ARM views MUST show visible R0–R15, PC pipeline interpretation,
  status flags/mode, banked registers and SPSR where applicable, interrupt state,
  current instruction, and CPU generation/coprocessor facts supported by the
  selected Archimedes profile.
- DBG-023: Tube sessions MUST provide host and parasite CPU state side by side,
  with a prominent active stepping context and cross-links for Tube events.
- DBG-024: Stack views MUST decode return frames/call stack where debug metadata
  permits and fall back to an honest raw stack view otherwise.
- DBG-025: Globals, locals, parameters, watches, and expressions MUST state the
  debug-information source and mark optimized-out, unavailable, stale, and
  ambiguous values accurately.

### 13.3 Memory, disassembly, and instruction spy

- DBG-040: Memory inspection MUST support named address spaces, bank/slot,
  hex/decimal/ASCII/Acorn text, configurable rows/width, navigation by symbol or
  expression, search, diff against snapshot, copy/export, follow pointer, and
  safe editing.
- DBG-041: Memory maps MUST visualize RAM, ROM, I/O, shadow/private/hazel,
  sideways banks, overlays, Tube spaces, and ARM logical/physical mappings to
  the fidelity exposed by the adapter.
- DBG-042: Disassembly MUST show address, bank/space, bytes, mnemonic/operands,
  symbol, source line, execution count, cycle estimate/actual count, branch
  destination, and current/breakpoint markers.
- DBG-043: Mixed source/disassembly mode MUST remain navigable after source
  changes by pinning to the debugged build and marking newer editor content.
- DBG-044: The instruction spy/trace MUST capture a bounded stream containing
  sequence/time/cycle, CPU, PC/bank, opcode bytes, decoded instruction,
  effective address, register/flag deltas, memory/I/O reads and writes, interrupt
  transitions, and source/symbol mapping where available.
- DBG-045: Trace controls MUST provide start/stop, ring-buffer size, trigger,
  pre/post-trigger capture, address/opcode/event filters, pause-on-match,
  bookmarks, search, aggregate counts, and export in documented structured and
  human-readable forms.
- DBG-046: Trace collection MUST advertise its timing/performance impact and
  offer low-overhead summaries separately from full bus/instruction capture.
- DBG-047: Execution history SHOULD allow reverse step/continue when the
  emulator can restore deterministic checkpoints and replay all inputs; the UI
  MUST label replay-based behavior and irreversible boundaries.
  The jsbeeb 8-bit adapter satisfies this with bounded full-machine checkpoints
  and replay verification over CPU state, absolute cycle and ordered bus writes.
  Inputs and state mutations that are not recorded start a new, visibly named
  segment rather than permitting reverse execution across an unproven boundary.

### 13.4 Hardware inspectors

- DBG-060: 8-bit profiles MUST provide capability-gated inspectors for relevant
  Video ULA/6847, 6845 CRTC, system/user VIA, PPIA, sound, ACIA/serial, ADC,
  keyboard, FDC/drives, cassette, ROM/bank selection, Tube ULA, and timers/
  interrupts.
- DBG-061: ARM profiles MUST provide capability-gated VIDC, MEMC, IOC, DMA,
  interrupt, timers, sound, video timing/palette, input, storage, and module/SWI
  inspectors where emulator data is reliable.
- DBG-062: Register inspectors MUST show name, address, current and previous
  value, bitfield decoding, access semantics, source of truth, and change
  highlighting; unknown/reserved fields are not invented.
- DBG-063: Raster/video tools SHOULD show beam position, frame/scanline timing,
  palette/mode changes, display memory, sprites/software objects where derived,
  and break-on-position/event.
- DBG-064: Interrupt tools MUST show pending/enabled/source/mask state and a
  timestamped history linking handler entry/exit to instruction trace.
- DBG-065: Performance tools MUST provide cycle/frame/function/symbol hot spots,
  call counts where derivable, memory bandwidth/events, frame-time timeline, and
  exportable comparisons between builds.

### 13.5 Standalone file analyser and disassembler

- ANL-001: The workbench MUST load a local file without executing it or
  uploading it by default, enforce a documented size bound, and show filename,
  byte length, content classification, source of metadata, and analysis status.
- ANL-002: Classification MUST inspect bounded content rather than trusting a
  filename alone and distinguish tokenized BASIC, numbered plain-text BASIC,
  ordinary text, executable/machine code, media/container formats, malformed
  input, and unsupported architecture without silently choosing a misleading
  representation.
- ANL-003: Acorn load, execution, filetype, locked, filing-system, bank and
  address-space metadata MUST be accepted from supported container catalogues,
  `.inf` sidecars, conventional host filename suffixes, project manifests and
  explicit user input, with precedence and conflicts displayed.
- ANL-004: Tokenized BBC BASIC MUST be validated as complete line records,
  listed using the dialect-correct token tables and protected line-number
  codec, preserve literal bytes inside quoted strings/comments/data, report
  duplicate/out-of-order lines, distinguish trailing payload, and never rewrite
  through the wrong dialect.
- ANL-005: Atom BASIC and BBC BASIC I/II/IV/V/VI MUST have explicit dialect
  detection/support states. An unproved dialect MUST remain readable as raw
  bytes rather than being falsely labelled BBC BASIC II.
- ANL-006: Plain BASIC listings MUST retain original line numbers and line
  endings for round trip while offering normalized, searchable presentation.
- ANL-007: Static disassembly MUST use an explicitly selected processor and
  profile. Required adapters are NMOS 6502, Acorn 65C02/65C12, supported Tube
  CPUs, ARM2/ARM3 and later ARM profiles claimed by the product; unsupported or
  undocumented opcodes MUST remain byte directives.
- ANL-008: Disassembly MUST be driven by declared entry points and recursively
  proved branch/call flow. Bytes not proved reachable MUST be rendered as data,
  strings, tables or unknown bytes; the UI MUST distinguish analysis evidence
  from user assertions and MUST NOT linearly invent executable code from data.
- ANL-009: The listing MUST expose load/logical address, file offset, bank or
  address space, raw bytes, mnemonic/directive, operand, effective target,
  reachability, generated/user label, incoming/outgoing references, comments,
  warnings and confidence/provenance where applicable.
- ANL-010: Symbol recovery MUST generate deterministic labels for entry points,
  subroutines, loops and branch destinations; recognize applicable MOS calls,
  vectors, hardware registers, SWIs and modules; infer semantic routine names
  only from reproducible evidence; and allow valid user labels to override
  generated names without altering source bytes.
- ANL-011: MOS annotations MUST identify entry-point purpose and, when constant
  propagation proves it, relevant OSBYTE/OSWORD/OSFILE/OSFIND actions, VDU
  controls, printable characters, command strings, parameter blocks, vectors,
  bank operations and hardware regions. Unknown register state MUST not yield a
  speculative annotation.
- ANL-012: Users MUST be able to change load/entry address, processor, bank and
  additional entry points; mark code/data/text boundaries; rename/create/remove
  labels; add comments; and re-run analysis deterministically with undo/history
  once analysis becomes project-persistent.
- ANL-013: Clicking a branch, call, symbol, reference, address, vector or source
  mapping MUST navigate to its local definition or explain that the destination
  is external. Back/forward navigation, address/symbol go-to, filter, find,
  bookmarks and keyboard operation are required.
- ANL-014: Listings MUST export as accessible human-readable text and a
  versioned structured interchange format containing source hash, input
  metadata, adapter/version, decisions, symbols, comments and warnings. Assembly
  source export MUST preserve directives/data and declare that reassembly is
  exact only after a byte-for-byte verification passes.
- ANL-015: The file analyser MUST integrate with the hex editor, source editor,
  debugger, memory map, media explorer, research panel and project files without
  conflating static reachability with runtime execution coverage.
- ANL-016: Parser/disassembler work MUST run in a bounded worker or isolated
  service for production, support cancellation and progress, avoid network by
  default, never load a file into the emulator without a separate user action,
  and fail safely on malformed/adversarial input.
- ANL-017: Accuracy suites MUST cover every official opcode/addressing mode,
  boundary/wrap/truncation case, mixed code/data, indirect flow, known MOS and
  hardware idiom, all supported BASIC tokens/dialects, compound BASIC payloads,
  metadata conflicts, golden listings and byte-exact round trips where claimed.
- ANL-018: Dense listings MUST meet the same WCAG 2.2 AA, keyboard, focus,
  structured alternative, 200% zoom and 320 CSS-pixel reflow obligations as the
  debugger, including non-colour reachability and selection cues.

## 14. Testing inside the IDE

- TST-001: Projects MUST define named test targets separate from ordinary run
  targets, with machine profile, build dependency, setup, input script,
  assertions, timeout, artifact capture, and teardown.
- TST-002: Supported assertions MUST include memory/register values, symbol-
  relative values, textual output, screen region/image comparison with declared
  tolerance, audio/event presence, emulator stop/result protocol, and timing/
  cycle budgets where deterministic.
- TST-003: A test explorer MUST group by target/suite/file, run selected/all,
  cancel, retain history, show failure source/debug links, and re-run under the
  debugger from the same immutable build.
- TST-004: Input recording and scripts MUST cover keyboard, joystick/gamepad,
  mouse, analogue inputs, reset, media changes, delays, and emulator events using
  target-independent actions resolved through the selected input map.
- TST-005: Headless CI execution MUST use the same manifests and result schema as
  interactive runs and output JUnit-compatible plus native structured reports.
- TST-006: Golden files MUST record provenance and deliberate update approval;
  visual/audio comparisons MUST not hide broad changes behind excessive tolerance.
- TST-007: The platform's own acceptance suite MUST include known-good programs,
  instruction/flag tests, media round trips, banking, Tube communication,
  deterministic input, source breakpoint mapping, frame/audio fixtures, and
  accessibility checks for every production profile.

## 15. Asset creation

### 15.1 Shared asset behavior

- AST-001: Asset editors MUST store editable source separately from generated
  binaries/includes and produce deterministic output through versioned codecs.
- AST-002: All editors MUST support undo/redo, dirty/save state, selection,
  clipboard where safe, zoom/pan, grid, keyboard editing, import preview, export
  preview, metadata, validation, palette/mode constraints, and non-destructive
  conversion warnings.
- AST-003: Every asset MUST declare target capability, dimensions, encoding,
  palette/mode, output layout, load/use metadata, codec/version, and build links.
- AST-004: A generated preview MUST be rendered using target rules or the chosen
  emulator, not merely a generic RGB canvas.

### 15.2 Graphics and maps

- AST-010: Character/font/UDG editor: glyph banks, target grid sizes, bit depth,
  baseline/guides, transformations, range operations, text preview, system font
  import subject to licence, and binary/include export.
- AST-011: Sprite/object editor: animation frames, onion skin, layers where the
  target format permits, hotspots, collision metadata, software-sprite formats,
  masks, packing/order, preview over target modes, and sheet/binary export.
- AST-012: Screen/bitmap editor: Acorn mode selection, authentic resolution and
  palette constraints, pixel/aspect preview, attributes where applicable,
  selection tools, dithering/conversion controls, and screen-memory export.
- AST-013: Tile/block editor: characters/tiles to metatiles, collision and custom
  properties, transformations, deduplication, usage view, and packed outputs.
- AST-014: Map editor: finite layers, tile/object placement, regions/triggers,
  collision, custom typed properties, image import, validation, overview,
  compression choices, and data/include export.
- AST-015: Palette editor: physical/logical colour mapping, VIDC or machine-
  specific constraints, contrast warnings, cycling/animation metadata, and
  shared project palettes.

### 15.3 Sound and music

- AST-020: Sound tools MUST be capability-driven for Atom speaker output,
  SN76489-family audio on BBC/Electron/Master, and Archimedes sound systems,
  without presenting SID-specific concepts as generic Acorn features.
- AST-021: Tracker requirements include patterns, order/song sequence, channels,
  instruments/envelopes, effects, tempo, loop/selection playback, solo/mute,
  keyboard entry, undo, validation, size/cycle estimates, and deterministic
  player/data/include export.
- AST-022: SFX editor requirements include tone/noise/envelope design, audition,
  target contention/limits, bank/list management, and code/data export.
- AST-023: Sample editor for capable targets SHOULD provide waveform, trim,
  normalize, resample, signedness/bit-depth/rate conversion, loop points, memory
  estimate, audition through target emulation, and lawful source metadata.
- AST-024: Import/export formats and third-party tracker compatibility MUST be
  selected through documented round-trip and licence analysis; unsupported
  effects must produce a conversion report.

## 16. Integrated research and documentation

- RSH-001: A dockable research panel MUST search target-filtered local/approved
  documentation, SDK references, instruction sets, memory maps, OS calls/SWIs,
  hardware registers, examples, and the user's project symbols.
- RSH-002: Results MUST identify title, source/publisher, version/date, applicable
  machines/ROMs/toolchains, licence, excerpt location, and a link/citation.
- RSH-003: The application MUST distinguish authoritative documentation, curated
  community material, project notes, and generated assistance. Generated text
  MUST never masquerade as a manual or hardware fact.
- RSH-004: Search MUST support exact symbol/register/address/opcode queries,
  filters, bookmarks, recent history, cross-links from diagnostics/debuggers,
  and keyboard/screen-reader navigation.
- RSH-005: Documentation ingestion MUST respect copyright, robots/access policy,
  licence, attribution, retention, deletion, and index versioning. The product
  MUST link rather than redistribute where permission is absent.
- RSH-006: Code/example insertion MUST preview the change, preserve provenance
  and licence metadata, match the selected dialect/profile, and require explicit
  user action.
- RSH-007: Offline/local reference packs MAY be installed only with manifest,
  integrity, provenance, licence, target/version tags, and removal support.
- RSH-008: If AI assistance is later added, it MUST be separately consented,
  disclose data transmission/provider/retention, scope project access, cite
  sources where factual, avoid silent edits, and remain optional.
- HLP-001: A searchable in-application user guide MUST cover every visible
  command and complete workflows for project creation, target selection, ROM
  import, editing, building, analysis, media, assets, emulation, debugging,
  tests, research, settings, portability, recovery and troubleshooting.
- HLP-002: Help topics MUST be technical and task-oriented. Each topic MUST state
  prerequisites, exact steps, expected results, target-specific limitations,
  failure recovery, related commands and keyboard or assistive-technology paths.
- HLP-003: Help MUST include maintained screenshots captured from the shipped
  interface. Images MUST have useful alternative text, visible captions, theme
  and version metadata, responsive presentation and a text equivalent for every
  fact or action shown visually.
- HLP-004: Help navigation MUST support full-text search, category filtering,
  direct topic links, previous/next movement, keyboard operation, visible focus,
  screen-reader landmarks and context links from relevant workbench surfaces.
- HLP-005: Help content and screenshots MUST be versioned with the application
  and checked for broken anchors, missing images, stale control names and
  unsupported claims. Help prose MUST use direct human technical language and
  MUST NOT use em dashes or generic generated-assistant filler.

## 17. Workbench, visual design, and accessibility

- UX-001: The default desktop layout MUST retain the reference IDE's productive
  anatomy: global action bar; target/project context; grouped workspace and asset
  tabs; project tree; central primary editor; embedded runtime; contextual right
  inspector; and persistent build/status summary.
- UX-002: Panels MUST resize, collapse, move among supported docks, restore
  defaults, persist by scope, and enforce usable minimum sizes. Focus order MUST
  follow the visible arrangement.
- UX-003: At narrow widths the layout MUST reflow to a single primary surface
  with explicit panel switcher/drawer; no essential operation may require a
  desktop-width viewport. Mobile may be inspection-focused but not inaccessible.
- UX-004: The identity MUST use original Acorn-inspired iconography and a colour
  system informed by Acorn hardware/keys/displays, not copied logos or protected
  artwork. Icons require text alternatives/tooltips and cannot encode state alone.
- UX-005: Theme tokens MUST cover surfaces, text, borders, focus, selection,
  syntax, diagnostics, debugger state, charts, target palette previews, and
  reduced-transparency/high-contrast modes. Components MUST consume shared tokens.
- UX-006: The product MUST conform to WCAG 2.2 AA: 4.5:1 normal-text contrast,
  3:1 large text and meaningful non-text contrast, visible focus, 24 CSS pixel
  minimum target spacing/size exceptions handled, keyboard access, semantic
  names/roles/states, error identification, reflow at 320 CSS px, 200% text zoom,
  no colour-only meaning, and status announcements.
- UX-007: Code and data canvases MUST have equivalent accessible controls or
  structured representations. Canvas pixels, maps, graphs, waveforms, and memory
  grids cannot be the sole way to inspect or edit critical data.
- UX-008: User preferences MUST cover text/UI size, editor font, theme, contrast,
  reduced motion, animation, sound cues, keyboard mappings, and panel layout.
- UX-009: Destructive commands require clear scope, confirmation proportional to
  recoverability, and undo/trash where possible. Background activity and stale
  results must remain visible.
- UX-010: A first-run guided flow, contextual help, shortcut reference, and
  target-specific empty states MUST lead to a successful build/run/debug without
  blocking experienced users.
- UX-011: Performance-heavy views MUST virtualize without breaking assistive
  technology; an accessible paged/tabular fallback is required.

## 18. Accounts, storage, revisions, and sharing

- CLD-001: Anonymous/local mode MUST support the complete core create/build/run/
  debug/export journey within browser and configured service constraints.
- CLD-002: Accounts add private cloud projects/assets, settings sync, revisions,
  sharing, storage controls, and multi-device continuity; account creation is not
  allowed to become a dark pattern.
- CLD-003: The service MUST define project owner, editor, tester, and viewer
  capabilities scoped to each project; backend checks every read/write/build/run/
  share/delete action.
- CLD-004: Revision history MUST capture authored changes and relevant manifest/
  asset versions, support compare/restore/fork, identify actor/time/source, and
  avoid duplicating large binaries without retention controls.
- CLD-005: Offline edits MUST use explicit sync state and deterministic conflict
  handling. Automatic merge is permitted only for formats with safe semantics;
  binary/asset conflicts require choice or forking.
- CLD-006: Quotas MUST show usage by projects, revisions, artifacts, assets,
  ROMs, and caches; eviction/deletion behavior must be predictable.
- CLD-007: Users MUST be able to export their data and delete projects/account
  according to documented retention, audit, backup, and legal requirements.
- CLD-008: Public/template sharing MUST scan secrets and redistribution rights,
  generate immutable/versioned links where requested, and allow revocation.

## 19. API and domain boundaries

- API-001: Core domain entities are MachineProfile, ExpansionProfile,
  ResolvedMachine, Project, ProjectRevision, SourceFile, Asset, BuildTarget,
  Build, Artifact, MediaLayout, RunProfile, EmulatorSession, DebugSession,
  Breakpoint, TraceCapture, TestTarget, TestRun, Toolchain, ReferenceSource, and
  PermissionAssignment.
- API-002: API contracts MUST be versioned, typed, schema-validated, and generate
  compatible TypeScript clients from one authoritative description where practical.
- API-003: Long-running builds, tests, imports, and exports MUST use cancellable
  jobs with idempotency keys, finite states, progress/events, safe retry, and
  terminal result retention.
- API-004: Real-time emulator/debug transport MUST use explicit sequencing,
  backpressure, bounded messages, reconnect/resync, capability negotiation, and
  session ownership. Dropped trace data must be counted and reported.
- API-005: Binary upload/download MUST be streamed or chunked, size-limited,
  content-validated, checksummed, tenant-isolated, and served with safe content
  disposition/type headers.
- API-006: Errors MUST use stable codes, correlation ID, safe user message,
  retryability, field details, and redacted internal context.
- API-007: Emulator, toolchain, media, asset, documentation, and storage adapters
  MUST publish manifests and conform to contract suites before registration.

## 20. Security and privacy

- SEC-001: A threat model MUST cover untrusted source/build scripts, archive and
  media parsing, compiler/emulator vulnerabilities, malicious ROMs, cross-tenant
  access, browser storage, shared projects, supply chain, XSS/CSRF, WebSocket
  hijacking, denial of service, and data exfiltration.
- SEC-002: Builds and server emulation MUST run as non-root in disposable,
  isolated sandboxes with read-only toolchains, no network by default, quotas,
  syscall/process restrictions, and cleanup after terminal state.
- SEC-003: Archives and media MUST be protected from traversal, symlink escape,
  decompression bombs, malformed metadata, type confusion, and parser resource
  exhaustion.
- SEC-004: Authentication MUST use contemporary framework mechanisms; secrets
  are hashed/encrypted appropriately, sessions are revocable, CSRF is prevented,
  and privileged/recent-auth operations are identified.
- SEC-005: Authorization MUST combine capabilities and resource scopes. Hidden
  navigation is never authorization. Required service capability examples include
  `acornide.project.read/write/share/delete`, `acornide.build.execute/read`,
  `acornide.runtime.execute/debug`, `acornide.references.manage`, and
  `acornide.operations.read/manage`.
- SEC-006: Project content, trace/memory dumps, logs, crash reports, analytics,
  and AI requests are potentially sensitive and MUST follow minimization,
  redaction, purpose, retention, access, export, and deletion policies.
- SEC-007: CSP, trusted asset origins, safe iframe/worker isolation, dependency
  integrity, output escaping, and download headers MUST be defined before public use.
- SEC-008: Dependency/adapter updates require automated vulnerability and licence
  checks plus reproducible provenance/SBOM for release artifacts.
- SEC-009: Security-relevant and sensitive project actions MUST be audited with
  actor, capability, scope, target, outcome, correlation ID, and safe metadata.

## 21. Reliability, performance, and operation

- NFR-001: Availability, recovery, retention, and capacity SLOs MUST be accepted
  before production; health does not equal mere process liveness.
- NFR-002: On the agreed reference desktop, cached application shell interactive
  target is ≤2 s, typical small-project incremental diagnostic target ≤500 ms
  where browser compilation supports it, input-to-frame target ≤50 ms at normal
  speed, debugger command acknowledgement ≤150 ms locally, and common UI input
  response ≤100 ms. Final budgets require measured feasibility.
- NFR-003: Large project limits and graceful behavior MUST be defined for file
  count, single file, total project, artifact, media image, trace, revision, build
  log, and concurrent jobs; no unbounded list or buffer is permitted.
- NFR-004: Editor input, emulator audio/video, build work, indexing, and trace
  processing SHOULD use isolated workers/processes so one cannot starve another.
- NFR-005: Services MUST emit structured logs, metrics, and traces with service/
  version/correlation/job/tenant-safe identifiers and redact source, secrets,
  memory, ROM, and filenames according to policy.
- NFR-006: Health endpoints MUST separately report liveness and readiness for
  database/object storage/queue/toolchain workers/adapter registry as applicable.
- NFR-007: Metrics MUST include request/job latency and errors, queue depth,
  sandbox resource use, build cache, emulator sessions, WebSocket backpressure,
  trace drops, storage/quota, sync conflicts, and adapter/toolchain health.
- NFR-008: Backup and restore MUST be tested; restoration evidence must cover
  metadata, project blobs, revision history, permissions, and integrity.
- NFR-009: Every migration MUST be forward tested and have a documented safe
  deployment/rollback or roll-forward procedure.
- NFR-010: Browser support policy MUST cover current and previous major versions
  of Chromium, Firefox, and Safari, with explicit fallback for file-system,
  audio, worker, WebAssembly, full-screen, and gamepad APIs.

## 22. Quality strategy

- QLT-001: Unit tests cover domain logic, schema migrations, parsers/codecs,
  configuration resolution, and UI state machines.
- QLT-002: Contract tests cover every adapter, API, job/event stream, and
  version-compatibility boundary.
- QLT-003: Integration tests use real pinned toolchains, representative ROM-free
  fixtures, storage, queue, and sandbox boundaries.
- QLT-004: End-to-end tests cover every principal journey on keyboard and pointer
  and include screen-reader-oriented semantic assertions.
- QLT-005: Accessibility testing combines lint/static checks, automated browser
  scans, keyboard scripts, zoom/reflow/high-contrast/reduced-motion checks, and
  manual testing with representative screen readers. Automated scans alone do
  not establish conformance.
- QLT-006: Visual regression covers layout states/themes/zoom and excludes
  machine display pixels from broad anti-aliasing tolerances unless separately
  tested as emulator output.
- QLT-007: Property/fuzz tests target project manifests, archives, media images,
  BASIC tokenization, debug expressions/protocol, and binary asset codecs.
- QLT-008: Performance/load tests validate budgets, cancellation, fairness,
  quota enforcement, cleanup, and degraded dependency behavior.
- QLT-009: Fixtures MUST be synthetic or redistributable and include provenance;
  proprietary ROMs and commercial software are never CI dependencies.
- QLT-010: A release traceability report maps each in-scope requirement to test
  evidence, accepted limitation, or approved deferment.

## 23. Release acceptance gates

### 23.1 Definition of a production machine profile

A machine profile is production-ready only when all are true:

1. The profile and all selectable expansions resolve and validate deterministically.
2. At least one documented, pinned toolchain builds the starter and advanced sample.
3. Authentic media or executable export round-trips through an independent parser.
4. The exact profile boots/runs in the embedded emulator without undeclared substitution.
5. Source and address breakpoints, register view, memory view, disassembly, and
   instruction trace pass the adapter contract, or a specific limitation has
   received product approval and is displayed before selection.
6. Automated headless smoke and regression tests run in CI without proprietary assets.
7. Keyboard mapping, screen, audio, reset, and media behavior have reference tests.
8. Documentation, example, ROM/legal instructions, known limitations, and support status exist.
9. WCAG, security, performance, and operational gates pass for its complete journey.

### 23.2 Minimum public product gate

- ACC-001: BBC Model B and one other materially different 8-bit profile complete
  the full create/build/run/debug/test/export journey.
- ACC-002: One ARM Archimedes profile completes an explicitly scoped vertical
  journey before the product claims general “Acorn line” production support.
- ACC-003: Sideways memory and at least one Tube configuration are demonstrated
  end to end, or are clearly labelled preview with no production claim.
- ACC-004: Character/sprite or software-object, tile/block, map, screen/palette,
  and target-appropriate audio workflows all generate consumable build inputs.
- ACC-005: The instruction spy, CPU/hardware inspectors, test explorer, research
  panel, media mastering, multi-target build, local project bundle, and optional
  cloud revision flow meet their acceptance tests.
- ACC-006: No critical/high security findings, no WCAG A/AA blockers in core
  journeys, no known cross-tenant issue, and no unresolved dependency licence or
  ROM redistribution ambiguity.
- ACC-007: Fresh-clone Docker Compose startup, migrations, health, logs, test
  commands, backup/restore, and operator documentation are verified.

## 24. Product decisions still requiring evidence

These are deliberate discovery items, not permission to omit capability:

- DEC-001: Product name, original brand system, and permissible Acorn references.
- DEC-002: Exact machine rollout and what “Archimedes” compatibility tier means
  for ARM2, ARM3, later ARM systems, and RISC OS versions.
- DEC-003: Emulator adapter selection per family and whether integration is
  forked, upstreamed, embedded as a library, or isolated.
- DEC-004: Lawful ROM/firmware provision, user import, hashing, storage, and
  sharing policy per profile.
- DEC-005: Toolchain selection/version/licence and browser-Wasm versus isolated
  server execution for each language.
- DEC-006: Canonical project bundle, media libraries, editable asset schemas,
  debug information, trace, and test-result formats.
- DEC-007: Persistence technologies and object/job/event architecture based on
  measured workload, captured in ADRs.
- DEC-008: Which documentation collections may be indexed, cached, quoted, and
  redistributed, with owner/version/licence data.
- DEC-009: Cloud commercial model, quotas, retention, education/sharing needs,
  privacy jurisdictions, and service SLOs.
- DEC-010: Native bridge policy for toolchains/emulators that cannot safely or
  accurately run in browser/server environments.

## 25. Principal risks

| Risk | Required response |
|---|---|
| ROM/manual/toolchain licensing blocks redistribution | Complete legal/provenance matrix before selecting adapters; provide bring-your-own flows |
| One emulator cannot accurately cover the family | Use capability-negotiated adapters and vertical profile tests; never normalize away real hardware differences |
| Full debugger hooks require invasive emulator changes | Prove pause/step/memory/register/trace contracts in early spikes and upstream reusable hooks where feasible |
| Tube dual-CPU determinism is difficult | Treat host/parasite scheduling and event trace as a dedicated architecture spike and gated profile |
| ARM/RISC OS workflow differs fundamentally from 6502 | Preserve shared workbench/domain contracts while allowing distinct toolchain, packaging, debugger, and hardware views |
| Untrusted builds create remote-code-execution risk | Sandbox before cloud builds, deny network, pin toolchains, enforce quotas, fuzz parsers, and audit |
| Dense IDE conflicts with accessibility/reflow | Build semantic primitives and keyboard model first; test every vertical slice at zoom/reflow and with assistive technology |
| Scope expansion prevents a usable release | Ship complete vertical machine slices behind honest support tiers; do not ship cosmetic selectors |
| Upstream churn breaks reproducibility | Pin versions/digests, maintain contract suites and SBOM, and separate adapter upgrades from project schemas |
| Trace and emulation overload the browser | Worker isolation, bounded buffers, backpressure, sampling, declared overhead, and performance budgets |

## 26. Glossary

- **Artifact**: immutable output of a particular build, with provenance.
- **Capability**: a declared, testable operation supported by an adapter/profile.
- **Machine profile**: versioned description of a real target's hardware and
  firmware assumptions.
- **Resolved machine**: immutable result of combining base profile, expansions,
  ROM choices, and run settings.
- **Sideways memory**: banked ROM/RAM presented through the BBC-family sideways
  address window and slot-selection mechanisms.
- **Tube**: Acorn host/parasite second-processor interface and protocol.
- **Instruction spy**: bounded, filterable instruction/event trace with state
  and memory/I/O effects, not merely a static disassembly.
- **Source map**: build-proven association among source ranges, symbols, address
  spaces/banks, and generated instructions/data.
- **Vertical machine slice**: one real profile completed across configure, edit,
  build, media, emulation, debugging, testing, documentation, and export.

## 27. References and provenance

- Governing repository contract: `../../../docs/architecture-contract.md` from
  this service directory.
- Interaction baseline: Web64 IDE, manually inspected at
  `https://web64.nofs.ai/ide/` on 20 August 2026.
- Candidate evidence only, not accepted architecture: official BeebAsm source
  repository (`https://github.com/stardot/beebasm`) and jsbeeb source repository
  (`https://github.com/mattgodbolt/jsbeeb`). Both require formal dependency,
  licence, accuracy, and integration review under DEC-003/DEC-005.
- UX and analysis behavior baseline: the existing Acorn File Forge file editor
  and ROM workbench were inspected locally on 20 August 2026. This is product
  evidence, not authority to copy implementation or redistribute dependencies;
  this IDE requires its own provenance, licence and accuracy evidence.
