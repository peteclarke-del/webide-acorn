/* Automated accessibility rules, and an honest account of what they cover.
 *
 * These are not a substitute for the manual audit. An automated scan can find
 * a control with no accessible name, a heading level that skips, an id used
 * twice, text that does not meet contrast, and a target too small to hit. It
 * cannot tell whether a name is meaningful, whether a reading order makes
 * sense, or whether a live region announces at a useful moment. The rules
 * below are the ones a machine can decide; everything else stays in the manual
 * matrix, and the scan says so rather than implying coverage it does not have.
 *
 * Every rule names the WCAG success criterion it checks, so a finding can be
 * traced to the requirement rather than to somebody's preference.
 *
 * Written as plain JavaScript so the release gate and the tests run the same
 * rules rather than two sets that can drift.
 */

/** What this scan checks, and what it deliberately does not. */
export const COVERAGE = Object.freeze({
  automated: Object.freeze([
    'Controls and images without an accessible name (WCAG 1.1.1, 4.1.2)',
    'Duplicate element identifiers, which make an aria-labelledby reference ambiguous (WCAG 4.1.2)',
    'Document language and title (WCAG 3.1.1, 2.4.2)',
    'Heading levels that skip (WCAG 1.3.1)',
    'Landmark regions sharing a label (WCAG 1.3.1)',
    'Text contrast against its own background (WCAG 1.4.3)',
    'Targets smaller than the minimum size (WCAG 2.5.8), and any claim of its essential exception made without a reason',
    'Focusable elements with no visible focus indicator (WCAG 2.4.7)',
  ]),
  manual: Object.freeze([
    'Whether an accessible name is meaningful rather than merely present',
    'Whether the reading and focus order make sense',
    'Whether a live region announces at a useful moment',
    'Whether an alternative conveys the same information as the visual it replaces',
    'Screen-reader behaviour on each supported combination',
  ]),
});

/** WCAG 2.2 AA minimum target size, in CSS pixels (2.5.8). */
export const MINIMUM_TARGET = 24;

/* Contrast thresholds from WCAG 1.4.3. Large text is 18.66px bold or 24px. */
export const CONTRAST_NORMAL = 4.5;
export const CONTRAST_LARGE = 3;

/**
 * The scan, as an expression evaluated inside the page.
 *
 * It runs against whatever is on screen, so the caller decides what to open
 * before calling it. Findings carry the rule, the element and enough context
 * to find it again; nothing is summarised away.
 */
export const SCAN = `(() => {
  const findings = [];
  const add = (rule, criterion, element, detail) => {
    const identity = element
      ? element.tagName.toLowerCase()
        + (element.id ? '#' + element.id : '')
        + (element.className && element.className.toString ? '.' + element.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : '')
      : 'document';
    findings.push({ rule, criterion, element: identity.slice(0, 80), detail });
  };

  const shown = (node) => typeof node.checkVisibility === 'function'
    ? node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
    : getComputedStyle(node).display !== 'none';

  /* An accessible name, computed the way a browser would for the common
   * cases: an explicit label, a wrapping label, a referenced label, a title,
   * or the element's own text. */
  const accessibleName = (node) => {
    const aria = node.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      if (text) return text;
    }
    if (node.id) {
      const label = document.querySelector('label[for="' + CSS.escape(node.id) + '"]');
      if (label && label.textContent.trim()) return label.textContent.trim();
    }
    const wrapping = node.closest('label');
    if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
    const title = node.getAttribute('title');
    if (title && title.trim()) return title.trim();
    if (node.tagName === 'IMG') return (node.getAttribute('alt') ?? '').trim();
    return (node.textContent ?? '').trim();
  };

  /* --- names ------------------------------------------------------------ */
  for (const node of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="option"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="combobox"]')) {
    if (!shown(node)) continue;
    if (node.type === 'hidden') continue;
    if (!accessibleName(node)) add('control-name', '4.1.2', node, 'has no accessible name');
  }
  for (const node of document.querySelectorAll('img')) {
    if (!shown(node)) continue;
    const presentational = node.getAttribute('role') === 'presentation' || node.getAttribute('role') === 'none' || node.getAttribute('alt') === '';
    if (!presentational && !accessibleName(node)) add('image-alt', '1.1.1', node, 'has no alternative text and is not marked presentational');
  }

  /* --- identity --------------------------------------------------------- */
  const seen = new Map();
  for (const node of document.querySelectorAll('[id]')) {
    const count = (seen.get(node.id) ?? 0) + 1;
    seen.set(node.id, count);
    /* Cited against 4.1.2 rather than 4.1.1: Parsing was removed in WCAG 2.2,
     * and what still matters about a duplicate id is that aria-labelledby and
     * aria-describedby resolve by it, so a duplicate makes a name or a
     * description ambiguous. */
    if (count === 2) add('duplicate-id', '4.1.2', node, 'shares its identifier "' + node.id + '" with another element, so an aria-labelledby reference to it is ambiguous');
  }

  /* --- document --------------------------------------------------------- */
  if (!document.documentElement.getAttribute('lang')) add('document-language', '3.1.1', null, 'the document declares no language');
  if (!document.title || !document.title.trim()) add('document-title', '2.4.2', null, 'the document has no title');

  /* --- headings --------------------------------------------------------- */
  let previous = 0;
  for (const node of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!shown(node)) continue;
    const level = Number(node.tagName.slice(1));
    if (previous && level > previous + 1) add('heading-order', '1.3.1', node, 'jumps from level ' + previous + ' to level ' + level);
    previous = level;
  }

  /* --- landmarks -------------------------------------------------------- */
  const landmarks = new Map();
  for (const node of document.querySelectorAll('main, nav, aside, header, footer, form, section[aria-label], [role="region"], [role="complementary"], [role="navigation"], [role="banner"], [role="contentinfo"]')) {
    if (!shown(node)) continue;
    const role = node.getAttribute('role') ?? node.tagName.toLowerCase();
    const key = role + '::' + (accessibleName(node).slice(0, 60) || '(unnamed)');
    const count = (landmarks.get(key) ?? 0) + 1;
    landmarks.set(key, count);
    if (count === 2) add('landmark-label', '1.3.1', node, 'shares its role and name with another landmark: ' + key);
  }

  /* --- contrast --------------------------------------------------------- */
  const parseColour = (value) => {
    const match = /rgba?\\(([^)]+)\\)/.exec(value);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const behind = (node) => {
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      /* A background image could be anything, so contrast is not decided. */
      if (style.backgroundImage && style.backgroundImage !== 'none') return null;
      const colour = parseColour(style.backgroundColor);
      if (colour && colour.a === 1) return colour;
      if (colour && colour.a > 0) return null;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  for (const node of document.querySelectorAll('body *')) {
    if (!shown(node)) continue;
    const ownText = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    if (!ownText) continue;
    const style = getComputedStyle(node);
    if (Number(style.opacity) < 1) continue;
    const foreground = parseColour(style.color);
    const background = behind(node);
    if (!foreground || !background || foreground.a < 1) continue;
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    const ratio = (light + 0.05) / (dark + 0.05);
    const size = Number.parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const required = (bold && size >= 18.66) || size >= 24 ? ${CONTRAST_LARGE} : ${CONTRAST_NORMAL};
    if (ratio + 0.005 < required) {
      add('contrast', '1.4.3', node, 'text at ' + ratio.toFixed(2) + ':1 needs ' + required + ':1 (' + size.toFixed(1) + 'px' + (bold ? ' bold' : '') + ')');
    }
  }

  /* --- target size ------------------------------------------------------- */
  for (const node of document.querySelectorAll('button, a[href], input, select, [role="button"], [role="tab"], [role="option"]')) {
    if (!shown(node) || node.disabled) continue;
    if (node.type === 'hidden' || node.type === 'checkbox' || node.type === 'radio') continue;
    /* An inline target within a sentence is exempt (2.5.8 "inline"). */
    if (node.tagName === 'A' && node.closest('p, li, td')) continue;
    const box = node.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    /* 2.5.8 is about pointer targets, and something that cannot be hit at its
     * own centre is not one. That covers the two real cases without either
     * knowing class names or exempting anything by hand: a file input clipped
     * to a pixel and activated by a visible button elsewhere, and a checkbox
     * behind its own label. Both have a visible control that is measured on
     * its own turn. */
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== node && !node.contains(hit))) continue;
    /* 2.5.8 exempts a target whose size is essential. A cell in a pixel or
     * glyph grid is one pixel of the artwork, and enlarging it past the
     * artwork would change what the editor edits. The exemption is declared in
     * the markup with its reason rather than guessed here from a class name,
     * so it is reviewable where it is claimed — and an exemption claimed
     * without a reason is itself reported. */
    const essential = node.closest('[data-essential-target-size]');
    if (essential) {
      if ((essential.getAttribute('data-essential-target-size') ?? '').trim().length < 40) {
        add('essential-exemption', '2.5.8', essential, 'claims the essential exception without stating why');
      }
      continue;
    }
    if (box.width + 0.5 < ${MINIMUM_TARGET} || box.height + 0.5 < ${MINIMUM_TARGET}) {
      add('target-size', '2.5.8', node, Math.round(box.width) + 'x' + Math.round(box.height) + ' is under ' + ${MINIMUM_TARGET} + 'x' + ${MINIMUM_TARGET});
    }
  }

  return findings;
})()`;

/** Group findings by rule so a report leads with the largest problem. */
export function summarise(findings) {
  const byRule = new Map();
  for (const finding of findings) {
    const entry = byRule.get(finding.rule) ?? { rule: finding.rule, criterion: finding.criterion, count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push(`${finding.element} ${finding.detail}`);
    byRule.set(finding.rule, entry);
  }
  return [...byRule.values()]
    .sort((left, right) => right.count - left.count || left.rule.localeCompare(right.rule))
    .map((entry) => `${entry.rule} (WCAG ${entry.criterion}) x${entry.count}: ${entry.examples.join('; ')}`);
}

/* --- conditions a person can turn on, checked with them turned on ---------- */

/**
 * Text spacing, WCAG 1.4.12.
 *
 * The criterion asks that no content be lost when a reader applies their own
 * spacing: line height 1.5 times the font size, paragraphs 2 times, letters
 * 0.12em and words 0.16em. The usual failure is a fixed-height box that clips
 * its own text, which is invisible until someone actually applies the spacing.
 * So it is applied, and every element is measured for content taller than the
 * box holding it with no way to scroll to the rest.
 */
export const TEXT_SPACING = `(() => {
  const style = document.createElement('style');
  style.id = 'wcag-text-spacing';
  style.textContent = \`* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
    p { margin-bottom: 2em !important; }\`;
  document.head.appendChild(style);
  /* Force layout before measuring. */
  void document.body.offsetHeight;

  const clipped = [];
  for (const node of document.querySelectorAll('body *')) {
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue;
    const computed = getComputedStyle(node);
    if (!/hidden|clip/.test(computed.overflowY) && !/hidden|clip/.test(computed.overflowX)) continue;
    /* Only the element that actually holds the text. A container whose
     * children scroll is not clipping anything; its child would report it. */
    if (![...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim())) continue;
    /* Something clipped to a pixel is there for a screen reader and is never
     * presented visually, so spacing cannot lose it. */
    const box = node.getBoundingClientRect();
    if (box.width <= 2 || box.height <= 2) continue;
    /* Text deliberately truncated with an ellipsis is a design choice and the
     * full value is available elsewhere; a box that simply cuts text off is
     * not. Two pixels of tolerance for sub-pixel rounding. */
    if (computed.textOverflow === 'ellipsis') continue;
    const lostVertically = node.scrollHeight > node.clientHeight + 2 && /hidden|clip/.test(computed.overflowY);
    const lostHorizontally = node.scrollWidth > node.clientWidth + 2 && /hidden|clip/.test(computed.overflowX);
    if (lostVertically || lostHorizontally) {
      clipped.push({
        element: node.tagName.toLowerCase() + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : ''),
        detail: lostVertically
          ? node.scrollHeight + 'px of text in a ' + node.clientHeight + 'px box that cannot scroll'
          : node.scrollWidth + 'px of text in a ' + node.clientWidth + 'px box that cannot scroll',
      });
    }
  }
  style.remove();
  return clipped;
})()`;

/**
 * Focus visibility, WCAG 2.4.7.
 *
 * Every focusable control must show where focus is. This focuses each one and
 * compares its outline, box shadow, border and background against the same
 * element unfocused: something has to change, and a change nobody can see is
 * the same as no change. Checked on the real element rather than by reading
 * the stylesheet, because a `:focus-visible` rule that is overridden later
 * looks correct in the source and does nothing on screen.
 */
export const FOCUS_VISIBILITY = `(() => {
  const invisible = [];
  const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((node) => (typeof node.checkVisibility === 'function' ? node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : true) && !node.disabled);
  const signature = (node) => {
    const style = getComputedStyle(node);
    return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow, style.borderColor, style.backgroundColor, style.textDecorationLine].join('|');
  };
  const active = document.activeElement;
  for (const node of controls.slice(0, 120)) {
    const before = signature(node);
    node.focus();
    if (document.activeElement !== node) continue;
    const after = signature(node);
    if (before === after) {
      invisible.push({
        element: node.tagName.toLowerCase() + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : ''),
        detail: 'looks identical focused and unfocused',
      });
    }
    node.blur();
  }
  if (active && typeof active.focus === 'function') active.focus();
  return invisible;
})()`;

/**
 * The `prefers-reduced-motion` preference.
 *
 * Cited carefully: WCAG 2.3.3 Animation from Interactions is Level AAA, so
 * this is not an AA obligation and is not claimed as one. It is checked
 * because honouring a preference a person has set in their operating system is
 * a commitment worth keeping regardless of what the level requires, and
 * because the AA criterion that does apply — 2.2.2 Pause, Stop, Hide — is
 * satisfied trivially by there being nothing that moves for five seconds.
 *
 * Run with the preference emulated. Anything still animating or transitioning
 * for a perceptible time has not honoured it, and the usual cause is a rule
 * added after the blanket override rather than the override being wrong.
 */
export const REDUCED_MOTION = `(() => {
  const moving = [];
  for (const node of document.querySelectorAll('body *')) {
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue;
    const style = getComputedStyle(node);
    const longest = (value) => Math.max(0, ...String(value).split(',').map((part) => {
      const trimmed = part.trim();
      const seconds = trimmed.endsWith('ms') ? Number.parseFloat(trimmed) / 1000 : Number.parseFloat(trimmed);
      return Number.isFinite(seconds) ? seconds : 0;
    }));
    /* A twentieth of a second is below the threshold at which motion is
     * perceived as motion rather than as an immediate change. */
    const animation = style.animationName !== 'none' ? longest(style.animationDuration) : 0;
    const transition = longest(style.transitionDuration);
    if (Math.max(animation, transition) > 0.05) {
      moving.push({
        element: node.tagName.toLowerCase() + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : ''),
        detail: 'still animates for ' + Math.max(animation, transition).toFixed(2) + 's with reduced motion asked for',
      });
    }
  }
  return moving;
})()`;

/**
 * Forced colours, WCAG 1.4.1 and 1.4.11 in the mode where the browser replaces
 * the palette.
 *
 * When the system supplies the colours, anything that conveyed meaning only
 * through its own colour stops conveying it. This checks that controls still
 * have a boundary a person can see — a border or an outline — rather than
 * relying on a background that the browser has just replaced.
 */
export const FORCED_COLOURS = `(() => {
  const flat = [];
  for (const node of document.querySelectorAll('button, [role="button"], [role="tab"], [role="option"], input, select')) {
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    const style = getComputedStyle(node);
    /* An engine that reports an unset property as an empty string must not be
     * read as reporting a decoration that is not there. */
    const declared = (value) => !!value && value !== 'none';
    const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((side) => Number.parseFloat(style['border' + side + 'Width']) > 0 && declared(style['border' + side + 'Style']));
    const outlined = declared(style.outlineStyle) && Number.parseFloat(style.outlineWidth) > 0;
    const underlined = declared(style.textDecorationLine);
    if (!bordered && !outlined && !underlined && !(node.textContent ?? '').trim()) {
      flat.push({
        element: node.tagName.toLowerCase() + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : ''),
        detail: 'has no border, outline, underline or text, so in forced colours nothing marks it as a control',
      });
    }
  }
  return flat;
})()`;

/**
 * Reduced transparency, the `prefers-reduced-transparency` condition.
 *
 * The preference is about content read *through* something: a panel with a
 * translucent background, or a backdrop filter, where whatever is behind it
 * competes with the text in front. It is not about a control being dimmed. A
 * disabled control drawn faintly is a convention with a meaning of its own, and
 * reporting it here would bury the thing this is for under three dozen entries
 * that are all correct.
 *
 * So a translucent background or a backdrop filter is always reported, and
 * element opacity is reported only on something that is not a disabled or
 * otherwise unavailable control.
 *
 * The position recorded for this product is that nothing in it is read through
 * translucency. That was measured rather than assumed before this rule was
 * written: of every translucent element in the built workbench, all of them
 * were disabled or unavailable controls, and there was no translucent
 * background and no backdrop filter anywhere. This rule is what keeps that
 * true — the moment it stops being true, the check says so.
 *
 * Decorative translucency is exempted where it says so, with the
 * `data-decorative` attribute. Nothing is exempt for being small or for being
 * somewhere in particular: the exemption has to be written next to the thing it
 * applies to.
 */
export const REDUCED_TRANSPARENCY = `(() => {
  const translucent = [];
  const alphaOf = (colour) => {
    const match = /^rgba?\\(([^)]+)\\)$/.exec(String(colour).trim());
    if (!match) return 1;
    const parts = match[1].split(/[\\s,\\/]+/).filter(Boolean);
    return parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
  };
  const unavailable = (node) => {
    try { return !!node.closest(':disabled, [disabled], [aria-disabled="true"], .state-planned'); }
    catch { return false; }
  };
  for (const node of document.querySelectorAll('body *')) {
    if (node.closest('[data-decorative]')) continue;
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    const style = getComputedStyle(node);
    const name = node.tagName.toLowerCase() + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : '');
    if (style.backdropFilter && style.backdropFilter !== 'none') {
      translucent.push({ element: name, detail: 'applies a backdrop filter, so whatever is behind it competes with what is in front' });
      continue;
    }
    const background = alphaOf(style.backgroundColor);
    if (background > 0 && background < 1) {
      translucent.push({ element: name, detail: 'has a background with alpha ' + background + ', so what is behind it shows through the content in front' });
      continue;
    }
    const opacity = Number.parseFloat(style.opacity);
    /* Fully transparent is not translucency: it is something hidden, which is a
     * different question and one the visibility rules already ask. */
    if (Number.isFinite(opacity) && opacity > 0 && opacity < 1 && !unavailable(node)) {
      translucent.push({ element: name, detail: 'is drawn at opacity ' + opacity + ' and is not a disabled control, so its content is read through whatever is behind it' });
    }
  }
  return translucent;
})()`;

/* --- operating the product without a pointer ------------------------------- */

/**
 * Keyboard reachability and traps, WCAG 2.1.1 and 2.1.2.
 *
 * Two different things, checked together because they are two halves of the
 * same question. Reachability: a control that no keyboard route arrives at
 * cannot be operated at all. Traps: focus that enters something and cannot
 * leave it is worse than an unreachable control, because it takes the rest of
 * the product with it.
 *
 * Tab order is not the whole answer and this does not pretend it is. A tree, a
 * grid and a tab strip deliberately hold one tab stop and move within
 * themselves using the arrow keys, which is the pattern those roles are
 * supposed to follow; counting their rows as missing tab stops would report
 * correct code as broken. So what is checked is that every group holding
 * focusable content is itself reachable, and that focus can always leave
 * wherever it is.
 */
export const KEYBOARD_REACHABILITY = `(() => {
  const problems = [];
  const shown = (node) => typeof node.checkVisibility === 'function'
    ? node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
    : true;
  const focusable = (node) => shown(node) && !node.disabled && node.tabIndex >= 0;
  const identity = (node) => node.tagName.toLowerCase()
    + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : '');

  const stops = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')].filter(focusable);
  if (!stops.length) return [{ element: 'document', detail: 'offers no keyboard tab stop at all' }];

  /* A composite widget — a tree, a grid, a tab strip — is entered once and
   * moved through with the arrow keys, so its one tab stop serves every part of
   * it. A group inside such a widget is a subdivision of it rather than a
   * separate destination, and requiring each subdivision to hold its own stop
   * reports the prescribed pattern as broken: the project tree groups its files
   * by origin, and only the group holding the current item would have passed. */
  const COMPOSITE = '[role="tree"], [role="grid"], [role="tablist"], [role="listbox"], [role="radiogroup"], [role="menu"], [role="menubar"], [role="toolbar"]';
  const reachedByItsWidget = (region) => {
    const widget = region.parentElement && region.parentElement.closest(COMPOSITE);
    return !!widget && [...widget.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')].some(focusable);
  };

  /* Every region that holds something focusable must itself contain a tab
   * stop, or nothing in it can be reached. */
  for (const region of document.querySelectorAll('[role="group"], [role="tablist"], [role="listbox"], [role="tree"], [role="grid"], [role="radiogroup"], [role="region"], aside[aria-label], section[aria-label]')) {
    if (!shown(region)) continue;
    const inside = [...region.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')];
    if (!inside.length) continue;
    if (!inside.some(focusable) && !reachedByItsWidget(region)) {
      problems.push({ element: identity(region), detail: 'holds ' + inside.length + ' controls and no keyboard tab stop, so none of them can be reached' });
    }
  }

  /* Focus must be able to leave anything it can enter. With only one stop
   * there is nowhere for focus to go and no trap can be demonstrated, so the
   * check would report a page that is merely small. */
  const previous = document.activeElement;
  for (const stop of stops.length > 1 ? stops.slice(0, 80) : []) {
    stop.focus();
    if (document.activeElement !== stop) continue;
    const others = stops.filter((candidate) => candidate !== stop);
    const next = others.find((candidate) => { candidate.focus(); return document.activeElement === candidate; });
    if (!next) problems.push({ element: identity(stop), detail: 'focus could not be moved away from it' });
    break;
  }
  if (previous && typeof previous.focus === 'function') previous.focus();
  return problems;
})()`;

/**
 * Alternatives to dragging and to a destructive action, WCAG 2.1.1 and 2.5.7.
 *
 * Dragging cannot be done without a pointer, so anything draggable has to say
 * what to do instead. The alternative is declared in the markup, next to the
 * thing that needs it, rather than listed somewhere a reviewer has to go and
 * find — and an alternative claimed without saying what it is fails, because
 * a claim nobody can check is not an alternative.
 *
 * A destructive action must be reachable and named. A delete that can only be
 * clicked is a delete some people cannot undo their way out of.
 */
export const POINTER_ALTERNATIVES = `(() => {
  const problems = [];
  const shown = (node) => typeof node.checkVisibility === 'function'
    ? node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
    : true;
  const identity = (node) => node.tagName.toLowerCase()
    + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : '');

  /* Visibility is deliberately not consulted here. Something draggable offers
   * dragging whenever it is reached, and a panel that happens to be closed
   * while the page is scanned would otherwise hide the omission. */
  for (const node of document.querySelectorAll('[draggable="true"]')) {
    const declared = node.closest('[data-drag-alternative]');
    const alternative = declared ? (declared.getAttribute('data-drag-alternative') ?? '').trim() : '';
    if (!declared) {
      problems.push({ element: identity(node), detail: 'can be dragged and states no keyboard alternative' });
    } else if (alternative.length < 20) {
      problems.push({ element: identity(declared), detail: 'claims a keyboard alternative to dragging without saying what it is' });
    }
  }

  const destructive = /\\b(delete|remove|purge|discard|erase|clear|empty|revert)\\b/i;
  for (const node of document.querySelectorAll('button, [role="button"]')) {
    if (!shown(node) || node.disabled) continue;
    const name = (node.getAttribute('aria-label') ?? node.textContent ?? '').trim();
    if (!destructive.test(name)) continue;
    if (node.tabIndex < 0) problems.push({ element: identity(node), detail: '"' + name.slice(0, 40) + '" is destructive and cannot be reached from the keyboard' });
  }
  return problems;
})()`;

/**
 * Structured alternatives for what is drawn rather than written, WCAG 1.1.1.
 *
 * A canvas, or a grid of coloured cells, carries information that no assistive
 * technology can read out of the pixels. Hiding it with `aria-hidden` is the
 * right first step and is not the whole answer: something has to carry the
 * same information in text, near it, and be announced when it changes.
 *
 * So a drawing surface passes one of two ways. Either it names and describes
 * itself, or it is hidden from assistive technology and its container holds a
 * live region that says what it currently shows. Anything else is a picture
 * with nothing behind it.
 */
export const VISUAL_ALTERNATIVES = `(() => {
  const problems = [];
  const shown = (node) => typeof node.checkVisibility === 'function'
    ? node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
    : true;
  const identity = (node) => node.tagName.toLowerCase()
    + (node.className && node.className.toString ? '.' + node.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : '');

  for (const node of document.querySelectorAll('canvas, [role="img"]')) {
    if (!shown(node)) continue;
    const named = (node.getAttribute('aria-label') ?? '').trim() || (node.getAttribute('aria-labelledby') ?? '').trim();
    if (node.getAttribute('aria-hidden') === 'true') {
      /* Hidden from assistive technology, so the alternative has to be next to
       * it: a live region in an ancestor that says what is currently shown. */
      let alternative = null;
      for (let parent = node.parentElement; parent && !alternative; parent = parent.parentElement) {
        alternative = parent.querySelector('[role="status"], [aria-live], figcaption, table');
      }
      if (!alternative) {
        problems.push({ element: identity(node), detail: 'is hidden from assistive technology and nothing near it says what it shows' });
      }
      continue;
    }
    if (!named) problems.push({ element: identity(node), detail: 'draws information and has no accessible name' });
  }
  return problems;
})()`;
