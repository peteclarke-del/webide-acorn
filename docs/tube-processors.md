# Second processors behind the Tube

<!-- Generated from src/emulator/tubeProcessors.ts. Edit the catalogue, not this file. -->

A Tube interface takes whatever is plugged into it. Acorn sold four processors for one, and a PiTube Direct offers twenty-six emulations, selected on the host with `*FX 151,230,n`. So the question is never whether a machine has a Tube; it is which processor is on the other side.

The selection numbers below are PiTube Direct's own, kept so a program that switches processors on real hardware can be written against the same numbers here. See [PiTubeDirect wiki](https://github.com/hoglet67/PiTubeDirect/wiki).

| n | Processor | CPU | Runs here | Parasite ROM |
| --- | --- | --- | --- | --- |
| 1 | 6502 second processor | 65C02 at 3 MHz | yes | `tube/6502Tube.rom` |
| 3 | 65C102 Turbo second processor | 65C102 at 4 MHz | yes | `tube/65C102Tube.rom` |
| 5 | Z80 second processor | Z80 | no | `tube/Z80_120.rom` |
| 8 | 80286 second processor | Intel 80286 | no | not identified |
| 12 | ARM2 second processor | ARM2 | no | `tube/ARMeval_100.rom` |
| 13 | 32016 second processor | National Semiconductor 32016 | no | not identified |

## What each one is, and what it would take

- **6502 second processor** (65C02 at 3 MHz): What Acorn sold for a BBC Model B. The pinned engine models it, and the parasite prints Acorn TUBE 6502 64K.
- **65C102 Turbo second processor** (65C102 at 4 MHz): What Acorn sold for a Master, and what a PiTube Direct usually runs. The pinned engine models it, and the parasite prints Acorn TUBE 65C102 Co-Processor.
- **Z80 second processor** (Z80): Acorn sold this one for CP/M. The parasite ROM is identified and reads Acorn TUBE Z80 64K 1.20, and the pinned engine has no Z80 at all, so running it needs a Z80 core this build does not have.
- **80286 second processor** (Intel 80286): The closest thing PiTube Direct offers to the 80186 Acorn put in the Master 512, for DOS Plus. No x86 core is present here, and no parasite ROM for it is identified.
- **ARM2 second processor** (ARM2): The Acorn ARM Evaluation System, the machine the Archimedes came out of. The parasite ROM is identified and is the Brazil supervisor of August 1986. This build has an ARM2 elsewhere, inside the pinned Arculator, but that is a whole Archimedes rather than a core that can be put behind a Tube.
- **32016 second processor** (National Semiconductor 32016): Acorn sold this one as the Cambridge Co-processor, running Panos. No 32016 core is present here, and no parasite ROM for it is identified.

## Why only two

The pinned jsbeeb publishes two parasite models, both 6502 family, and no others. A Tube parasite is a whole processor with its own memory, its own boot ROM and its own timing, so fitting a Z80 or an ARM2 behind the Tube means bringing a core for it, not configuring one that is already there.

Two of the absent ones already have their parasite ROM in the firmware vault, identified by reading the image rather than trusting its filename: the Z80 ROM reads `Acorn TUBE Z80 64K 1.20` and the ARM one is the Brazil supervisor of August 1986. Having the ROM is not having the processor, and the table says so rather than implying otherwise.

## Choosing one in this build

Enable the Tube capability for the machine, which fits the processor Acorn sold with it: a 6502 for a BBC B or B+, a 65C102 for a Master. Enable the 65C102 Turbo capability alongside it to put a 65C102 behind the Tube of a BBC B or B+ instead, which is what a PiTube Direct does. A Model B also needs the Tube host code in a sideways bank, because OS 1.20 finds the Tube and stops there; Acorn shipped that code in DNFS.
