# ADR 0013: expansion hardware the emulator core does not model

Status: Accepted; implemented for BeebSID, BeebSCSI and the Tube parasite choice
Date: 9 September 2026
Requirements: EMU-420, EMU-424B, EMU-430, EMU-432

## Context

ADR 0001 puts the emulator behind an adapter boundary and says the core is not
modified. That holds for the machine. It does not answer what to do about the
expansions people actually fit to one.

The pinned jsbeeb decodes several 1 MHz bus address ranges and answers them with
a bare `break`: &FC20 to &FC3F for a SID and &FC40 to &FC5F for the Acorn SCSI
host adapter. An address that is decoded and does nothing is worse than one that
is not decoded at all, because a program written against it appears to run.

The Tube is a second case of the same shape. The core fits the parasite Acorn
sold for each host, which is a good default and the whole of what it offers. A
PiTube Direct puts a 65C102 behind whatever machine it is plugged into, and that
is how people run one now.

## Decision

Expansion hardware is fitted by this build, to an already-constructed processor,
and never by patching the core.

Each board is two modules. The device is its own file with no dependency on the
engine: registers, state and behaviour, testable without a machine. A second
file wires it to a processor by wrapping `readDevice`, `writeDevice` and `reset`
on the instance that was just built, and by claiming one bit of the engine's
interrupt word where the board raises an interrupt.

Wrapping an instance rather than subclassing one is the part worth stating. A
Model B, a B+ and a Master can each carry either board, and this build already
adds a third processor class for the B+, so a subclass per combination would
multiply for no gain. Fitting the same board twice returns the one already
fitted, because a machine has one 1 MHz bus.

The parasite is passed to the processor rather than derived from the host. The
engine's own factory takes no argument for it, so the factory is this build's:
the same body with the parasite and the processor class passed in.

Which boards a session has is a capability on the machine profile, carried in
the runtime session manifest that already exists. No new session concept is
introduced.

## What this rules out

Patching the core on disk, vendoring a fork of it, or reaching into its private
state. A board answers its own addresses and defers every other one, and the
tests assert that an address outside its range still reaches the machine.

It also rules out porting a device from another emulator. BeebSCSI is written
from the register map in its own published CPLD and the command set in its own
Technical Guide. That is a licence position as much as a quality one: the
obvious donor implementations are GPL-2.0-or-later, and this product's position
on copyleft is set out in ADR 0008.

## The evidence rule

A board is not offered until real firmware has been pointed at it and the
machine's answer has been written down. What the machine said is checked in
beside the code as a `*Measurements.ts` module, with a `scripts/measure*.mjs`
that reproduces it against a firmware vault, and tests that hold the code to
those answers.

This is what settled the Tube. The product had recorded for months that the
handover failed on a BBC-family host and that the fault was in the core. The
trace showed OS 1.20 writing the Tube ULA control register once, reading it back
and stopping, because the language transfer is not in that operating system at
all. Acorn shipped it in DNFS. Nothing in the core was wrong, and a note that
had been believed for months was.

## The cost

Three things.

The device is this build's, so its accuracy is this build's problem. A BeebSID
tune that sounds wrong is not the core's fault, and the capability says the
analogue filter is approximated rather than claiming a chip.

Wrapping methods on an instance is order-dependent. Two boards on the same bus
compose because each defers what it does not decode, and that is asserted rather
than assumed; a third that answered a range another already claimed would be a
silent conflict.

The engine may model one of these itself later. When it does, the choice is
between dropping this build's and keeping it, and that decision needs the
measurements above to be worth anything, which is the other reason they exist.

## Reversing it

Delete the device and its bus module, drop the capability, and the machine is
the core's again. Nothing else depends on either. The parasite factory is the
part that would be missed: reverting it puts the choice of second processor back
in the engine's hands, and a Model B could not be given a 65C102 again.
