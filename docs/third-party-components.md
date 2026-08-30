# Third-party components

## jsbeeb machine runtime

The ROM-aware BBC Micro, Master and Atom runtime uses jsbeeb 1.19.1, pinned in
`package-lock.json`. The upstream source is <https://github.com/mattgodbolt/jsbeeb>
and the evaluated revision is `90449f0f4ae8b91582986d03705cbf5ef1420c9e`.

jsbeeb declares `GPL-3.0-or-later` in its package metadata and `COPYING` file.
The production container serves that licence text at
`/licenses/jsbeeb-COPYING.txt`. Emulator code is built as a separate
`emulator.html` entry and communicates with the workbench through a versionable
same-origin message boundary.

No ROM from the jsbeeb npm package is copied into the runtime image. Acorn ROMs
are loaded only from the user's origin-private IndexedDB firmware vault. The
local `local-roms/` development inventory is excluded by both `.gitignore` and
`.dockerignore`.

Every qualified ROM profile records the `jsbeeb` engine and pinned version
`1.19.1`. Inspection of that exact release found no Acorn Electron, BBC Model A,
B+ or Master Compact machine definition, so those catalogue targets are
deliberately not mapped to this dependency.

## BeebAsm native assembler

The local native builder compiles BeebAsm 1.11 from upstream commit
`ca2cc5fd2fa3f73da3b0682ad004b2aca99840c3`. It is GPL-3.0-or-later. The worker
image carries both `COPYING.txt` and a source archive made from that exact
commit; readiness and build provenance publish their SHA-256 digests alongside
the compiled binary digest. BeebAsm runs non-root, without network access, via
fixed argv in the read-only native-builder container.

## cc65 C/assembler/linker suite

The native builder installs Debian cc65 package `2.19-1`, providing cc65,
ca65, ld65, `none.lib`, headers and target configurations. Upstream is
<https://github.com/cc65/cc65>. Debian records the project licence as
`BSD-3-zlib`; the packaged notice remains at `/usr/share/doc/cc65/copyright`.
The C manifest publishes that notice's SHA-256 alongside the compiler,
assembler, linker, generic library and WebIDE runtime/header digests.

Both the pinned package and audited current upstream commit
`e11fb5c39371046ebe25485f984f644c5a0d65d3` contain `cfg/bbc.cfg` but no BBC
target runtime library. The project-owned `8bit-net.cc65-bbc-runtime` is
therefore explicitly identified as a WebIDE component rather than attributed
to cc65. It links against the upstream generic runtime only for referenced
symbols and supplies the missing CALL-compatible startup and BBC MOS bridge.

## GNU ARM bare-metal binutils

The native builder installs Debian Bookworm package
`binutils-arm-none-eabi` `2.40-2+18+b1`. The accepted adapter invokes only the
package's fixed `arm-none-eabi-as`, `ld`, `objcopy`, `objdump`, `nm` and
`readelf` paths. Each executable digest, the Debian package version and the
packaged copyright digest are published by readiness and repeated in build
provenance. Debian's packaged notice remains at
`/usr/share/doc/binutils-arm-none-eabi/copyright`.

This component supplies a GNU-syntax ARM2 assemble/link evidence path. It does
not supply the RISC OS ABI, headers, libraries, filetypes, application-directory
packaging or an Archimedes emulator. Its normalized output therefore remains a
raw little-endian `arm-binary` with a null RISC OS filetype. Raw Debug is a
separate mapped-memory contract; Run becomes available only after the IDE's
independent packager validates the fixed `&8000` Absolute contract and creates
typed RISC OS application objects for the qualified Acorn runtime.

## Arculator WASM and support extension

The first A310 runtime builds `pdjstone/arculator-wasm` at pinned commit
`579ac437b9a4ebe83b9b5f9b8e50b0c9c530509e` under GPL-2.0. The production image
serves the licence, an archive of that exact upstream source, build hashes and
the maintained WebIDE patch. It never contains user Acorn operating-system
firmware.

The image does contain upstream's 65,536-byte `arcrom_ext` support extension,
verified during the build by SHA-256
`c181c7fbbd0f0038f6adf2976a9cd03cb4ad58be3bd32074719fd516d1ddae98`.
That GPL source-built extension provides the RISC OS 3 HostFS module; it is not
an Acorn OS ROM and is enabled only for the qualified RISC OS 3 profiles.

## Meeting the copyleft obligations, not just naming them

Three components ship under a copyleft licence: jsbeeb (GPL-3.0-or-later),
the vendored ElkJS (GPL-2.0) and the Arculator WASM core (GPL-2.0). Each is
conveyed in what this product distributes, so each has to travel with its
licence *and* its corresponding source.

Arculator did. jsbeeb and ElkJS shipped a licence file and nothing else, which
is an obligation named and not met, and nothing would have caught the next one
either. The image now carries, for all three, the licence, an archive of the
exact source the image was built from, and a digest of each archive.

The archives are what upstream ships minus the emulator core's own ROM
directory, which is excluded and then proved absent during the build. Those
ROMs are not source this image is built from — the workbench serves firmware
the person running it supplied — and archiving the package wholesale would have
put fifty-two Acorn ROM files into the image, which is the one thing that must
never happen.

The check is derived from the inventory rather than from a list somebody
remembers to update: `npm run ci` reads which shipped packages the bill of
materials classifies as copyleft, and fails if any of them — or any component
recorded here — lacks its licence or its source in the image. A shipped
copyleft package that nothing accounts for is a failure, not a silence.
