/* OLHAR — Persistence v4 (IndexedDB)
   Coloque este arquivo na raiz do projeto e carregue-o NO FINAL do index.html,
   imediatamente antes de </body>:
   <script src="./olhar-storage-idb.js?v=1"></script>

   Objetivos:
   - migrar automaticamente o conteúdo atual de localStorage['olhar_v3'] para IndexedDB;
   - manter o objeto global D e a função sv() compatíveis com o app existente;
   - parar de duplicar o banco inteiro em localStorage;
   - manter 1 cópia anterior dentro do IndexedDB;
   - liberar os antigos _last_good_backup e _autosnapshot somente após migração validada;
   - impedir entrada no app até a inicialização do banco terminar.
*/
(function () {
  'use strict';

  var LEGACY_KEY = 'olhar_v3';
  var IDB_NAME = 'olhar_clinica';
  var IDB_VERSION = 1;
  var STORE = 'state';
  var MAIN_KEY = 'main';
  var PREV_KEY = 'previous';

  var db = null;
  var saveQueue = Promise.resolve();
  var lastErrorAlertAt = 0;

  function log() {
    try { console.log.apply(console, ['[OLHAR storage]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  function warn() {
    try { console.warn.apply(console, ['[OLHAR storage]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB não está disponível neste navegador.'));
        return;
      }

      var req = indexedDB.open(IDB_NAME, IDB_VERSION);

      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };

      req.onsuccess = function () {
        db = req.result;
        db.onversionchange = function () {
          try { db.close(); } catch (_) {}
        };
        resolve(db);
      };

      req.onerror = function () {
        reject(req.error || new Error('Falha ao abrir IndexedDB.'));
      };

      req.onblocked = function () {
        warn('Abertura do IndexedDB bloqueada por outra aba.');
      };
    });
  }

  function idbGet(key) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('Falha ao ler IndexedDB.')); };
      } catch (e) {
        reject(e);
      }
    });
  }

  function idbWriteState(snapshot) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var getReq = store.get(MAIN_KEY);

        getReq.onsuccess = function () {
          var previous = getReq.result;
          if (previous && previous.data) store.put(previous, PREV_KEY);
          store.put({
            schema: 1,
            updatedAt: new Date().toISOString(),
            data: snapshot
          }, MAIN_KEY);
        };

        getReq.onerror = function () {
          try {
            store.put({
              schema: 1,
              updatedAt: new Date().toISOString(),
              data: snapshot
            }, MAIN_KEY);
          } catch (_) {}
        };

        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao gravar IndexedDB.')); };
        tx.onabort = function () { reject(tx.error || new Error('Gravação IndexedDB abortada.')); };
      } catch (e) {
        reject(e);
      }
    });
  }

  function cloneData(data) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(data); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(data));
  }

  function isValidData(data) {
    return !!data &&
      typeof data === 'object' &&
      Array.isArray(data.patients) &&
      Array.isArray(data.records) &&
      Array.isArray(data.appointments);
  }

  function legacyData() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return isValidData(parsed) ? parsed : null;
    } catch (e) {
      warn('Não foi possível ler o banco legado:', e);
      return null;
    }
  }

  function dataTime(data) {
    try {
      var t = data && data._meta && data._meta.updatedAt;
      var n = t ? Date.parse(t) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  function installSaveFunction() {
    window.sv = sv = function () {
      try {
        if (!window.D && typeof D === 'undefined') {
          return Promise.reject(new Error('Objeto D não está disponível.'));
        }

        var current = (typeof D !== 'undefined') ? D : window.D;
        if (!current._meta) current._meta = {};
        current._meta.updatedAt = new Date().toISOString();
        current._meta.storage = 'indexeddb-v1';

        var snapshot = cloneData(current);

        saveQueue = saveQueue
          .catch(function () {}) // uma falha anterior não trava a fila
          .then(function () { return idbWriteState(snapshot); })
          .then(function () {
            try {
              localStorage.setItem(LEGACY_KEY + '_migrated', JSON.stringify({
                at: new Date().toISOString(),
                storage: 'indexeddb-v1'
              }));
            } catch (_) {}
            return true;
          })
          .catch(function (e) {
            console.error('[OLHAR storage] Falha ao salvar:', e);
            var now = Date.now();
            if (now - lastErrorAlertAt > 5000) {
              lastErrorAlertAt = now;
              alert('Falha ao salvar no banco local. Exporte um backup agora. Erro: ' + (e && e.message ? e.message : e));
            }
            throw e;
          });

        return saveQueue;
      } catch (e) {
        console.error('[OLHAR storage] Falha antes da gravação:', e);
        return Promise.reject(e);
      }
    };
  }

  function installBackupImport() {
    // Mantém o mesmo formato de backup atual, mas garante que a restauração
    // só recarregue a página depois que o IndexedDB confirmar a gravação.
    window.importBackup = function (file) {
      if (!file) return;
      var r = new FileReader();

      r.onload = function () {
        try {
          var parsed = JSON.parse(r.result);
          var data = parsed.data || parsed;

          if (!isValidData(data)) throw new Error('Arquivo incompatível.');
          if (!confirm('Importar este backup substituirá os dados locais atuais.\nContinuar?')) return;

          if (typeof D !== 'undefined') {
            D = Object.assign(D, data);
            window.D = D;
          } else {
            window.D = data;
          }

          Promise.resolve(window.sv())
            .then(function () {
              try { if (typeof toast === 'function') toast('Backup importado'); } catch (_) {}
              setTimeout(function () { location.reload(); }, 150);
            })
            .catch(function (e) {
              alert('Os dados foram lidos, mas não foi possível gravá-los: ' + e.message);
            });
        } catch (e) {
          alert('Não foi possível importar: ' + e.message);
        }
      };

      r.readAsText(file);
    };
  }

  function freeLegacyDuplicates() {
    // Só é chamado DEPOIS de confirmar que o MAIN existe e é válido no IndexedDB.
    // O banco legado principal é mantido nesta primeira versão como rede de segurança,
    // porém as duas cópias gigantes que causavam quota são removidas.
    try { localStorage.removeItem(LEGACY_KEY + '_last_good_backup'); } catch (_) {}
    try { localStorage.removeItem(LEGACY_KEY + '_autosnapshot'); } catch (_) {}
  }

  function wrapEnterUntilReady(readyPromise) {
    try {
      var originalEnter = window.enterAs || (typeof enterAs === 'function' ? enterAs : null);
      if (!originalEnter) return;

      var wrapped = function (role) {
        readyPromise.then(function () {
          originalEnter(role);
        }).catch(function (e) {
          alert('O banco de dados do OLHAR não iniciou. Não prossiga antes de exportar um backup.\n\n' + e.message);
        });
      };

      window.enterAs = wrapped;
      try { enterAs = wrapped; } catch (_) {}
    } catch (e) {
      warn('Não foi possível proteger a entrada:', e);
    }
  }

  var ready = openDB()
    .then(function () {
      var legacy = legacyData();

      return idbGet(MAIN_KEY).then(function (main) {
        var idbData = main && main.data && isValidData(main.data) ? main.data : null;

        // Primeira execução: migra localStorage -> IndexedDB.
        if (!idbData && legacy) {
          log('Migrando banco legado para IndexedDB...');
          return idbWriteState(cloneData(legacy)).then(function () {
            return idbGet(MAIN_KEY);
          }).then(function (check) {
            if (!check || !isValidData(check.data)) throw new Error('A validação da migração falhou.');
            return check.data;
          });
        }

        // Se já existe IndexedDB, usa a cópia mais recente.
        if (idbData && legacy) {
          return dataTime(idbData) >= dataTime(legacy) ? idbData : legacy;
        }

        if (idbData) return idbData;

        // App ainda vazio: grava o D inicial.
        var current = (typeof D !== 'undefined') ? D : window.D;
        if (!isValidData(current)) throw new Error('Estrutura inicial de dados inválida.');
        return idbWriteState(cloneData(current)).then(function () { return current; });
      });
    })
    .then(function (loaded) {
      if (loaded && isValidData(loaded)) {
        if (typeof D !== 'undefined') {
          D = Object.assign(D, loaded);
          window.D = D;
        } else {
          window.D = loaded;
        }
      }

      installSaveFunction();
      installBackupImport();

      return idbGet(MAIN_KEY).then(function (check) {
        if (!check || !isValidData(check.data)) throw new Error('IndexedDB não passou na validação final.');
        freeLegacyDuplicates();
        log('IndexedDB pronto. Pacientes:', check.data.patients.length, 'Prontuários:', check.data.records.length);
        window.dispatchEvent(new CustomEvent('olhar-storage-ready'));
        return true;
      });
    });

  window.OLHAR_STORAGE = {
    ready: ready,
    save: function () { return window.sv(); },
    getMain: function () { return ready.then(function () { return idbGet(MAIN_KEY); }); },
    getPrevious: function () { return ready.then(function () { return idbGet(PREV_KEY); }); },
    info: function () {
      return ready.then(function () {
        return idbGet(MAIN_KEY).then(function (x) {
          return {
            database: IDB_NAME,
            store: STORE,
            updatedAt: x && x.updatedAt,
            patients: x && x.data && x.data.patients ? x.data.patients.length : 0,
            records: x && x.data && x.data.records ? x.data.records.length : 0
          };
        });
      });
    }
  };

  wrapEnterUntilReady(ready);

  ready.catch(function (e) {
    console.error('[OLHAR storage] Inicialização falhou:', e);
  });

})();
