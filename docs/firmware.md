# Firmware matrix

Generated from the ROM manifests, the Archimedes firmware profiles and the
adapter support map. It is not maintained by hand, and a contract test fails
the release gate whenever it stops matching the code.

## What this product does with firmware

- **It never ships any.** No ROM, disc or tape image is in this repository or
  in the container image, and an executable check refuses one that is added.
  The machine you run is one you supplied the firmware for.
- **Ownership does not change.** The images are yours. This build stores them
  in your browser and serves them to the emulator frame; nothing is uploaded,
  and a project export deliberately excludes them, so a project you send to
  somebody else does not carry firmware they may not have.
- **Storage is origin-private.** The vault is IndexedDB under this origin,
  read back through a service worker at `/user-roms/`, which is what lets an
  emulator frame ask for a ROM by path without a general-purpose file
  endpoint existing.
- **A manifest checks size, not content.** Each entry below names the lengths
  it accepts, so a wrong file is refused before it can produce a machine that
  half works. It is not a hash: this build does not hold a list of accepted
  digests, and inventing one would refuse legitimate regional and revision
  variants somebody owns.
- **Continuous integration is given the same files.** The headless runner
  takes a ROM manifest naming local paths, so a pipeline supplies firmware the
  same way a person does. There is no substitute image and no ROM-less mode
  for the paths that need one; a run without firmware is reported as a run
  that did not happen.

## ROM sets

### BBC MOS 1.20 + BASIC II + DFS

- Machines: Acorn BBC Model B
- Engine: jsbeeb 1.19.1
- Adapter model: `B-DFS0.9`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| MOS 1.20 operating system | operating system | required | 16 KiB | `os12-basic2-dfs/os.rom` | — |
| BBC BASIC II | language | required | 16 KiB | `os12-basic2-dfs/BASIC.ROM` | — |
| DFS filing system | filing system | required | 8 KiB or 16 KiB | `os12-basic2-dfs/b/DFS-0.9.rom` | — |
| 6502 Tube boot ROM | extension | optional · needed for tube | 2 KiB | `os12-basic2-dfs/tube/6502Tube.rom` | — |
| 1MHzPi BBC WiFi development ROM | extension | optional · needed for 1mhzpi | 16 KiB | `os12-basic2-dfs/development/BBCWiFi-development.rom` | Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds. |

### BBC MOS 1.20 + BASIC I + DFS

- Machines: Acorn BBC Model B
- Engine: jsbeeb 1.19.1
- Adapter model: `B-DFS0.9`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| MOS 1.20 operating system | operating system | required | 16 KiB | `os12-basic1/os.rom` | — |
| BBC BASIC I | language | required | 16 KiB | `os12-basic1/BASIC.ROM` | The first BBC BASIC, loaded through the path the engine names for the language socket. |
| DFS filing system | filing system | required | 8 KiB or 16 KiB | `os12-basic1/b/DFS-0.9.rom` | — |
| 6502 Tube boot ROM | extension | optional · needed for tube | 2 KiB | `os12-basic1/tube/6502Tube.rom` | — |
| 1MHzPi BBC WiFi development ROM | extension | optional · needed for 1mhzpi | 16 KiB | `os12-basic1/development/BBCWiFi-development.rom` | Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds. |

### BBC MOS 1.20 + BASIC II + ADFS

- Machines: Acorn BBC Model B
- Engine: jsbeeb 1.19.1
- Adapter model: `B1770A`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| MOS 1.20 operating system | operating system | required | 16 KiB | `os12-basic2-adfs/os.rom` | — |
| BBC BASIC II | language | required | 16 KiB | `os12-basic2-adfs/BASIC.ROM` | — |
| 1770 DFS | filing system | required | 8 KiB or 16 KiB | `os12-basic2-adfs/b1770/dfs1770.rom` | — |
| ADFS | filing system | required | 16 KiB | `os12-basic2-adfs/b1770/zADFS.ROM` | — |
| 6502 Tube boot ROM | extension | optional · needed for tube | 2 KiB | `os12-basic2-adfs/tube/6502Tube.rom` | — |
| 1MHzPi BBC WiFi development ROM | extension | optional · needed for 1mhzpi | 16 KiB | `os12-basic2-adfs/development/BBCWiFi-development.rom` | Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds. |

### B+ MOS 2.00 + BASIC II + 1770 DFS

- Machines: Acorn BBC B+
- Engine: jsbeeb 1.19.1
- Adapter model: `BPlus`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| B+ MOS 2.00 | operating system | required | 16 KiB | `bplus-os/bplus/os2.rom` | The upper half of the 32 KiB part at IC71 on a B+ 64K, or a 16 KiB OS 2.00 dump on its own. The machine introduces itself as Acorn OS 64K when this is right. |
| BBC BASIC II | language | required | 16 KiB | `bplus-os/bplus/BASIC2.ROM` | The lower half of that same 32 KiB part, or BASIC II on its own; they are the same image. |
| 1770 DFS | filing system | required | 16 KiB | `bplus-os/bplus/dfs223.rom` | — |
| 1MHzPi BBC WiFi development ROM | extension | optional · needed for 1mhzpi | 16 KiB | `bplus-os/development/BBCWiFi-development.rom` | Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds. |

### B+ MOS 2.00 + BASIC II + ADFS

- Machines: Acorn BBC B+
- Engine: jsbeeb 1.19.1
- Adapter model: `BPlusADFS`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| B+ MOS 2.00 | operating system | required | 16 KiB | `bplus-adfs/bplus/os2.rom` | — |
| BBC BASIC II | language | required | 16 KiB | `bplus-adfs/bplus/BASIC2.ROM` | — |
| ADFS 1.30 | filing system | required | 16 KiB | `bplus-adfs/bplus/adfs130.rom` | — |
| 1770 DFS | filing system | required | 16 KiB | `bplus-adfs/bplus/dfs223.rom` | — |
| 1MHzPi BBC WiFi development ROM | extension | optional · needed for 1mhzpi | 16 KiB | `bplus-adfs/development/BBCWiFi-development.rom` | Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds. |

### Master MOS 3.20

- Machines: BBC Master Series
- Engine: jsbeeb 1.19.1
- Adapter model: `Master`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| Master MOS 3.20 combined image | operating system | required | 128 KiB | `mos320/master/mos3.20` | — |
| 65C102 Turbo Tube boot ROM | extension | optional · needed for tube | 2 KiB | `mos320/tube/65C102Tube.rom` | — |
| 1MHzPi BBC WiFi development ROM | extension | optional · needed for 1mhzpi | 16 KiB | `mos320/development/BBCWiFi-development.rom` | Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds. |

### Master MOS 3.50

- Machines: BBC Master Series
- Engine: jsbeeb 1.19.1
- Adapter model: `Master`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| Master MOS 3.50 combined image | operating system | required | 128 KiB | `mos350/master/mos3.20` | The later Master 128 firmware, as a 128 KiB combined image of eight 16 KiB banks in the order the engine reads them. It is loaded through the path the engine names for the Master OS socket. |
| 65C102 Turbo Tube boot ROM | extension | optional · needed for tube | 2 KiB | `mos350/tube/65C102Tube.rom` | — |
| 1MHzPi BBC WiFi development ROM | extension | optional · needed for 1mhzpi | 16 KiB | `mos350/development/BBCWiFi-development.rom` | Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds. |

### Electron OS + BASIC

- Machines: Acorn Electron
- Engine: elkjs ff123355
- Adapter model: `Electron`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| Electron operating system | operating system | required | 16 KiB | `electron-os/os.rom` | — |
| BBC BASIC II for the Electron | language | required | 16 KiB | `electron-os/BASIC.ROM` | — |

### Electron + Plus 1 expansions

- Machines: Acorn Electron
- Engine: elkulator allegro5-6785521
- Adapter model: `Electron`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| Electron operating system 1.00 | operating system | required | 16 KiB | `electron-expanded/roms/os` | — |
| BBC BASIC II for the Electron | language | required | 16 KiB | `electron-expanded/roms/basic.rom` | — |
| Plus 1 expansion ROM | extension | optional · needed for plus1 | 4 KiB | `electron-expanded/roms/plus1.rom` | Acorn Plus 1 support ROM. Supplies the cartridge slots, printer port and analogue port. |
| Acorn ADFS for the Plus 3 | extension | optional · needed for plus3 | 16 KiB | `electron-expanded/roms/acorn-adfs.rom` | Acorn ADFS. The Plus 3 disc interface is unusable without it. |
| Electron DFS | extension | optional · needed for plus3 | 16 KiB | `electron-expanded/roms/dfs.rom` | Disc filing system for Electron disc interfaces. |
| EMMFS · MMFS for the Electron | extension | optional · needed for plus1 | 16 KiB | `electron-expanded/roms/EMMFS.rom` | MMFS built for the Electron, giving SD-card storage through the cartridge slot. |
| ESWMMFS · sideways-RAM MMFS | extension | optional · needed for sideways | 16 KiB | `electron-expanded/roms/ESWMMFS.rom` | MMFS variant that keeps its workspace in sideways RAM. |
| ZEMMFS · MMFS variant | extension | optional · needed for plus1 | 16 KiB | `electron-expanded/roms/ZEMMFS.rom` | A further MMFS build carried by the 1MHzPi project. |
| Advanced File Manager 1.09 | extension | optional · needed for plus1 | 16 KiB | `electron-expanded/roms/AFM1V09.rom` | Advanced File Manager, a filing-system front end used with MMFS. |
| Retro Hardware Plus 1 support 1.33 | extension | optional · needed for plus1 | 16 KiB | `electron-expanded/roms/RHPLUS133.rom` | Support ROM for the Retro Hardware Plus 1 reimplementation, which is the board the 1MHzPi work uses. |
| ElkWiFi 1MHz bus firmware | extension | optional · needed for 1mhzpi | 16 KiB or 16,406 bytes | `electron-expanded/roms/elkwifi.rom` | Built from the 1MHzPi project’s own source rather than obtained; re-import after a firmware rebuild. Its size is not a round 16 KB. |
| 6502 Tube client 1.20 | extension | optional · needed for tube | 4 KiB | `electron-expanded/roms/6502tube_120.rom` | Parasite boot ROM for a 6502 second processor on the Plus 1 expansion connector. |

### Atom MOS + BASIC

- Machines: Acorn Atom
- Engine: jsbeeb 1.19.1
- Adapter model: `Atom-Tape`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| Atom kernel | operating system | required | 4 KiB | `atom-mos/atom/Atom_Kernel.rom` | — |
| Atom BASIC | language | required | 4 KiB | `atom-mos/atom/Atom_Basic.rom` | — |

### Atom MOS + floating point + BASIC

- Machines: Acorn Atom
- Engine: jsbeeb 1.19.1
- Adapter model: `Atom-Tape-FP`

| ROM | Purpose | Needed | Accepted length | Vault key | Note |
| --- | --- | --- | --- | --- | --- |
| Atom kernel | operating system | required | 4 KiB | `atom-fp/atom/Atom_Kernel.rom` | — |
| Atom floating-point ROM | extension | required | 4 KiB | `atom-fp/atom/Atom_FloatingPoint.rom` | — |
| Atom BASIC | language | required | 4 KiB | `atom-fp/atom/Atom_Basic.rom` | — |

## Archimedes firmware

The Archimedes profiles are not ROM sets in the sense above: a machine takes
one image built from four byte-lane ROMs interleaved together, plus a CMOS
image. The lanes are named because that is how the files arrive.

| Profile | Arculator ROM set | Byte lanes | Lane length | CMOS |
| --- | --- | --- | --- | --- |
| Arthur 1.20 (25 Sep 1987) | `arthur120` | `0277,022-02.rom`, `0277,023-02.rom`, `0277,024-02.rom`, `0277,025-02.rom` | 128 KiB | `cmos_arthur.bin` |
| RISC OS 2.00 (05 Oct 1988) | `riscos200` | `0283,022-01.rom`, `0283,023-01.rom`, `0283,024-01.rom`, `0283,025-01.rom` | 128 KiB | `cmos_riscos2.bin` |
| RISC OS 2.01 (05 Jul 1990) | `riscos201` | `0270,601-01.rom`, `0270,602-01.rom`, `0270,603-01.rom`, `0270,604-01.rom` | 128 KiB | `cmos_riscos2.bin` |
| RISC OS 3.00 (25 Sep 1991) | `riscos300` | `0270,251-01.rom`, `0270,252-01.rom`, `0270,253-01.rom`, `0270,254-01.rom` | 512 KiB | `cmos_riscos3.bin` |
| RISC OS 3.10 (30 Apr 1992) | `riscos310` | `0296,041-01.rom`, `0296,042-01.rom`, `0296,043-01.rom`, `0296,044-01.rom` | 512 KiB | `cmos_riscos3.bin` |
| RISC OS 3.11 (29 Sep 1992) | `riscos311` | `0296,041-02.rom`, `0296,042-02.rom`, `0296,043-02.rom`, `0296,044-02.rom` | 512 KiB | `cmos_riscos3.bin` |

## What is not here

- **Accepted digests.** Length is the only check. A per-image hash list would
  reject the regional and revision variants people legitimately own, and this
  build has measured none of them.
- **Redistribution.** There is nothing to state a position on, because nothing
  is redistributed.
- **Sharing between people.** Firmware is not part of a project export and the
  store holds none, so there is no sharing rule to write.

