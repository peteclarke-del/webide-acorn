/*
 * What the workbench actually does in each browser, measured rather than
 * claimed.
 *
 * The release gate has always driven one browser. That proves the build works
 * in Chromium and says nothing about the others, which matters here because the
 * product already knows it behaves differently in them — the folder importer
 * offers a writable handle where the File System Access API exists and a
 * one-way import where it does not, and that is a real difference a person
 * meets on their first day.
 *
 * So the same two probes run in every browser the gate can start, and the
 * answers are compared. One probe asks whether the workbench rendered at all;
 * the other asks which platform capabilities the browser provides. The first is
 * a requirement — a browser where the workbench does not render is a failure —
 * and the second is a record, because a capability one browser lacks is a fact
 * about the web rather than a defect in this build.
 *
 * Safari is not measured. It does not run on this platform and nothing here
 * substitutes another engine for it, because reporting Chromium's answers under
 * Safari's name is exactly the kind of claim this product refuses to make.
 */

/**
 * Evaluated in the page once it has loaded. Returns JSON, because WebDriver and
 * the Chrome DevTools Protocol disagree about how structured values come back
 * and a string comes back the same way through both.
 */
export const PAGE_PROBE = `(() => {
  const root = document.getElementById('root');
  const capability = {
    /* The folder importer offers a writable handle only where this exists. */
    fileSystemAccess: typeof window.showDirectoryPicker === 'function',
    webgl: (() => { try { return Boolean(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')); } catch { return false; } })(),
    /* Why, when there is none. A browser that refuses a GL context says so on
     * the canvas as a webglcontextcreationerror, and that sentence is the only
     * thing that distinguishes a blocklisted driver from an absent library
     * from a preference somebody turned off. Guessing between those cost three
     * runs of the gate. */
    webglRefusal: (() => {
      try {
        const canvas = document.createElement('canvas');
        let reason = '';
        canvas.addEventListener('webglcontextcreationerror', (event) => { reason = String(event.statusMessage || '').slice(0, 200); });
        if (canvas.getContext('webgl2') || canvas.getContext('webgl')) return '';
        return reason || 'no context and no reason given';
      } catch (error) { return String(error && error.message ? error.message : error).slice(0, 200); }
    })(),
    webgpu: 'gpu' in navigator,
    audioContext: typeof window.AudioContext === 'function',
    workers: typeof window.Worker === 'function',
    serviceWorker: 'serviceWorker' in navigator,
    indexedDB: 'indexedDB' in window,
    storageEstimate: Boolean(navigator.storage && navigator.storage.estimate),
    webAssembly: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
    clipboardWrite: Boolean(navigator.clipboard && navigator.clipboard.writeText),
    offscreenCanvas: typeof window.OffscreenCanvas === 'function',
    broadcastChannel: typeof window.BroadcastChannel === 'function',
    structuredClone: typeof window.structuredClone === 'function',
  };
  const collected = window.__ciCollected ?? { errors: [], rejections: [], violations: [] };
  return JSON.stringify({
    title: document.title,
    /* The count is what the workbench rendered, so a build that loaded its
       document and then threw is not mistaken for one that worked. */
    controls: document.querySelectorAll('button, [role="button"], a[href], input, select, textarea').length,
    landmarks: document.querySelectorAll('[role], main, nav, header, footer, aside, section').length,
    rootChildren: root ? root.childElementCount : -1,
    errors: collected.errors.slice(0, 8),
    rejections: collected.rejections.slice(0, 8),
    violations: collected.violations.slice(0, 8),
    capability,
  });
})()`;

/**
 * Loaded before the application's own script, from the same origin so that the
 * shipped policy — which forbids inline script — permits it.
 *
 * An error thrown while the application starts leaves an empty document and
 * nothing else to see. Collecting from before it runs is the difference between
 * reporting the cause and reporting the symptom.
 */
export const COLLECTOR_SOURCE = `(() => {
  const collected = { errors: [], rejections: [], violations: [] };
  window.__ciCollected = collected;
  window.addEventListener('error', (event) => {
    collected.errors.push(String(event.message ?? event.error ?? 'error') + (event.filename ? ' at ' + event.filename + ':' + event.lineno : ''));
  });
  window.addEventListener('unhandledrejection', (event) => {
    collected.rejections.push(String(event.reason && event.reason.message ? event.reason.message : event.reason));
  });
  document.addEventListener('securitypolicyviolation', (event) => {
    collected.violations.push(event.violatedDirective + ' blocked ' + (event.blockedURI || 'inline'));
  });
})();`;

/** The lowest counts a rendered workbench produces; below these it did not run. */
export const MINIMUM_CONTROLS = 40;
export const MINIMUM_LANDMARKS = 6;

/**
 * What must hold in every browser, as findings rather than exceptions, so one
 * browser failing does not hide what the others reported.
 *
 * @param {{ browser: string, version: string, page: any }[]} results
 */
export function matrixFindings(results) {
  const findings = [];
  if (!results.length) return ['No browser was measured, so this stage checked nothing.'];
  for (const { browser, page } of results) {
    if (!page) { findings.push(`${browser} produced no answer at all.`); continue; }
    if (page.rootChildren <= 0) findings.push(`${browser} loaded the document but the workbench did not mount into it.`);
    if (page.controls < MINIMUM_CONTROLS) findings.push(`${browser} rendered ${page.controls} controls, fewer than the ${MINIMUM_CONTROLS} a started workbench has, so it did not finish starting.`);
    if (page.landmarks < MINIMUM_LANDMARKS) findings.push(`${browser} rendered ${page.landmarks} landmarks, fewer than the ${MINIMUM_LANDMARKS} the workbench structure has.`);
    for (const error of page.errors ?? []) findings.push(`${browser} reported an uncaught error: ${error}`);
    for (const rejection of page.rejections ?? []) findings.push(`${browser} reported an unhandled rejection: ${rejection}`);
    for (const violation of page.violations ?? []) findings.push(`${browser} reported a content security policy violation: ${violation}`);
    /* A capability the whole product rests on is a requirement rather than a
     * record. Without these the workbench cannot do its job at all, so a
     * browser missing one is not a browser this product supports. */
    for (const required of ['webAssembly', 'workers', 'indexedDB', 'webgl', 'structuredClone']) {
      if (!page.capability?.[required]) {
        const why = required === 'webgl' && page.capability?.webglRefusal ? ` It said: ${page.capability.webglRefusal}` : '';
        findings.push(`${browser} does not provide ${required}, which this product cannot work without.${why}`);
      }
    }
  }
  return findings;
}

/** Capabilities that are recorded rather than required, and what each is for. */
export const OPTIONAL_CAPABILITIES = Object.freeze({
  fileSystemAccess: 'Opening a folder the project can be written back to. Without it the folder importer is one-way and the project saves as a download.',
  webgpu: 'Not used by this build. Recorded because a future renderer might, and because its absence is otherwise invisible.',
  audioContext: 'Emulated sound. Without it a machine runs silently and says so.',
  serviceWorker: 'Serving firmware from the local vault to the emulator frame. Without it the ROM path does not work.',
  storageEstimate: 'Reporting how much of the browser quota the projects and firmware use.',
  clipboardWrite: 'Copying a listing, a disassembly or a report out of the workbench.',
  offscreenCanvas: 'Rendering an asset preview off the main thread.',
  broadcastChannel: 'Telling other tabs of the same workbench that storage changed.',
});

/** One line per browser for the gate, naming what each does not have. */
export function matrixSummary(results) {
  return results.map(({ browser, version, page }) => {
    const missing = Object.keys(OPTIONAL_CAPABILITIES).filter((name) => page?.capability?.[name] === false);
    return `${browser} ${version}: ${page?.controls ?? 0} controls, ${page?.landmarks ?? 0} landmarks${missing.length ? `, without ${missing.join(', ')}` : ', with every recorded capability'}`;
  });
}

/*
 * The runtime pages, which are the half of this product a workbench probe never
 * touches.
 *
 * Each is a separate document served under a different policy, and each starts a
 * different core: two of them are WebAssembly. A browser where the workbench
 * renders and the emulator page throws on load is a browser this product does
 * not work in, and nothing above would have noticed.
 *
 * What is checked is that the page's own script ran to the end and left the
 * page saying what it is waiting for. None of them is asked to start a machine,
 * because that needs firmware which may not enter this repository.
 */
export const RUNTIME_PAGES = Object.freeze([
  Object.freeze({ path: '/emulator.html', label: 'jsbeeb 6502 runtime', status: 'machine-status', channel: '8bit-net-machine' }),
  Object.freeze({ path: '/archimedes.html', label: 'Arculator A310 runtime', status: 'runtime-status', channel: '8bit-net-archimedes' }),
  Object.freeze({ path: '/electron.html', label: 'ElkJS Electron runtime', status: 'runtime-status', channel: '8bit-net-electron' }),
  Object.freeze({ path: '/elkulator.html', label: 'Elkulator Electron runtime', status: 'runtime-status', channel: '8bit-net-elkulator' }),
]);

/*
 * The harness that frames a runtime page, and why there is one.
 *
 * Loading a runtime document on its own says only that its bytes arrived. What
 * the workbench actually depends on is that the page announces itself on its
 * channel, and a page announces to its parent — so on its own it announces to
 * nobody and a script that threw before announcing looks exactly like one that
 * did not need to.
 *
 * Framing it is therefore not a convenience: it is the difference between
 * measuring that a file was served and measuring that the integration point
 * this product is built on works in this browser.
 */
export const RUNTIME_HOST_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>runtime host</title><script src="/ci-runtime-host.js"></script></head><body><iframe id="frame" title="runtime under test" width="900" height="700"></iframe></body></html>`;

export const RUNTIME_HOST_SOURCE = `(() => {
  const announced = [];
  window.__ciAnnounced = announced;
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || typeof data.channel !== 'string') return;
    announced.push({ channel: data.channel, type: String(data.type ?? '') });
  });
  window.addEventListener('DOMContentLoaded', () => {
    const page = new URLSearchParams(window.location.search).get('page') ?? '';
    /* Only a path on this origin, so the harness cannot be pointed elsewhere. */
    if (!/^\\/[A-Za-z0-9._-]+\\.html$/.test(page)) return;
    document.getElementById('frame').src = page + '?session=ci-browser-matrix';
  });
})();`;

/** Evaluated in the harness once the framed runtime has had time to start. */
export function runtimeProbe(statusId, channel) {
  return `(() => {
    const frame = document.getElementById('frame');
    const inner = frame && frame.contentDocument;
    const status = inner ? inner.getElementById(${JSON.stringify(statusId)}) : null;
    const announced = (window.__ciAnnounced ?? []).filter((entry) => entry.channel === ${JSON.stringify(channel)});
    const collected = window.__ciCollected ?? { errors: [], rejections: [], violations: [] };
    return JSON.stringify({
      framed: Boolean(inner),
      statusPresent: Boolean(status),
      statusText: status ? (status.textContent || '').trim().slice(0, 120) : '',
      canvases: inner ? inner.querySelectorAll('canvas').length : 0,
      announced: announced.map((entry) => entry.type),
      errors: collected.errors.slice(0, 6),
      rejections: collected.rejections.slice(0, 6),
      violations: collected.violations.slice(0, 6),
    });
  })()`;
}

/**
 * What must hold for a runtime page in every browser.
 *
 * @param {string} browser
 * @param {{ label: string, expectsAnnouncement: boolean, page: any }[]} pages
 */
export function runtimeFindings(browser, pages) {
  const findings = [];
  for (const { label, expectsAnnouncement, page } of pages) {
    if (!page) { findings.push(`${browser} could not load the ${label} at all.`); continue; }
    if (!page.framed) { findings.push(`${browser} could not reach into the framed ${label}, so nothing about it was measured.`); continue; }
    if (!page.statusPresent) findings.push(`${browser} loaded the ${label} without its status region, so the document did not render.`);
    if (!page.canvases) findings.push(`${browser} loaded the ${label} without a display surface.`);
    /* The announcement is the check that matters: it is the only one a page
     * whose script threw on load cannot pass, because the status region carries
     * the document's own initial text either way. */
    if (expectsAnnouncement && !(page.announced ?? []).length) {
      findings.push(`${browser} loaded the ${label} and it never announced itself on its channel, so its script did not run to the end.`);
    }
    for (const error of page.errors ?? []) findings.push(`${browser} reported an uncaught error in the ${label}: ${error}`);
    for (const rejection of page.rejections ?? []) findings.push(`${browser} reported an unhandled rejection in the ${label}: ${rejection}`);
    for (const violation of page.violations ?? []) findings.push(`${browser} reported a policy violation in the ${label}: ${violation}`);
  }
  return findings;
}

/** What each runtime document announced, so the check is visible rather than implied. */
export function runtimeSummary(results) {
  const first = results.find((result) => result.runtimes?.length);
  if (!first) return 'no runtime document was measured';
  /* Named rather than left as "the runtimes", because every browser is checked
   * and only one is quoted; a reader should know which one they are reading. */
  return `in ${first.browser}: ${first.runtimes
    .map(({ label, page }) => `${label} announced ${(page?.announced ?? []).join('+') || 'nothing'}`)
    .join(', ')}`;
}
