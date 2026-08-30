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
| Acorn BBC Model B | DFS disk system, Cassette interface, Sideways RAM | 1MHzPi WiFi ROM, Tube second processor | Econet, Speech system |
| Acorn BBC B+ | Shadow screen RAM, Sideways RAM, 1770 DFS | ADFS, Tube second processor, 1MHzPi WiFi ROM | Econet |
| Acorn Electron | — | — | Cassette interface, Plus 1 expansion, Plus 3 expansion, Sideways RAM, Joystick interface, 1MHzPi / ElkWiFi |
| BBC Master Series | Shadow & Hazel RAM, Sideways RAM, ADFS, DFS | Tube / Turbo, 1MHzPi WiFi ROM | Econet |
| Acorn Archimedes A300 | ADFS floppy | Podule expansion, ST-506 hard disk | Econet, Floating-point accelerator |
| Acorn Archimedes A400/1 | ADFS, Hard disk | ARM3 upgrade, Podule expansion | FPA10 |
| BBC Acorn A3000 | ADFS floppy | Internal expansion, External hard disk | Econet |
| Acorn A5000 | IDE + ADFS, ARM3 cache | Podule expansion, Multiscan display | Econet |
| Acorn Risc PC | — | VIDC20 display, IDE + ADFS | Second processor slice, Podule expansion, Ethernet |

## Known inaccuracies and limitations

- **Acorn Atom** — The tape and tape-with-floating-point models run here. The MMC and DOS models exist in the engine but need firmware images this build does not register a manifest for.
- **Acorn BBC Model A** — jsbeeb models the BBC B; a Model A differs in fitted RAM and interfaces, and this build registers no separate Model A manifest, so it is described but not run.
- **Acorn BBC Model B** — The 8271 DFS and 1770 DFS or ADFS models all run here. A 6502 second processor can be fitted through the Tube capability.
- **Acorn BBC B+** — jsbeeb 1.19.1 has no BBC B+ model, so the B+ shadow and sideways memory behaviour cannot be executed here. Supplying B+ firmware would not change that; the profile is listed because the product models the machine, not because this build can emulate it.
- **Acorn Electron** — The Electron runs on the vendored ElkJS core, which models a base 32 KB machine with an operating system and BASIC only. It has no Plus 1, Plus 3, AP5 or AP6, no ADFS, no cartridge and no usable expansion ROM slot, and it offers no instruction stepping, breakpoints or hardware test execution because that core exposes no per-instruction hook. Those expansions need the Elkulator port recorded in the backlog, not more firmware.
- **BBC Master Series** — The Master 128 runs here with its combined MOS 3.20 image, selecting DFS, ADFS or ANFS. A 65C102 Turbo second processor can be fitted through the Tube capability. Master Turbo, 512 and Compact are separate machines with no model in this engine.
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

## Portability guarantees

- A project document opens in any build whose format version is at least the one it declares. Every version this product has ever written is still readable, and a document from a newer build is refused by name rather than parsed as though its missing fields were simply absent.
- A portable bundle carries an integrity manifest. Its contents are verified against their recorded digests before anything is migrated, so a migration never runs over contents that are not what the author sent.
- A build is reproducible: the same source, target and toolchain produce identical bytes, and the build records the toolchain identity and version that produced them.
- No firmware, disk image, credential or captured session is ever part of this product or its bundles. The release gate scans for all four.

## Upstream components and licences

Every vendored component, its upstream revision and its licence are recorded in
`docs/third-party-components.md`, with checksums verified by the release gate.
