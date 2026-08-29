// @vitest-environment jsdom

/* The rules run in a browser, so these drive them against a real DOM built in
 * jsdom. The release gate runs the same expression against the built product,
 * so the two cannot disagree about what a finding is. */
import { describe, expect, it, beforeEach } from 'vitest';
import { COVERAGE, FOCUS_VISIBILITY, FORCED_COLOURS, KEYBOARD_REACHABILITY, MINIMUM_TARGET, POINTER_ALTERNATIVES, REDUCED_MOTION, REDUCED_TRANSPARENCY, SCAN, TEXT_SPACING, VISUAL_ALTERNATIVES, summarise } from './accessibilityRules.mjs';

/* jsdom has no layout, so the geometry rules need boxes supplied. */
function withBox(element: Element, box: { width: number; height: number; left?: number; top?: number }) {
  const left = box.left ?? 0;
  const top = box.top ?? 0;
  element.getBoundingClientRect = () => ({
    width: box.width, height: box.height, left, top,
    right: left + box.width, bottom: top + box.height, x: left, y: top, toJSON: () => ({}),
  }) as DOMRect;
}

const scan = () => (0, eval)(SCAN) as Array<{ rule: string; criterion: string; element: string; detail: string }>;
const rules = () => scan().map((finding) => finding.rule);

beforeEach(() => {
  document.documentElement.setAttribute('lang', 'en-GB');
  document.title = 'Workbench';
  document.body.innerHTML = '';
  document.elementFromPoint = () => null;
});

describe('what the scan says it covers', () => {
  it('names what it checks and what it deliberately leaves to a person', () => {
    /* An automated scan that implied full coverage would be worse than none,
     * because the manual audit is where the harder half lives. */
    expect(COVERAGE.automated.length).toBeGreaterThanOrEqual(6);
    expect(COVERAGE.manual.length).toBeGreaterThanOrEqual(4);
    for (const entry of [...COVERAGE.automated, ...COVERAGE.manual]) expect(entry.trim().length).toBeGreaterThan(20);
    expect(COVERAGE.automated.join(' ')).toMatch(/WCAG/);
  });
});

describe('names', () => {
  it('finds a control with no accessible name and accepts every way of giving one', () => {
    document.body.innerHTML = `
      <button></button>
      <button aria-label="Run"></button>
      <button>Build</button>
      <button title="Stop"></button>
      <label for="a">Speed</label><input id="a">
      <label>Volume<input></label>
      <span id="lbl">Reset</span><button aria-labelledby="lbl"></button>`;
    expect(rules().filter((rule) => rule === 'control-name')).toHaveLength(1);
  });

  it('finds an image with no alternative, and accepts one marked presentational', () => {
    document.body.innerHTML = '<img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="A sprite"><img src="d.png" role="presentation">';
    expect(rules().filter((rule) => rule === 'image-alt')).toHaveLength(1);
  });
});

describe('structure', () => {
  it('finds a duplicated identifier once, not twice', () => {
    document.body.innerHTML = '<div id="same"></div><div id="same"></div><div id="other"></div>';
    expect(rules().filter((rule) => rule === 'duplicate-id')).toHaveLength(1);
  });

  it('finds a heading level that skips, and accepts one that does not', () => {
    document.body.innerHTML = '<h1>A</h1><h4>B</h4>';
    expect(rules()).toContain('heading-order');
    document.body.innerHTML = '<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>';
    expect(rules()).not.toContain('heading-order');
  });

  it('finds two landmarks a screen reader could not tell apart', () => {
    document.body.innerHTML = '<aside aria-label="Outline"></aside><aside aria-label="Outline"></aside><aside aria-label="Bookmarks"></aside>';
    expect(rules().filter((rule) => rule === 'landmark-label')).toHaveLength(1);
  });

  it('reports a document with no language or title', () => {
    document.documentElement.removeAttribute('lang');
    document.title = '';
    expect(rules()).toEqual(expect.arrayContaining(['document-language', 'document-title']));
  });
});

describe('the essential exception for target size', () => {
  it('accepts a small target inside a grid that says why, and reports one that does not', () => {
    document.body.innerHTML = `
      <div id="declared" data-essential-target-size="A cell in this grid is one pixel of the artwork, so enlarging it would change what the editor edits.">
        <button id="cell">1</button>
      </div>
      <div id="bare" data-essential-target-size="because">
        <button id="other">2</button>
      </div>`;
    withBox(document.getElementById('cell')!, { width: 16, height: 16, left: 10, top: 10 });
    withBox(document.getElementById('other')!, { width: 16, height: 16, left: 100, top: 10 });
    document.elementFromPoint = (x: number) => (x < 50 ? document.getElementById('cell') : document.getElementById('other'));

    const findings = scan();
    /* The declared grid is exempt; the one claiming the exception without a
     * reason is reported, because an unexplained exemption is not one. */
    expect(findings.filter((finding) => finding.rule === 'target-size')).toHaveLength(0);
    expect(findings.filter((finding) => finding.rule === 'essential-exemption')).toHaveLength(1);
  });

  it('reports an ordinary control below the minimum, and accepts one at it', () => {
    document.body.innerHTML = '<button id="small">a</button><button id="fine">b</button>';
    withBox(document.getElementById('small')!, { width: MINIMUM_TARGET - 1, height: MINIMUM_TARGET, left: 0, top: 0 });
    withBox(document.getElementById('fine')!, { width: MINIMUM_TARGET, height: MINIMUM_TARGET, left: 100, top: 0 });
    document.elementFromPoint = (x: number) => (x < 50 ? document.getElementById('small') : document.getElementById('fine'));
    expect(scan().filter((finding) => finding.rule === 'target-size')).toHaveLength(1);
  });

  it('says nothing about something that cannot be hit at its own centre', () => {
    /* A file input clipped to a pixel behind a visible button is not a pointer
     * target, and the visible button is measured on its own turn. */
    document.body.innerHTML = '<label>Choose<input id="hidden" type="file"></label>';
    withBox(document.getElementById('hidden')!, { width: 1, height: 1, left: 5, top: 5 });
    document.elementFromPoint = () => document.querySelector('label');
    expect(scan().filter((finding) => finding.rule === 'target-size')).toHaveLength(0);
  });
});

describe('reporting', () => {
  it('groups by rule, leads with the largest, and names the criterion', () => {
    const lines = summarise([
      { rule: 'contrast', criterion: '1.4.3', element: 'span', detail: 'a' },
      { rule: 'contrast', criterion: '1.4.3', element: 'div', detail: 'b' },
      { rule: 'control-name', criterion: '4.1.2', element: 'button', detail: 'c' },
    ]);
    expect(lines[0]).toContain('contrast (WCAG 1.4.3) x2');
    expect(lines[1]).toContain('control-name (WCAG 4.1.2) x1');
  });
});

describe('the conditions a person can turn on', () => {
  /* jsdom applies no layout, so these drive the rules with the geometry and
   * computed styles supplied. What is being checked is the decision each rule
   * makes, not the browser's layout, which the release gate exercises. */
  const run = (expression: string) => (0, eval)(expression) as Array<{ element: string; detail: string }>;

  it('reports text a fixed box cuts off, and ignores a container whose children scroll', () => {
    document.body.innerHTML = '<div id="clipped">Some text</div><div id="container"><span>child</span></div>';
    const clipped = document.getElementById('clipped')!;
    const container = document.getElementById('container')!;
    for (const node of [clipped, container]) withBox(node, { width: 100, height: 20 });
    Object.defineProperty(clipped, 'scrollHeight', { value: 60, configurable: true });
    Object.defineProperty(clipped, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 60, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 20, configurable: true });
    clipped.style.overflowY = 'hidden';
    container.style.overflowY = 'hidden';

    const findings = run(TEXT_SPACING);
    /* The container has no text of its own; its child would report it. */
    expect(findings.map((finding) => finding.element)).toEqual(['div']);
    expect(findings[0]!.detail).toContain('cannot scroll');
  });

  it('ignores something clipped to a pixel for a screen reader', () => {
    document.body.innerHTML = '<span class="visually-hidden">Machine volume</span>';
    const node = document.querySelector('span')!;
    withBox(node, { width: 1, height: 1 });
    Object.defineProperty(node, 'scrollHeight', { value: 20, configurable: true });
    Object.defineProperty(node, 'clientHeight', { value: 1, configurable: true });
    node.style.overflowY = 'hidden';
    expect(run(TEXT_SPACING)).toEqual([]);
  });

  it('reports a control that looks identical focused and unfocused', () => {
    document.body.innerHTML = '<button id="flat">One</button>';
    expect(run(FOCUS_VISIBILITY).map((finding) => finding.element)).toEqual(['button']);
  });

  it('reports something still animating when reduced motion was asked for', () => {
    document.body.innerHTML = '<div id="spinner">x</div><div id="still">y</div>';
    const spinner = document.getElementById('spinner')!;
    spinner.style.animationName = 'spin';
    spinner.style.animationDuration = '800ms';
    const findings = run(REDUCED_MOTION);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('0.80s');
  });

  it('accepts a transition too short to be seen as motion', () => {
    document.body.innerHTML = '<div id="quick">x</div>';
    document.getElementById('quick')!.style.transitionDuration = '10ms';
    expect(run(REDUCED_MOTION)).toEqual([]);
  });

  it('reports an icon-only control with nothing marking it as one in forced colours', () => {
    /* jsdom's own stylesheet gives a button a border the product's reset
     * removes, so the case being stated has to remove it explicitly. */
    document.body.innerHTML = '<button id="icon"><svg></svg></button><button id="named">Run</button><button id="bordered"><svg></svg></button>';
    for (const id of ['icon', 'named', 'bordered']) {
      const node = document.getElementById(id)!;
      withBox(node, { width: 24, height: 24 });
      node.style.borderStyle = 'none';
      node.style.borderWidth = '0';
    }
    document.getElementById('bordered')!.style.borderStyle = 'solid';
    document.getElementById('bordered')!.style.borderWidth = '1px';
    const findings = run(FORCED_COLOURS);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('nothing marks it as a control');
  });
});

describe('operating the product without a pointer', () => {
  const run = (expression: string) => (0, eval)(expression) as Array<{ element: string; detail: string }>;

  it('reports a group whose controls no keyboard route reaches', () => {
    document.body.innerHTML = `
      <div role="group" aria-label="Reachable"><button>One</button></div>
      <div role="group" aria-label="Unreachable"><button tabindex="-1">Two</button><button tabindex="-1">Three</button></div>`;
    const findings = run(KEYBOARD_REACHABILITY);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('2 controls and no keyboard tab stop');
  });

  it('accepts a roving tab stop, which is what a tree or a grid is meant to have', () => {
    /* Counting a tree's rows as missing tab stops would report correct code as
     * broken: one stop and arrow keys is the pattern the role prescribes. */
    document.body.innerHTML = `
      <div role="tree" aria-label="Files">
        <button tabindex="0">main.asm</button>
        <button tabindex="-1">lib.asm</button>
        <button tabindex="-1">notes.txt</button>
      </div>`;
    expect(run(KEYBOARD_REACHABILITY)).toEqual([]);
  });

  it('says so when a page offers no tab stop at all', () => {
    document.body.innerHTML = '<p>Nothing to operate</p>';
    expect(run(KEYBOARD_REACHABILITY)[0]!.detail).toContain('no keyboard tab stop at all');
  });

  it('requires anything draggable to say what to do instead', () => {
    document.body.innerHTML = '<div draggable="true">Drag me</div>';
    const findings = run(POINTER_ALTERNATIVES);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('states no keyboard alternative');
  });

  it('refuses an alternative that is claimed without being stated', () => {
    /* A claim nobody can check is not an alternative. */
    document.body.innerHTML = '<div data-drag-alternative="use keys"><div draggable="true">x</div></div>';
    expect(run(POINTER_ALTERNATIVES)[0]!.detail).toContain('without saying what it is');
  });

  it('accepts a stated alternative', () => {
    document.body.innerHTML = '<div data-drag-alternative="Hold Alt and press the up or down arrow to move the focused file past its neighbour."><div draggable="true">x</div></div>';
    expect(run(POINTER_ALTERNATIVES)).toEqual([]);
  });

  it('reports a destructive action the keyboard cannot reach', () => {
    document.body.innerHTML = '<button tabindex="-1">Delete project</button><button>Empty trash</button><button tabindex="-1">Open</button>';
    const findings = run(POINTER_ALTERNATIVES);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('destructive and cannot be reached');
  });
});

describe('what is drawn rather than written', () => {
  const run = (expression: string) => (0, eval)(expression) as Array<{ element: string; detail: string }>;

  it('accepts a drawing surface that names and describes itself', () => {
    document.body.innerHTML = '<canvas aria-label="Screen preview, 320 by 256"></canvas>';
    expect(run(VISUAL_ALTERNATIVES)).toEqual([]);
  });

  it('accepts one hidden from assistive technology with a live region beside it', () => {
    /* Hiding the pixels is the right first step and is not the whole answer:
     * something has to carry the same information in text. */
    document.body.innerHTML = '<div><canvas aria-hidden="true"></canvas><p role="status">Pixel 1, 1 is logical colour 0.</p></div>';
    expect(run(VISUAL_ALTERNATIVES)).toEqual([]);
  });

  it('reports one hidden with nothing near it saying what it shows', () => {
    document.body.innerHTML = '<div><canvas aria-hidden="true"></canvas></div>';
    expect(run(VISUAL_ALTERNATIVES)[0]!.detail).toContain('nothing near it says what it shows');
  });

  it('reports one that is neither named nor hidden, which is a picture with nothing behind it', () => {
    document.body.innerHTML = '<canvas></canvas>';
    expect(run(VISUAL_ALTERNATIVES)[0]!.detail).toContain('no accessible name');
  });

  it('accepts a figure caption or a table as the alternative', () => {
    document.body.innerHTML = '<figure><canvas aria-hidden="true"></canvas><figcaption>Waveform, 8 rows</figcaption></figure>';
    expect(run(VISUAL_ALTERNATIVES)).toEqual([]);
    document.body.innerHTML = '<div><canvas aria-hidden="true"></canvas><table><tr><td>0</td></tr></table></div>';
    expect(run(VISUAL_ALTERNATIVES)).toEqual([]);
  });

  it('holds an element with the image role to the same rule', () => {
    document.body.innerHTML = '<div role="img"></div>';
    expect(run(VISUAL_ALTERNATIVES)).toHaveLength(1);
    document.body.innerHTML = '<div role="img" aria-label="Memory map"></div>';
    expect(run(VISUAL_ALTERNATIVES)).toEqual([]);
  });
});

describe('translucency, when somebody has asked for less of it', () => {
  const run = () => (0, eval)(REDUCED_TRANSPARENCY) as Array<{ element: string; detail: string }>;

  const place = (html: string) => {
    document.body.innerHTML = html;
    for (const node of document.body.querySelectorAll('*')) withBox(node, { width: 100, height: 40 });
  };

  it('says nothing about a page that is not translucent anywhere', () => {
    /* The state this product claims to be in. The claim is only worth
     * something because the same rule would report it if it changed. */
    place('<div style="opacity: 1; background-color: rgb(20, 20, 20)"><p>Ordinary</p></div>');
    expect(run()).toEqual([]);
  });

  it('reports an element drawn at partial opacity', () => {
    place('<div class="scrim" style="opacity: 0.6"><p>Behind this</p></div>');
    const findings = run();
    expect(findings.some((finding) => finding.detail.includes('opacity 0.6'))).toBe(true);
  });

  it('leaves a dimmed disabled control alone, because that is a different convention', () => {
    /* A control drawn faintly because it cannot be used means something on its
     * own, and it is not content read through translucency. Reporting the whole
     * of that convention here would bury what this rule is actually for. */
    place('<button disabled style="opacity: 0.35">Mount</button><label class="state-planned" style="opacity: 0.55"><span style="opacity: 0.55">Planned</span></label>');
    expect(run()).toEqual([]);
  });

  it('still reports a translucent background on a disabled control, because that is content read through', () => {
    place('<button disabled style="background-color: rgba(0, 0, 0, 0.3)">Mount</button>');
    expect(run().some((finding) => finding.detail.includes('alpha 0.3'))).toBe(true);
  });

  it('reports a background colour with an alpha channel', () => {
    place('<div class="veil" style="background-color: rgba(10, 20, 30, 0.5)"><p>Behind this</p></div>');
    expect(run().some((finding) => finding.detail.includes('alpha 0.5'))).toBe(true);
  });

  it('reports a backdrop filter, which only does anything through translucency', () => {
    /* jsdom implements no layout and does not carry this property at all, so
     * it is supplied here the same way the boxes are. The rule reads the same
     * computed property in the release gate, where a real engine reports it. */
    place('<div class="frosted"><p>Behind this</p></div>');
    const frosted = document.querySelector('.frosted')!;
    const real = window.getComputedStyle.bind(window);
    window.getComputedStyle = ((node: Element, pseudo?: string | null) => {
      const style = real(node, pseudo ?? undefined);
      return node === frosted ? new Proxy(style, { get: (target, key) => key === 'backdropFilter' ? 'blur(4px)' : Reflect.get(target, key) }) : style;
    }) as typeof window.getComputedStyle;
    try {
      expect(run().some((finding) => finding.detail.includes('backdrop filter'))).toBe(true);
    } finally {
      window.getComputedStyle = real;
    }
  });

  it('leaves alone something declared decorative, and everything inside it', () => {
    /* The exemption has to be written next to the thing it applies to, so a
     * shadow can say what it is rather than being argued about every time. */
    place('<div data-decorative style="opacity: 0.4"><span style="opacity: 0.4">Shadow</span></div>');
    expect(run()).toEqual([]);
  });

  it('does not treat something fully transparent as translucency', () => {
    /* Nothing shows through something that is not drawn at all, and whether it
     * should be there is a question the visibility rules already ask. */
    place('<div style="opacity: 0"><p>Hidden</p></div>');
    expect(run()).toEqual([]);
  });
});
