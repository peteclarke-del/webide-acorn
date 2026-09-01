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
      if (!page.capability?.[required]) findings.push(`${browser} does not provide ${required}, which this product cannot work without.`);
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
