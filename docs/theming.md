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
