/**
 * api/dte.js — Facturación Electrónica DTE directo al SII
 * Cada profesional (cliente_id) configura su propio RUT, certificado (.p12) y CAF.
 * No depende de intermediarios: firma y envía directamente al SII.
 */

import crypto from 'crypto';
import { loadP12, parseCaf, buildDteXml, signDte, wrapEnvioDte, sendToSii } from '../lib/dte.js';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CERT_ENC_KEY = process.env.CERT_ENCRYPTION_KEY; // 32-byte hex: openssl rand -hex 32
const INTERNAL_KEY = process.env.INTERNAL_API_SECRET;

const sh     = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const shJson = { ...sh, 'Content-Type': 'application/json' };

// ── Auth helper (mismo mecanismo HMAC que el resto de las APIs) ───────────────
function verifySessionToken(token) {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const sb = Buffer.from(sig, 'hex');
    const eb = Buffer.from(expected, 'hex');
    if (sb.length !== eb.length || !crypto.timingSafeEqual(sb, eb)) return null;
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const [cliente_id, rol, expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id, rol };
}

function getClienteId(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
              || req.headers['x-session-token'];
  const session = verifySessionToken(token);
  if (!session) return null;
  const override = req.headers['x-override-cliente-id'];
  if (session.rol === 'superadmin' && override && /^[0-9a-f-]{36}$/i.test(override)) {
    return override;
  }
  return session.cliente_id;
}

// ── Cifrar/descifrar contraseña del .p12 ─────────────────────────────────────
function encryptPassword(plain) {
  if (!CERT_ENC_KEY) throw new Error('CERT_ENCRYPTION_KEY no configurada');
  const key = Buffer.from(CERT_ENC_KEY, 'hex');
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptPassword(enc) {
  if (!CERT_ENC_KEY) throw new Error('CERT_ENCRYPTION_KEY no configurada');
  const key = Buffer.from(CERT_ENC_KEY, 'hex');
  const buf = Buffer.from(enc, 'base64');
  const iv   = buf.subarray(0, 12);
  const tag  = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
}

// ── Calcular totales ─────────────────────────────────────────────────────────
function calcularTotales(items, tipoDte) {
  const esExento = tipoDte === 41 || tipoDte === 34;
  let neto = 0, exento = 0;
  for (const it of items) {
    const subtotal = Math.round(it.cantidad * it.precio_unitario);
    const linea = subtotal - (it.descuento_monto || 0);
    if (it.exento || esExento) exento += linea;
    else neto += linea;
    it.total_linea = linea;
  }
  const iva   = Math.round(neto * 0.19);
  const total = neto + iva + exento;
  return { neto, iva, exento, total };
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Sin configuración servidor' });

  const { action } = req.query;

  try {
    // ── GET config ────────────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'config') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/dte_config?cliente_id=eq.${cid}&limit=1`, { headers: sh });
      const [cfg] = await r.json().catch(() => []);
      return res.status(200).json(cfg || null);
    }

    // ── POST config ───────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'config') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });

      const { rut, razon_social, giro, direccion, comuna, region, fecha_resolucion, numero_resolucion, ambiente, email } = req.body || {};
      if (!rut || !razon_social) return res.status(400).json({ error: 'RUT y razón social requeridos' });

      const payload = { cliente_id: cid, rut, razon_social, giro: giro || '', direccion: direccion || '', comuna: comuna || '', region: region || '', fecha_resolucion: fecha_resolucion || null, numero_resolucion: numero_resolucion ?? null, ambiente: ambiente || 'certificacion', email: email || '', updated_at: new Date().toISOString() };

      const r = await fetch(`${SUPABASE_URL}/rest/v1/dte_config?on_conflict=cliente_id`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      return res.status(r.ok ? 200 : 500).json(Array.isArray(data) ? data[0] : data);
    }

    // ── POST upload_cert — sube .p12 (base64) y guarda en Storage ─────────────
    if (req.method === 'POST' && action === 'upload_cert') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });

      const { p12_b64, password } = req.body || {};
      if (!p12_b64 || !password) return res.status(400).json({ error: 'Faltan p12_b64 y password' });
      if (!CERT_ENC_KEY) return res.status(500).json({ error: 'CERT_ENCRYPTION_KEY no configurada en Vercel' });

      // Verificar que el .p12 es válido antes de guardar
      let rutFirmante;
      try {
        const { rut } = loadP12(p12_b64, password);
        rutFirmante = rut;
      } catch(e) {
        return res.status(400).json({ error: 'Certificado inválido o contraseña incorrecta: ' + e.message });
      }

      // Asegurar que el bucket existe (lo crea si no hay)
      await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST', headers: shJson,
        body: JSON.stringify({ id: 'dte-certs', name: 'dte-certs', public: false })
      }).catch(() => {});

      // Subir a Storage
      const path = `dte-certs/${cid}_${Date.now()}.p12`;
      const buf  = Buffer.from(p12_b64, 'base64');
      const upR  = await fetch(`${SUPABASE_URL}/storage/v1/object/dte-certs/${path}`, {
        method: 'POST',
        headers: { ...sh, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
        body: buf
      });
      if (!upR.ok) {
        const upErr = await upR.json().catch(() => ({}));
        return res.status(500).json({ error: 'Error subiendo certificado: ' + (upErr.message || upErr.error || upR.status) });
      }

      // Desactivar certs anteriores
      await fetch(`${SUPABASE_URL}/rest/v1/dte_certificados?cliente_id=eq.${cid}`, {
        method: 'PATCH', headers: shJson, body: JSON.stringify({ activo: false })
      });

      // Guardar registro
      const certR = await fetch(`${SUPABASE_URL}/rest/v1/dte_certificados`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'return=representation' },
        body: JSON.stringify({ cliente_id: cid, storage_path: path, password_enc: encryptPassword(password), rut_firmante: rutFirmante, activo: true })
      });
      const cert = await certR.json();
      return res.status(201).json({ ok: true, rut_firmante: rutFirmante, id: Array.isArray(cert) ? cert[0]?.id : cert?.id });
    }

    // ── POST upload_caf — sube XML del CAF ───────────────────────────────────
    if (req.method === 'POST' && action === 'upload_caf') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });

      const { xml_caf } = req.body || {};
      if (!xml_caf) return res.status(400).json({ error: 'Falta xml_caf' });

      let parsed;
      try { parsed = parseCaf(xml_caf); }
      catch(e) { return res.status(400).json({ error: 'CAF inválido: ' + e.message }); }

      const { tipoDoc, folioDesde, folioHasta } = parsed;

      // Desactivar CAF anterior del mismo tipo
      await fetch(`${SUPABASE_URL}/rest/v1/dte_cafs?cliente_id=eq.${cid}&tipo_documento=eq.${tipoDoc}`, {
        method: 'PATCH', headers: shJson, body: JSON.stringify({ activo: false })
      });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/dte_cafs`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'return=representation' },
        body: JSON.stringify({ cliente_id: cid, tipo_documento: tipoDoc, xml_caf, folio_desde: folioDesde, folio_hasta: folioHasta, folio_siguiente: folioDesde, activo: true })
      });
      const data = await r.json();
      return res.status(201).json({ ok: true, tipo: tipoDoc, desde: folioDesde, hasta: folioHasta, id: Array.isArray(data) ? data[0]?.id : data?.id });
    }

    // ── GET cafs — lista CAFs activos ─────────────────────────────────────────
    if (req.method === 'GET' && action === 'cafs') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/dte_cafs?cliente_id=eq.${cid}&activo=eq.true&select=tipo_documento,folio_desde,folio_hasta,folio_siguiente`, { headers: sh });
      return res.status(200).json(await r.json().catch(() => []));
    }

    // ── GET cert — estado del certificado activo ──────────────────────────────
    if (req.method === 'GET' && action === 'cert') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/dte_certificados?cliente_id=eq.${cid}&activo=eq.true&select=rut_firmante,created_at&order=created_at.desc&limit=1`, { headers: sh });
      const [cert] = await r.json().catch(() => []);
      return res.status(200).json(cert || null);
    }

    // ── POST emitir — emite DTE para una cita ────────────────────────────────
    if (req.method === 'POST' && action === 'emitir') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });

      const { cita_id, tipo_documento, receptor_rut, receptor_nombre, items, medio_pago } = req.body || {};
      if (!tipo_documento || !items?.length) return res.status(400).json({ error: 'Faltan tipo_documento e items' });

      const tipoDte = parseInt(tipo_documento);

      // Cargar config DTE del profesional
      const cfgR = await fetch(`${SUPABASE_URL}/rest/v1/dte_config?cliente_id=eq.${cid}&limit=1`, { headers: sh });
      const [cfg] = await cfgR.json().catch(() => []);
      if (!cfg) return res.status(400).json({ error: 'Configura primero los datos de facturación (RUT, giro, resolución SII).' });
      if (!cfg.fecha_resolucion || cfg.numero_resolucion === null || cfg.numero_resolucion === undefined) {
        return res.status(400).json({ error: 'Falta la resolución SII. Agrégala en Configuración → Facturación.' });
      }

      // CAF activo para este tipo
      const cafR = await fetch(`${SUPABASE_URL}/rest/v1/dte_cafs?cliente_id=eq.${cid}&tipo_documento=eq.${tipoDte}&activo=eq.true&limit=1`, { headers: sh });
      const [caf] = await cafR.json().catch(() => []);
      if (!caf) return res.status(400).json({ error: `No hay CAF activo para tipo ${tipoDte}. Súbelo en Configuración → Facturación → CAF.` });
      if (caf.folio_siguiente > caf.folio_hasta) return res.status(400).json({ error: 'CAF agotado. Solicita un nuevo CAF al SII.' });

      // Certificado activo
      const certR = await fetch(`${SUPABASE_URL}/rest/v1/dte_certificados?cliente_id=eq.${cid}&activo=eq.true&order=created_at.desc&limit=1`, { headers: sh });
      const [cert] = await certR.json().catch(() => []);
      if (!cert) return res.status(400).json({ error: 'No hay certificado digital. Sube tu .p12 en Configuración → Facturación.' });

      // Descargar .p12
      const p12Res = await fetch(`${SUPABASE_URL}/storage/v1/object/dte-certs/${cert.storage_path}`, { headers: sh });
      if (!p12Res.ok) return res.status(500).json({ error: 'No se pudo cargar el certificado digital' });
      const p12Buffer = Buffer.from(await p12Res.arrayBuffer());

      // Descifrar y extraer claves
      const password = decryptPassword(cert.password_enc);
      const { privateKeyPem, certPem } = loadP12(p12Buffer, password);
      const { clavePrivadaPem } = parseCaf(caf.xml_caf);

      // Calcular totales
      const folio    = caf.folio_siguiente;
      const docItems = items.map(it => ({ ...it, cantidad: it.cantidad ?? 1, precio_unitario: Math.round(it.precio_unitario) }));
      const totales  = calcularTotales(docItems, tipoDte);
      const fechaHoy = new Date().toISOString().slice(0, 10);

      const docObj = {
        tipo_documento: tipoDte,
        folio,
        fecha_emision: fechaHoy,
        receptor_rut:    receptor_rut    || '66666666-6',
        receptor_nombre: receptor_nombre || 'Consumidor Final',
        medio_pago: medio_pago || null,
        items: docItems,
        ...totales,
      };

      const empresa = {
        rut:               cfg.rut,
        razon_social:      cfg.razon_social,
        giro:              cfg.giro || 'Servicios',
        direccion:         cfg.direccion || 'Sin dirección',
        comuna:            cfg.comuna || 'Santiago',
        region:            cfg.region || 'Santiago',
        email:             cfg.email || '',
        fecha_resolucion:  cfg.fecha_resolucion,
        numero_resolucion: cfg.numero_resolucion,
        ambiente:          cfg.ambiente || 'produccion',
      };

      // Construir, firmar, envolver y enviar al SII
      const dteXml    = buildDteXml(docObj, empresa);
      const dteFirmado = signDte(dteXml, privateKeyPem, certPem, caf.xml_caf, clavePrivadaPem, {
        tipoDoc: tipoDte, rutEmisor: cfg.rut, folio,
        fechaEmision: fechaHoy,
        rutReceptor: docObj.receptor_rut,
        montoTotal: totales.total,
      });
      const envioDte = wrapEnvioDte(dteFirmado, empresa, { privateKeyPem, certPem, rutFirmante: cert.rut_firmante });
      const { trackId } = await sendToSii(envioDte, empresa, cert.rut_firmante, privateKeyPem);

      // Avanzar folio
      await fetch(`${SUPABASE_URL}/rest/v1/dte_cafs?id=eq.${caf.id}&cliente_id=eq.${cid}`, {
        method: 'PATCH', headers: shJson,
        body: JSON.stringify({ folio_siguiente: folio + 1, updated_at: new Date().toISOString() })
      });

      // Guardar documento
      const docInsert = await fetch(`${SUPABASE_URL}/rest/v1/dte_documentos`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'return=representation' },
        body: JSON.stringify({
          cliente_id: cid, cita_id: cita_id || null,
          tipo_documento: tipoDte, folio,
          receptor_rut: docObj.receptor_rut, receptor_nombre: docObj.receptor_nombre,
          total: totales.total, items: docItems,
          track_id_sii: String(trackId),
          estado: 'emitido',
          fecha_emision: fechaHoy,
        })
      });
      const docCreado = await docInsert.json().catch(() => null);
      const docId = Array.isArray(docCreado) ? docCreado[0]?.id : docCreado?.id;

      // Marcar cita con boleta emitida
      if (cita_id) {
        fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita_id}&cliente_id=eq.${cid}`, {
          method: 'PATCH', headers: shJson,
          body: JSON.stringify({ boleta_emitida: true, boleta_folio: folio, boleta_tipo: tipoDte })
        }).catch(() => {});
      }

      return res.status(200).json({ ok: true, folio, track_id: trackId, doc_id: docId });
    }

    // ── GET documentos ────────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'documentos') {
      const cid = await getClienteId(req);
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const { desde, hasta, limit = 50 } = req.query;
      let filter = `cliente_id=eq.${cid}&order=fecha_emision.desc,folio.desc&limit=${limit}`;
      if (desde) filter += `&fecha_emision=gte.${desde}`;
      if (hasta) filter += `&fecha_emision=lte.${hasta}`;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/dte_documentos?${filter}`, { headers: sh });
      return res.status(200).json(await r.json().catch(() => []));
    }

    return res.status(404).json({ error: 'Acción no reconocida' });

  } catch(e) {
    console.error('dte.js error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
