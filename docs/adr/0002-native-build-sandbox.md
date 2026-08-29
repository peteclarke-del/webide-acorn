# ADR 0002: local native-build sandbox and API boundary

Status: Accepted for the local ca65/ld65 vertical slice  
Date: 21 August 2026  
Requirements: ARC-01–ARC-06, BLD-001–BLD-014, API-002–API-007,
SEC-001–SEC-003, NFR-003–NFR-007, QLT-002–QLT-004

## Context

The browser-local assemblers provide low-latency builds but cannot substitute
for an independent, pinned native ca65/ld65 toolchain. Native compilation accepts
untrusted project files and invokes executable parsers, so placing it in the
public nginx process, exposing the Docker socket, interpolating a shell command,
or invoking a host-installed compiler would violate the architecture and
security contracts.

The product must remain self-contained under Docker Compose and present one
browser origin on the configured host port (8090 by default). The initial local
mode does not need durable build-job persistence: requests are synchronous,
bounded and intentionally forgotten after their normalized result is returned.

## Decision

The public `webide-acorn` container serves the React/Vite application and proxies
only `/api/` to a Unix-domain PHP-FPM socket on a named Compose volume. A separate
`native-builder` container owns that socket and contains a supported PHP release,
Symfony and the immutable ca65/ld65 package.

The builder has:

- no network namespace (`network_mode: none`);
- no published ports and no Docker/host socket;
- a read-only root filesystem;
- all Linux capabilities dropped and `no-new-privileges` enabled;
- a bounded, executable-free `/tmp` tmpfs for per-request job directories;
- Compose CPU, memory and PID limits;
- PHP-FPM workers running build application code as a non-root UID;
- fixed absolute executable paths and argv-array process creation only;
- a minimal deterministic environment and explicit time/output/file limits;
- project-relative regular files created by the service itself, never symlinks;
- unconditional recursive cleanup after success, failure, timeout or parser
  rejection.

This is a local execution capability, not the future multi-tenant cloud job
system. It is authorised by same-origin request checks plus a required custom
request header in local mode. Public/multi-user deployment remains disabled until
the shared platform identity can enforce `acornide.build.execute` with resource
scope and audit identity. The UI must not treat hidden controls as authorisation.

## API contract

`GET /api/v1/toolchains/ca65` returns the detected immutable adapter manifest and
health. `POST /api/v1/builds/ca65` accepts versioned JSON with:

- request and target identifiers;
- processor (`6502`, `65sc02`, `65c02` or `w65c02`);
- one or more explicitly named source units;
- bounded project files and contents;
- bounded symbol defines;
- either a bounded project linker configuration or a generated Acorn RAM layout;
- safe output name and declared origin/entry information.

The request cannot contain command fragments, executable paths, environment,
post-build commands, absolute paths, traversal, response files or undeclared
host inputs. The response uses `8bit-net.build-result`, whether or not an
executable artifact exists. It contains normalized diagnostics, bounded logs,
invocation/toolchain identity, input/toolchain/output SHA-256 digests, size facts,
symbols, source/address evidence and retained generated documents. Binary bytes
are base64 only within the small local artifact limit; larger future transfers
require the chunked object API from API-005.

Every error has a stable code, correlation ID, safe message, retryability and
field details. Internal paths are rewritten to project-relative paths before
return. Server logs contain correlation/toolchain/outcome/duration/byte counts,
not source, ROMs, artifacts or user filenames.

## Limits for the first slice

| Resource | Limit |
| --- | ---: |
| Request body | 2 MiB |
| Project files | 128 |
| Single file | 512 KiB |
| Total decoded source/config | 2 MiB |
| Source units | 32 |
| Defines | 64 |
| Filename/path | 160 bytes, 16 segments |
| Native stage wall clock | 5 seconds |
| Captured log per stage | 256 KiB |
| Generated documents | 32 files / 2 MiB total |
| Executable artifact | 1 MiB |
| Builder container | 256 MiB memory / 64 PIDs / 1 CPU |
| PHP-FPM concurrency | 2 workers |

Limits are part of the adapter manifest and cache/provenance policy. Increasing
them requires adversarial tests and an operations review.

## Persistence decision

No database, queue or object store is introduced for this local synchronous
slice. There is no durable domain state: project truth remains in the browser,
job directories are disposable, and completed evidence is returned to the
project UI. Adding cloud builds, histories, sharing, fairness/retry or audit
retention changes the access pattern and requires a separate persistence ADR,
migrations and tenant model. This avoids imposing a database where the current
workload has no durable consistency requirement.

## Failure and readiness behavior

Nginx liveness remains independent of build readiness. `/api/health/live` proves
the Symfony/FPM application can answer; `/api/health/ready` additionally checks
the exact ca65/ld65 executables and versions. The UI registry may expose the
native toolchain only after the manifest endpoint reports ready and matches its
supported contract version. Loss of the builder removes native availability but
does not disable browser editing, browser builds or emulation.

Invalid input returns HTTP 400/413. Valid builds with assembler/linker diagnostics
return HTTP 200 and a normalized failed build result with no implied executable.
Unavailable/mismatched toolchains return 503. Internal faults return a redacted
500 envelope and correlation ID. Timeouts and output limits are distinct terminal
exit reasons.

## Consequences and remaining risks

The Unix socket preserves a single public origin while the native parser has no
network access. A compromised builder still shares one container across local
jobs and could attack its PHP-FPM process or other concurrent local jobs; the
read-only filesystem, non-root identity, tmpfs isolation and two-worker bound
reduce but do not eliminate that risk. Public multi-tenant execution therefore
requires a queued launcher that creates a fresh sandbox identity/container or
microVM per job. This ADR does not waive BLD-301/302 or SEC-002 for cloud mode.

The cc65 Debian package must be pinned by version and image digest. Package and
binary digests, licence, SBOM/update policy and upstream-source provenance remain
release evidence. Acorn ROMs are never mounted into the builder.

## Rejected alternatives

- **Invoke host ca65 from nginx/Node:** not self-contained, not reproducible and
  crosses the browser/server boundary.
- **Mount `/var/run/docker.sock`:** grants the application control of the host
  Docker daemon and is not an acceptable sandbox.
- **Networked long-running worker:** unnecessary for local synchronous builds and
  weakens the default network-denial guarantee.
- **Shell script command construction:** makes filenames/defines an injection
  surface and obscures provenance.
- **Advertise ca65 before backend readiness:** creates a decorative selector and
  violates the product's honest support-state rule.
