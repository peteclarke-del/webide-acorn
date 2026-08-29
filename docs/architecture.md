# Architecture

This describes how the product is put together and, more usefully, why it is
put together that way. Where a decision was contested or has a cost, the cost
is stated. A document that only lists what exists is a directory listing with
prose around it.

## Shape

The workbench is a single-page React application with no server of its own for
anything a browser can do. Source is edited, assembled, analysed and run in the
tab. One service sits behind it — an isolated container that runs the native
toolchains, because ca65, BeebAsm and GNU binutils are real programs and cannot
be honestly reimplemented in JavaScript.

That split is the central architectural decision and it is deliberate:

- Everything that can work offline does. Opening a project, editing it,
  assembling it with the browser-local assembler, running it on an emulated
  machine and debugging it all work with the network unplugged.
- The one thing that cannot is isolated rather than trusted. The native builder
  has no network route at all, drops every capability, runs read-only as an
  unprivileged user, and is bounded on memory, processes, CPU and stage time.

## Modules

| Directory | What lives there |
| --- | --- |
| `src/analysis` | Disassembly, annotation, coverage correlation and export. Reads bytes; never executes them. |
| `src/assets` | The editable asset documents — pixels, palettes, fonts, tile maps, screens, songs — and their generators. |
| `src/build` | The toolchain registry, the browser-local 6502 assembler and BASIC tokeniser, the build graph and the native adapter. |
| `src/components` | The workbench surfaces. Presentation and interaction; the rules they present live in the modules above. |
| `src/data` | Machine profiles, and the generated compatibility and conformance documents. |
| `src/editor` | Editing operations, document lifecycle, preferences, encodings and line endings. |
| `src/emulator` | Adapter contract, debug models, and everything that talks to a running machine. |
| `src/language` | The language adapter API, the project language index, completion, and the reference packs. |
| `src/media` | Disk, tape and ROM image readers and writers. |
| `src/profiles` | Machine and configuration resolution, and portability comparison. |
| `src/project` | The project document, its schema and migrations, import, bundles, trash and limits. |
| `src/rom` | Firmware manifests and adapter support, which decides what this build can actually run. |
| `src/settings` | Layered settings: defaults, then the person's, then the project's. |
| `src/testing` | Hardware test plans and their execution model. |
| `src/commands` | The workbench command set and the one key-binding table every chord resolves from. |
| `src/help` | The in-app help topics and their integrity checks. |
| `src/platform` | The few places a browser capability is wrapped rather than used directly. |
| `src/runtime` | The 6502 core used for hardware test execution, separate from the emulator adapters. |
| `src/samples` | The worked sample projects, which open through the ordinary project parser. |

## The rules the code follows

These are not style preferences. Each was introduced because its absence caused
a defect that is recorded in the backlog.

**Nothing invents runtime state.** If a value cannot be read from the running
machine, the interface says it is unavailable and why. There is no placeholder
register, no assumed memory content and no fabricated cycle count anywhere. The
Electron adapter declares twenty-four capabilities it does not have, each with
the reason, rather than approximating them.

**A refusal names what was refused and what to do.** Every error path in this
codebase states the thing, the reason and the remedy. "Failed" on its own is
treated as a defect, and the limits register refuses an entry written that way.

**Two declarations of one fact are a defect.** Where the same thing was stated
twice — accepted project formats, commit characters, security policy directives,
compatibility claims — one of the two is now derived from the other and a
contract proves they cannot drift. Several of those pairs had already drifted
when they were found.

**A check that cannot fail is not a check.** The release gate refuses to pass
when a rule found nothing to examine, and every browser-level check in it has
been verified by deliberately breaking the thing it checks and confirming the
gate goes red.

**A skipped test is not a passing test.** The gate fails on any skipped test or
stage. Where a test needed a toolchain, the toolchain is built rather than the
test made conditional.

## Emulator adapters

An adapter declares the API version it implements, every operation it supports,
and its limitations. An adapter declaring a different API version is not loaded,
because a partially-matching adapter is the one failure mode that produces wrong
answers rather than no answers.

Three cores are integrated: jsbeeb for the BBC family, Arculator compiled to
WebAssembly for the A310 class, and a vendored ElkJS for the Electron. What each
can and cannot do is in `docs/compatibility.md`, generated from the adapters
themselves.

See `docs/adr/0001-emulator-integration-boundary.md` for the boundary, and
`0006-archimedes-wasm-runtime.md` and `0008-elkjs-electron-adapter-and-gpl-position.md`
for the two cores with licence positions worth reading before changing them.

## Language adapters

A language adapter is the single declaration of what a language offers:
classification, outline, and diagnostics that one file can support on its own.
The boundary is the point of the API — an adapter sees one file, so it reports
a duplicate label but never an unresolved symbol, because an included file it
cannot see may declare it. Whole-project questions belong to the project
language service, which has the include graph.

A language with no adapter gets nothing rather than a stub, because a stub
returning an empty outline looks like a working adapter and is believed.

## Schemas and migration

Every document this product has ever written stays readable. The accepted
versions are derived from one version number rather than restated as a list,
and a document from a newer build is refused by name rather than half-parsed.
The full policy, with every versioned surface and what it promises, is in
`docs/versioning-policy.md`, generated from the constants it describes.

## Testing

Three layers, and each exists because the other two cannot answer its question.

- **Contracts** — pure functions and models, run under Vitest. These state what
  the code must do in the words of the problem, not the implementation.
- **Component contracts** — the real surfaces under jsdom, driven the way a
  person drives them.
- **The release gate** — `npm run ci`. Types, help integrity, the whole test
  suite, the backend suite, the production build, vendored-file provenance,
  repository hygiene, and a headless Chromium run against the built artefact
  under the shipped security headers.

The browser stage is where layout, policy and accessibility are settled, because
none of them is decidable without a rendering engine.

## Developer setup

```bash
npm install
npm run dev          # the workbench, with hot reload
npm run typecheck    # everything, tests included
npm test             # the suite
npm run ci           # the full release gate
```

The container path is in the README. Running the native toolchains locally needs
`scripts/toolchains.mjs`, which clones and builds the pinned BeebAsm commit and
locates cc65 and the ARM binutils; the backend tests fail rather than skip when
it has not been run.

## Adding things

**A machine profile** — add it to `src/data/machines.ts` with its variants, ROM
sets and capabilities, each capability marked `supported`, `preview` or
`planned`. Then add an adapter support record in `src/rom/adapterSupport.ts`
saying which engine runs it or why none does. The compatibility matrix and its
contracts pick both up automatically. Marking a capability `supported` that the
build cannot drive will fail the machine catalogue contract.

**A toolchain** — add a manifest to `src/build/buildTarget.ts` and bump the
registry version, so an artifact can still be traced to what produced it.

**A language adapter** — implement the interface in
`src/language/languageAdapter.ts` and register it. The validator contract will
require an identifier, a label, the dialects it actually implements, and all
three methods.

**A limit** — add it to `src/project/limits.ts` importing the constant from the
module that enforces it. The validator requires the reason the limit exists and
what happens on reaching it, and refuses an entry that says only that something
fails.

## Dependency updates

Vendored third-party code is checksummed and its upstream revision recorded in
`docs/third-party-components.md`; the release gate verifies the checksums. A
vendored file that is patched carries its patch in `docker/` and the reason in
its `PROVENANCE.md`, so a future update knows what to reapply and why.

Runtime dependencies are deliberately few — React, Vite, jsbeeb and fflate. Each
addition is a licence position and a supply-chain surface, and is worth the
argument.

## Contributing

The backlog in `docs/todo.md` is the source of truth for what is done. A
checkbox is not complete until it records how it was verified; the traceability
report counts that directly and names anything that does not.
