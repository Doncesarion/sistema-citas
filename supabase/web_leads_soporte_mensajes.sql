-- ─── web_leads: conversaciones del chat de attempo.cl ───────────────────────
-- Cada fila = un intercambio (pregunta + respuesta) de un visitante en el chat del sitio web
CREATE TABLE IF NOT EXISTS web_leads (
  id         uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text         NOT NULL,
  mensajes   jsonb        DEFAULT '[]',
  ip         text,
  created_at timestamptz  DEFAULT now()
);

-- Sin RLS: el acceso se controla desde el backend con service key
ALTER TABLE web_leads DISABLE ROW LEVEL SECURITY;

-- ─── soporte_mensajes: chat de soporte entre superadmin y clientes/visitantes ─
-- cliente_id puede ser un UUID real (cliente) o 'web-<session_id>' (visitante web)
-- remitente: 'superadmin' | 'cliente' | 'visitante' | 'attia'
CREATE TABLE IF NOT EXISTS soporte_mensajes (
  id         uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id text         NOT NULL,
  remitente  text         NOT NULL,
  contenido  text         NOT NULL,
  leido      boolean      DEFAULT false,
  created_at timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soporte_mensajes_cliente ON soporte_mensajes (cliente_id);
CREATE INDEX IF NOT EXISTS idx_soporte_mensajes_created ON soporte_mensajes (created_at DESC);

ALTER TABLE soporte_mensajes DISABLE ROW LEVEL SECURITY;
