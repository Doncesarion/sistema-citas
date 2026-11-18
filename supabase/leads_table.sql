-- ============================================================
-- Attempo — Tabla de leads comerciales
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id    UUID        NOT NULL,
  canal         TEXT,
  canal_user_id TEXT,
  canal_user_name TEXT,
  nombre        TEXT,
  telefono      TEXT,
  email         TEXT,
  interes       TEXT,
  resumen       TEXT,
  estado        TEXT        DEFAULT 'nuevo',  -- nuevo | en_contacto | ganado | perdido
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_cliente_id_idx  ON leads(cliente_id);
CREATE INDEX IF NOT EXISTS leads_estado_idx       ON leads(estado);
CREATE INDEX IF NOT EXISTS leads_created_at_idx   ON leads(created_at DESC);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_leads"
  ON leads FOR ALL
  USING (auth.role() = 'service_role');
