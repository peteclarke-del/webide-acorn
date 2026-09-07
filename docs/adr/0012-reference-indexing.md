# ADR 0012 — Reference indexing in the browser, over imported packs

Status: accepted  
Date: 6 September 2026  
Supersedes: nothing  
Relates to: P0-043, REF-700–REF-706, SEC-903, ADR 0007

## Context

The workbench needs to answer "what is this?" about a token under somebody's
caret — an opcode, an OS call, a hardware register, a SWI. Some of that answer is
first-party: maintained tables of opcodes, SWIs and registers that ship with the
build, each entry carrying its own citation. The rest is documentation this
project did not write: manuals, application notes, community pages. That
material cannot be shipped, because most of it is published under terms that do
not permit redistribution (SEC-903 covers the same boundary for firmware).

So the question is how imported documentation is held, searched and quoted. The
obvious answer is a service: upload packs, index them server-side, query over
HTTP. That was rejected.

## Decision

Reference indexing happens **in the browser, over packs the user imported, with
no network path**.

### A pack is a document with provenance, not a blob of text

`src/research/referencePack.ts` defines the `8bit-net.reference-pack` schema.
Two fields exist that a simpler design would omit, and both exist because
omitting them would make the product lie:

- **Source tier.** A page from Acorn's own manual and a paragraph somebody
  generated are both text about a BBC Micro, and presenting them identically
  tells the reader they carry equal weight. The tier travels with every entry and
  the interface is required to display it, so nothing below `independent` can be
  read as authoritative by accident.
- **Licence, as two separate permissions.** Permission to quote and permission
  to insert into somebody's source are recorded separately from the licence name,
  because "MIT" and "all rights reserved" are not the only two cases. Collapsing
  them would either lose a right the author granted or take one they did not.
  `referenceInsertion` refuses an insertion the pack does not permit.

### Identity is (id, publisher), and a collision is refused

`packLibrary` distinguishes three cases that look alike from outside: the same
pack byte for byte, which changes nothing; the same pack reissued with altered
text, which is an update and must say what it replaced; and a different pack
claiming an identifier already in use, which is refused. Two publishers may both
reasonably ship `user-guide`, so the identifier alone is not identity, and
letting one silently overwrite the other would lose a document nobody agreed to
lose.

### Anchors are the index; text is the fallback, reported as such

An entry declares anchors: this opcode, this address, this SWI, this OS call.
`referenceLinks` maps what the editor already knows about the caret onto those
anchors and **asks by kind** — a project symbol called `OSWRCH` and the OS call
`OSWRCH` are different questions with different right answers, and a search that
could not tell them apart would answer the wrong one confidently.

An anchor match and a text match are reported distinctly rather than folded into
one score: the first is an answer, the second is a lead. And `referenceLinks`
deliberately does **not** fall back to text search when no anchor matches, because
a panel that always finds something teaches people that finding something means
nothing.

### Applicability ranks, it does not filter

A page about the Master's ACCCON latch is correct and useless to somebody
building for a Model B. So the target machine, processor and dialect are part of
the ranking rather than a filter applied afterwards — and it is a preference, not
a rule. A pack naming a different machine is ranked *below* the rest rather than
hidden, because sometimes the Master manual is the only place a thing is written
down. A pack naming no machine is not thereby wrong for yours.

### Bounds, because it runs in the user's tab

`PACK_LIMITS` caps entry count and sizes at import. An index built in a browser
must not be able to exhaust the browser it is built in, and the refusal happens
at parse rather than at search time so the failure names the pack.

## Alternatives rejected

**A server-side indexing service.** Rejected on three grounds. It would require
uploading material whose licence frequently forbids redistribution, making the
service a republisher of documents it has no right to republish. It would make
the reference panel require a network, when the rest of the workbench does not.
And it would add an operational dependency — a service to run, scale and secure
— for a corpus that is a few megabytes per user and never shared between them.

**Shipping a bundled corpus.** Rejected for licence reasons: the documents worth
indexing are mostly not redistributable. The first-party tables that *can* ship
do ship, and are separate from packs precisely so the difference is visible.

**Full-text search as the primary index, with anchors as a boost.** Rejected
because it inverts the confidence. Text ranking always returns a top result, and
the top result for a hardware address is very often a page that merely mentions
it. Anchors say "this entry documents this thing"; that assertion is what the
lookup is for.

**Embeddings or any learned ranking.** Rejected: it needs either a model in the
bundle or a network call, it cannot state why a result was chosen, and the corpus
is small enough that exact anchors answer most queries outright.

## Consequences and cost

The user must import documentation before the library answers anything, and an
empty library is the normal first state — the panel has to say so plainly rather
than appearing broken. Search quality is bounded by the anchors a pack declares,
so a badly-anchored pack is text-searchable and little more; that is visible in
the reported match kind rather than hidden behind a score. Nothing is shared
between users or devices, because there is no server: a person who wants the same
library on two machines imports it twice.

Reversing this — moving indexing to a service — is primarily a licence question
rather than an engineering one, and would have to answer what right the service
has to hold the documents it indexes.
