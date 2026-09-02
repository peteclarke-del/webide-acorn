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

The CSS cascade order is declared as `theme`, `layout`, then `overrides`.

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

The pages that are loaded outside the workbench — `src/emulator/runtime.css`,
`public/electron-runtime.css` and `public/archimedes-runtime.css` — each carry
their own copy of the two numbers, because they cannot see `theme.css`. An
override that changes the scale has to change theirs too, and the same test
holds the copies in step.

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
status colours remain controlled by the active deployment theme.
