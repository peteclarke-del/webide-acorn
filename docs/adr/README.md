# Architecture decision records

Each record states a decision that was contested, expensive or hard to reverse,
and the position it settled on. They are historical: a record is not edited to
agree with what came later, it is superseded by a new one that says what
changed and why.

Two of these carry a licence position rather than only a technical one. Those
are the ones to read before changing anything they touch, because reversing
them later is a legal question and not only an engineering one.

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-emulator-integration-boundary.md) | Emulator integration boundary and the first executable BBC slice | Accepted; implemented |
| [0002](0002-native-build-sandbox.md) | Local native-build sandbox and its API boundary | Accepted for the ca65/ld65 slice |
| [0003](0003-beebasm-adapter.md) | Pinned BeebAsm compatibility adapter | Accepted for the binary-output slice |
| [0004](0004-cc65-bbc-c-runtime.md) | cc65 C adapter and the WebIDE BBC runtime | Accepted for the 8-bit C slice |
| [0005](0005-arm2-build-boundary.md) | ARM2 build boundary before Archimedes execution | Accepted; implemented |
| [0006](0006-archimedes-wasm-runtime.md) | Archimedes browser runtime and the firmware boundary | Accepted for implementation |
| [0007](0007-editable-asset-document-contract.md) | Editable asset document contract | Accepted |
| [0008](0008-elkjs-electron-adapter-and-gpl-position.md) | ElkJS Electron adapter, and the GPL position it creates | Accepted; **licence position pending sign-off** |
| [0009](0009-risc-os-c-toolchain-candidate.md) | RISC OS C toolchain candidate boundary | Accepted direction; toolchain unavailable |

## A note on numbering

Records 0006 and 0009 were both written as 0006. A decision log whose
identifiers are ambiguous cannot be cited, so the RISC OS record was renumbered
to the next free number and says so at its head. The Archimedes runtime keeps
0006 because it was referenced first. Nothing in either decision changed.

## Writing one

A record is worth adding when a choice is contested, costly to reverse, or
carries a licence or firmware position. It should say what was decided, what
was rejected and why, and what it would take to reverse. A record that only
describes what was built is a commit message in a longer file.

State the cost. Every decision here has one — a pinned upstream that has to be
tracked, a core that cannot be stepped, a licence that constrains distribution —
and a record that omits the cost is the one that gets reversed by someone who
did not know it was there.
