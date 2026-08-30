# Security, privacy and disclosure

This states what the product does with data, what it does not, and what to do
when something is wrong with it. Most of it is short, because most of the usual
answers do not apply: there is no account, no server holding your work, and
nothing collected about you.

## What the product holds, and where

Everything you make stays on your machine.

| Thing | Where it lives | How it leaves |
| --- | --- | --- |
| Your project — sources, assets, build targets, bookmarks, settings | Your browser's local storage for this site | Only when you export it, write it back to a folder you chose, or download it |
| Firmware you supply | Your browser, and never in a build, a bundle or a log | It does not. It is never sent anywhere |
| A folder you opened from disk | Read in the browser. Written back only when you ask, and only after the browser grants write permission at that moment | It does not leave your machine |
| Source sent to the native builder | The isolated container, for the length of one build | It has no network route, so it cannot leave |

There is no analytics, no telemetry, no error reporting service, no font or
script loaded from another origin, and no account to sign in to. The content
security policy permits `'self'` only, and the release gate serves the built
application under that policy and fails on any blocked request.

## What is deliberately not collected

- Nothing that identifies you. No name, address, device identifier or usage
  record is gathered, because none is needed to edit a program.
- No copy of your source. The native builder receives what it must compile, for
  as long as the compile takes, in a container with no route out.
- No firmware. ROM images you supply are never included in a project bundle, a
  build artefact, a log or a captured session, and the release gate scans both
  the repository and the built output for them on every run.

## Retention and deletion

Your work is yours to delete and nothing survives elsewhere.

- Deleting a file puts it in the project's trash, which lives inside the project
  document; emptying the trash removes it, and the deletion reports exactly what
  went with it.
- Clearing this site's data in your browser removes the project entirely. There
  is no server-side copy to ask anyone to delete.
- The native builder keeps nothing between builds. Its filesystem is read-only
  apart from a temporary area that does not survive the process.
- A saved project that cannot be read is moved aside rather than destroyed, and
  can be downloaded. That is the one case where something is kept rather than
  removed, and it is kept because it is your work.

## Exporting your work

A portable bundle carries the project and an integrity manifest of digests, so
it can be verified rather than trusted. Before it is written, it is scanned for
values that look like credentials and each is reported with its shape, never its
value, so you can decide before sharing it. Private bookmarks and notes are
excluded by default and require an explicit choice to include.

## Reporting a vulnerability

Report it privately first. Open a GitHub security advisory on the repository, or
if that is not available to you, open an issue that says only that you have
found a security problem and asks for a private channel — do not put the detail
in a public issue.

Please include what you did, what happened, and what you expected. A proof of
concept helps and is not required.

What to expect: acknowledgement that the report was received, an assessment of
whether it is reproducible, and a fix or a stated position. If a report is not
a vulnerability, that will be said with the reason rather than left unanswered.

Please do not run automated scanning against anyone else's deployment of this
software, and do not access data that is not yours in order to demonstrate a
problem. Neither is necessary to report anything real here.

## What is in scope

The workbench, the native builder container, the project and bundle formats, the
media and archive parsers, and the emulator adapters.

Out of scope, with reasons rather than as a way of avoiding the work:

- The emulated machines themselves. A program written in this product can crash,
  corrupt its own memory or flash the screen, because that is what writing for
  an 8-bit machine involves. That is the program's behaviour, not the product's.
- Findings that require an attacker to already control the browser or the
  machine. If they have that, the product is not the weak point.
- Missing hardening headers on a deployment someone else configured. What this
  product ships is in `docker/security-headers.conf` and is verified on every
  release; how a third party serves it is theirs.

## Handling an incident

1. Establish what is affected and whether anyone's data is involved. In most
   cases it will not be, because the product holds none.
2. Fix it, with a regression test that fails before the fix and passes after.
   A security fix with no test is a fix that comes back.
3. Say what happened, what was affected, and what changed. Publish it with the
   release rather than separately.
4. If firmware or a credential ever reached a published artefact, treat it as
   distribution: withdraw the artefact, do not merely replace it.

## Dependencies

Runtime dependencies are kept few on purpose. Each one is a licence position and
a supply-chain surface, and adding one is worth the argument.

Vendored third-party code carries its upstream revision and licence in
`docs/third-party-components.md`, with checksums the release gate verifies. Where
a vendored file is patched, the patch is kept in `docker/` and the reason in its
`PROVENANCE.md`, so an update knows what to reapply and why.

An update is taken when it fixes a defect that affects this product, closes a
vulnerability, or is needed to move forward. Updating to be current is not by
itself a reason, because every update to a pinned emulator core is a
re-qualification of the machines it runs.

## The licence position

One decision is accepted technically and still awaiting a licence sign-off: the
vendored ElkJS core is GPL-2.0, which constrains how the Electron runtime may be
distributed. It is recorded in `docs/adr/0008-elkjs-electron-adapter-and-gpl-position.md`
and is deliberately visible in the decision index rather than buried, because it
is the kind of thing that is expensive to discover late.
