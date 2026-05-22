-- ============================================================
-- Attempo — Tablas para el chatbot de mensajería (WhatsApp / Facebook / Instagram)
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- Sesiones de conversación por canal y usuario
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id    UUID        NOT NULL,
  canal         TEXT        NOT NULL,           -- 'whatsapp' | 'facebook' | 'instagram'
  canal_user_id TEXT        NOT NULL,           -- número de teléfono, PSID, etc.
  canal_user_name TEXT,
  messages      JSONB       DEFAULT '[]'::jsonb, -- historial de mensajes {role, content}
  estado        TEXT        DEFAULT 'activo',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cliente_id, canal, canal_user_id)
);

-- Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS chat_sessions_cliente_id_idx ON chat_sessions(cliente_id);
CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions(updated_at DESC);

-- Configuración de personalidad del bot por cliente
CREATE TABLE IF NOT EXISTS bot_config (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID        NOT NULL UNIQUE,
  nombre_bot TEXT        DEFAULT 'Valentina',
  genero     TEXT        DEFAULT 'femenino',
  tono       TEXT        DEFAULT 'informal',    -- 'informal' | 'formal'
  saludo     TEXT        DEFAULT '¡Hola! 👋 Soy {nombre_bot}, la asistente virtual de {negocio}.',
  faqs       JSONB       DEFAULT '[]'::jsonb,   -- [{pregunta: "...", respuesta: "..."}]
  activo     BOOLEAN     DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: habilitar para ambas tablas
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_config    ENABLE ROW LEVEL SECURITY;

-- Política: solo el service role puede leer/escribir (el bot usa SUPABASE_SERVICE_KEY)
CREATE POLICY "service_role_all_chat_sessions"
  ON chat_sessions FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_bot_config"
  ON bot_config FOR ALL
  USING (auth.role() = 'service_role');
