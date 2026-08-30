const DATABASE = '8bit-net-dev-roms';
const STORE = 'roms';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/user-roms/')) return;
  // jsbeeb asks its configured base URL for `roms/<manifest path>`. The vault
  // deliberately stores only `<set>/<manifest path>`, so remove that adapter
  // implementation detail without exposing a general-purpose file endpoint.
  const key = decodeURIComponent(url.pathname.slice('/user-roms/'.length)).replace(/^([^/]+)\/roms\//, '$1/');
  event.respondWith(readRom(key).then(record => record
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
