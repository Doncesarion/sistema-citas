-- Previene doble-booking a nivel de base de datos.
-- Aplica solo a citas en estado activo (no canceladas ni inasistencias).
-- Ejecutar en: Supabase Dashboard → SQL Editor

CREATE UNIQUE INDEX IF NOT EXISTS idx_citas_unique_slot
ON citas (especialista_id, fecha, hora)
WHERE estado NOT IN (
  'cancelada', 'canceled', 'cancelled',
  'inasistencia', 'no-show', 'no_show'
);
