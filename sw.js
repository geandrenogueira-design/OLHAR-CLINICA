/* ============================================================
   Olhar — Service Worker v7
   ============================================================ */
var VERSION = 'olhar-v7';
var CACHE = 'olhar-cache-' + VERSION;

var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './olhar-storage-idb.js',
  './olhar-simulador-ametropia.html',
  './olhar-simulador-patologias.html',
  './cenas/manifest.js'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.allSettled(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' }));
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) {
          return k.indexOf('olhar-cache-') === 0 && k !== CACHE;
        }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

function netWithTimeout(req, ms, opts) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () {
      if (!done) { done = true; reject(new Error('timeout')); }
    }, ms);

    fetch(req, opts || undefined)
      .then(function (r) {
        if (!done) { done = true; clearTimeout(t); resolve(r); }
      })
      .catch(function (err) {
        if (!done) { done = true; clearTimeout(t); reject(err); }
      });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (_) { return; }

  var isNav = req.mode === 'navigate' ||
              (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  var isSimulador = url.origin === self.location.origin &&
                    /olhar-simulador-.*\.html$/.test(url.pathname);

  // Navegação principal: rede primeiro.
  if (isNav && !isSimulador) {
    e.respondWith(
      netWithTimeout(req, 3500, { cache: 'reload' })
        .then(function (resp) {
          if (resp && (resp.ok || resp.type === 'opaqueredirect')) {
            var c1 = resp.clone();
            var c2 = resp.clone();
            caches.open(CACHE).then(function (c) {
              c.put('./index.html', c1);
              c.put('./', c2);
            });
            return resp;
          }
          throw new Error('status ' + (resp && resp.status));
        })
        .catch(function () {
          return caches.match('./index.html').then(function (m) {
            return m || caches.match('./') || new Response(
              '<h1 style="font-family:sans-serif">Olhar offline</h1>' +
              '<p>Abra o app uma vez com internet para guardar a cópia local.</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  // Arquivos do próprio site: cache primeiro + atualização em segundo plano.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        var net = fetch(req, { cache: 'no-cache' })
          .then(function (r) {
            if (r && r.ok) {
              var cp = r.clone();
              caches.open(CACHE).then(function (c) { c.put(req, cp); });
            }
            return r;
          })
          .catch(function () { return null; });

        if (cached) {
          net.catch(function () {});
          return cached;
        }

        return net.then(function (r) {
          if (r) return r;

          if (isSimulador) {
            return new Response(
              '<!DOCTYPE html><meta charset="utf-8">' +
              '<div style="font:16px/1.6 system-ui;padding:48px;max-width:640px;margin:auto;color:#1a1a1a">' +
              '<h1 style="font-size:22px">Este módulo ainda não está disponível offline</h1>' +
              '<p>Abra o app uma vez com internet para guardar a cópia local.</p>' +
              '</div>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }

          return new Response('', { status: 504, statusText: 'sem rede e sem cache' });
        });
      })
    );
    return;
  }

  // Fontes e ícones: stale-while-revalidate.
  if (/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com)/.test(url.host)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (cached) {
          var net = fetch(req)
            .then(function (r) {
              if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
              return r;
            })
            .catch(function () { return cached; });

          return cached || net;
        });
      })
    );
  }
});
