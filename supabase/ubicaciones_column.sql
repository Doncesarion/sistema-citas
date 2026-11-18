-- Agregar columna ubicaciones a clientes_sistema para soporte de múltiples sedes
-- Ejecutar en el SQL Editor de Supabase

ALTER TABLE clientes_sistema
  ADD COLUMN IF NOT EXISTS ubicaciones JSONB DEFAULT '[]'::jsonb;
