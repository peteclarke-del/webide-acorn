# ElkJS — vendored Acorn Electron emulation modules

## Upstream

- Project: ElkJS, an Acorn Electron emulator written in JavaScript by Darren Coles
- Source: https://github.com/dmcoles/elkjs
- Pinned revision: `ff123355407f79a91f808e31222dcca5d51ea87f`
- Licence: GNU General Public License, version 2 (`LICENSE` in this directory)

## What is vendored, and what is not

Only the hardware emulation modules are taken. The upstream user interface,
tape handling and its third-party dependencies are not used here.

| File | SHA-256 of the pristine upstream file |
| --- | --- |
| `processor.js` | `99a7162784d35f7d33d556d431d9061e8451d9cb15a98eb693c7433480b44777` |
| `memory.js` | `879075b14e95372883c05f8c56e7ea0b1c0f51bde4738a36662c19718f8d8994` |
| `sheila.js` | `ec0a2fdf5a29a765f8170f188c5802b67ae3457ea70dcac452e0a57402aac882` |
| `display.js` | `f1bc47822b79d254689c5a4afaa39ba51fa9cba790161976e721b65e6214fcf6` |
| `sound.js` | `27e1317eed1873c148b67dc149f4a08f48a47d923810591c364f42b6ddd47941` |
| `keyboard.js` | `f36fa34e8808b9c3239f621ddba023bfab912a58d386b9a762a52f73405bf575` |
| `LICENSE` | `8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643` |

**Deliberately not vendored**

- `os.rom` and `basic.rom`. Upstream ships Acorn firmware images; this product
  ships none, and supplies ROMs from the user's own browser-local firmware vault.
- `Elite_snap.uef`, `StarshipCommand_snap.uef`, `citadel_snap.uef`,
  `cybertronmission_snap.uef`, `repton2_snap.uef`, `snapper_snap.uef` and
  `boxer_snap.uef`. These are commercial game snapshots.
- `elkjs.js`, `main.js`, `index.html`, the jQuery and jQuery UI copies, the CSS,
  the images, `js-unzip.js` and `rawinflate.js`. The WebIDE supplies its own
  driver, so none of the upstream user interface is used.
- `tape.js` and `uef_file.js`. Tape is not offered by this slice, so the modules
  that would need the two third-party decompression libraries are not taken.

## Local changes

Two changes, both recorded in `docker/elkjs/elkjs-webide.patch`.

**`memory.js` — where firmware comes from.** Upstream fetches `./os.rom` and
`./basic.rom` from files beside the script. The vendored copy takes ROM images
from its caller instead, so firmware comes from the browser-local vault and none
is shipped with the product. Upstream behaviour is preserved when no images are
supplied. No emulation behaviour is changed.

**`processor.js` — the reset path outside a global scope.** Inside `exec6502`,
the deferred reset that `reset6502e` requests calls a bare `reset6502()`. That
name is a property of the module instance, not a global, so the call is a
`ReferenceError` in any page that does not also define a global of that name —
which upstream's own user interface happens to. Since this build loads only the
hardware modules, the reference is qualified to `self.reset6502()`. It is the
same function; nothing about the reset semantics changes.

## What this slice does and does not emulate

Read `memory.js` before assuming expansion support. Upstream models a base
Electron: a fixed 32 KB of RAM and exactly two ROM images, the operating system
and BASIC. Its ROM-bank decode returns BASIC for every bank the keyboard does not
claim, and the author's own commented-out code shows that real sideways-ROM
paging was begun and not finished.

There is therefore **no Plus 1, no Plus 3, no AP5 or AP6, no ADFS, no cartridge
and no usable expansion ROM slot** in this slice. Those are provided by
`stardot/elkulator`, which has no WebAssembly port; adding them here means
porting that emulator, not configuring this one.

`processor.js` also keeps its registers in closure variables with no accessor
other than `makeSnapshotData()`, and runs a batch of cycles per call with no
per-instruction hook. This slice therefore offers execution, reset, register and
memory reading, program loading, keyboard input and display, and does not offer
instruction stepping, breakpoints, watchpoints, tracing or hardware test
execution. Those absences are declared in the adapter capability list rather
than failing at the point of use.
