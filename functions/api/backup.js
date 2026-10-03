// ==========================================================================
// OLHAR — Backup automático na nuvem (Cloudflare Pages Function + D1)
//
// POST /api/backup   (autenticado por X-Clinic-Key, a mesma chave do Portal)
//
//   put   { device, deviceName, dataUpdatedAt, payload }  -> grava uma versão
//   list  { limit? }                                       -> lista versões
//   get   { id }                                           -> devolve o payload
//
// O servidor NUNCA vê dado de paciente em aberto: o payload chega já
// criptografado no aparelho (AES-GCM 256, envelope "olhar-enc-v1"). Aqui só
// guardamos o texto cifrado, partido em pedaços porque o D1 limita o tamanho
// de cada linha (~2 MB). O SHA-256 do payload volta para o aparelho conferir.
//
// Retenção por aparelho: as 24 versões mais recentes + a última de cada dia
// dos 30 dias anteriores. O resto é apagado a cada novo envio.
//
// As tabelas são criadas sozinhas na primeira chamada (IF NOT EXISTS):
// não é preciso rodar nada no console do D1.
//
// Bindings (os mesmos do Portal): env.DB (D1 olhar_portal) e env.CLINIC_KEY.
// ==========================================================================

const CHUNK = 900_000;                 // caracteres por linha (folga sob ~2 MB)
const MAX_PAYLOAD = 40 * 1024 * 1024;  // 40 MB de envelope por versão
const KEEP_RECENT = 24;
const KEEP_DAYS = 30;
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000; // dia contado no horário de Garanhuns

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
const fail = (message, status = 400) => json({ error: message }, status);

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function checkClinicKey(request, env) {
  const provided = request.headers.get('X-Clinic-Key');
  if (!env.CLINIC_KEY) return 'CLINIC_KEY não configurada no Cloudflare';
  if (!env.DB) return 'Banco D1 (binding DB) não configurado no Cloudflare';
  if (!provided) return 'Chave da clínica ausente';
  if (!constantTimeEqual(provided, env.CLINIC_KEY)) return 'Chave da clínica inválida';
  return '';
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureTables(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY, device TEXT NOT NULL, deviceName TEXT,
      createdAt INTEGER NOT NULL, dataUpdatedAt TEXT, size INTEGER NOT NULL,
      chunks INTEGER NOT NULL, sha256 TEXT NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_backups_device ON backups(device, createdAt DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS backup_chunks (
      backupId TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (backupId, idx))`),
  ]);
}

async function audit(env, action, targetId, ip, detail) {
  try {
    await env.DB.prepare(
      `INSERT INTO auditoria (ts, actor, action, targetId, ip, detail) VALUES (?, 'clinic', ?, ?, ?, ?)`
    ).bind(Date.now(), action, targetId || null, ip || null, detail ? JSON.stringify(detail) : null).run();
  } catch (e) { /* tabela de auditoria ausente não impede o backup */ }
}

function dayKey(ms) { return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10); }

async function prune(env, device) {
  const { results } = await env.DB.prepare(
    `SELECT id, createdAt FROM backups WHERE device = ? ORDER BY createdAt DESC`
  ).bind(device).all();
  const keep = new Set();
  const seenDays = new Set();
  const limit = Date.now() - KEEP_DAYS * 86400000;
  results.forEach((r, i) => {
    if (i < KEEP_RECENT) { keep.add(r.id); seenDays.add(dayKey(r.createdAt)); return; }
    const d = dayKey(r.createdAt);
    if (r.createdAt >= limit && !seenDays.has(d)) { keep.add(r.id); seenDays.add(d); }
  });
  const drop = results.filter(r => !keep.has(r.id)).map(r => r.id);
  for (const id of drop) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM backup_chunks WHERE backupId = ?`).bind(id),
      env.DB.prepare(`DELETE FROM backups WHERE id = ?`).bind(id),
    ]);
  }
  return drop.length;
}

async function actionPut(env, body, ip) {
  const device = String(body.device || '').slice(0, 64);
  const payload = body.payload;
  if (!/^[a-z0-9-]{8,64}$/i.test(device)) return fail('Identificador de aparelho inválido');
  if (typeof payload !== 'string' || !payload.length) return fail('Payload ausente');
  if (payload.length > MAX_PAYLOAD) return fail('Backup grande demais para a nuvem', 413);

  // só aceita envelope criptografado: dado aberto de paciente não entra aqui.
  // Checagem pelo cabeçalho do envelope (o texto cifrado vem por último) para
  // não gastar CPU fazendo JSON.parse de megabytes no plano gratuito.
  const head = payload.slice(0, 8000);
  if (!head.startsWith('{"app":"Olhar Sistema","format":"olhar-enc-v1"') ||
      !head.includes('"schema":2') || !head.includes('"wraps":{') ||
      !head.includes('"iv":"') || !head.includes('"ct":"') || !payload.endsWith('"}')) {
    return fail('Só backups criptografados são aceitos');
  }
  if (head.includes('"patients":[')) return fail('Só backups criptografados são aceitos');

  const id = crypto.randomUUID();
  const sha = await sha256Hex(payload);
  const parts = [];
  for (let i = 0; i < payload.length; i += CHUNK) parts.push(payload.slice(i, i + CHUNK));

  const stmts = parts.map((p, idx) =>
    env.DB.prepare(`INSERT INTO backup_chunks (backupId, idx, data) VALUES (?, ?, ?)`).bind(id, idx, p));
  stmts.push(env.DB.prepare(
    `INSERT INTO backups (id, device, deviceName, createdAt, dataUpdatedAt, size, chunks, sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, device, String(body.deviceName || '').slice(0, 80), Date.now(),
         String(body.dataUpdatedAt || '').slice(0, 40), payload.length, parts.length, sha));
  await env.DB.batch(stmts);   // tudo ou nada

  const removed = await prune(env, device);
  await audit(env, 'backup', id, ip, { device, size: payload.length, removed });
  return json({ ok: true, id, sha256: sha, size: payload.length, chunks: parts.length, removed });
}

async function actionList(env, body) {
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 60, 1), 200);
  const { results } = await env.DB.prepare(
    `SELECT id, device, deviceName, createdAt, dataUpdatedAt, size, sha256
     FROM backups ORDER BY createdAt DESC LIMIT ?`
  ).bind(limit).all();
  return json({ ok: true, backups: results });
}

async function actionGet(env, body, ip) {
  const id = String(body.id || '');
  const meta = await env.DB.prepare(`SELECT * FROM backups WHERE id = ?`).bind(id).first();
  if (!meta) return fail('Backup não encontrado', 404);
  const { results } = await env.DB.prepare(
    `SELECT data FROM backup_chunks WHERE backupId = ? ORDER BY idx`
  ).bind(id).all();
  if (results.length !== meta.chunks) return fail('Backup incompleto no servidor', 500);
  const payload = results.map(r => r.data).join('');
  const sha = await sha256Hex(payload);
  if (sha !== meta.sha256) return fail('Backup corrompido no servidor (SHA-256 não confere)', 500);
  await audit(env, 'backup_get', id, ip, null);
  return json({ ok: true, id, createdAt: meta.createdAt, deviceName: meta.deviceName, sha256: sha, payload });
}

export async function onRequestPost({ request, env }) {
  const problem = checkClinicKey(request, env);
  if (problem) return fail(problem, 401);

  let body;
  try { body = await request.json(); } catch (e) { return fail('Corpo inválido (esperado JSON)'); }
  const ip = request.headers.get('CF-Connecting-IP') || '';

  try {
    await ensureTables(env);
    switch (String(body.action || '')) {
      case 'put':  return await actionPut(env, body, ip);
      case 'list': return await actionList(env, body);
      case 'get':  return await actionGet(env, body, ip);
    }
    return fail('Ação desconhecida', 400);
  } catch (e) {
    return fail('Erro no servidor de backup: ' + (e && e.message ? e.message : e), 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return fail('Este endpoint aceita apenas POST', 405);
}
