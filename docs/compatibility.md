# Compatibility matrix

This document is generated from the machine profiles, the adapter support
map, the toolchain registry and the emulator adapter descriptors that the
product actually runs on. It is not maintained by hand, and a contract test
fails the release gate whenever it stops matching the code. Regenerate it
with `npm run compatibility`.

## What the words mean

- **Runnable** — a qualified emulator core in this build executes the machine, with firmware you supply yourself.
- **Described** — the product models the machine, its variants, ROM sets and hardware, and no core in this build executes it. Nothing is substituted for it.
- **Fitted** — a capability the machine has and this build drives.
- **Preview** — a capability that does something, with known gaps.
- **Planned** — not fitted. It is listed because the machine has it, not because this build does anything with it.

No firmware is distributed with this product. Every runnable machine needs
ROM images you own and supply.

## Machines

5 of 11 registered machine profiles are runnable in this build.

| Machine | CPU | RAM | Tier | Emulator core | Variants | ROM sets |
| --- | --- | --- | --- | --- | --- | --- |
| Acorn Atom | MOS 6502 @ 1 MHz | 2–12 KB base RAM | Runnable | jsbeeb 1.19.1 | 3 | 2 |
| Acorn BBC Model A | MOS 6502A @ 2 MHz | 16 KB RAM | Described | no ROM manifest registered here | 2 | 2 |
| Acorn BBC Model B | MOS 6502A @ 2 MHz | 32 KB RAM | Runnable | jsbeeb 1.19.1 | 3 | 3 |
| Acorn BBC B+ | MOS 6502A @ 2 MHz | 64 or 128 KB RAM | Described | no model in any core here | 2 | 2 |
| Acorn Electron | MOS 6502A @ 2 MHz variable | 32 KB shared RAM | Runnable | elkjs ff123355 | 3 | 2 |
| BBC Master Series | WDC 65C12 @ 2 MHz | 128 KB base RAM | Runnable | jsbeeb 1.19.1 | 4 | 3 |
| Acorn Archimedes A300 | ARM2 @ 8 MHz | 512 KB–1 MB RAM | Runnable | arculator webide-1 | 2 | 6 |
| Acorn Archimedes A400/1 | ARM2 / ARM3 | 1–8 MB RAM | Described | no model in any core here | 4 | 3 |
| BBC Acorn A3000 | ARM2 @ 8 MHz | 1–4 MB RAM | Described | no model in any core here | 3 | 2 |
| Acorn A5000 | ARM3 @ 25/33 MHz | 2–8 MB RAM | Described | no model in any core here | 2 | 2 |
| Acorn Risc PC | ARM610 / ARM710 / StrongARM | 4–256 MB RAM | Described | no model in any core here | 3 | 2 |

## Hardware capabilities, by machine

A planned capability is an absence. It appears here so that it can be read as one.

| Machine | Fitted | Preview | Planned |
| --- | --- | --- | --- |
| Acorn Atom | Cassette interface, Floating-point ROM | AtomDOS, AtoMMC storage | Colour board |
| Acorn BBC Model A | Cassette interface | Model B interfaces | Econet, Tube interface |
| Acorn BBC Model B | DFS disk system, Cassette interface, Sideways RAM | 1MHzPi WiFi ROM | Tube second processor, Econet, Speech system |
| Acorn BBC B+ | Shadow screen RAM, Sideways RAM, 1770 DFS | ADFS, 1MHzPi WiFi ROM | Tube second processor, Econet |
| Acorn Electron | Cassette interface | — | Plus 1 expansion, Plus 3 expansion, Sideways RAM, Joystick interface, 1MHzPi / ElkWiFi |
| BBC Master Series | Shadow & Hazel RAM, Sideways RAM, ADFS, DFS, Tube / Turbo | 1MHzPi WiFi ROM | Econet |
| Acorn Archimedes A300 | ADFS floppy | Podule expansion, ST-506 hard disk | Econet, Floating-point accelerator |
| Acorn Archimedes A400/1 | ADFS, Hard disk | ARM3 upgrade, Podule expansion | FPA10 |
| BBC Acorn A3000 | ADFS floppy | Internal expansion, External hard disk | Econet |
| Acorn A5000 | IDE + ADFS, ARM3 cache | Podule expansion, Multiscan display | Econet |
| Acorn Risc PC | — | VIDC20 display, IDE + ADFS | Second processor slice, Podule expansion, Ethernet |

## Known inaccuracies and limitations

- **Acorn Atom** — The tape and tape-with-floating-point models run here. The MMC and DOS models exist in the engine but need firmware images this build does not register a manifest for.
- **Acorn BBC Model A** — jsbeeb models the BBC B; a Model A differs in fitted RAM and interfaces, and this build registers no separate Model A manifest, so it is described but not run.
- **Acorn BBC Model B** — The 8271 DFS and 1770 DFS or ADFS models all run here. A second processor is not offered: the interface is fitted and answers, but this core never hands the language over on a BBC-family host — the parasite runs its own ROM and waits, and its RAM is never written. It does boot on the Master.
- **Acorn BBC B+** — jsbeeb 1.19.1 has no BBC B+ model, so the B+ shadow and sideways memory behaviour cannot be executed here. Supplying B+ firmware would not change that; the profile is listed because the product models the machine, not because this build can emulate it.
- **Acorn Electron** — The Electron has two cores here and the ROM set chooses between them. The Electron OS + BASIC set runs on the vendored ElkJS core, which models a base 32 KB machine with an operating system and BASIC only, and offers no instruction stepping, breakpoints or hardware test execution because it exposes no per-instruction hook. The Electron + Plus 1 expansions set runs on the Elkulator core built for WebAssembly, which has that hook, so stepping, breakpoints, register writing and key injection are available there; running a test plan is not, because the stop is real but its assertions, captures and teardown are not written yet. Cassette media works and is proved: a tape written here was mounted on that core, the machine was typed *LOAD at, it turned its own cassette motor on and the whole file arrived. Disc media is implemented on the same path and unproved, because an Electron reads discs through a Plus 3 and no ADFS or DFS firmware is registered for one. The remaining expansions are declared and their firmware checkable, but none has been exercised through that core, so each stays marked planned until it has been.
- **BBC Master Series** — The Master 128 runs here with either its MOS 3.20 or its MOS 3.50 combined image, selecting DFS, ADFS or ANFS. The Master Compact cannot be selected: it is a different machine rather than a Master 128 with later firmware, and this engine models no Compact. A 65C102 Turbo second processor can be fitted through the Tube capability, and is the one machine here where the Tube boot completes: the host records it, the language reaches the parasite, and a conformance case asserting it passes on real hardware. Master Turbo, 512 and Compact are separate machines with no model in this engine.
- **Acorn Archimedes A300** — The qualified A310 slice runs on the pinned Arculator build. Machine state save and restore stay disabled because that core exposes no complete deterministic serializer.
- **Acorn Archimedes A400/1** — This build qualifies the A310 class only. Later Archimedes and Risc PC profiles are described but have no qualified adapter here, and no other machine is substituted for them.
- **BBC Acorn A3000** — This build qualifies the A310 class only. Later Archimedes and Risc PC profiles are described but have no qualified adapter here, and no other machine is substituted for them.
- **Acorn A5000** — This build qualifies the A310 class only. Later Archimedes and Risc PC profiles are described but have no qualified adapter here, and no other machine is substituted for them.
- **Acorn Risc PC** — This build qualifies the A310 class only. Later Archimedes and Risc PC profiles are described but have no qualified adapter here, and no other machine is substituted for them.

## Toolchains

Every toolchain here is deterministic: the same source and the same target
produce the same bytes. Browser-local toolchains run in this tab. Isolated
native toolchains run in the service container.

| Toolchain | Version | Language | Processor | Output | Runs |
| --- | --- | --- | --- | --- | --- |
| BBC BASIC II tokenizer | 2026.08.2 | bbc-basic | — | bbc-basic-program | in this browser |
| Atom BASIC text packer | 2026.08.2 | bbc-basic | — | atom-basic-text | in this browser |
| 8bit-net NMOS 6502 assembler | 2026.08.2 | 6502 | 6502 | 6502-binary | in this browser |
| 8bit-net Acorn 65C12 assembler | 2026.08.2 | 6502 | 65c02 | 6502-binary | in this browser |
| ca65 + ld65 (isolated native) | 2026.08.1 | 6502 | — | 6502-binary | in the isolated container |
| BeebAsm 1.11 · BBC-style (isolated native) | 2026.08.1 | 6502 | — | 6502-binary | in the isolated container |
| cc65 C + WebIDE BBC runtime (isolated native) | 2026.08.1 | c | 6502 | 6502-binary | in the isolated container |
| GNU ARM binutils · ARM2 raw binary (isolated native) | 2026.08.1 | arm | arm2 | arm-binary | in the isolated container |

## Emulator adapters

| Adapter | Version | Operations unavailable | Limitations |
| --- | --- | --- | --- |
| jsbeeb | 1.19.1 | — | — |
| arculator-wasm | 579ac437b9a4 | serialize-state, restore-state | Core-native state serialization is unavailable. |
| elkjs | ff123355 | 24 of 36 declared capabilities | The Acorn Electron runs on the vendored ElkJS core: execution, reset, register and memory reading, memory writing, machine-code loading, the real keyboard over the live display, screen capture and a sound toggle. Instruction stepping, breakpoints, watchpoints, tracing, disassembly, profiling, hardware inspection, media and machine-state save are not offered, because that core exposes no per-instruction hook and models no expansions. |
| elkulator | allegro5-6785521 | 20 of 37 declared capabilities | The Acorn Electron also runs on the Elkulator core built for WebAssembly, which adds what ElkJS cannot do: instruction stepping and execution breakpoints against a real per-instruction hook, register writing and key injection, alongside execution, reset, memory reading and writing, machine-code loading, cassette and disc media, hardware test plans over registers, memory and the machine's own contended cycles, the real keyboard over the live display and screen capture. Watchpoints, tracing, disassembly, profiling, replay, hardware inspection, reading a disc back out, sound and machine-state save are not offered: some because the core provides no hook for them, and the rest because the bridge this build exposes deliberately does not carry them. Two things are worth knowing before reading a test result from this core. A stop address is exact, because the instruction hook halts the machine on it; a cycle budget is not, because this core runs a whole field per animation frame and cannot be interrupted inside one, so a test that never reaches its stop can overrun its budget by up to a field before the overrun is noticed — and the result reports the cycles that actually elapsed rather than the budget. And the cycles are the Electron's real contended ones: the ULA stretches the processor when it touches shared RAM, so a program a datasheet would call eight cycles is measured at twelve, which is the number it actually has to live within. |

## Portability guarantees

- A project document opens in any build whose format version is at least the one it declares. Every version this product has ever written is still readable, and a document from a newer build is refused by name rather than parsed as though its missing fields were simply absent.
- A portable bundle carries an integrity manifest. Its contents are verified against their recorded digests before anything is migrated, so a migration never runs over contents that are not what the author sent.
- A build is reproducible: the same source, target and toolchain produce identical bytes, and the build records the toolchain identity and version that produced them.
- No firmware, disk image, credential or captured session is ever part of this product or its bundles. The release gate scans for all four.

## Upstream components and licences

Every vendored component, its upstream revision and its licence are recorded in
`docs/third-party-components.md`, with checksums verified by the release gate.
