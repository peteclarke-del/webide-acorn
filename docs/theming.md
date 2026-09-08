# Theming and downstream overrides

8bit-net Dev's Acorn Workbench separates semantic presentation tokens from component structure.
This follows the portable token approach used by bit-chat and the palette/layout
separation used by Acorn File Forge.

## Files

- `src/theme.css` owns the complete default colour, typography, effect, radius,
  and syntax palette.
- `src/styles.css` owns component layout and responsive behavior. It consumes
  semantic variables and must not introduce deployment-specific colours.
- `public/theme-overrides.css` is an intentionally empty runtime override loaded
  after the application bundle.

The CSS cascade order is declared as `theme`, `layout`, then `overrides`, and
every rule the product ships is inside one of those layers. That matters more
than it sounds: a rule written outside a layer beats every layered rule whatever
its specificity, and beats the overrides layer too, so a single stray rule can
make a downstream override silently do nothing. Four hundred lines had drifted
outside the layout layer this way. `src/styleLayers.test.ts` fails if anything
does again.

## The type scale

Every text size in the product resolves through a `--fs-*` custom property, and
those properties are generated in `src/theme.css` from two numbers:

- `--ui-scale`, a multiplier applied to every size, and
- `--fs-floor`, a minimum below which nothing is allowed however small it was.

So the whole interface is made larger by changing one number, and the floor is
what stops small captions collapsing back to sizes people cannot read. Nothing
in `src/styles.css` writes a raw pixel size; `src/typeScale.test.ts` fails if
anything does, if a stylesheet asks for a token nothing defines, or if a page
loaded on its own drifts from the workbench's scale.

The pages that are loaded outside the workbench (`src/emulator/runtime.css`,
`public/electron-runtime.css` and `public/archimedes-runtime.css`) each carry
their own copy of the two numbers, because they cannot see `theme.css`. An
override that changes the scale has to change theirs too, and the same test
holds the copies in step.

Those copies are the *shipped* size, and a person's own choice is copied into
each frame at runtime by `syncFrameScale`: the frames are same-origin, so the
two properties are written straight onto the framed document. They are not
passed through the frame's URL, because changing the URL remounts the iframe and
remounting the iframe restarts the emulator. Nobody expects a machine to reboot
because they made the text bigger.

The code editor is the one exception: its size is the reader's own preference,
bounded in `src/editor/editorPreferences.ts`, and it starts at the floor.

## Override without rebuilding

Replace `theme-overrides.css` in the built site or mount it into the container:

```yaml
services:
  webide-acorn:
    volumes:
      - ./my-theme.css:/usr/share/nginx/html/theme-overrides.css:ro
```

An override should normally contain only semantic custom properties:

```css
@layer overrides {
  :root {
    --theme-primary: #73e0c1;
    --theme-background: #090d1a;
    --theme-surface-1: #111729;
    --theme-ink: #f3f5ff;
  }
}
```

Machine accent colours are content data rather than theme data. They communicate
the selected hardware profile while surfaces, focus, contrast, syntax, and
status colours remain controlled by the active deployment theme. They are used
for a border, a wash and a shadow rather than for text: the accents are light
golds and creams chosen against a dark ground, and as letters on a light one the
machine monogram measured 1.15:1, so the monogram takes the theme's own ink.

## The four palettes

There are two themes and two contrast levels, and every combination is a palette
the product can show:

| Palette | Text | The border that identifies a control |
| --- | --- | --- |
| dark | 4.5:1 | 3:1 |
| light | 4.5:1 | 3:1 |
| dark, high contrast | 7:1 | 4.5:1 |
| light, high contrast | 7:1 | 4.5:1 |

The standard palettes meet WCAG AA, which is what UX-006 requires; the
high-contrast ones meet AAA, because a high-contrast setting that asked no more
than the standard one would be a setting that did nothing. Each is declared once,
`:root`, `:root[data-theme='light']`, `:root[data-contrast='more']` and the
two combined, and each override block lists only the tokens that had to move.

A person chooses among them in Settings, under Appearance, along with the type
scale. **The theme defaults to dark rather than to the machine's setting**, which
is the opposite of what a new product would do and is right for this one: the
workbench has only ever been dark, and following the operating system by default
would change the look for somebody who never asked. Contrast does follow the
machine, because asking for more contrast is already a deliberate act. `--ui-scale` and `--fs-floor` move together: the floor is held at the
ratio the shipped pair already has, because a multiplier raised on its own
collapses the bottom of the scale onto the floor and produces two scales side by
side.

**`system` is resolved in script rather than by a media query, deliberately.**
The stylesheet holds each palette exactly once, under an attribute selector, and
a media query cannot join a selector list, so following the operating system in
CSS would mean a second copy of the light palette that nothing keeps in step
with the first. That is not hypothetical: the light theme was unreachable for
long enough that it came to declare its own surfaces and inherit every
foreground from `:root`, and its emphasis text measured 1.01:1 against its own
paper. `applyAppearance` sets the attributes and `watchSystemAppearance`
re-applies when the machine's setting changes, so one copy still follows the
computer.

## The palettes are measured, not reviewed

`src/theme/contrastAudit.ts` parses `theme.css`, resolves each palette the way a
browser does, and measures every declared pairing against the table above. The
pairings are declared rather than generated, because a pairing is a claim about
what is actually drawn on what.

That audit is necessary and not sufficient, and the difference matters to
anybody writing an override. It reads tokens, so it cannot see text drawn on a
surface that deliberately does not follow the theme, the machine's bezel is
dark in every palette, nor text on a background produced by `color-mix`. Those
are caught by rendering instead: the `smoke` stage of the release gate walks
nineteen workspaces in all four palettes after a real build and measures the
contrast of what is actually on screen.

**A deployment override is checked by neither.** Both instruments read this
repository's own palette. An override that lowers a token below its target will
not be caught here, so run the gate against your own build if you change one.

## Text on the machine's own surfaces

A BBC Micro's screen and its bezel are dark whatever the workbench is set to, so
those backgrounds do not follow the theme. Workbench text drawn on them uses
`--theme-on-machine` and `--theme-on-machine-muted`, which are defined once and
deliberately not overridden by the light theme, because the surface they sit on
is not overridden either.

Name that text directly. Re-pointing the ink tokens for a whole subtree looks
tidier and is wrong: `.runtime-console` contains a status panel that paints a
theme surface of its own, and it inherited near-white text onto cream at 1.01:1.
A container cannot lend a colour to descendants that bring their own background.
