const DATABASE = '8bit-net-dev-roms';
const STORE = 'roms';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/user-roms/')) return;
  // jsbeeb asks its configured base URL for `roms/<manifest path>`, and its
  // profiles store `<set>/<manifest path>` without that segment, so it has to
  // come off. But the Elkulator profiles put `roms/` in the manifest path
  // itself, so their vault keys really do contain it, and stripping it
  // unconditionally meant every ROM of the expanded Electron set was stored
  // under a key this worker would never ask for: supplied, present, and
  // answered with 404 the moment the core wanted it.
  //
  // So the stored key is tried as it is first, and the shortened form only if
  // that finds nothing. Both conventions are served and neither profile has to
  // change to suit the other.
  const asked = decodeURIComponent(url.pathname.slice('/user-roms/'.length));
  const shortened = asked.replace(/^([^/]+)\/roms\//, '$1/');
  event.respondWith(readRom(asked).then(record => record ?? (shortened === asked ? undefined : readRom(shortened))).then(record => record
    ? new Response(record.bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
    : new Response('ROM not supplied', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
  ).catch(() => new Response('ROM storage unavailable', { status: 503 })));
});

function readRom(key) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'key' }); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}
