-- Vista usada por attempo-booking.html para verificar horas ocupadas al seleccionar día.
-- Ejecutar una sola vez en SQL Editor de Supabase.
-- Permite buscar por cliente_id, fecha y estado, igual que la tabla citas pero solo los campos necesarios.

CREATE OR REPLACE VIEW citas_disponibilidad AS
SELECT
  id,
  cliente_id,
  especialista_id,
  fecha,
  hora,
  estado,
  -- duracion puede no existir en la tabla base; ajustar según el schema real
  COALESCE(
    (SELECT s->>'duracion'
     FROM especialistas e,
          jsonb_array_elements(e.servicios) s
     WHERE e.id = citas.especialista_id
       AND s->>'nombre' = citas.servicio
     LIMIT 1),
    '60'
  ) AS duracion
FROM citas
WHERE estado <> 'canceled';

-- Deshabilitar RLS en la vista (acceso vía service role en booking público)
ALTER VIEW citas_disponibilidad OWNER TO postgres;

-- Si el anon key necesita leer la vista, habilitar SELECT para anon:
-- GRANT SELECT ON citas_disponibilidad TO anon;
-- NOTA: La vista no expone datos sensibles del paciente (sin nombre, email, tel).
