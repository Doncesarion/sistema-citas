-- ================================================
-- SISTEMA AGENDA - Tablas Supabase
-- Pega todo esto en SQL Editor de Supabase
-- ================================================

-- 1. TABLA DE CLIENTES (negocios que contratan el sistema)
CREATE TABLE IF NOT EXISTS clientes_sistema (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre_negocio  TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,          -- bcrypt hash
  plan            TEXT DEFAULT 'demo'     CHECK (plan IN ('demo','mensual','anual')),
  fecha_inicio    DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_expiracion DATE NOT NULL,
  activo          BOOLEAN DEFAULT true,
  contacto_nombre TEXT,
  contacto_tel    TEXT,
  rubro           TEXT,                   -- barberia, clinica, psicologia, etc
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA DE PAGOS (historial de cobros)
CREATE TABLE IF NOT EXISTS pagos (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id      UUID REFERENCES clientes_sistema(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL,
  monto           INTEGER NOT NULL,       -- en CLP
  estado          TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado','fallido')),
  plataforma      TEXT,                   -- flow, mercadopago, transferencia
  referencia      TEXT,                   -- ID transaccion externa
  fecha_pago      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA DE SESIONES (para verificar login activo)
CREATE TABLE IF NOT EXISTS sesiones (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id      UUID REFERENCES clientes_sistema(id) ON DELETE CASCADE,
  token           TEXT UNIQUE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. INSERT de cliente demo tuyo (para probar)
-- Contraseña: Admin2024! (hash bcrypt)
INSERT INTO clientes_sistema (
  nombre_negocio, email, password_hash, plan,
  fecha_inicio, fecha_expiracion,
  contacto_nombre, contacto_tel, rubro
) VALUES (
  'DonCesarion Demo',
  'cesar@doncesarion.cl',
  '$2b$10$rQnW3yZ1vX8kL2mN4pO6uOqVwJhGfDsAeKiTxBzYcMlP7RvHnEjSg',
  'demo',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '14 days',
  'César Salinas',
  '+56 9 1234 5678',
  'psicologia'
) ON CONFLICT (email) DO NOTHING;

-- 5. INSERT de cliente de prueba con plan anual activo
INSERT INTO clientes_sistema (
  nombre_negocio, email, password_hash, plan,
  fecha_inicio, fecha_expiracion,
  contacto_nombre, contacto_tel, rubro
) VALUES (
  'Clínica Ejemplo',
  'clinica@ejemplo.cl',
  '$2b$10$rQnW3yZ1vX8kL2mN4pO6uOqVwJhGfDsAeKiTxBzYcMlP7RvHnEjSg',
  'anual',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '365 days',
  'Ana García',
  '+56 9 9876 5432',
  'clinica'
) ON CONFLICT (email) DO NOTHING;

-- 6. Función para limpiar sesiones vencidas automáticamente
CREATE OR REPLACE FUNCTION limpiar_sesiones_vencidas()
RETURNS void AS $$
BEGIN
  DELETE FROM sesiones WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- 7. Deshabilitar RLS en estas tablas (acceso via secret key desde el admin)
ALTER TABLE clientes_sistema DISABLE ROW LEVEL SECURITY;
ALTER TABLE pagos DISABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones DISABLE ROW LEVEL SECURITY;

-- 8. Columnas de Google Calendar (agregar si aún no existen)
ALTER TABLE clientes_sistema ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
