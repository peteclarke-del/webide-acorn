# Accessible primitives

The sixteen interface patterns UX-123 names, and what this product uses for each
one. Everything below was read off the source rather than proposed for it, and
where a pattern is deliberately *not* used that is stated with the reason —
declaring a role the product does not honour is worse than not declaring it.

Every one of these is checked while rendered. The release gate's `smoke` stage
walks nineteen workspaces and applies the rules in `scripts/accessibilityRules.mjs`:
accessible names, heading order, landmark labels, duplicate ids, target size,
contrast in all four palettes, and — since the pixel grid was found without it —
that a role which only means something inside another role is inside it.

## The patterns

| Pattern | What is used | Contract |
| --- | --- | --- |
| Button, icon button | Native `<button>` | An icon button carries a text alternative; the gate fails a control with no accessible name (4.1.2) |
| Split button | **Not used** | Nothing in the product needs one. A split button is a menu button wearing a default action, and where a default action exists it is its own button beside the menu |
| Menu | `role="menubar"` / `role="menu"` in `PanelMenuBar` | Entries are a word or two with the detail in a tooltip; `aria-expanded` on the opener, arrow keys within |
| Tabs | `role="tablist"` / `tab` / `tabpanel` | `aria-selected` on the tab, `aria-controls` to its panel |
| Tree | `role="tree"` / `treeitem` in `ProjectTree` | Folders are `treeitem` buttons carrying `aria-expanded`; shut folders hide their contents and say how many they hold |
| List, grid | `role="list"`, `role="grid"` | A `grid` owns `row`s which own `gridcell`s — see below |
| Combobox | `role="combobox"` | `aria-expanded` and `aria-controls` onto the listbox it opens |
| Form, error | Native labels, `role="alert"` | A refusal names the thing, the measurement and the consequence (see `wording.md`) |
| Toolbar | `role="group"` with a label — **not `role="toolbar"`** | See below |
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
count position within and could not say which row and column the caret was in —
the two facts that matter most when editing artwork pixel by pixel. There were
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

## What is still open

The command palette's taxonomy and its default shortcuts are a product decision
rather than an implementation one, and UX-106 stays open for it.
