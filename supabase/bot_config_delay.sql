-- Agregar columnas de delay a bot_config
-- Ejecutar en el SQL Editor de Supabase

ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS delay_min_seg INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_max_seg INTEGER NOT NULL DEFAULT 0;
