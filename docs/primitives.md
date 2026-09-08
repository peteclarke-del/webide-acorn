# Accessible primitives

The sixteen interface patterns UX-123 names, and what this product uses for each
one. Everything below was read off the source rather than proposed for it, and
where a pattern is deliberately *not* used that is stated with the reason.
Declaring a role the product does not honour is worse than not declaring it.

Every one of these is checked while rendered. The release gate's `smoke` stage
walks nineteen workspaces and applies the rules in `scripts/accessibilityRules.mjs`:
accessible names, heading order, landmark labels, duplicate ids, target size,
contrast in all four palettes, and, since the pixel grid was found without it.
That a role which only means something inside another role is inside it.

## The patterns

| Pattern | What is used | Contract |
| --- | --- | --- |
| Button, icon button | Native `<button>` | An icon button carries a text alternative; the gate fails a control with no accessible name (4.1.2) |
| Split button | **Not used** | Nothing in the product needs one. A split button is a menu button wearing a default action, and where a default action exists it is its own button beside the menu |
| Menu | `role="menubar"` / `role="menu"` in `PanelMenuBar` | Entries are a word or two with the detail in a tooltip; `aria-expanded` on the opener, arrow keys within |
| Tabs | `role="tablist"` / `tab` / `tabpanel` | `aria-selected` on the tab, `aria-controls` to its panel |
| Tree | `role="tree"` / `treeitem` in `ProjectTree` | Folders are `treeitem` buttons carrying `aria-expanded`; shut folders hide their contents and say how many they hold |
| List, grid | `role="list"`, `role="grid"` | A `grid` owns `row`s which own `gridcell`s, see below |
| Combobox | `role="combobox"` | `aria-expanded` and `aria-controls` onto the listbox it opens |
| Form, error | Native labels, `role="alert"` | A refusal names the thing, the measurement and the consequence (see `wording.md`) |
| Toolbar | `role="group"` with a label, **not `role="toolbar"`** | See below |
| Dialog | Native `<dialog>` and `role="dialog"` | Focus is moved in and restored; Escape closes; the backdrop uses `--theme-overlay` |
| Notification | `role="status"` and `role="log"` | Announced politely; the workbench never interrupts with an alert for something that is not an error |
| Splitter | `role="separator"` in `PanelSeparator` | Focusable, moved with arrow keys |
| Status | `role="status"` | The status bar is one live region, not many |
| Tooltip | The native `title` attribute | See below |
| Command palette | `role="dialog"` over a `listbox` | The taxonomy itself is still open (UX-106) and needs the user |
| Virtualised table | `role="table"` with explicit `row`, `columnheader`, `cell` | Rows that are not rendered are not claimed to exist |

## A grid owns rows

`role="gridcell"` has a required context and the pixel editors did not give it
one: cells sat directly inside `role="grid"`, so a screen reader had nothing to
count position within and could not say which row and column the caret was in.
The two facts that matter most when editing artwork pixel by pixel. There were
448 such cells on one workspace.

The rows are laid out with `display: contents`, so the grid still performs the
layout and nothing moved on screen. That technique has historically dropped
elements from the accessibility tree, so it was checked rather than assumed: in
Chromium the tree reports a grid with 8 rows and 64 cells for a character and 16
rows and 256 cells for a sprite.

## Toolbars are labelled groups, not ARIA toolbars

Fourteen toolbars are bars of ordinary buttons, each individually reachable by
Tab and each individually named. They now carry `role="group"` and a label, so a
screen reader announces where one bar ends and the next begins.

They are deliberately not `role="toolbar"`. That pattern promises arrow-key
navigation with a roving tabindex, and declaring it without implementing it
would tell somebody their arrow keys do something they do not. A labelled group
claims exactly what is true.

## Tooltips are the native `title`

There is no `role="tooltip"` anywhere. Menu entries and icon buttons carry a
`title`, which the browser positions, dismisses and exposes without any of the
focus and hover management an ARIA tooltip needs to get right. Where the detail
matters more than that, it is on the page instead of in a tooltip.

## The action bar, and what happens when it does not fit

The workbench menu bar is the global action bar: **File, Project, Edit, Build,
Debug, View, Help**, in that order. The order is declared once, in
`workbenchMenus`, and each menu's contents come from the command table by
category rather than being listed twice, so a command cannot appear in a menu
without also being a command, with the shortcut and the enabled rule that go
with it.

State comes from the same place. An entry is `disabled` when its command is not
available, carries its chord as a hint, and its tooltip says why it is greyed.
The reason is in the tooltip rather than beside the label, because a sentence
next to every unavailable entry makes the menu as wide as the longest of them.
Entries that toggle carry `checked`.

**Overflow is a wrap, not an overflow menu.** Measured across four sizes, with
every item reachable and nothing scrolled or clipped at any of them:

| Viewport | Menu bar | Workspace tabs |
| --- | --- | --- |
| 1600 wide | 7 items, 1 row | 1 row |
| 700 wide | 7 items, 1 row | 3 rows |
| 320 wide | 7 items, 2 rows | 3 rows |
| 1280 at 2× text | 7 items, 1 row | 1 row |

An overflow menu, the "..." that collects what did not fit, is the conventional
answer and it hides things: the item somebody wants is behind a control that
does not say which items are behind it, and the set changes with the window. A
wrap costs a second row and hides nothing, which is the trade this build makes
everywhere else too.

## Canvases have one of two treatments, never neither

UX-007 says a canvas may not be the only way to inspect or edit critical data.
Which treatment applies depends on whether the canvas can be edited.

**An editable canvas is `aria-hidden`.** A bitmap read out cell by cell tells
nobody anything. What it is wrapped in takes focus and arrow keys, and a
`role="status"` region beside it says where the caret is and what is under it,
*"Row 4 of 32, column 9 of 40, tile 12 on layer Background"*. That sentence is
the accessible view, and because it is live it follows the caret. The screen
editor and the tile map both work this way.

**A canvas that only shows something carries an `aria-label`** describing what
it shows: the golden-image comparison figure and the map overview thumbnail. It
is not hidden, because there is something worth announcing, and there is nothing
to operate.

The failure this guards against is a third treatment, a canvas that is neither
hidden nor named, which a screen reader announces as nothing at all and which
may be the only place some data appears. `scripts/canvasAlternatives.test.ts`
refuses one, and refuses a hidden canvas whose file has no live region to speak
for it, since hiding is only honest when something else says what is there.

The pixel grids are not canvases at all. They are a `grid` of `row`s of
`gridcell` buttons, one per pixel, each with its own label, see above.

## Leaving a control that takes Tab

The source editor takes Tab so that Tab indents. That is the case WCAG 2.1.2 has
in mind when it allows a component to hold a key it would otherwise pass on, and
it is allowed only with a way out that the person is told about. **Escape arms
it; the next Tab moves focus.** Typing anything else disarms it again, so Tab
never quietly stops indenting, and the control announces `Escape+Tab` in its
`aria-keyshortcuts`.

The gate walks the workbench with trusted Tab presses, a synthesised Tab event
does not move focus, so a check built on one would walk nothing and report
cleanly. Where a control does not pass Tab on, the advertised way out is used
and checked to work, because an advertised escape that does nothing is worse
than none at all.

## What is still open


The command palette's taxonomy and its default shortcuts are a product decision
rather than an implementation one, and UX-106 stays open for it.
