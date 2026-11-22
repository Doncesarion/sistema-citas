-- ============================================================
-- Attempo — Columna motivo_perdida en tabla leads
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_perdida TEXT;
