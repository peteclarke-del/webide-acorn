# ADR 0010: project storage, revisions and the single local identity

Status: Accepted for the local storage and revision slice  
Date: 30 August 2026  
Requirements: CLD-802, CLD-803, CLD-805, SEC-004, NFR-003, NFR-007

## Context

ADR 0002 introduced no database, queue or object store on purpose: the build
service is synchronous, bounded, and deliberately forgets a job once its result
is returned. Everything a person makes has therefore lived in their browser.

That is a real limit rather than a tidy one. A project exists on exactly one
machine, in storage the browser may evict, with no history: an edit that broke
something cannot be compared against the version that worked, and the only
backup is whatever somebody exported by hand.

The remaining cloud requirements ask for a great deal more than storage —
accounts, roles, sharing, invitations, cross-tenant isolation and a penetration
test. None of that can be designed around an identity decision that has not been
taken, and CLD-800 is that decision.

## Decision

Storage, revisions and synchronisation are built now, against a Docker volume,
under **one implicit local identity**. Authentication is not invented in the
meantime and no account is asked for.

The identity is explicit in the data and in the API from the first commit, as
`local`. It is not omitted and then retrofitted: a store written without an
owner cannot later tell whose data it holds, and every isolation test that
matters would have nothing to bind to. What is deferred is proving *who* somebody
is, not recording *whose* something is.

Content is stored twice over, by different keys, because they answer different
questions:

- **Blobs** are content-addressed by SHA-256. The same file in twenty revisions
  is stored once, and a blob whose bytes do not hash to the digest it was filed
  under is refused rather than stored, so the store cannot quietly hold something
  other than what it was given.
- **Revisions** are immutable manifests naming a filename against a blob digest,
  with a parent. History is therefore a chain of manifests over shared content,
  and restoring an old revision is reading it rather than reconstructing it.

Quotas are per owner and enforced on write, in bytes and in revisions. Collection
removes only blobs no retained revision references; a blob any revision names is
never collected, and a revision is never removed to make a blob collectable.

## Consequences

Local mode remains complete and is what the product does by default. Storage is
opt-in per project, and moving a project into it copies rather than moves, so a
person who tries it and stops has lost nothing — CLD-803's requirement that
neither mode coerces the other.

What this does not do, and does not pretend to: there is no authentication, so
the store is exactly as private as the machine it runs on and must not be exposed
beyond it. There are no roles, no sharing, no invitations and no cross-tenant
isolation, because with one identity there are no tenants to isolate. Those wait
on CLD-800, and the compatibility documentation says so rather than implying that
storage is the same thing as an account.

Encryption at rest is the deployment's, not the application's: a volume this
product cannot see the mounting of is not one it can honestly claim to encrypt.
That is stated rather than left for somebody to assume from the requirement's
wording.
