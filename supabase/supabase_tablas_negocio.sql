-- ================================================
-- SISTEMA AGENDA - Tablas de datos por negocio
-- Pega esto en SQL Editor de Supabase y ejecuta
-- ================================================

-- 1. CONFIGURACIÓN DEL NEGOCIO
CREATE TABLE IF NOT EXISTS negocios_config (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id      UUID REFERENCES clientes_sistema(id) ON DELETE CASCADE,
  nombre          TEXT DEFAULT 'Mi Negocio',
  emoji           TEXT DEFAULT '📋',
  whatsapp        TEXT DEFAULT '',
  direccion       TEXT DEFAULT '',
  horario         TEXT DEFAULT 'Lun–Sáb · 09:00–19:00',
  color_actual    TEXT DEFAULT '#2563eb',
  servicios       JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ESPECIALISTAS
CREATE TABLE IF NOT EXISTS especialistas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id      UUID REFERENCES clientes_sistema(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  especialidad    TEXT DEFAULT '',
  email           TEXT DEFAULT '',
  tel             TEXT DEFAULT '',
  color           TEXT DEFAULT '#2563eb',
  foto            TEXT DEFAULT '',
  dias            JSONB DEFAULT '[]',
  servicios       JSONB DEFAULT '[]',
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CITAS
CREATE TABLE IF NOT EXISTS citas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id      UUID REFERENCES clientes_sistema(id) ON DELETE CASCADE,
  especialista_id UUID REFERENCES especialistas(id) ON DELETE SET NULL,
  fecha           DATE NOT NULL,
  hora            TEXT NOT NULL,
  nombre_paciente TEXT NOT NULL,
  email_paciente  TEXT DEFAULT '',
  tel_paciente    TEXT DEFAULT '',
  servicio        TEXT NOT NULL,
  precio          INTEGER DEFAULT 0,
  estado          TEXT DEFAULT 'pending' CHECK (estado IN ('pending','done','canceled')),
  reagendamientos INTEGER DEFAULT 0,
  nota            TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PACIENTES / CLIENTES DEL NEGOCIO
CREATE TABLE IF NOT EXISTS pacientes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id      UUID REFERENCES clientes_sistema(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  email           TEXT DEFAULT '',
  tel             TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cliente_id, email)
);

-- 5. ÍNDICES para que las consultas sean rápidas
CREATE INDEX IF NOT EXISTS idx_citas_cliente    ON citas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_citas_fecha      ON citas(fecha);
CREATE INDEX IF NOT EXISTS idx_citas_estado     ON citas(estado);
CREATE INDEX IF NOT EXISTS idx_esp_cliente      ON especialistas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pac_cliente      ON pacientes(cliente_id);

-- 6. Deshabilitar RLS (acceso via Edge Function con service role)
ALTER TABLE negocios_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE especialistas   DISABLE ROW LEVEL SECURITY;
ALTER TABLE citas           DISABLE ROW LEVEL SECURITY;
ALTER TABLE pacientes       DISABLE ROW LEVEL SECURITY;

-- Columnas Google Calendar (agregar si aún no existen)
ALTER TABLE citas ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- 7. Datos de ejemplo para el cliente de prueba
-- Primero obtenemos el ID del cliente de prueba
DO $$
DECLARE
  v_cliente_id UUID;
  v_esp1_id    UUID;
  v_esp2_id    UUID;
  v_esp3_id    UUID;
  v_esp4_id    UUID;
BEGIN
  SELECT id INTO v_cliente_id FROM clientes_sistema WHERE email = 'prueba@test.cl' LIMIT 1;
  IF v_cliente_id IS NULL THEN
    RAISE NOTICE 'Cliente prueba@test.cl no encontrado, saltando datos de ejemplo';
    RETURN;
  END IF;

  -- Config del negocio
  INSERT INTO negocios_config (cliente_id, nombre, emoji, whatsapp, direccion, horario, color_actual, servicios)
  VALUES (v_cliente_id, 'Clínica Demo', '🏥', '+56912345678', 'Av. Principal 123, Santiago', 'Lun–Sáb · 09:00–19:00', '#2563eb',
    '[{"nombre":"Consulta general","emoji":"🩺","precio":25000,"duracion":"45 min"},
      {"nombre":"Revisión rápida","emoji":"⚡","precio":15000,"duracion":"20 min"},
      {"nombre":"Sesión completa","emoji":"⭐","precio":40000,"duracion":"60 min"},
      {"nombre":"Seguimiento","emoji":"📋","precio":18000,"duracion":"30 min"}]'::jsonb)
  ON CONFLICT DO NOTHING;

  -- Especialistas
  INSERT INTO especialistas (cliente_id, nombre, especialidad, email, tel, color, dias, servicios)
  VALUES (v_cliente_id, 'César Salinas', 'Psicólogo clínico', 'cesar@clinica.cl', '+56912345001', '#2563eb',
    '["lunes","martes","miércoles","jueves","viernes"]'::jsonb,
    '["Consulta general","Sesión completa","Seguimiento"]'::jsonb)
  RETURNING id INTO v_esp1_id;

  INSERT INTO especialistas (cliente_id, nombre, especialidad, email, tel, color, dias, servicios)
  VALUES (v_cliente_id, 'Tamara Rojas', 'Psicóloga infantil', 'tamara@clinica.cl', '+56912345002', '#db2777',
    '["lunes","miércoles","viernes"]'::jsonb,
    '["Consulta general","Revisión rápida","Seguimiento"]'::jsonb)
  RETURNING id INTO v_esp2_id;

  INSERT INTO especialistas (cliente_id, nombre, especialidad, email, tel, color, dias, servicios)
  VALUES (v_cliente_id, 'Andrea Muñoz', 'Neuropsicóloga', 'andrea@clinica.cl', '+56912345003', '#7c3aed',
    '["martes","jueves","viernes"]'::jsonb,
    '["Sesión completa","Consulta general"]'::jsonb)
  RETURNING id INTO v_esp3_id;

  INSERT INTO especialistas (cliente_id, nombre, especialidad, email, tel, color, dias, servicios)
  VALUES (v_cliente_id, 'Juanito Pérez', 'Psicólogo deportivo', 'juanito@clinica.cl', '+56912345004', '#16a34a',
    '["lunes","martes","miércoles","sábado"]'::jsonb,
    '["Revisión rápida","Seguimiento","Sesión completa"]'::jsonb)
  RETURNING id INTO v_esp4_id;

  -- Citas de ejemplo
  INSERT INTO citas (cliente_id, especialista_id, fecha, hora, nombre_paciente, email_paciente, tel_paciente, servicio, precio, estado, nota)
  VALUES
    (v_cliente_id, v_esp1_id, CURRENT_DATE, '09:00', 'Rodrigo Cárdenas', 'rodrigo@mail.com', '+56912345678', 'Consulta general', 25000, 'done', 'Paciente presenta avances en manejo de ansiedad.'),
    (v_cliente_id, v_esp2_id, CURRENT_DATE, '09:30', 'María Fuentes', 'maria@mail.com', '+56987654321', 'Revisión rápida', 15000, 'done', 'Seguimiento conductual positivo.'),
    (v_cliente_id, v_esp3_id, CURRENT_DATE, '10:00', 'Patricia Vera', 'patricia@mail.com', '+56911112222', 'Sesión completa', 40000, 'done', 'Evaluación neuropsicológica inicial completada.'),
    (v_cliente_id, v_esp1_id, CURRENT_DATE, '10:30', 'Felipe Morales', 'felipe@mail.com', '+56911111111', 'Sesión completa', 40000, 'pending', ''),
    (v_cliente_id, v_esp2_id, CURRENT_DATE, '11:00', 'Diego Castillo', 'diego@mail.com', '+56922222222', 'Consulta general', 25000, 'pending', ''),
    (v_cliente_id, v_esp4_id, CURRENT_DATE, '11:30', 'Camila Torres', 'camila@mail.com', '+56933334444', 'Seguimiento', 18000, 'pending', ''),
    (v_cliente_id, v_esp1_id, CURRENT_DATE, '14:00', 'Valentina Rojas', 'vale@mail.com', '+56933333333', 'Seguimiento', 18000, 'pending', ''),
    (v_cliente_id, v_esp3_id, CURRENT_DATE, '14:30', 'Catalina Muñoz', 'cata@mail.com', '+56944444444', 'Sesión completa', 40000, 'pending', ''),
    (v_cliente_id, v_esp1_id, CURRENT_DATE, '16:00', 'Sebastián Lagos', 'seba@mail.com', '+56955555555', 'Revisión rápida', 15000, 'canceled', ''),
    (v_cliente_id, v_esp1_id, CURRENT_DATE - 1, '09:00', 'Rodrigo Cárdenas', 'rodrigo@mail.com', '+56912345678', 'Seguimiento', 18000, 'done', 'Paciente reporta reducción del estrés laboral.'),
    (v_cliente_id, v_esp2_id, CURRENT_DATE - 1, '10:00', 'María Fuentes', 'maria@mail.com', '+56987654321', 'Consulta general', 25000, 'done', ''),
    (v_cliente_id, v_esp1_id, CURRENT_DATE - 2, '09:30', 'Felipe Morales', 'felipe@mail.com', '+56911111111', 'Sesión completa', 40000, 'done', 'Se trabajó duelo por separación.'),
    (v_cliente_id, v_esp2_id, CURRENT_DATE - 3, '10:00', 'María Fuentes', 'maria@mail.com', '+56987654321', 'Revisión rápida', 15000, 'canceled', ''),
    (v_cliente_id, v_esp3_id, CURRENT_DATE - 4, '14:00', 'Patricia Vera', 'patricia@mail.com', '+56911112222', 'Sesión completa', 40000, 'done', 'Evaluación de memoria completada.');

  RAISE NOTICE 'Datos de ejemplo creados para cliente %', v_cliente_id;
END $$;
