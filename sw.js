// Versioned, self-contained app shell. Never cache API responses or personal keys.
const CACHE = 'vocab-builder-static-v19';
const PREFIX = 'vocab-builder-';
const ASSETS = [
  '/index.html','/styles.css','/curriculum.js','/study-content.js',
  '/app.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'
];
const ASSET_SET = new Set(ASSETS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache=await caches.open(CACHE);
    // A release is activated only after its entire offline study pack is stored.
    await cache.addAll(ASSETS.map(path=>new Request(path,{cache:'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(PREFIX) && name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if (url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  const path=url.pathname==='/' ? '/index.html' : url.pathname;
  if (ASSET_SET.has(path)) {
    // App assets are an atomic release: do not mix newer network files
    // with the currently cached set while another service worker installs.
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached=await cache.match(path);
      return cached || fetch(event.request);
    }));
  } else if (event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(async()=> {
      const cache=await caches.open(CACHE);
      return (await cache.match('/index.html')) || Response.error();
    }));
  }
});
