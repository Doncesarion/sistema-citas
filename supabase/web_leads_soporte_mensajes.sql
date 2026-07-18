-- ─── web_leads: leads del sitio web attempo.cl ──────────────────────────────
-- tipo: 'chat' (chatbot Attia) | 'whatsapp' (clic en botón WA)
-- Cada fila = un intercambio del chat o un clic en WA
CREATE TABLE IF NOT EXISTS web_leads (
  id         uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text         NOT NULL,
  mensajes   jsonb        DEFAULT '[]',
  ip         text,
  tipo       text         DEFAULT 'chat',
  pagina     text,
  created_at timestamptz  DEFAULT now()
);

-- Sin RLS: el acceso se controla desde el backend con service key
ALTER TABLE web_leads DISABLE ROW LEVEL SECURITY;

-- Agregar columnas si la tabla ya existe (idempotente)
ALTER TABLE web_leads ADD COLUMN IF NOT EXISTS tipo    text DEFAULT 'chat';
ALTER TABLE web_leads ADD COLUMN IF NOT EXISTS pagina  text;

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
