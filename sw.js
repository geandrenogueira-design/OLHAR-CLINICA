/* ============================================================
   OLHAR — Service Worker v9
   Correção específica: simuladores em janela própria.
   - Simuladores: NETWORK FIRST real, antes de qualquer outra regra.
   - Nunca devolve index.html no lugar de simulador.
   - Cache é somente fallback quando a rede realmente falha.
   - App principal: network first com fallback offline.
   ============================================================ */
var VERSION = 'olhar-v9';
var CACHE = 'olhar-cache-' + VERSION;

var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './olhar-storage-idb.js',
  './cenas/manifest.js'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.allSettled(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }));
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('olhar-cache-') === 0 && key !== CACHE) {
          return caches.delete(key);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function networkWithTimeout(request, timeoutMs, options) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) {
        settled = true;
        reject(new Error('timeout'));
      }
    }, timeoutMs);

    fetch(request, options || undefined).then(function (response) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(response);
      }
    }).catch(function (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

function simulatorFallback(request, url) {
  return caches.match(request).then(function (cached) {
    if (cached && cached.ok) return cached;
    return new Response(
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>OLHAR — módulo indisponível</title>' +
      '<body style="margin:0;background:#0c0c0c;color:#f0f0f0;font:16px/1.6 system-ui;padding:42px">' +
      '<div style="max-width:720px;margin:auto">' +
      '<h1 style="font-size:24px">Não foi possível carregar o simulador</h1>' +
      '<p>Arquivo solicitado: <code style="color:#5ebbf7">' + url.pathname.replace(/^\//, '') + '</code>.</p>' +
      '<p>O Service Worker tentou a rede diretamente e não recebeu uma resposta válida. ' +
      'Verifique se este arquivo existe na raiz do deploy do Cloudflare Pages.</p>' +
      '<button onclick="location.reload()" style="padding:10px 18px;border:0;border-radius:20px;cursor:pointer">Tentar novamente</button>' +
      '</div></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (_) { return; }

  var sameOrigin = url.origin === self.location.origin;
  var isSimulator = sameOrigin && /\/olhar-simulador-(ametropia|patologias)\.html$/i.test(url.pathname);

  /* 0) SIMULADORES — regra mais importante, vem ANTES de navegação geral. */
  if (isSimulator) {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .then(function (response) {
          if (!response || !response.ok) {
            throw new Error('HTTP ' + (response ? response.status : 'sem resposta'));
          }
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
          return response;
        })
        .catch(function () {
          return simulatorFallback(request, url);
        })
    );
    return;
  }

  var isNavigation = request.mode === 'navigate' ||
    (request.headers.get('accept') || '').indexOf('text/html') !== -1;

  /* 1) APP PRINCIPAL — rede primeiro; cache apenas se necessário. */
  if (isNavigation) {
    event.respondWith(
      networkWithTimeout(request, 5000, { cache: 'no-store' })
        .then(function (response) {
          if (!response || !response.ok) throw new Error('HTTP inválido');
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put('./index.html', copy.clone());
            cache.put('./', copy);
          });
          return response;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (cached) {
            return cached || caches.match('./') || new Response(
              '<h1 style="font-family:system-ui">OLHAR offline</h1><p>Abra o aplicativo uma vez conectado à internet.</p>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  /* 2) ESTÁTICOS DO PRÓPRIO SITE — stale while revalidate. */
  if (sameOrigin) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        var network = fetch(request, { cache: 'no-cache' }).then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        }).catch(function () { return null; });

        if (cached) {
          network.catch(function () {});
          return cached;
        }

        return network.then(function (response) {
          return response || new Response('', { status: 504, statusText: 'sem rede e sem cache' });
        });
      })
    );
    return;
  }

  /* 3) FONTES / CDN — stale while revalidate. */
  if (/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com)/.test(url.host)) {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          var network = fetch(request).then(function (response) {
            if (response && (response.ok || response.type === 'opaque')) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
  }
});
