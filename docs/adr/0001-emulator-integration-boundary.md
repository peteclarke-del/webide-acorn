# ADR 0001: emulator integration boundary and first executable slice

Status: accepted; first BBC machine slice implemented  
Date: 20 August 2026

## Context

The product must eventually emulate the BBC family, Atom, Electron, Master and
Archimedes accurately, while never bundling proprietary ROMs without permission.
The editor, assembler, build result, runtime and debugger must also remain usable
and testable independently of a particular machine core.

The current jsbeeb project is the selected BBC Model B/Atom/Master adapter:
its upstream documentation describes those machine profiles, debug entry,
save/rewind, media and input support. Its repository currently exposes a GPL-3.0
`COPYING` file and package metadata say `GPL-3.0-or-later`, while its README says
MIT. Source-level evaluation used release 1.19.1 at commit
`90449f0f4ae8b91582986d03705cbf5ef1420c9e` (16 August 2026). The GPL metadata
is treated as authoritative unless upstream resolves the discrepancy. Its ROM
README explicitly says the bundled ROMs are not GPL and remain copyrighted, so
they will not be copied. ROM provenance and redistribution must be decided
separately; an emulator licence never grants ROM rights.

Sources inspected:

- <https://github.com/mattgodbolt/jsbeeb>
- <https://github.com/mattgodbolt/jsbeeb/blob/main/COPYING>
- <https://github.com/mattgodbolt/jsbeeb/blob/main/src/machine-session.js>
- <https://github.com/mattgodbolt/jsbeeb/blob/main/public/roms/README>

## Decision

Use explicit TypeScript adapter boundaries between build artifacts, runtime
lifecycle and debug state. Deliver the first executable slice as a self-contained,
ROM-less 6502 diagnostic adapter. It is labelled as such and may implement only
documented development shims such as character output; it must not claim BBC
hardware, video, sound, timing or ROM behaviour.

A full machine adapter will run isolated from the React workbench and communicate
through versioned, bounded messages. It must bind a session to an exact target,
build and user-supplied or lawfully distributable ROM manifest. Upstream code may
be integrated only after recording its exact revision, licence conclusion,
source-offer obligations, integrity digest, security review and adapter tests.

The evaluated upstream exposes execute/read/write debug hooks, CPU
registers, memory access, snapshots, a 1024×625 framebuffer, instrumented sound,
disc loading and BBC/Atom/Master model selection. Those capabilities make an
adapter credible; they do not waive the licence or ROM gates.

## Implemented first machine slice

The BBC/Atom/Master dependency is pinned to jsbeeb 1.19.1. Vite builds it as the
separate `emulator.html` entry, which accepts only same-origin adapter messages.
The React workbench never imports a machine object directly. Firmware is fetched
from the user-controlled IndexedDB vault through `/user-roms/<set>/...`; neither
the npm package's ROM directory nor `local-roms/` enters the runtime container.

The qualified browser contracts cover BBC Model B MOS/DFS/BASIC, Master MOS
3.20 and Atom ROM boot, framebuffer output, keyboard input, audio, media,
snapshots, run/pause/reset/step, registers, breakpoints, memory, trace and the
bounded debugger capabilities recorded in the requirements and backlog.
Firmware can be supplied individually or by selecting an ignored normalized
folder. Folder matching uses each manifest's exact emulator paths and accepted
sizes and performs one IndexedDB transaction only after every required input is
unambiguous and valid.

The pinned engine's `models.js` registry has BBC B, Master and Atom definitions
but no BBC Model A, B+, Master Compact or Acorn Electron hardware model. Other
uses of the word “Electron” in the dependency are its desktop-shell entry
point, not the Acorn machine. Those targets therefore do not resolve a ROM or
runtime manifest. In particular, running a BBC B core with Electron ROMs or
calling 32 KiB Model B memory a BBC A would violate the hardware-truth contract.
They require a different qualified engine or a separately reviewed upstream
extension. The UI's engine capability gate states this and never creates a
substitute iframe.

jsbeeb generates optimized opcode runners dynamically and therefore requires
`script-src 'unsafe-eval'`. That CSP exception applies only to the isolated
`/emulator.html` document. The workbench retains `script-src 'self'` and
`frame-ancestors 'none'`; the emulator permits only same-origin framing and
connections, and the message bridge rejects non-same-origin events.

## Consequences

- Editing, assembly, source maps, breakpoints and debugger UI can be exercised
  now without creating a false BBC emulator.
- Full-machine run controls remain a separate capability and cannot be inferred
  from the diagnostic adapter.
- The adapter contract can later host jsbeeb or another qualified core and can
  also support an Electron or Archimedes core without rewriting the workbench.
- A machine appearing in the target catalogue is not evidence of runtime
  support; only an exact machine/ROM manifest with a pinned engine may enable
  the full-machine controls.
