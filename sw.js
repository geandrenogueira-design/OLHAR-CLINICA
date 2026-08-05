/* ============================================================
   Olhar — Service Worker (PWA offline + resiliente a 404)
   Estratégia:
   - Abrir o app (navegação): rede primeiro com timeout curto;
     se a rede falhar OU devolver 404/erro, serve a cópia em cache.
     => Resolve "às vezes não abre" (404 intermitente / sem internet).
   - Recursos estáticos do próprio site: cache primeiro, atualiza ao fundo.
   - Fontes Google / ícones (unpkg): stale-while-revalidate (offline ok).
   - API do Google Drive e demais: passam direto (sem cache).
   Para publicar uma versão nova do app, troque VERSION abaixo.
   ============================================================ */
var VERSION = 'olhar-v5';
var CACHE   = 'olhar-cache-' + VERSION;

/* Pré-cache: só o que é leve e indispensável para o app abrir offline.
   As fotos das cenas NÃO entram aqui — somam ~3,5 MB e seriam baixadas
   na instalação do SW, atrasando o primeiro carregamento. Elas são
   guardadas sob demanda pela regra 2 do fetch, na primeira vez que a
   cena é aberta. */
var PRECACHE = ['./', './index.html', './manifest.webmanifest',
                './icon-192.png', './icon-512.png', './icon-maskable-512.png',
                './olhar-simulador-ametropia.html',
                './olhar-simulador-patologias.html',
                './cenas/manifest.js'];

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
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('olhar-cache-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function netWithTimeout(req, ms, opts) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
    fetch(req, opts || undefined).then(function (r) { if (!done) { done = true; clearTimeout(t); resolve(r); } })
              .catch(function (err) { if (!done) { done = true; clearTimeout(t); reject(err); } });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (_) { return; }

  var isNav = req.mode === 'navigate' ||
              (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  /* Os simuladores são HTML e rodam dentro de um <iframe>. Sem esta exceção
     eles cairiam na regra de navegação abaixo, que devolve o index.html em
     caso de falha — e o iframe mostraria o app inteiro dentro dele. */
  var isSimulador = url.origin === self.location.origin &&
                    /olhar-simulador-.*\.html$/.test(url.pathname);

  // 1) Abrir o app — rede primeiro (timeout) → cai pro cache em 404/offline
  if (isNav && !isSimulador) {
    e.respondWith(
      netWithTimeout(req, 3500, { cache: 'reload' }).then(function (resp) {
        if (resp && (resp.ok || resp.type === 'opaqueredirect')) {
          var c1 = resp.clone(), c2 = resp.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', c1); c.put('./', c2); });
          return resp;
        }
        throw new Error('status ' + (resp && resp.status));
      }).catch(function () {
        return caches.match('./index.html').then(function (m) {
          return m || caches.match('./') || new Response(
            '<h1 style="font-family:sans-serif">Olhar offline</h1><p>Abra o app uma vez com internet para guardar a cópia local.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        });
      })
    );
    return;
  }

  // 2) Estáticos do próprio site — cache primeiro, atualiza ao fundo
  //    (inclui os simuladores e as fotos em cenas/)
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        var net = fetch(req).then(function (r) {
          if (r && r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
          return r;
        }).catch(function () { return cached; });
        return cached || net;
      })
    );
    return;
  }

  // 3) Fontes Google / ícones unpkg — stale-while-revalidate
  if (/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)/.test(url.host)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (cached) {
          var net = fetch(req).then(function (r) {
            if (r && (r.ok || r.type === 'opaque')) { c.put(req, r.clone()); }
            return r;
          }).catch(function () { return cached; });
          return cached || net;
        });
      })
    );
    return;
  }

  // 4) Demais (ex.: API do Google Drive) — passam direto
});
