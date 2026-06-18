const CACHE = 'mkt-v3';
const STATIC = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API: network-only
  if(url.pathname.startsWith('/api/')){
    e.respondWith(fetch(e.request));
    return;
  }

  // HTML: stale-while-revalidate（即キャッシュ表示 + バックグラウンドで更新）
  if(url.pathname === '/' || url.pathname.endsWith('.html')){
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const fresh = fetch(e.request).then(res => {
            if(res.ok) cache.put(e.request, res.clone());
            return res;
          });
          return cached || fresh; // キャッシュがあれば即返す、なければネット待ち
        })
      )
    );
    return;
  }

  // その他の静的ファイル: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
