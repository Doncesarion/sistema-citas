-- ============================================================
-- Attempo — Base de conocimiento dinámica + gaps analytics
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS chatbot_knowledge (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id  UUID        NOT NULL,
  categoria   TEXT        NOT NULL DEFAULT 'general',
  titulo      TEXT        NOT NULL,
  contenido   TEXT        NOT NULL,
  activo      BOOLEAN     DEFAULT true,
  orden       INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ck_cliente_activo ON chatbot_knowledge(cliente_id, activo);

ALTER TABLE chatbot_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_ck"
  ON chatbot_knowledge FOR ALL
  USING (auth.role() = 'service_role');

-- Preguntas sin respuesta (gaps analytics)
CREATE TABLE IF NOT EXISTS chatbot_gaps (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id  UUID        NOT NULL,
  pregunta    TEXT        NOT NULL,
  canal       TEXT,
  frecuencia  INTEGER     DEFAULT 1,
  respondida  BOOLEAN     DEFAULT false,
  first_seen  TIMESTAMPTZ DEFAULT now(),
  last_seen   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cg_cliente_resp ON chatbot_gaps(cliente_id, respondida);

ALTER TABLE chatbot_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_cg"
  ON chatbot_gaps FOR ALL
  USING (auth.role() = 'service_role');
