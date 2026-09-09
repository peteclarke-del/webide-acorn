# Information architecture

Where everything in the workbench lives, and why it lives there. Read off the
product rather than proposed for it: the lists below are the ones the code
builds its tabs and panels from.

## The frame

Four regions, always present, in this order down the page.

| Region | What it holds |
| --- | --- |
| Title bar | The product identity, the open project's name, and the global controls: terminal, layout, appearance shortcut, run, debug, cloud |
| Menu bar and tab strip | The action bar (see `primitives.md`), then the workspace tabs |
| Workbench | The activity rail, the panels, the editor, and the machine beneath it |
| Status bar | One live region on the left, facts about the open file on the right |

## The workbench

The activity rail switches workspace. Beside it sit up to three panels and the
editor, in an order the person arranges. A panel's side is simply whether it
comes before or after the editor, and panels move one place at a time from their
own headings. The machine runtime sits below the editor rather than beside it,
because a screen is wider than it is tall and so is a workbench.

| Panel | Answers |
| --- | --- |
| Target configuration | Which machine, which model, which ROM, which capabilities, and whether the firmware for them is present |
| Project explorer | What is in this project, sources, build targets, artifacts, trash |
| Inspector | What is true of the thing in front of you right now, and what problems it has |
| Machine runtime | What the machine is doing, and the controls that make it do it |

## Workspaces

Ten, and they are modes rather than documents: switching one does not close
what you were doing.

**Code** · **Search** · **Analyse** · **Build targets** · **Media** ·
**Debugger** · **Tests** · **Research** · **Settings** · **Help**

Nine more edit the things a game is made of, and share the asset document
contract in ADR 0007:

**Characters** · **Sprites** · **Tiles** · **Fonts** · **Screens** · **Maps** ·
**Palettes** · **Sound** · **Samples**

Each workspace is reachable three ways (the rail, the tab strip, and the View
menu), because the rail is quick, the strip says where you are, and the menu is
the one a keyboard reaches without knowing the layout.

## Inside the source editor

The editor has a sidebar of its own, to the right of the text, and it holds the
five things somebody looks at while reading source rather than while running it:
the number and address converter, the outline, the project symbol selector, the
bookmarks, and the jump targets or line references for the open file. It is a
share of the editor's width rather than a fixed number of pixels, because at the
larger text sizes a fixed column could not show a name beside its location.

Splitting the editor gives the second pane the whole of its width. Two outlines
of one project side by side left about two hundred pixels of source in each,
which is the opposite of what a split is for, so the sidebar stays on the first
pane and is one keystroke away when the split is reset.

## Status

The left of the status bar is a single `aria-live` region and carries the most
recent thing the product has to say. The right carries facts about the open
file, each of which is a thing somebody checks rather than reads: whether it is
saved, the machine and its processor, the language, the caret's line and column,
the encoding, and the line ending.

One live region and not several. Two regions announcing at once produce speech
that interrupts itself, and the workbench has one thing to say at a time.

## What is not here

**There is no account.** Nothing signs in, nothing is owned by anybody, and
every project lives in this browser. That is not an omission from this map, it
is the product as it stands, and it is why the cloud items are a phase rather
than a panel. When there is an account there will be somewhere in this frame for
it, and pretending there is one now would put a control in the title bar that
cannot do anything.

**There is no separate document tree.** A project is a flat set of files with
kinds, and the explorer groups them by kind rather than by folder, because a
BBC Micro project is a dozen files and a folder tree for a dozen files is
ceremony.
