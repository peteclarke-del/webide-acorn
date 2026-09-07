# ADR 0011 — Adapter discovery as a compiled table, not a registry

Status: accepted  
Date: 6 September 2026  
Supersedes: nothing  
Relates to: P0-043, EMU-401, EMU-423, ADR 0001, ADR 0006, ADR 0008

## Context

This product describes twelve machines and can execute some of them. Those are
two different facts, and for a long time no single place held the second one.
Each surface worked it out for itself, usually by looking for the absence of
something: no ROM manifest meant "not runnable", which was wrong in both
directions. A machine could have a manifest and no engine model, in which case
supplying firmware would never make it start; and a machine could have an engine
model with no manifest yet, in which case the missing work was in this
repository rather than in the user's ROM folder. Telling somebody to "supply the
ROM set" for a machine that can never run is a lie the product told repeatedly.

The obvious shape for the fix is a registry: adapters that announce themselves at
startup, are discovered by the shell, and describe their own capabilities. That
is what a plugin system looks like, and it is what was rejected.

## Decision

Adapter discovery is a **table compiled into the bundle**, in
`src/rom/adapterSupport.ts`, and it is the only place that answers whether a
machine can be executed here.

### Three states, because they mean different things to a person

- `runnable` — the pinned engine has a model for this machine and this build
  registers a ROM manifest for it, so supplying firmware makes it start.
- `no-rom-manifest` — the engine has a model but no manifest is registered, so
  the outstanding work is in this repository and no firmware will help.
- `no-engine-model` — no engine in this build models the machine at all.

Every surface asks `adapterSupportFor(machineId)` and renders the state it is
given. `adapterSupportSummary` turns the state into one sentence, so the same
machine is described the same way in the machine picker, the firmware vault and
the system status panel.

### Limitations are stated positively and written by hand

Each machine carries a `limitation` string saying what does work and what does
not, in prose, naming the thing rather than describing an absence. These are
long, and deliberately so: "a second processor is fitted and answers, but this
core never hands the language over on a BBC-family host" is the kind of sentence
that saves somebody an afternoon, and no capability flag can generate it. They
are written when the boundary is found by measurement, and they are the reason
this is a table of prose rather than a matrix of booleans.

### Two engines for one machine is modelled, not flattened

The Electron has two cores here — ElkJS and the Emscripten Elkulator — and which
one starts is decided by the selected ROM set, not by the machine. A single
`engine` field would name one and be wrong about the other, so `engine` and
`additionalEngines` are separate and the summary names both.

### The engine's own model list is the authority

`engineModels` lists the model synonyms the pinned engine provides. It is
written out here rather than imported, so that the emulator does not enter the
workbench bundle; a contract test in `src/rom/adapterSupport.test.ts` compares
the table against the engine's own model list, so it cannot drift silently. The
two B+ models are the exception and are marked as this build's own rather than
the engine's, because jsbeeb publishes no B+ in the pinned 1.19.1 or in the
current 1.22.4 — the machine is assembled here from the engine's Model B plus
the B+'s paging.

### A manifest may exist for an engine that cannot yet start

`RUNNABLE_ENGINE_IDS` gates which ROM sets are advertised. A manifest is written
and firmware verified against it long before the core can boot — that is how the
Elkulator port was developed — and listing such a set as runnable would offer a
configuration nobody can select. The manifest still does its job; it is simply
not advertised.

## Alternatives rejected

**A runtime adapter registry.** Adapters self-register and the shell discovers
them. Rejected because it buys extensibility this product has no user for — the
engines are vendored, pinned and licence-reviewed one at a time (ADRs 0006 and
0008), and adding one is a deliberate act with a decision record, not a drop-in.
Meanwhile it costs the thing that matters most here: with a registry, "can this
machine run?" becomes answerable only at runtime, after the adapter has loaded,
so no test and no type can hold it. The table is checkable at build time and by
a unit test that runs everywhere, including where no firmware exists.

**Capability booleans instead of prose.** Rejected because every limitation
found so far has been conditional in a way a flag cannot express. The Tube boots
on the Master and not on the B; the Electron's disc path is implemented and
unproved for a stated reason. Reduced to `tube: false` these become wrong.

**Inferring runnability from the ROM manifests alone.** This is what the code
did before and it is the defect this record exists to close: a manifest says what
firmware a configuration needs, not whether anything here can execute it.

## Consequences and cost

Adding a machine or an engine means editing this file, and forgetting to means
the machine is described and reported unrunnable — a visible, safe failure
rather than a silent one. The prose limitations are maintenance: when a boundary
moves, the sentence has to move with it, and nothing automated will notice if it
does not. That is accepted because the alternative is a product that is
accurate and useless.

Reversing this decision — moving to a registry — would mean finding another home
for the three states and the limitation prose, since neither survives being
derived from an adapter's self-description.
