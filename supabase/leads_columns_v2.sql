-- ============================================================
-- Attempo — Columnas adicionales tabla leads
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS requiere_atencion BOOLEAN DEFAULT false;
