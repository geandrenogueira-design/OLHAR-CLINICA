-- ==========================================================================
-- OLHAR — Portal das Óticas Conveniadas
-- Schema do banco D1
--
-- Como aplicar:
--   1. No painel Cloudflare → Workers & Pages → D1 → Create database
--      Nome: olhar_portal
--   2. Vá em Console e cole este arquivo TODO
--   3. Execute
--
-- Se precisar recomeçar do zero: DROP TABLE de tudo, cole de novo.
-- (Em produção, use migrations em vez de recriar.)
-- ==========================================================================

-- Cada ótica cadastrada no sistema clínico recebe UM registro aqui quando
-- o Dr. Geandré cria um acesso pra ela. externalId é o D.opticas[].id do
-- sistema clínico — é assim que ligamos o cadastro local ao registro do portal.
CREATE TABLE IF NOT EXISTS opticas (
  id             TEXT PRIMARY KEY,        -- uuid gerado pelo Worker
  externalId     TEXT NOT NULL UNIQUE,    -- D.opticas[].id (do sistema clínico)
  name           TEXT NOT NULL,           -- nome da ótica (para mostrar)
  username       TEXT NOT NULL UNIQUE,    -- login (slug: minúsculo, sem espaço)
  pinSalt        TEXT NOT NULL,           -- salt aleatório (base64)
  pinHash        TEXT NOT NULL,           -- PBKDF2-SHA256, 100k iter (base64)
  pinIterations  INTEGER NOT NULL DEFAULT 100000,
  failedAttempts INTEGER NOT NULL DEFAULT 0,  -- reset ao logar; incrementa a cada erro
  blockedUntil   INTEGER,                 -- timestamp ms; se > now, bloqueada
  createdAt      INTEGER NOT NULL,
  updatedAt      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_opticas_external ON opticas(externalId);
CREATE INDEX IF NOT EXISTS idx_opticas_username ON opticas(username);

-- Cada PDF de receita enviado para uma ótica gera um documento aqui.
-- SEM R2: o PDF inteiro vive dentro do próprio D1, em base64, na coluna
-- pdfData. Custa ~33% de inflação de tamanho (base64 vs binário puro), mas
-- evita a exigência de cartão de crédito do R2. Para o volume de uma clínica
-- (algumas dezenas de receitas por mês, ~30-80 KB cada) isso não pesa —
-- o D1 tem 5 GB grátis e um limite de ~2 MB por linha, bem confortável aqui.
-- Revogar agora significa: marcar revokedAt E apagar pdfData (não há R2
-- para limpar — o dado só existe aqui).
CREATE TABLE IF NOT EXISTS documentos (
  id           TEXT PRIMARY KEY,          -- uuid
  opticaId     TEXT NOT NULL,             -- referencia opticas.id
  patientName  TEXT NOT NULL,
  rxDate       TEXT,                      -- ISO date do exame (yyyy-mm-dd)
  rxSummary    TEXT,                      -- resumo textual "OD -2.50 -0.75 x90 · OE ..."
  fileName     TEXT NOT NULL,             -- nome sugerido do arquivo
  fileSize     INTEGER NOT NULL,          -- bytes do PDF original (antes do base64)
  pdfData      TEXT,                      -- PDF em base64; NULL depois de revogado
  createdAt    INTEGER NOT NULL,          -- timestamp ms
  viewedAt     INTEGER,                   -- primeira vez que a ótica abriu
  viewCount    INTEGER NOT NULL DEFAULT 0,
  revokedAt    INTEGER,                   -- se preenchido: acesso revogado
  FOREIGN KEY (opticaId) REFERENCES opticas(id)
);

CREATE INDEX IF NOT EXISTS idx_documentos_optica ON documentos(opticaId);
CREATE INDEX IF NOT EXISTS idx_documentos_created ON documentos(createdAt DESC);

-- Sessões da ótica no portal. Cookie httpOnly guarda apenas o id (opaco).
-- Expira em 8 horas. Ao renovar, cria nova entrada — não reaproveitamos ids.
CREATE TABLE IF NOT EXISTS sessoes (
  id         TEXT PRIMARY KEY,            -- uuid, opaco
  opticaId   TEXT NOT NULL,
  createdAt  INTEGER NOT NULL,
  expiresAt  INTEGER NOT NULL,
  userAgent  TEXT,                        -- para o log de auditoria
  ip         TEXT,                        -- CF-Connecting-IP
  FOREIGN KEY (opticaId) REFERENCES opticas(id)
);

CREATE INDEX IF NOT EXISTS idx_sessoes_optica ON sessoes(opticaId);
CREATE INDEX IF NOT EXISTS idx_sessoes_expires ON sessoes(expiresAt);

-- Log de auditoria: quem fez o quê. Não substitui logs sérios em produção,
-- mas dá pra reconstruir o "quem viu qual receita e quando" — que é
-- o mínimo para responder a um pedido LGPD.
CREATE TABLE IF NOT EXISTS auditoria (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,            -- timestamp ms
  actor      TEXT NOT NULL,               -- 'clinic' ou 'optica:<id>'
  action     TEXT NOT NULL,               -- 'upload', 'view', 'revoke', 'login', 'login_fail'
  targetId   TEXT,                        -- id do documento ou da ótica
  ip         TEXT,
  detail     TEXT                         -- json opcional com contexto
);

CREATE INDEX IF NOT EXISTS idx_auditoria_ts ON auditoria(ts DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_actor ON auditoria(actor, ts DESC);
