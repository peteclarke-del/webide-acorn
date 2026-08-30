# Release, versioning and deprecation policy

This document is generated from the constants it describes. A policy that
names version numbers goes stale the first time one of them changes, and a
stale policy is worse than none: it is a commitment the product no longer
keeps, in writing. A contract fails the release gate whenever this document
stops matching the code. Regenerate it with `npm run policy`.

## The rule

Every version of a document this product has ever written stays readable. A
document from a newer build is refused by name — saying which version it
carries and which this build reads — rather than parsed as though the fields
it does not contain were simply absent. A newer document is not a corrupt
one, and the difference is the difference between "update the workbench" and
"your project is broken".

## Versioned surfaces

| Surface | Identifier | Version | What is promised |
| --- | --- | --- | --- |
| Project document | `8bit-net-dev-project-21` | 21 | Every version from 1 to 21 opens and is migrated forward on the way in. A document declaring a higher version is refused by name, saying which version it carries and which this build reads. |
| Portable project bundle | `8bit-net.project-bundle` | 1 | Contents are verified against the bundle’s own integrity manifest before anything is migrated, so a migration never runs over contents that are not what the author sent. A bundle from a newer build is refused as newer rather than as malformed. |
| Build target | `build-target.schemaVersion` | 5 | Migrated forward when a project document is opened. A target that names a toolchain this build does not register keeps its declaration and is reported as unavailable rather than silently reassigned. |
| Toolchain registry | `toolchain-registry` | 2026.08.2 | A build records the toolchain identity and version that produced it. Changing a toolchain changes this version, so an artifact can always be traced to what made it. |
| Emulator adapter API | `emulator-adapter` | 1 | An adapter declares the API version it implements, every operation it supports, and its limitations. An adapter declaring a different API version is not loaded. |
| Analysis annotations | `8bit-net.analysis-annotations` | 1 | Bound to the SHA-256 of the bytes described, so annotations follow the program rather than a filename and are never applied to different bytes. |
| Disk set | `8bit-net.disk-set` | 1 | Carried inside the project document and migrated with it. |
| Settings | `8bit-net.settings` | 1 | A stored value the current schema refuses is dropped on the way in rather than applied, and the default is used. |
| Machine profile manifest | `8bit-net.machine-profile` | 2 | Every earlier version is read and migrated forward, with everything changed or dropped reported rather than applied in silence. A field the manifest’s own version predates is absent rather than missing, so a version 1 capability carries no variant restriction because version 1 could not express one. A capability whose state this build does not define is dropped and named rather than defaulted, because defaulting would either claim hardware or remove it. |
| Template catalogue | `8bit-net.template-catalogue` | 1 | Shipped with the build rather than stored, so it has no backward-compatibility obligation. It is validated by a contract at build time. |

## When a version goes up

- **A stored document** — whenever a field is added, removed or changes meaning. The reader accepts every earlier version and migrates it forward; the writer only ever writes the current one.
- **A registry or catalogue shipped with the build** — machine profiles, toolchains, reference packs. These are not stored in anyone’s project, so they carry a version for provenance rather than for compatibility: an artifact records the version that produced it.
- **An adapter API** — whenever the contract an adapter implements changes. An adapter declaring a different version is not loaded, because a partially-matching adapter is the one failure mode that produces wrong answers rather than no answers.

## Deprecation

A capability is never removed silently.

1. It is marked in the interface and in the compatibility matrix, with what replaces it.
2. It keeps working for at least one further release.
3. When it is removed, anything that still names it reports the removal by name and says what to use instead. Nothing is substituted for it.

A machine capability declared `planned` has never been fitted and is not a
deprecation. It is listed because the machine has the hardware, not because
this build does anything with it.

## What a release states

Every release records the project format version it writes, the toolchain
registry version its builds were produced with, the vendored component
revisions and their licences, and the compatibility matrix generated from
the catalogues in that build. All four are checked by the release gate.
