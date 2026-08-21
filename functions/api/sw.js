/* ============================================================
   OLHAR — Service Worker v10
   Correção Cloudflare Pages:
   Pages redireciona automaticamente /arquivo.html -> /arquivo.
   Uma navegação interceptada pelo Service Worker pode preservar
   redirect:"manual"; nesse caso o fetch vê o redirect como
   opaqueredirect e response.ok é false.

   Solução:
   - simuladores usam a rota canônica SEM .html;
   - aceita também pedidos antigos COM .html e converte internamente;
   - o fetch é criado do zero com redirect:"follow";
   - nunca devolve index.html no lugar de um simulador.
   ============================================================ */
var VERSION = 'olhar-v11';
var CACHE = 'olhar-cache-' + VERSION;

var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './olhar-simulador-ametropia',
  './olhar-simulador-patologias',
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

function simulatorKind(pathname) {
  var p = pathname.replace(/\/+$/, '');
  if (/\/olhar-simulador-ametropia(?:\.html)?$/i.test(p)) return 'ametropia';
  if (/\/olhar-simulador-patologias(?:\.html)?$/i.test(p)) return 'patologias';
  return '';
}

function canonicalSimulatorURL(url, kind) {
  var u = new URL(url.href);
  u.pathname = '/olhar-simulador-' + kind; // rota canônica do Cloudflare Pages
  u.search = '';
  u.hash = '';
  return u;
}

function fetchSimulator(url, kind) {
  var canonical = canonicalSimulatorURL(url, kind);

  // Criamos um Request NOVO para não herdar redirect:"manual"
  // da navegação original controlada pelo Service Worker.
  var req = new Request(canonical.href, {
    method: 'GET',
    mode: 'same-origin',
    credentials: 'same-origin',
    redirect: 'follow',
    cache: 'no-store',
    headers: { 'Accept': 'text/html,application/xhtml+xml' }
  });

  // Com timeout: sem ele, numa rede ruim a janela do simulador fica
  // pendurada em branco em vez de cair no cache.
  return networkWithTimeout(req, 6000).then(function (response) {
    if (!response || !response.ok) {
      throw new Error('HTTP ' + (response ? response.status : 'sem resposta'));
    }
    return response;
  });
}

function simulatorFallback(request, url, kind) {
  var canonical = canonicalSimulatorURL(url, kind);
  return caches.open(CACHE).then(function (cache) {
    return Promise.all([
      cache.match(canonical.href),
      cache.match(request)
    ]).then(function (found) {
      var cached = found[0] || found[1];
      if (cached && cached.ok) return cached;

      return new Response(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>OLHAR — módulo indisponível</title>' +
        '<body style="margin:0;background:#0c0c0c;color:#f0f0f0;font:16px/1.6 system-ui;padding:42px">' +
        '<div style="max-width:760px;margin:auto">' +
        '<h1 style="font-size:24px">Não foi possível carregar o simulador</h1>' +
        '<p>Rota canônica tentada: <code style="color:#5ebbf7">' +
        canonical.pathname.replace(/^\//, '') + '</code>.</p>' +
        '<p>O módulo não foi encontrado nem na rede nem no cache.</p>' +
        '<button onclick="location.href=\'' + canonical.pathname + '?retry=' + Date.now() + '\'" ' +
        'style="padding:10px 18px;border:0;border-radius:20px;cursor:pointer">Tentar novamente</button>' +
        '</div></body></html>',
        { status: 503, headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        }}
      );
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (_) { return; }

  var sameOrigin = url.origin === self.location.origin;
  var kind = sameOrigin ? simulatorKind(url.pathname) : '';

  // 0) SIMULADORES — antes de qualquer outra regra.
  if (kind) {
    event.respondWith(
      fetchSimulator(url, kind)
        .then(function (response) {
          var canonical = canonicalSimulatorURL(url, kind);
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(canonical.href, copy);
          });
          return response;
        })
        .catch(function () {
          return simulatorFallback(request, url, kind);
        })
    );
    return;
  }

  var isNavigation = request.mode === 'navigate' ||
    (request.headers.get('accept') || '').indexOf('text/html') !== -1;

  // 1) APP PRINCIPAL — network first.
  if (isNavigation) {
    event.respondWith(
      networkWithTimeout(request, 5000, { cache: 'no-store' })
        .then(function (response) {
          if (!response || (!response.ok && response.type !== 'opaqueredirect')) {
            throw new Error('HTTP inválido');
          }
          if (response.ok) {
            var copy = response.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put('./index.html', copy.clone());
              cache.put('./', copy);
            });
          }
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

  // 2) ESTÁTICOS DO SITE — stale while revalidate.
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

  // 3) FONTES / CDN — stale while revalidate.
  if (/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com)/.test(url.host)) {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          var network = fetch(request).then(function (response) {
            if (response && (response.ok || response.type === 'opaque')) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(function () { return null; });

          if (cached) { network.catch(function () {}); return cached; }

          // respondWith(undefined) vira ERR_FAILED: todo caminho termina
          // numa Response de verdade.
          return network.then(function (response) {
            return response || new Response('', { status: 504, statusText: 'sem rede e sem cache' });
          });
        });
      })
    );
  }
});
