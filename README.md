# 8bit-net Dev — Acorn Workbench

A working local-first foundation for a browser-based Acorn development studio.
It combines an editable project workspace and file analyser with the workbench
layout, Acorn-inspired design language, responsive behavior, and linked target
configuration model. It includes working BBC BASIC, 6502, BBC-targeted cc65 C
and raw ARM2 build paths, a ROM-less 6502 diagnostic runtime, ROM-aware
BBC/Atom/Master machines, and a qualified first A310/RISC OS 3.11 live core.
Raw ARM2 builds can enter an explicitly labelled mapped-RAM debug session on
that core. Its debugger now decodes the genuine packed 26-bit R15 into address,
N/Z/C/V/I/F and processor mode, displays Arculator's execute/decode latches plus
an explicitly separate next-fetch preview, and reads the real User/FIQ/IRQ/
Supervisor R8–R14 banks. A separate validated RISC OS 3 path can wrap a current `&8000` image
as a typed Absolute `RunImage`, generate its Obey `!Run`, stage both through
HostFS, and launch the application through the emulated A310 keyboard. AIF and
RISC OS C remain separate, still-open contracts. The same live A310 adapter now
supports explicit VIDC audio, PNG framebuffer capture and exact 800 KiB ADFS
floppy mounting through Arculator's controller path.

The A310 debugger exposes a side-effect-free hardware inspector with the live
64-word VIDC register file, decoded display timing and control, all 20 palette
entries, raster and cursor position, MEMC video/cursor/sound DMA, IOC A/B/F
status and masks, all four timers, SDL audio state, and all four floppy drive
slots. Consecutive samples have emulated-time provenance and change
highlighting. The execute latch reports a current SWI only when the instruction
is real. The pinned adapter does not expose a safe RISC OS module registry, so
the panel says so and never constructs one by scanning guest memory.

Both live adapters expose a shared Runtime performance disclosure in the
debugger. It reports active requestAnimationFrame interval statistics, late and
estimated dropped presentation slots, explicit session/frame/snapshot/trace/
media/crash budgets, background suspension state, audio latency and bounded
redacted crash diagnostics. The jsbeeb AudioWorklet path counts long sound-chip
buffer gaps as diagnostic underruns. The pinned Arculator SDL bridge does not
expose a callback-underrun counter, so that field is visibly unavailable rather
than inferred. Hiding the page pauses the real core and active audio, then
restores the prior run state when the page becomes visible.

Both emulator integrations also publish Emulator adapter API 1 in the live
debug session. The shared TypeScript boundary covers configuration, immutable
machine and ROM provenance, media, artifacts, lifecycle, reset, input, state,
capture, inspection and debug operations. Capability checks reject unavailable
calls, and the UI shows the exact operation matrix and limitations for the
pinned jsbeeb or Arculator revision. Contract tests run complete and partial
fake adapters through valid and invalid lifecycle paths.

The genuine cores run in sandboxed embedded documents with a stricter, separate
content security policy. Transport requires the expected origin, source window,
channel, random session nonce and increasing sequence. One command is in flight,
64 may wait, and a frame change discards the queue. Runtime teardown stops
animation, timers, hooks, audio and core execution. If an adapter reports an
error, Restart adapter replaces the iframe and creates a new isolated session.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Run as a self-contained container

```bash
docker compose up --build
```

Open `http://localhost:8090`. The container publishes host port 8090 to its
internal port 8080 and exposes `GET /healthz`. No host Node installation,
backend service, database, or external runtime dependency is required.

Use the Compose plugin (`docker compose`), not the standalone `docker-compose`
script. The standalone tool is Compose v1, which is end of life and fails
against images built by current Docker with `KeyError: 'ContainerConfig'` when
it reuses a named volume. If your system has only `docker-compose`, install the
plugin rather than working around it.

Set `WEBIDE_ACORN_PORT` to change the host port. A deployment-specific theme can
be mounted over `/usr/share/nginx/html/theme-overrides.css`; see
`docs/theming.md`.

### Run hardware tests in CI

Copy `ci/project.example.json` to the ignored `ci/project.json`, copy
`ci/roms.example.json` to the ignored `ci/roms.json`, then place legally
obtained ROM files under ignored `ci/roms/`. Run:

```bash
docker compose --profile ci build headless-tests
docker compose --profile ci run --rm headless-tests
```

The runner drives the production Test all path and writes
`ci/results/test-report.json` plus `ci/results/test-report.junit.xml`. It returns
0 when every reported test passes, 1 for completed test failures and 2 for
invalid input, manifest mismatch or runner failure. The runner is attached only
to an internal Docker network and does not receive an external network route.
ROM bytes remain private mounted inputs and are not copied into an image.

## Security, privacy and reporting a problem

Everything you make stays on your machine. There is no account, no analytics and
no server holding your work. What is held, what is deliberately not collected,
how to delete it, and how to report a vulnerability privately are all in
[`docs/security-and-privacy.md`](docs/security-and-privacy.md).

## Quality commands

```bash
npm run typecheck
npm test
npm run build
```

## Current scope

- React, TypeScript, and Vite application shell.
- Web64-inspired workbench anatomy with original Acorn presentation.
- Searchable in-app technical help with stable topic links, category filters,
  context links from every workspace, maintained interface screenshots,
  captions, text alternatives, keyboard navigation, target-specific limits and
  recovery procedures. `npm test` verifies screenshot files, related links,
  selected control names and the help prose rules.
- Linked platform, machine, variant, ROM/OS, and capability controls.
- Browser-local projects with new/open/save/recovery/export, source import,
  editable multi-file tabs, rename/delete/download, modified-state tracking,
  line gutter, caret status, outline navigation, bookmarks, find/replace,
  command completion, and BBC BASIC automatic line numbering. A project-wide
  search workspace provides bounded current-file/project scopes, literal and
  timed worker-isolated regular-expression matching, case/whole-word modes,
  grouped filename/line/column previews, exact click-to-source selection, and
  confirmed replacement (including capture groups) with modified-state and
  local-recovery integration. Invalid, empty-match, excessive and timed-out
  expressions fail without changing source files.
- A searchable command palette opens from the toolbar, `F1`, or
  `Ctrl/Cmd+Shift+P`. It provides keyboard navigation and contextual availability
  reasons for real project/file, editor navigation, build/run/debug, emulator,
  panel, and workspace actions.
- One canonical keyboard-binding table is the only source of dispatched
  shortcuts. The workbench window handler, the source editor, the palette's
  advertised chords and the editor's `aria-keyshortcuts` list are all generated
  from it, so a displayed shortcut cannot drift from the chord that actually
  runs. Events are normalized to a canonical `Ctrl+Alt+Shift+Key` chord using
  the physical key, so shifted punctuation and non-US layouts resolve correctly
  and Command on macOS shares the Control role. Settings › Keyboard shortcuts
  lists every workbench and editor binding with its effective and default chord,
  records a replacement chord, unbinds a command, and resets one or all
  bindings. Assignments are refused only when they would capture ordinary typing
  or Tab focus movement; conflicts within a scope, editor chords that hide a
  workbench chord, and chords a browser normally claims first are reported by
  name rather than silently prevented or falsely promised. Customisations are
  validated against the declared inventory and persisted in browser storage.
  Chorded key sequences and separate Command/Control assignment remain tracked
  work.
- Deleting a file moves it to the project's trash together with the build
  targets and bookmarks that were removed with it, so restoring puts back the
  state that existed rather than an approximation; a name taken in the meantime
  causes a rename rather than an overwrite. The explorer groups sources by
  origin — authored, imported, generated — and is a real tree: one tab stop,
  arrow keys between rows, rather than a tab stop per file. Files reorder by
  dragging or, equivalently, with Alt and an arrow, so the operation is not
  pointer-only; a drop into another group is refused with the reason, because
  the group is read from the file's origin rather than its position.
- The working project autosaves, and says so honestly. A write that fails
  because browser storage is full is reported rather than swallowed, and the
  last good snapshot is left intact so the fallback is that rather than nothing.
  A saved project that cannot be read is kept aside with the parse error and its
  byte count, offered for download, and deleted only when the person chooses:
  "unreadable" and "gone" are different things and only one of them was ever
  true.
- A project exports as a bundle rather than a bare JSON dump. It carries a
  digest of the project and of every file, so a bundle altered in transit is
  refused with what no longer matches instead of being opened as if it were what
  its author sent; a dependency report naming the machine, firmware, capabilities
  and toolchains the work expects, and any source a build target references but
  the bundle lacks; and an exclusion report stating what deliberately did not
  travel. Source is scanned for credentials before anything is written, and
  findings are reported with the value masked rather than removed, because the
  author decides.
- Choosing a configuration never quietly becomes a different one. Resolution
  still substitutes where it must, because the workbench has to show something,
  but every departure from what was asked for is named where the machine is
  chosen: an unknown machine, a machine from another platform class, an unknown
  variant or firmware profile, a capability this machine does not have, one that
  is only planned, and a peripheral fitted to a variant that is not selected.
  Opening a project also says what would not survive the move, distinguishing a
  capability the target machine merely has switched off from one it does not
  have at all. The shipped catalogue itself is validated by contract test, which
  caught two real errors when it was introduced.
- One adapter support matrix answers, for every machine profile, whether this
  build can actually run it, and distinguishes the reasons: it runs, the pinned
  engine has a model but no ROM manifest is registered here yet, or the pinned
  engine has no model at all so supplying firmware could never help. The
  firmware vault states the applicable reason rather than always asking for
  ROMs. The model names the matrix claims are checked against the emulator's own
  published model list by contract test, so they cannot drift from the code.
  jsbeeb 1.19.1 publishes no BBC B+ model, so that profile is described but
  cannot be executed here, and no other machine is substituted for it. jsbeeb
  publishes no Electron model either, so the Electron runs on a separate
  vendored core.
- The Acorn Electron runs on ElkJS, vendored at a pinned revision with a
  SHA-256 for each pristine file, no firmware and no game snapshot copied, and
  every local change recorded as a patch. Selecting the Electron routes the
  emulator panel to that core rather than to jsbeeb, and a project builds, loads
  and executes on it. Because ElkJS keeps its registers behind its own snapshot
  and runs a batch of cycles per call with no per-instruction hook, the adapter
  offers twelve capabilities and declares twenty-four unavailable with a reason
  for each. Every command the emulator panel can emit is classified against one
  of them, so a command this core cannot honour is refused in the workbench with
  that reason rather than sent and quietly dropped, and the panel does not
  synthesise a jsbeeb-shaped snapshot the core could not have produced. A
  contract test compares the workbench's tables against the runtime the browser
  loads, so the two cannot drift. The core models a base 32 KB machine only, so
  the Electron's cassette, Plus 1, Plus 3, sideways RAM and joystick are marked
  planned against the Elkulator port rather than offered as switches that change
  nothing.
- Four 8-bit machine slices are proved by execution on their real cores with
  locally supplied firmware, not by assertion: BBC B with 8271 DFS, BBC B with
  1770 DFS and ADFS, BBC Master 128 with its combined MOS 3.20 image, and the
  Acorn Atom with its own kernel and BASIC ROMs. A BBC B with the 6502 second
  processor fitted also boots and runs host code. Hardware tests that capture
  BBC MOS entry addresses, namely `OUTPUT` and `EVENT[…]`, are refused on the
  Atom with an explanation, because that machine is a different operating system
  and counting whatever occupies those addresses there would be meaningless.
- A character-set editor holds eight bytes per glyph at any code from 32 to 255,
  with exact flip, rotate, invert and shift transforms and a row-byte readout.
  `INCLUDEFONT` generates the `23, code` and eight rows VDU stream. The text
  preview draws only the characters the font defines: this build ships no machine
  character ROM, so an undefined code is reported by its number rather than a
  stand-in shape, and codes below 224 are flagged as claiming extra character
  definition memory.
- A screen editor stores the packed frame buffer itself for MODE 0, 1, 2, 4 and
  5, so a document is byte-for-byte what the machine displays. One documented
  rule places colour bit b of pixel p at bit `b * N + (N - 1 - p)` of a byte
  holding N pixels, which reproduces the one, two and four bit-per-pixel layouts
  and is proved against the separately tested MODE 5 packer. Painting works with
  the pointer or a keyboard cursor, and the colour under that cursor is readable
  as text. Changing mode reports how many pixels were resampled and how many
  colours were clamped; image import reports the source colour count, the
  approximated pixel count and any cropped area. `INCLUDESCREEN` emits the frame
  buffer in hardware block order and says the bytes are the picture only.
- Tile maps import from and export to the Tiled JSON format. Import accepts
  finite orthogonal maps with uncompressed CSV layer data and refuses anything
  else with the reason; everything the format carries that this build cannot
  hold is named individually first, including image layers, layer groups,
  external tileset references, polygon and text objects and tile flip flags, and
  adjustments such as renumbered global ids are reported separately from
  refusals. The source filename, producing tool version and format identifier
  are carried into the document, and the licence position is stated rather than
  assumed.
- Every asset codec is covered by seeded property and fuzz tests: round-trip and
  regeneration stability, randomised field mutation that must either parse or be
  refused and never half-apply, structurally hostile input, and non-JSON text.
  `docs/adr/0007-editable-asset-document-contract.md` records the contract all
  six document types follow.
- A four-channel tracker composes in the numbers OSWORD 7 actually takes, and
  `INCLUDESONG` generates the pattern data together with a working player that
  exposes `name_reset` and `name_play_row` and declares the four zero-page bytes
  it claims. Selecting the Atom rebuilds the song as one channel with volume
  limited to on or off, because that machine has a single speaker bit and no
  volume control, and generates a player that toggles port C bit 2 of the PPIA
  instead. Nothing is synthesised in the browser: this build has no verified
  pitch-to-frequency table for either machine, so a song is heard by building it
  and running it on real hardware.
- Versioned palette documents record one physical colour per logical colour for
  MODE 0, 1, 2, 4 or 5, and generate the exact `19, logical, physical, 0, 0, 0`
  VDU stream through `INCLUDEPALETTE`, or the equivalent BASIC statements. All
  sixteen physical colours are modelled, including the eight that flash between
  a colour and its complement: a flashing entry exposes both phases and is
  labelled as flashing, because a still preview cannot show the alternation. The
  pixel and map editors now preview with the project's own palette rather than
  interface theme colours, and say which palette they used and which of its
  colours flash. With no palette document they say they are using the power-up
  palette instead of implying a project palette that does not exist.
- A functional tile-map editor completes the sprites, tiles, map, code, build
  and run loop. Maps are versioned documents that store indices, layers and
  objects only: each tileset index names a pixel asset already in the project,
  so the artwork has one source of truth and editing a tile changes the map
  preview and the generated output. The editor paints with the pointer or with
  a keyboard cursor, and exposes the cell under that cursor and the current
  row's indices as text, so the canvas is not the only way to read or change the
  map. Layers can be added, hidden and removed within a declared bound; the map
  can be resized, keeping retained cells and dropping objects that no longer fit
  rather than clamping them; point and region objects carry byte properties.
  `INCLUDEMAP` generates a header, one block per layer, a tile pointer table and
  an object table, and emits any tileset artwork the build has not already
  included, once per build. A declared index with no artwork chosen generates a
  zero pointer and a build diagnostic naming it, rather than a fabricated
  address. Maps and their tileset artwork are tracked as real build inputs, so
  editing either stales the artifact.
- Two complete sample games open as ordinary browser-local projects from the
  toolbar or the command palette. **Acorn Harvest** is a BBC Model B MODE 5 maze
  collection game in 6502 assembly: its 10 by 12 maze is an editable tile-map
  document generated by `INCLUDEMAP`, which also pulls in the wall and acorn
  artwork its tileset names; a two-frame animated player sprite is compiled in
  by `INCLUDEASSET` and the game reads its generated frame table; acorns score in 6502 decimal mode and play a note through
  OSWORD 7; and a second build target links the same engine, player, score,
  sound and level modules and writes its observations to memory so the Tests
  workspace checks them against a genuinely executed BBC. **Acorn Catcher** is a
  short structured BBC BASIC II game with `VDU 23` display characters, an
  `ENVELOPE`-shaped note and one `DEF PROC` per job. Both build with no
  firmware; running or testing either one needs the ROM images you supply.
- A project can be created from an existing codebase. Choosing a folder produces
  a plan that is shown in full before anything is created: every file that will
  be imported with its language, everything left out with the reason, every
  filename that had to change, the build targets that were inferred with the
  evidence for each choice, and the editable pixel assets that can be recovered
  from `EQUB` data already in the source. A recovered asset is offered only when
  unpacking and repacking its bytes reproduces them exactly, so promoting one
  never changes what the build emits, and the original source is left untouched.
  Runs that also read as tile-map data are labelled as such, and map-shaped data
  can be promoted to a real editable map at a grid shape the run's length
  actually allows: the layout is recovered exactly, and every value found is
  declared as a tile index with no artwork chosen, because the layout can be
  recovered from the data and the pictures cannot. Folders are read in the browser and never
  uploaded, and the result is created through the same project parser and
  migration as any imported project.
- Versioned project and build-target manifests and persisted source breakpoints,
  including automatic migration from both earlier local project formats.
  Projects can retain multiple named build targets with linked entry-file and
  compatible browser-local toolchain choices plus safe output names. Build,
  run, debug, test, and binary download bind to the selected validated target,
  not the active editor tab. Each result records the exact target, machine
  profile, adapter/version, declared UTF-8 inputs and output with deterministic
  fingerprints; source, machine, target, or toolchain changes visibly stale the
  result and prevent it being downloaded or attached as current.
- Project manifest v13 separates the last explicit-save filename/content baseline
  and explicit never-saved state from continuously recovered working content.
  Dirty state and a genuine revert target therefore survive reload without
  fabricating a baseline for a newly created file; project versions 1–4 migrate
  forward and portable export still records a clean saved snapshot. V5 also
  persists named source bookmarks with file/line/column and a bounded source
  anchor, plus target-bound hardware test plans. V7 adds ARM source/target
  persistence. V8 adds build-target-scoped ARM breakpoint and logpoint intent.
  V9 preserves symbol-valued comparison operands and resolves them against the
  exact current ARM build. V10 adds target-scoped, enableable ARM breakpoint
  groups. V11 retains eight requested-versus-resolved build outcomes with move
  and rejection reasons. V12 adds bounded, target-scoped 6502 breakpoint and
  logpoint intent, named enableable groups, symbolic conditions and the latest
  eight exact rebuild-resolution outcomes. V13 adds persistent hardware test
  definitions, input sequences, assertions and retained run history for the
  selected build target; versions 1–12 migrate forward.
- Source bookmarks are named, enableable, searchable project-wide and visibly
  distinct from breakpoints. Toolbar and Ctrl+Alt+B actions add/remove the caret
  bookmark; Ctrl+Alt+PageUp/PageDown and visible controls navigate enabled marks
  across files with wraparound. Edits move anchors where deterministically
  possible, mark deleted anchors orphaned instead of silently guessing, and
  offer explicit recovery at a chosen line. Rename/delete and file-deletion
  cleanup are persisted by the local project model.
- Context-aware automatic and Ctrl+Space Atom BASIC, BBC BASIC and 6502
  completion with exact replacement ranges, project-first ranking, explicit
  ambiguity/source/version labels, and string/comment suppression; caret and hover/focus token help,
  plus a BASIC line-reference view with direct line lookup, exact source/target
  navigation, next/previous traversal and missing/duplicate diagnostics,
  signatures, current-line definitions, source symbols, BASIC line targets,
  resolved jump/call/branch navigation, and unresolved-target states. Signature
  help follows the active BASIC argument (ignoring commas inside strings or
  nested calls), exposes parameter semantics without moving editor focus, and
  can be requested with Ctrl+Shift+Space. Declared nested `FN`/`PROC` calls now
  take over signature help while open, then return to the enclosing call when
  closed; strings and REM commentary are excluded. `PRINT`, `VDU` and `CALL`
  expose labelled alternative forms with optional/repeated parameters. Current-file assembly labels, BASIC
  line numbers and declared `PROC`/`FN` routines are directly navigable at the
  caret with F12 or Ctrl/Command-click; routine calls also appear in the jump
  list and declarations in the outline. Dynamic procedure/function completion
  uses the parameters from the actual `DEF` declaration. Completion requests
  pass through a document-version session that aborts and rejects results from
  an older source snapshot; other future asynchronous language providers must
  adopt the same guard before EDT-208 can be considered complete.
- A deterministic project-language index adds real cross-file 6502 assistance
  using the same `INCLUDE` topology as the assembler. Automatic and explicit
  completion exposes origin/version metadata, CPU-compatible opcodes, connected
  symbols and project filenames with exact replacement ranges and Enter/Tab
  commit. F12, Ctrl/Command-click and jump targets navigate across closed/open
  files; ambiguous duplicate declarations require a user choice, while symbols
  outside the include graph remain unresolved with an explanation. Changes to
  any indexed file cancel stale completion, help, signature and navigation
  requests, including older requests on the same provider channel.
- Atom targets use a distinct `ATOM-BASIC` editor identity and the complete
  standard integer-ROM vocabulary from Acorn's *Atomic Theory and Practice*.
  Completion, signatures and cited help understand Atom semicolon statements,
  apostrophe newlines, 32-bit integer/address variables, computed branches and
  lower-case line labels (including labels abutted to uppercase keywords).
  The Atom floating-point ROM capability conditionally enables its documented
  scientific functions, five-byte `%` variables, floating-point statements and
  COLOUR command; selecting the base ROM keeps those entries out of completion
  while explicit help explains the missing-ROM requirement.
- Shift+F12 or the References action opens a version-labelled, keyboard-
  navigable peek list containing the declaration and real call/branch sites in
  the connected build scope. Selecting a result opens closed files at the exact
  token range. Bounded Back/Forward source-location history (`Alt+Left` and
  `Alt+Right`) restores file, caret/selection and editor scroll position and
  clears the forward branch after a new navigation.
- Optional source type hints report BBC BASIC II's authoritative suffix model
  (`%` signed 32-bit integer, `$` variable-length string, unsuffixed 5-byte
  real) or Atom's single-letter/doubled-array 32-bit integer model and
  FP-ROM-gated five-byte `%` variables. Assembly is explicitly identified as
  untyped instead of being assigned fabricated types. Editor-overlay inlays and
  later C/ARM type providers remain tracked work.
- 6502-family opcode help is now structured rather than a fabricated one-line
  tooltip. Pointer hover, keyboard focus and caret help expose decoder-derived
  addressing forms, examples, flags, register/memory/stack effects, fixed or
  variable cycle ranges, NMOS-versus-65C02 compatibility warnings, related
  instructions, reference-pack version and a direct citation to the WDC
  W65C02S datasheet. Completion still excludes incompatible opcodes, while an
  explicit lookup reports a known-but-incompatible instruction such as `STZ`
  instead of mislabelling it unknown. The help is inline, dismissible and does
  not cover the editable source.
- BBC BASIC and MOS help uses the same accessible structured panel, including
  syntax, parameter/register meanings and ranges, results, side effects,
  examples, compatibility, related entries and direct Acorn manual citations.
  Completion is filtered for the selected machine while explicit lookup retains
  an explanation for incompatible targets. CPU, machine, ROM selection, local
  ROM readiness and capabilities are included in the language-session revision,
  so target changes cannot leave old help or completion results on screen.
- BBC BASIC automatic numbering has configurable 0–32,767 start/increment
  values and selects a free intermediate number when the configured step would
  collide with the following line; if no safe number exists it inserts an
  unnumbered line and explains that the program must be renumbered. Whole-
  program renumbering is preview-first: it validates duplicates and overflow,
  shows a bounded old/new mapping, rewrites direct and `ON … GOTO/GOSUB` list
  targets, reports unresolved targets, and applies as one explicitly undoable
  edit. The shared lexical scanner protects strings, `DATA`, and `REM` both
  during rewriting and in the editor jump-target list. Range-only renumbering
  and more complex computed expressions remain tracked rather than guessed.
- The source editor's functional Edit menu operates on exact selections or
  complete current lines: cut/copy/paste plain text, select all, duplicate,
  delete, move up/down, join, indent/outdent, BASIC/assembly-aware comment
  toggling, case conversion and trailing-whitespace cleanup. The same line
  commands have visible shortcuts where assigned. Programmatic edits retain a
  bounded 100-operation per-file undo/redo history with exact before/after
  selections; ordinary typing invalidates incompatible command history instead
  of replaying stale text. Clipboard cut/paste snapshot the file and selection,
  cancel if source changes while permission is pending, and offer a labelled
  plain-text paste field when browser clipboard-read permission is denied.
  Native browser shortcuts remain available for ordinary text interoperability.
- The completed baseline editing command set also provides join/split line,
  tab-stop-aware tab expansion, C line/block comments, case conversion,
  trailing-whitespace cleanup and safe selection/document formatting for the
  registered BBC BASIC and 6502 adapters. Transformations are single command
  undo boundaries. Revert is confirmation-gated and intentionally non-undoable;
  it restores the last explicit-save content and clears command history.
- Project files are independent from open editor tabs. Files open from the
  explorer and can be closed individually, in groups, or all at once without
  deleting or discarding their source; the last 20 closed documents can be
  reopened from the File menu or with `Ctrl/Cmd+Shift+T`. `Ctrl/Cmd+W` closes
  the active editor. `Ctrl/Cmd+S` saves only the current source file to browser
  storage while preserving other dirty markers, and `Ctrl/Cmd+Shift+S` saves
  the entire project. Closing modified source keeps it recoverable in the
  browser-local project and says so explicitly.
- A searchable offline Research workspace shares the editor's typed BBC BASIC,
  6502/65C12, assembler-directive and MOS-call knowledge, with language/category
  filters and detailed syntax views. Versioned cited reference packs remain
  tracked work.
- A working registered, browser-local two-pass NMOS 6502/Acorn 65C12 assembler
  with labels, MOS symbols, Acorn `<`/`>` low and high byte selection, `SKIP`
  reservation that advances the address without emitting or padding bytes,
  common Acorn syntax/directives, diagnostics, source maps, listings, symbol
  table, binary artifact export, and deterministic tests. Assembly entry files
  can use bounded, case-insensitive `INCLUDE` directives against other project
  files; nested dependencies, missing files, exact dependency cycles, and
  original file/line provenance are reported without accessing the host file
  system. On a ROM-aware target, Run/Debug loads the bounded binary into real
  machine RAM, sets the hardware CPU entry point, and resolves persisted source
  breakpoints from both the entry file and included files onto that CPU. Its
  adapter contract proves repeat-build identity, complete per-byte multi-file
  mapping, normalized failure locations and NMOS/65C12 instruction gating.
- Versioned build targets support validated source/symbol/address execution
  entries and manual, explicit-save, or debounced live policies. Background
  builds use the same pure build service inside a cancellable module worker,
  never navigate away from the editor, and cannot overwrite an artifact the
  user has explicitly retained. Superseded request identities cannot publish
  stale results. The build surface exposes queued/running/terminal status,
  elapsed time, navigable diagnostics, and a bounded 50-event output history
  with trigger, result, diagnostic count and reproducible fingerprint.
- Build-target schema v5 exposes the complete persisted target declaration in a
  capability-aware editor. Real 6502 builds honour target defines, linked source
  units, default origin, maximum address and ordered target dependencies;
  unsupported library, generated-asset and post-processor registries are clearly
  reported as unavailable and forged manifest values fail validation. Imported
  schema-v1/v2/v3/v4 targets migrate automatically. ARM targets add explicit
  ARM2, word-aligned 26-bit load bounds and raw-output identity.
- The four current browser-local toolchains register behind one typed adapter
  invocation contract with pinned manifests and declared profile capabilities.
  Foreground builds, cancellable workers, build-all, Run, Debug and Test consume
  the same normalized result; NMOS 6502 and Acorn 65C12 share the assembly
  adapter lifecycle instead of duplicating expansion and diagnostics.
- Four readiness-gated native adapters run in the separate network-disabled,
  non-root Symfony builder: pinned ca65/ld65 for object/link projects, pinned
  BeebAsm 1.11 for BBC-style source, and `cc65.c-bbc` for real C compile →
  assemble → link builds, plus pinned GNU ARM binutils for genuine ARM2
  assemble → link → raw-binary builds. BeebAsm targets use one root plus literal
  project `INCLUDE`s and one filename-free `SAVE`; completion and hover help are
  dialect-aware. C targets use declared `.c` units, dependency-tracked static
  project/SDK headers, real optimization switches, and the separately versioned
  WebIDE BBC startup/MOS bridge necessitated by cc65's missing upstream BBC
  library. All return genuine binaries, navigable diagnostics, symbols,
  source evidence, generated documents and digest-bearing provenance through the
  same build result contract. The raw ARM2 artifact explicitly carries no RISC
  OS filetype and cannot Run/Debug until a qualified Archimedes runtime exists;
  the 6502 artifacts retain the working emulator handoff. None invokes a host
  tool or user shell text.
- Every successful adapter invocation also returns a command-independent,
  versioned result envelope with adapter/machine/profile identity, normalized
  exit and warning counts, non-provenance timing, explicit cache bypass reason,
  input/output fingerprints and SHA-256 digests, a canonical pinned-toolchain
  SHA-256 digest, artifact collection, structured size/map facts and bounded
  lifecycle logs. Immutable artifact provenance remains deterministic. Invalid
  configuration, dependency and adapter failures use the same inspectable,
  exportable envelope with normalized diagnostics and an explicitly empty
  artifact collection.
- Foreground browser builds use a bounded session-local SHA-256 content cache.
  Keys include target/dependency declarations, machine profile and the resolved
  source/INCLUDE graph; unrelated files do not invalidate a target. Every hit
  re-verifies artifact, source, provenance and toolchain digests. Cache status,
  key and metrics are visible in the build result, and Rebuild bypasses it once.
- Browser assembly expansion is stopped before its 100,000-line/2 MiB bounds,
  raw output cannot cross the 16-bit address space, and INCLUDE never resolves
  outside the in-memory project—even when given a traversal-shaped name.
- Debug, size, speed and custom assembler profiles are persisted build inputs.
  They inject reserved, deterministic profile symbols for author-controlled code
  paths and show source fidelity, measured size, runtime and compatibility
  implications without claiming a hidden optimizer. Custom targets may omit
  listing/source-map metadata, which genuinely switches the debugger to
  address-only operation. BASIC packers reject unsupported optimization modes.
- The build surface visualises the target dependency graph and selected-source
  impact. Build all schedules dependency-ready targets through at most two real
  module workers, retains each result for target switching, propagates failures
  as explicit downstream skips, and provides one cancellation path for queued
  and running work.
- Successful target results remain available as a per-target artifact tree for
  the browser session, including deterministic read-only listing, symbol,
  source/address-map, memory/size, provenance and normalized-result documents. Listing and source
  map rows jump to their immutable build source; symbol definitions and
  references expose exact source locations. Editing a target or source marks
  its retained result stale and prevents binary download while leaving the
  prior evidence inspectable and exportable.
- Every current build also has a dedicated Byte Inspector: paged hex/ASCII and
  printable-text views, selected-byte binary/decimal detail, absolute address or
  offset navigation, Acorn-style byte/text search, SHA-256 and CRC-32, exact
  window export, source-line jumps, and bounded local binary comparison with
  changed/added/removed-byte navigation. Comparison files remain in browser
  memory and are never sent to the build service.
- Portable project v6 stores multiple hardware assertion plans per target.
  Test all performs the dependency-aware bounded build first, then executes each
  enabled 6502/65C12 plan serially against the single real ROM-aware emulator,
  correlating results by opaque request identity and reporting pass, assertion
  failure, timeout, invalid-plan, build-skip and cancellation states.
- A working BBC BASIC II tokenizer with keyword and protected line-reference
  encoding, validation, listing, tokenised program download, and real injection
  at PAGE followed by RUN on a ROM-aware machine.
- A target-linked Atom BASIC text packer with numbered-line validation, readable
  artifact download, compact label preservation, and real execution by entering
  `NEW`, the source and `RUN` through the emulated Atom keyboard/interpreter.
  Machine/artifact mismatches are rejected instead of treating Atom as BBC BASIC.
- The Atom Media workspace opens, validates, edits and writes documented
  AtoMMC/Atomulator ATM containers with exact 22-byte headers and payloads. It
  packages current Atom BASIC text for `*EXEC` or current 6502 binaries with
  their load/execute addresses; validated RAM-resident machine code can be
  loaded and run in the live Atom. This does not claim that the preview-only
  AtoMMC SD/MMC hardware itself is emulated.
- Opening an `.atm` in the standalone analyser strips only its validated header,
  presents the embedded name/load/execute/length with explicit container
  provenance, and disassembles or lists the exact payload at the embedded
  address. A matching `.inf` remains an explicit higher-precedence override and
  conflicting metadata is shown rather than silently selected.
- DFS files from either SSD or DSD side and recursively discovered ADFS D/E
  files can be opened directly in the analyser. Their exact extracted bytes and
  catalogue metadata travel together; RISC OS filetyped load words remain
  visible metadata and are not incorrectly treated as executable addresses.
- A working ROM-less 6502 diagnostic runtime and debugger with source/address
  breakpoints, continue, instruction step, reset, live registers/flags, memory,
  MOS character-output shims, bounded instruction spy, and source-linked trace.
- The ROM-aware hardware debugger additionally reports the live decoded
  instruction and bytes at PC, installed execute breakpoints and raw bytes above
  the real 6502 stack pointer. It supports instruction step-in, JSR step-over,
  stack-return step-out, run-to address, removable breakpoints and side-effect-
  free memory reads. Its live memory inspector supports 1–4,096-byte paging,
  build-symbol and bounded offset navigation, 8/16/32-column hex or decimal
  views, ASCII/Acorn text, byte/wildcard/text search, selectable addresses,
  little-endian pointer following, cycle-stamped snapshots with changed-byte
  highlighting, clipboard text and text/binary exports. Paused writes are
  bounded to validated main RAM below `&8000`, acknowledged by the emulator and
  immediately read back; mapped I/O and ROM edits are rejected. Sequenced
  command IDs prevent duplicate or stale debugger actions during snapshot-driven
  UI updates.
- The live memory inspector now separates the mapped CPU view from authoritative
  physical backing stores. BBC-family sessions expose all 16 sideways slots,
  physical main RAM and MOS ROM; Master sessions additionally expose ANDY,
  HAZEL and LYNNE. Bank reads use jsbeeb's backing store without changing
  ROMSEL/ACCCON, and physical views are read-only. A live proportional map shows
  RAM, ROM, I/O, bank windows and active Master overlays from the core's actual
  ROMSEL/ACCCON values, including decoded ACCCON flags. Atom sessions use their
  distinct RAM, Branquart, I/O, language-ROM and kernel-ROM layout. Tube and ARM
  physical spaces remain explicitly unavailable until those adapters expose
  reliable physical mappings.
- The A310 debugger exposes Arculator's side-effect-free current-mapping ARM
  26-bit logical memory in bounded, non-wrapping 1–4,096-byte captures. It
  supports symbol plus offset navigation, paging, 8/16/32-column hex or decimal
  views, ASCII and byte/wildcard search, timestamped snapshot diff, clipboard/
  text/binary export, and following the 26-bit address portion of a selected
  little-endian 32-bit word. The panel states whether a capture was taken while
  running or paused. Paused current-mapping edits accept 1–256 bytes only when
  every resolved destination is backed by installed physical main RAM, verify
  exact read-back, roll back failed verification, and retain bounded before/
  after history. ROM and device mappings are rejected.
- The A310 debugger can sample its complete live 26-bit logical-to-physical
  mapping from Arculator's actual page pointers. It distinguishes RAM, main ROM,
  support ROM, extension ROM, unknown backing and unmapped space, compresses
  physically contiguous runs, and provides a proportional overview plus type/
  address filtering and 100-row paging for large alias maps.
- A310 execution controls use Arculator's real per-instruction breakpoint hook.
  The debugger publishes and removes its installed permanent breakpoint list,
  accepts aligned 26-bit addresses or build symbols with bounded offsets, and
  uses a separately identified one-shot stop for run-to. Step-over recognizes
  ARM branch-with-link and runs to the following instruction; other opcodes
  perform one exact instruction step. Run to R14 derives its target from the
  live link register. Permanent breakpoints also support bounded execute-hit
  thresholds and unsigned comparisons against live R0–R14 or execute-PC; the C
  hook owns both counting and the stop decision. Log-only and pause-and-log
  actions capture immutable R0–R14, execute-PC and hit count into a 64-event
  core ring with overwrite accounting, then render only documented template
  placeholders. Source step-in advances through exact core instructions until
  the authoritative PC reaches a different mapped file/line; source step-over
  uses the same rule except that BL installs a real one-shot hook stop at the
  next mapped statement. Both paths validate build metadata, yield during long
  searches and stop at a bounded instruction budget. Permanent breakpoints can
  combine up to four register/PC comparisons with explicit AND semantics; the
  bounded predicate set is evaluated inside the same C instruction hook and is
  shown verbatim in the live inventory. ARM breakpoint expressions, enabled
  state, hit thresholds and compound predicates are stored per build target in
  the portable project schema. They re-resolve on every current build, record
  its output digest in the resolution view, remain visible when unresolved and
  reinstall into the real core after a browser reload. Symbol-valued comparison
  operands and target-scoped grouping are project-backed and resolve into the
  exact flat breakpoint set installed in Arculator.
- Raw ARM debug-image injection no longer depends on waiting for RISC OS to map
  logical `&8000`. The paused bridge installs an identity mapping only for the
  bounded image pages backed by installed physical RAM, verifies every byte,
  enters masked supervisor mode and refills the real pipeline. A ROM-backed
  contract proves exact `MOV; ADD; B` bytes and a counted conditional stop in the
  resulting loop. HostFS/ADFS remain the qualified normal RISC OS application
  paths; the explicit mapping is scoped to raw debugger execution.
- The A310 debugger can edit R0–R14 while paused and verifies the requested
  32-bit value against a subsequent live-core snapshot. Execute-PC editing is
  separately aligned and 26-bit bounded; it preserves the packed status/mode
  bits, stores the core's PC+8 representation and refills the pipeline. Writes
  are disabled while running and are never reported successful from UI state
  alone. The ROM-backed browser contract proves an R2 write/read-back/restore
  and an execute-PC move/read-back/restore while comparing the packed status
  mask before and after the pipeline refill.
- Hardware breakpoints can use bounded hit-count thresholds and typed
  A/X/Y/S/P/PC comparisons (`=`, `≠`, `<`, `≤`, `>`, `≥`). They can pause,
  optionally log, or operate as non-stopping logpoints. Log templates substitute
  only documented register/hit placeholders, live hit counts are visible, and a
  bounded 64-entry session log prevents unbounded browser growth. Arbitrary
  expression evaluation and memory conditions are not claimed yet.
- The ROM-aware debugger also provides genuine jsbeeb bus-hook data
  watchpoints for one-byte reads, writes, and value changes in the currently
  mapped 6502 main-RAM address space (`&0000`–`&7FFF`). Optional byte equality
  or inequality conditions, live access counts, exact triggering instruction
  PC, old/new values, removal, and a bounded event history are exposed. The UI
  declares the width, address space, and emulated implementation. Banked ROM,
  mapped-I/O and range data watchpoints are not claimed. Interrupt-transition,
  exact memory-access, opcode and address event stops are available through the
  bounded triggered trace. Frame/sync/mode/palette and exact supported beam
  stops are available through the separate high-overhead raster hook.
- Paused hardware sessions can edit A/X/Y/S/P/PC as one validated, sequenced
  transaction. The emulator acknowledges the operation with authoritative
  before/after values, keeps a bounded per-program edit log, recalculates
  interrupt eligibility after P changes and clears stale hook-resume state after
  PC changes. The editor is disabled while execution is running.
- The debugger's hardware-inspector tab captures peripherals only on explicit
  refresh through jsbeeb's side-effect-free internal snapshot APIs. BBC/Master
  profiles expose video timing/beam state, all 6845 registers, Video ULA control
  and resolved palette, system and user 6522 registers/timers/interrupt flags,
  ACIA latches, ADC result/status, ROMSEL/ACCCON, the active 8271/1770 floppy
  controller/drive mechanics, cassette/serial selection and clocks, and SN76489
  tone/noise/attenuation latches. Tube-enabled profiles additionally expose Tube
  ULA host/parasite status and FIFO counts. Atom profiles expose MC6847 timing and the
  8255 PPIA keyboard/video/tape/speaker latches and pins. Every row identifies
  its address, access semantics, current/previous value, decoded known fields,
  change state and exact source of truth; unavailable devices are omitted.
  Both families expose the emulator's complete keyboard matrix as coordinate
  masks without guessed key names. Mounted UEF/tapefile transports report
  parser stream/chunk position and state without polling or consuming input.
  Raster events and interrupt history remain tracked extensions.
- Live CPU-state panels identify the actual jsbeeb core (NMOS 6502, CMOS 65C02
  or CMOS 65C12), expose the core IRQ source mask/line/acceptance and NMI
  line/edge without inventing source names, and decode the selected core's
  opcode table. Addressing mode, side-effect-free operand value, pointer,
  branch target, page crossing and effective address are resolved where the
  paused state permits it. Exact step-in records actual emulator cycle delta,
  register/flag changes and IRQ/NMI transition; step-over/out effects and full
  bus activity remain part of the wider trace work.
- An explicit interrupt-history monitor records a bounded 32–1,024-event stream
  at genuine jsbeeb instruction boundaries. It reports IRQ/NMI line changes,
  core acceptance, interrupt entry proven by the three-byte CPU stack frame,
  RTI exit, PC, emulated cycle, monotonic timestamp and any simultaneously
  pending/enabled System VIA, User VIA, ACIA or FDC source obtained from
  authoritative peripheral snapshots. Events carry a retained trace-record
  reference when one exists and link their PC into live disassembly or memory.
  The UI states the timing cost; stopping removes the hook and restores the
  normal fast CPU path without discarding the bounded history.
- The Raster Timeline is a separate opt-in, bounded 64–4,096-event recorder
  over jsbeeb's live beam, CRTC and Video ULA state (or MC6847 facade plus Atom
  PPIA mode/CSS latches). It records frame and VSync edges, mode/control and
  palette changes, configurable scanline samples and optional HSync edges with
  frame, beam X/Y, RA/HC/VC, display address, PC, cycle and monotonic time.
  It can pause on a selected video event or an exact supported beam position,
  links event PCs into live disassembly, renders a compact position plot and
  exports versioned JSON or readable text. Instruction-boundary sampling and
  its high timing cost are explicit; stopping removes the hook and restores the
  fast CPU path. Software sprites/objects are not inferred from pixels.
- The Performance Profiler is a bounded opt-in execution tool that attributes
  exact completed-instruction cycle deltas to live mapped PCs, assembler
  symbols, and pinned source lines. It records min/average/max cost and cycle
  share, derives function call counts only from executed JSR opcodes, and keeps
  a bounded timeline of exact emulator 50 Hz execution slices. Optional raw
  jsbeeb bus hooks count genuine reads and writes by mapped RAM, sideways,
  operating-system, and I/O regions; the UI explicitly notes that reads include
  instruction and operand fetches. Complete stopped profiles can be saved as a
  build-fingerprinted baseline, compared at total and address level, and
  exported as versioned JSON or readable text. Stopping removes all profiler
  hooks and restores the normal fast path.
- The hardware debugger includes a bounded live mixed source/disassembly view
  decoded from the emulator's current mapped bytes. It shows address/space,
  current bank context, bytes, symbol, mnemonic/operand, navigable branch/call
  targets, current-PC and breakpoint markers, static cycle ranges, and exact
  counts/cycles from the retained opt-in trace window. Source text is snapshotted
  into the assembled artifact; if any contributing editor file changes, the
  debugger continues showing the pinned build source and prominently marks the
  editor as newer. Pinned source rows navigate back to the corresponding current
  file/line without implying that changed content was executed.
- The hardware instruction trace is an explicit opt-in recorder: stopping it
  removes all three jsbeeb instruction/read/write hooks and restores the normal
  fast execution path. While active it keeps a configurable 64–4,096-entry
  circular buffer with sequence, wall/cycle time, actual cycles, selected CPU,
  mapped address-space context, core-specific decode/effective address,
  before/after registers and flags, IRQ/NMI transitions, up to 24 real data/I/O
  bus accesses per instruction, and exact build source/symbol mapping. Address
  range and opcode capture filters, pause-after-match, search, aggregate counts,
  bookmarks, clear, and versioned JSON/human-readable export work in the UI.
  Independent instruction-address, opcode, memory-read, memory-write and IRQ/NMI
  transition triggers retain configurable pre/trigger/post windows, uniquely
  mark the trigger record, automatically remove trace hooks at the boundary and
  can pause the machine after the requested post records.
  The UI prominently labels timing/performance overhead, overwritten records,
  deliberately skipped samples and per-instruction access drops. Sampling can
  retain every 1st–1,024th instruction and can remove the raw bus hooks for a
  lower-overhead summary; independent triggers require unsampled capture. The
  expandable view is bounded to the latest 200 rows, running snapshots to 256,
  while a semantic accessible table pages through the complete stopped buffer
  in 25/50/100-row windows. Instruction/operand fetches are already represented
  as opcode bytes and are intentionally excluded from trace bus events.
  Instruction PCs and bus accesses snapshot their live mapped region, exact
  sideways ROMSEL bank, writability and source at capture time. A separately
  bounded unified timeline can filter instruction, memory-read, memory-write and
  IRQ/NMI-transition events, search their source/symbol/mapping fields and
  export them with linked instruction records in trace schema v2. Deterministic
  replay is available separately for the jsbeeb 8-bit adapter while paused.
- Deterministic replay retains a user-bounded ring of full machine checkpoints
  (including writable sideways banks) at configurable 1–4,096-instruction
  intervals and a measured in-memory byte total. Reverse step restores the
  nearest retained checkpoint and re-executes to the preceding instruction;
  reverse continue targets the preceding retained checkpoint. A reverse result
  is committed only when PC/registers/flags, the absolute CPU cycle and an
  ordered digest of every bus write exactly match their recorded boundary.
  Failed verification restores the original state. Loading code or BASIC,
  reset, state restore, memory/register edits, media changes, keyboard input and
  audio activation start a visibly labelled irreversible segment; reverse
  controls cannot cross it. Starting history is explicit, paused-only and
  exposes its full-snapshot/high-overhead cost; stopping removes both hooks and
  releases retained states. Trace, profiler, raster and interrupt monitors are
  stopped before replay so they cannot claim uninterrupted observations.
- A hardware test whose setup asks for a reset now waits for the real machine to
  finish booting before the program is injected. A reset BBC has not installed
  its operating-system vectors and its language ROM has not claimed memory from
  PAGE, so a program loaded at that instant could not call the MOS at all. The
  runner advances the genuine core until it reaches OSRDCH, which is the first
  point at which the OS is callable and the language is waiting for input, and
  fails the test with an explicit message if that never happens. Boot cycles are
  excluded from the test's own cycle budget and from its audio capture. The Atom
  MOS has no verified readiness entry point in this build, so no marker is
  claimed for it and its behaviour is unchanged.
- A functional Tests workspace rebuilds the active 6502/65C12 source, binds the
  exact binary and symbol table, loads it into the selected ROM-aware machine,
  runs to a symbol or address under a cycle budget, and evaluates live
  A/X/Y/S/P/PC, side-effect-free memory bytes, exact MOS OSWRCH text, bounded
  exact framebuffer-region digests and elapsed core cycles. It reports passed,
  failed, validation-error and timeout outcomes
  with expected/actual values. Setup, deterministic keyboard/delay/reset input,
  captures and teardown are versioned in project format 13. A persistent
  target/file/suite explorer retains bounded result metadata, can debug the
  exact failed build, and exports native JSON or JUnit-compatible XML. Plans are
  bounded to 64 assertions, 1,024 expected memory bytes, 4,096 captured memory
  bytes and 10,000,000 cycles. Screen, audio and event assertions plus non-
  browser headless execution remain tracked work.
- A pinned jsbeeb 1.19.1 machine runtime, isolated as a separate same-origin
  entry point, with a browser-local ROM vault, real BBC Model B MOS/DFS/BASIC
  boot, framebuffer, keyboard path, run/pause/reset/single-step, live registers
  and flags, execute breakpoints, memory inspection, instruction-step spy, and
  user-enabled real SN76489/Atom-speaker AudioWorklet output. Audio is muted and
  its context suspended by default/when disabled.
- The production 6502 parent/iframe bridge uses exact origin and window-source
  checks, a fresh random runtime-session nonce, monotonically sequenced commands
  and independently sequenced responses. Wrong-session, duplicate and stale
  envelopes are rejected. An iframe reload clears observed state and transport
  counters before the selected machine is initialised again. The A310 bridge
  uses the same envelope while retaining an explicit no-token compatibility
  mode only when its runtime is opened outside the production workbench.
- Each attached core negotiates an explicit protocol-versioned capability list
  and publishes session ownership, accepted-command count, last command ID and
  a bounded 32-entry accepted-command audit in live snapshots. The workbench
  shows this state in the debugger. One command may be awaiting acknowledgement;
  at most 64 further commands are queued, each released only after the core
  returns a session-bound sequenced acceptance response. Queue overflow is
  refused visibly instead of silently dropping or sending unbounded work.
- Build and debug now creates a versioned immutable session binding from the
  exact successful machine-code result. The retained record includes full
  output SHA-256, build fingerprint, toolchain version, copied machine manifest,
  pinned emulator identity/version, selected ROM filename/size/SHA-256 records,
  processor, origin, entry point and run capabilities. The debugger visibly
  distinguishes stopped, starting, running, paused, stepping, rewinding,
  terminated, crashed and disconnected. A real authenticated Stop command
  cancels temporary execution work and pauses jsbeeb or Arculator while keeping
  the binding available for inspection; Restart reuses it. Unsafe PC-only
  instruction skipping is unavailable with its processor-state reason shown.
- Breakpoint projection is ordered behind debug image attachment. It begins
  only after the live PC proves the bound artifact range is active, preventing
  a breakpoint update from overtaking the load command. Stable empty intent and
  group collections also prevent redundant synchronization from filling the
  bounded transport queue.
- Debug commands are available from labelled controls, the searchable command
  palette and keyboard. F6 pauses, Shift+F6 stops, Ctrl+F5 restarts, Alt+F11
  steps one instruction, F11 source-steps in, F10 source-steps over, Shift+F11
  source-steps out and Ctrl+F10 runs to the mapped cursor line. Run to address
  and run to build symbol are also palette commands. Disabled commands state
  whether the core must be paused, a session must be attached, or current source
  metadata is missing. jsbeeb source stepping uses a live instruction hook and
  a bounded 100,000-instruction outcome rather than inferred UI movement.
- The A310 ARM state view reports the pinned coprocessor configuration alongside
  R0–R15, 26-bit status/mode, banked registers and pipeline latches. The current
  qualified profile has `fpa = 0`, so the dedicated panel states that FPA
  hardware and registers are absent. It does not synthesize floating-point state
  from general ARM registers or expose a control unsupported by the core.
- Qualified 6502 Tube sessions expose host and parasite registers side by side,
  explicit focus, interrupt and boot-ROM overlay state, both cycle domains,
  Tube ULA channel/FIFO state and parasite logical versus physical memory. A
  bounded timeline is captured at the real jsbeeb host/parasite ULA read and
  write methods with the byte, register, both PCs and both clocks. ULA memory
  addresses are never polled. Independent parasite pause and step controls are
  disabled because the core schedules both processors as a coupled machine.
  A dual proportional map identifies both 16-bit address spaces and live PCs.
  The parasite inspector reads bounded logical, physical RAM or physical boot
  ROM windows with paging, formatting, wildcard/text search, cycle-stamped
  snapshots, copy and text/binary export. Logical ULA reads are rejected so
  inspection cannot acknowledge or consume a Tube FIFO.
- Both qualified debuggers provide bounded safe expressions and refreshable
  watches over live registers, exact build symbols and side-effect-free memory.
  The 6502 call view admits stack frames only when live stack bytes verify a JSR
  return site. The ARM view admits R14 only when the exact artifact verifies the
  preceding BL. Current toolchains do not emit lexical scopes, variable/type
  locations or unwind records, so locals, parameters, storage classes and
  deeper frames are clearly unavailable instead of being inferred.
- Browser-qualified ROM boots now cover BBC Model B, BBC Master 128 and Acorn
  Atom. Tube selection conditionally requires the matching parasite boot ROM;
  the initial BBC B + 6502 Tube host configuration also boots successfully.
- Qualified BBC B and Master profiles can also enable the locally supplied
  1MHzPi BBC WiFi development ROM. The firmware vault labels the moving snapshot
  as development firmware and jsbeeb mounts it through its real sideways-ROM
  loader; it is never bundled or exported. BBC B+ and the Electron mark the
  development capability planned until their hardware adapters can reproduce it;
  the vendored Electron core models no expansion ROM slot at all. The same 1MHz firmware is provisionally applicable to BBC B+
  but remains development-only. Electron + Plus 1 now has a separate local
  development inventory for the Plus 1 RH support ROM and modified ElkWiFi ROM
  sourced from the 1MHzPi project. Both payloads can be imported, validated and
  hashed independently; the importer requires the raw 16 KiB ElkWiFi payload,
  not its 16,406-byte Acorn file-header form. Inventory completion does not
  enable Run or claim that the Electron external 1 MHz bus is emulated.
  The deployed browser contract verifies the vault request and exact development
  ROM byte in physical sideways bank 13 through the live debugger.
- Disk sets record which build artifacts, project files and generated boot
  files go on which disc and side, in what order, and how the machine starts
  from them. The set names the build targets it needs and says whether each has
  been built; writing is refused, with the missing targets named, until they
  have. Capacity comes from the real DFS geometry — whole sectors, 798 of them
  after the catalogue, at most 31 entries — so a side that will not fit says by
  how much before anything is written, and a side whose files are not all built
  says it cannot be sized yet rather than reporting a wrong total. Writing goes
  through the same DFS and DSD writers, so every side is still reparsed and
  byte-compared.
- The Media workspace mounts bounded local SSD/DSD/ADFS-family images into live
  drive 0 or 1 and mounts validated UEF/tapefile cassette streams through the
  real BBC/Electron ACIA or Atom PPIA. It reports only emulator acknowledgements
  and can retain disk and cassette attachments together. Single-sided DFS SSD
  images also receive a non-destructive catalogue preview with title, boot
  option, cycle, geometry, file/directory names, lock flags, load/execute
  addresses, lengths, start sectors, and structural warnings before mounting.
  The DFS logical-file editor creates or opens 200 KiB SSD and conventional
  track-interleaved 400 KiB DSD images, exposes either DSD side, edits each
  title/cycle/boot option and ordered catalogue, and accepts bounded host files
  or the current immutable build. Dirty drafts cannot download or mount stale
  bytes; each side and exact file extent is independently reparsed after the
  writer reinterleaves DSD tracks. Durable emulator media write-back, unknown
  metadata preservation, and tape recording remain tracked work.
- The qualified A310 path accepts exact 800 KiB ADFS `.adf` images in drive 0
  or 1, acknowledges attachment only after Arculator's controller accepts it,
  validates its old/new-map geometry and checksums, and previews the
  recursively validates D/E-format directories, resolves map fragments, and
  exposes typed object metadata plus exact file extraction before mounting,
  can create/download a deterministic one-file E disk from a current &FF8 ARM
  Absolute artifact and run its validated drive-0 copy through real FileSwitch,
  exposes muted-by-default VIDC audio, and downloads the live framebuffer as a
  PNG. A310 state save/restore remains deliberately disabled: the pinned core
  does not expose a complete deterministic serializer, and a WASM heap dump
  would lose browser, SDL, filesystem and device ownership state.
- The local firmware vault enforces manifest sizes, blank/combined-bank checks
  and BBC sideways-ROM header diagnostics, records SHA-256 identity, imports
  normalized folders atomically, and never includes ROM bytes in project
  exports. These structural checks are explicitly not presented as proof of
  authenticity or redistribution permission.
- Versioned machine-state downloads round-trip native CPU, RAM, paging,
  scheduler, video, sound-chip, VIA, ACIA, ADC, FDC and Tube state. Local disk
  images are embedded for self-contained restoration, ROMs are excluded, and
  incompatible machine/Tube snapshots are rejected before restore.
- The real emulator framebuffer can be downloaded as a native 1024×625 PNG and
  expanded to browser full-screen, with both browser Escape and an accessible
  in-frame exit control.
- The first Asset Studio increment provides functional character, sprite and
  tile pixel workspaces with 8–32 pixel dimensions, a four-index palette,
  painting/erasing, wrap shifts, local recovery, deterministic packed 2bpp
  bytes, assembler `EQUB` output and binary download. Assets are now validated
  versioned JSON documents with legacy-draft migration, bounded undo/redo,
  JSON import/export, retained extension fields and a SHA-256 generated-output
  manifest. Both the editable document and generated `EQUB` source can be added
  directly to the project. Rectangular selection supports fill, cut, copy and
  clipped paste plus selection-local horizontal/vertical flips through a
  validated schema-1 clipboard payload; four zoom levels
  and scroll panning retain the button-grid keyboard alternative. The generated
  codec is explicit: portable logical 2bpp is labelled as not being screen
  memory, while the separately tested BBC MODE 5 option emits its real split
  hardware bit-plane order and records that choice in the document/manifest.
  Sprite documents additionally keep an independent one-bit opacity mask and
  bounded hotspot. The mask has its own editor plane, binary download, packing,
  hash and assembler label; generated source also exposes colour and hotspot
  labels and is reassembled in tests. Sprite animations support 1–64 named,
  timed frames with independent pixels/masks/hotspots, duplicate/delete/reorder,
  loop/once preview, whole-animation resize and undo. Generated colour/mask
  streams retain exact frame order and include an assembler-verified runtime
  table of pointers, hotspots and durations plus manifest frame-stride/playback
  evidence. Target-native blitter previews and other Acorn screen encodings
  remain tracked work. An asset can be
  promoted to a live 6502 build target: `INCLUDEASSET` validates and generates
  its editable JSON during each build, includes it in provenance/fingerprints
  and incremental impact analysis, and makes an existing artifact visibly stale
  after document edits.
  `INCLUDEASSET` also participates in the normal editor intelligence contract:
  completion, hover/signature documentation, asset-path suggestions and source
  definition navigation all resolve against the live project.
- Local ROM binaries are excluded from Git, Docker context and project export;
  the runtime container includes jsbeeb's GPL licence but no emulator ROMs.
  The firmware vault can import the ignored `local-roms/normalized` directory in
  one folder selection: paths and sizes are matched against the selected
  versioned adapter manifest, every candidate is validated before one atomic
  IndexedDB transaction, ambiguous/missing required files reject the whole
  operation, and optional expansion ROMs are imported when present. Individual
  file import remains available.
- Settings resolve in three layers: what the build ships, what the person chose
  in this browser, and what the open project carries. A value that fails its
  schema is skipped rather than corrected, and the surface says which layer was
  ignored and why. The registry takes its value sets from the modules that own
  them, so a setting cannot offer something the runtime would refuse. Settings
  export and import as a versioned document that validates each entry on its own
  and preserves entries a newer build wrote; projects, firmware, test history
  and asset drafts are never included, and an import cannot smuggle one back in.
- One release gate, `npm run ci`, is the single definition of what must pass:
  the TypeScript build, help verification, the whole test suite against its
  coverage floors, the backend suite against the real assemblers, PHPStan at
  level 8 with the PHP formatter in check mode, the production build, the
  vendored GPL provenance, an executable check that no firmware or media image
  is tracked, and a headless browser smoke that boots the built workbench and
  fails on any console error. No test is allowed to skip: the gate fails if any test in
  either suite did not run, and a stage that cannot run is reported as skipped
  with its reason and fails the gate too, so the pipeline cannot quietly check
  less than it believes it does. `npm run toolchains` obtains the pinned
  assemblers, building BeebAsm at the exact commit the product names and
  refusing a binary that reports a different version. The GitHub Actions
  workflow runs that same gate rather than restating its steps.
- An honest inspector and emulator connection area: no fabricated registers,
  memory, command pop-up, runtime output, or debug state is displayed.
- Working browser-local file analyser for tokenized/plain BBC BASIC, selected-
  target Atom BASIC numbered text, ordinary text, and flow-aware NMOS 6502,
  Acorn 65C02/65C12, ARM2 or ARM3 disassembly. The ARM path decodes 26-bit base
  instruction families, conditions, shifts/immediates, branches, coprocessors
  and core named RISC OS SWIs while retaining unreachable/trailing words as
  data. The analyser includes MOS/VDU/hardware annotations where applicable,
  and NMOS 6502 or 65C02/65C12 analyses expose downloadable assembly source
  only after the built-in assembler has reproduced the original bytes, load
  address and entry point exactly. Unreached data is emitted as lossless
  `EQUB` values, while generated and user control-flow labels remain readable.
  ARM2/ARM3 analyses similarly generate readable GNU `.sarm` source around
  exact `.inst` words; a download appears only after the isolated pinned native
  assembler/linker has returned the same bytes, origin and entry point. ARM3
  verification is explicitly byte-level because the pinned native target is
  ARM2. Either verified form can also be added directly to the current project
  and opened in the editor without a download/re-import step.
  A synchronized, bounded hex/ASCII view lets a selected byte resolve back to
  its instruction/data row and symbol inspector without rendering the full
  multi-megabyte input at once.
- Reachability is honest but incomplete, so what a reader knows can be recorded
  rather than guessed. Extra entry points, spans marked as code, data or text,
  the destinations of a jump the bytes do not resolve, comments and labels are
  kept in a versioned document bound to the SHA-256 of the bytes it describes,
  and the same deterministic analysis is re-run with them. A jump through a
  pointer is left unfollowed until someone says where it goes; a span marked as
  data stays out of the decoder, and an instruction that would run into one is
  refused with a warning rather than decoded across it. Every edit is undoable
  to the exact earlier document, the record persists in the project keyed by
  digest so a binary keeps what was learned about it however it is reached, and
  it travels in the exported analysis document so that document reproduces the
  listing rather than only describing it.
  Analysis runs in a cancellable, one-request module worker with stale-result
  rejection and a hard 20-second ceiling. Current build artifacts can enter it
  directly with exact target/fingerprint, address-space, processor, origin and
  entry provenance; stale or failed artifacts cannot.
  The workspace also provides cross-reference navigation, mixed code/data
  presentation, filtering, address controls, matching `.inf` sidecar metadata
  with conflict reporting, text export, and versioned JSON export with a SHA-256
  source fingerprint.
- Responsive panel behavior and accessible names, focus states, and keyboard-
  operable controls.
- Separate semantic theme tokens and runtime theme override entry point, aligned
  with the Acorn File Forge and bit-chat visual language.

Audio recording/advanced audio controls, media write-back, cassette
recording, persistent state library/rewind, Electron/B+ coverage, additional
Tube processors, additional Archimedes profiles, AIF/RISC OS C packaging, cloud, and
server storage remain on the tracked backlog. Diagnostic and raw-load sessions
remain clearly distinguished from typed applications launched by FileSwitch
and from ROM-aware machines. See
`docs/requirements-specification.md` and `docs/todo.md` for the approved
implementation scope and gates.
