-- Agrega columna acteco (código actividad económica CIIU) a dte_config
-- Requerida por DTE_v10.xsd (EmisorType minOccurs=1) para tipo 33 (Factura Electrónica)
-- Ejecutar en Supabase SQL Editor: https://xztqawulvrtjvtfixofy.supabase.co

ALTER TABLE dte_config ADD COLUMN IF NOT EXISTS acteco INTEGER DEFAULT NULL;
