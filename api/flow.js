import crypto from 'crypto';

const SUPABASE_URL    = 'https://xztqawulvrtjvtfixofy.supabase.co';
const FLOW_API_URL    = (process.env.FLOW_API_URL || 'https://www.flow.cl/api').trim().replace(/\/$/, '');
const BASE_URL        = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');
const WEBPAY_INT_URL  = 'https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2';
const WEBPAY_PROD_URL = 'https://webpay3g.transbank.cl/rswebpaytransaction/api/webpay/v1.2';

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
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const [cliente_id, rol, expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id, rol };
}

function verifySaToken(token) {
  if (!token) return false;
  const SA_SECRET = process.env.SA_SECRET;
  if (!SA_SECRET) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SA_SECRET).update(payload).digest('hex');
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  } catch { return false; }
  if (Date.now() > parseInt(payload)) return false;
  return true;
}

function flowSign(params, secret) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secret || process.env.FLOW_SECRET_KEY).update(str).digest('hex');
}

function generateManageToken(cita_id) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('gestionar:' + cita_id).digest('hex');
}

function generateSubToken(cid, plan, monto, tipo_plan = '') {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`sub:${cid}:${plan}:${monto}:${tipo_plan}`).digest('hex').slice(0, 16);
}

function generateRecToken(cid, subtipo, codigo, monto) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`rec:${cid}:${subtipo}:${codigo}:${monto}`).digest('hex').slice(0, 16);
}

function webpayHeaders(code, secret) {
  return { 'Tbk-Api-Key-Id': code, 'Tbk-Api-Key-Secret': secret, 'Content-Type': 'application/json' };
}

const flowWebhookRateLimit = new Map();

function htmlEscape(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function emailPendientePagoHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, precio, payment_url, cita_id }) {
  const np  = htmlEscape(nombre_paciente);
  const ne  = htmlEscape(nombre_especialista || 'Profesional');
  const sv  = htmlEscape(servicio || 'Consulta');
  const nn  = htmlEscape(negocio_nombre || 'la clínica');
  const precioStr = precio
    ? '$' + Number(precio).toLocaleString('es-CL')
    : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Completa el pago de tu cita</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${np}</strong>, tu hora está reservada. Solo falta el pago para confirmarla.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Centro</span><br><span style="color:#2d2d2d;font-size:15px;">${nn}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${ne}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(fechaFmt)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(hora)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${sv}</span></td></tr>
    ${precioStr ? `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total a pagar</span><br><span style="color:#6C5CE4;font-size:22px;font-weight:700;">${htmlEscape(precioStr)}</span></td></tr>` : ''}
  </table>
  <a href="${htmlEscape(payment_url)}" target="_blank"
     style="display:inline-block;padding:14px 36px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:0.3px;">
    Pagar ahora
  </a>
  <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;text-align:center;">
    Este enlace es válido por 72 horas. Si no puedes pagar, <a href="${BASE_URL}/gestionar-cita?id=${htmlEscape(cita_id)}&token=${generateManageToken(cita_id)}" style="color:#6C5CE4;text-decoration:none;">cancela tu cita aquí</a>.
  </p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function emailWebpayPendienteHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, precio, payment_url, cita_id }) {
  const np  = htmlEscape(nombre_paciente);
  const ne  = htmlEscape(nombre_especialista || 'Profesional');
  const sv  = htmlEscape(servicio || 'Consulta');
  const nn  = htmlEscape(negocio_nombre || 'la clínica');
  const precioStr = precio
    ? '$' + Number(precio).toLocaleString('es-CL')
    : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Completa el pago de tu cita</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${np}</strong>, tu hora está reservada. Solo falta el pago para confirmarla.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Centro</span><br><span style="color:#2d2d2d;font-size:15px;">${nn}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${ne}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(fechaFmt)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(hora)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${sv}</span></td></tr>
    ${precioStr ? `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total a pagar</span><br><span style="color:#6C5CE4;font-size:22px;font-weight:700;">${htmlEscape(precioStr)}</span></td></tr>` : ''}
  </table>
  <a href="${htmlEscape(payment_url)}" target="_blank"
     style="display:inline-block;padding:14px 36px;background:#005BBB;color:#fff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:0.3px;">
    Pagar con Webpay
  </a>
  <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;text-align:center;">
    Si no puedes pagar, <a href="${BASE_URL}/gestionar-cita?id=${htmlEscape(cita_id)}&token=${generateManageToken(cita_id)}" style="color:#6C5CE4;text-decoration:none;">cancela tu cita aquí</a>.
  </p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function emailConfirmadoHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, precio, direccion, email_negocio, cita_id }) {
  const np  = htmlEscape(nombre_paciente);
  const ne  = htmlEscape(nombre_especialista || 'Profesional');
  const sv  = htmlEscape(servicio || 'Consulta');
  const dir = htmlEscape(direccion);
  const en  = htmlEscape(email_negocio);
  const precioStr = precio ? '$' + Number(precio).toLocaleString('es-CL') : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Pago confirmado — cita reservada</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${np}</strong>, recibimos tu pago. Tu hora está confirmada.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${ne}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(fechaFmt)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(hora)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${sv}</span></td></tr>
    ${precioStr ? `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total pagado</span><br><span style="color:#6C5CE4;font-size:18px;font-weight:700;">${htmlEscape(precioStr)}</span></td></tr>` : ''}
  </table>
  ${dir ? `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
    <tr><td style="text-align:center;">
      <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">${dir}</p>
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}" target="_blank"
         style="display:inline-block;padding:10px 22px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        Ver en Google Maps
      </a>
    </td></tr>
  </table>` : ''}
  <p style="margin:20px 0 6px;color:#6b7280;font-size:13px;text-align:center;">
    ¿Necesitas cambios? <a href="${BASE_URL}/gestionar-cita?id=${htmlEscape(cita_id)}&token=${generateManageToken(cita_id)}" style="color:#6C5CE4;font-weight:600;text-decoration:none;">Cancelar o reagendar tu cita</a>
  </p>
  ${en ? `<p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">También puedes enviarnos un mail a <a href="mailto:${en}" style="color:#6C5CE4;text-decoration:none;">${en}</a></p>` : ''}
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function handleSubWebhook(commerceOrder, statusData, res) {
  // Formato legado (39): AT{planCode}{uuid32}{4digits}
  // Formato nuevo  (40): AT{planCode}{tipoCode}{uuid32}{4digits}  — incluye tipo_plan
  if (commerceOrder.length < 35) return res.status(200).send('ok');
  const planCode  = commerceOrder[2];
  const plan      = planCode === 'a' ? 'anual' : 'mensual';
  const hasNuevo  = commerceOrder.length >= 40;
  const TIPO_MAP  = { i:'inicio', p:'pro', c:'clinica_ia' };
  const tipo_plan = hasNuevo ? (TIPO_MAP[commerceOrder[3]] || null) : null;
  const uuidClean = hasNuevo ? commerceOrder.slice(4, 36) : commerceOrder.slice(3, 35);
  const cliente_id = `${uuidClean.slice(0,8)}-${uuidClean.slice(8,12)}-${uuidClean.slice(12,16)}-${uuidClean.slice(16,20)}-${uuidClean.slice(20)}`;
  if (!['mensual', 'anual'].includes(plan) || uuidClean.length !== 32) return res.status(200).send('ok');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const monto = statusData.amount ? Math.round(Number(statusData.amount)) : (plan === 'anual' ? 285900 : 29900);
  const dias  = plan === 'anual' ? 365 : 30;
  const fecha_expiracion = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];

  const patchData = { activo: true, plan, fecha_expiracion };
  if (tipo_plan) patchData.tipo_plan = tipo_plan;

  await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cliente_id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify(patchData)
  }).catch(e => console.error('flow sub webhook: patch error:', e.message));

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/pagos`, {
    method: 'POST',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({
      cliente_id, plan, monto, plataforma: 'flow',
      referencia: String(statusData.flowOrder || statusData.commerceOrder)
    })
  }).catch(e => { console.error('flow sub webhook: insert pago network error:', e.message); return null; });
  if (insertRes && !insertRes.ok) {
    const errBody = await insertRes.text().catch(() => '');
    console.error('flow sub webhook: insert pago HTTP error:', insertRes.status, errBody);
  }

  console.log('flow sub webhook: suscripcion activada cliente_id=', cliente_id, 'plan=', plan);
  return res.status(200).send('ok');
}

async function handleSubPayment(req, res, clienteIdOverride = null) {
  const { plan } = req.body || {};
  const cliente_id = clienteIdOverride || req.body?.cliente_id;
  if (!cliente_id || !plan) return res.status(400).json({ error: 'Falta cliente_id o plan' });
  if (!['mensual', 'anual'].includes(plan)) return res.status(400).json({ error: 'Plan inválido' });

  const PRECIOS = {
    inicio:    { mensual: 24990,  anual: 239900  },
    pro:       { mensual: 44990,  anual: 431900  },
    clinica_ia:{ mensual: 119990, anual: 1151900 }
  };
  const tipoPlanKey = (req.body?.tipo_plan || 'inicio').toLowerCase().replace(/ /g,'_');
  const montoDefault = (PRECIOS[tipoPlanKey] || PRECIOS.inicio)[plan] || 24990;
  const montoReq = req.body.monto ? parseInt(req.body.monto) : null;
  const monto = (montoReq && montoReq > 0) ? montoReq : montoDefault;
  const tipo_plan = req.body?.tipo_plan || '';

  const t = generateSubToken(cliente_id, plan, monto, tipo_plan);
  const qs = new URLSearchParams({ cid: cliente_id, plan, monto: String(monto), t });
  if (tipo_plan) qs.set('tipo_plan', tipo_plan);

  const payment_url = `${BASE_URL}/webpay-plan.html?${qs.toString()}`;
  return res.json({ ok: true, payment_url });
}

// Precios y códigos de recordatorio
const REC_TOPUP   = { A: { cant: 100, monto: 1990 }, B: { cant: 300, monto: 4990 }, C: { cant: 500, monto: 7990 } };
const REC_MENSUAL = { A: { cant: 200, monto: 1990 }, B: { cant: 500, monto: 3990 }, C: { cant: 1000, monto: 6990 } };

async function handleRecPayment(req, res, cliente_id) {
  try {
    const { subtipo, codigo, monto } = req.body || {};

    const mapaValido = subtipo === 'topup' ? REC_TOPUP : subtipo === 'mensual' ? REC_MENSUAL : null;
    if (!mapaValido || !mapaValido[codigo]) return res.status(400).json({ error: 'Opción inválida' });

    const esperado = mapaValido[codigo].monto;
    if (parseInt(monto) !== esperado) return res.status(400).json({ error: `Monto no coincide: recibido ${monto}, esperado ${esperado}` });

    const t = generateRecToken(cliente_id, subtipo, codigo, monto);
    const qs = new URLSearchParams({ cid: cliente_id, subtipo, codigo, monto: String(monto), t });
    const payment_url = `${BASE_URL}/webpay-rec.html?${qs.toString()}`;
    return res.json({ ok: true, payment_url });
  } catch(e) {
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
}

async function handleRecWebhook(commerceOrder, res, sh) {
  // Formato: RC{T|M}{A|B|C}{uuid32}{4d} = 40 chars
  if (commerceOrder.length < 40) return res.status(200).send('ok');
  const tipoCode  = commerceOrder[2]; // T=topup, M=mensual
  const codigo    = commerceOrder[3]; // A, B, C
  const uuidClean = commerceOrder.slice(4, 36);
  if (uuidClean.length !== 32) return res.status(200).send('ok');

  const mapa    = tipoCode === 'T' ? REC_TOPUP : tipoCode === 'M' ? REC_MENSUAL : null;
  if (!mapa || !mapa[codigo]) return res.status(200).send('ok');
  const cantidad = mapa[codigo].cant;

  const cliente_id = `${uuidClean.slice(0,8)}-${uuidClean.slice(8,12)}-${uuidClean.slice(12,16)}-${uuidClean.slice(16,20)}-${uuidClean.slice(20)}`;
  const cr = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cliente_id)}&select=rec_mes_limit_extra,rec_limite_extra_mensual,rec_mes_key&limit=1`, { headers: sh });
  const [cli] = await cr.json();

  const mesActual = new Date().toISOString().slice(0, 7);
  let patch;

  if (tipoCode === 'T') {
    const actual = (cli?.rec_mes_key === mesActual ? cli.rec_mes_limit_extra : 0) || 0;
    patch = { rec_mes_limit_extra: actual + cantidad, rec_mes_key: mesActual };
  } else {
    patch = { rec_limite_extra_mensual: (cli?.rec_limite_extra_mensual || 0) + cantidad };
  }

  await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cliente_id)}`, {
    method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify(patch)
  }).catch(e => console.error('flow rec webhook patch error:', e.message));

  console.log(`flow rec webhook: ${tipoCode === 'T' ? 'top-up' : 'mensual'} +${cantidad} cliente=${cliente_id}`);
  return res.status(200).send('ok');
}

async function handleFlowWebhook(req, res) {
  const fwIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const fwNow = Date.now();
  const fwEntry = flowWebhookRateLimit.get(fwIp) || { count: 0, start: fwNow };
  if (fwNow - fwEntry.start > 60000) { fwEntry.count = 0; fwEntry.start = fwNow; }
  fwEntry.count++;
  flowWebhookRateLimit.set(fwIp, fwEntry);
  if (fwEntry.count > 10) return res.status(429).end();

  const token = req.body?.token;
  if (!token) return res.status(200).send('ok');

  // cid presente → pago de cita con credenciales propias del cliente
  const cid = req.query?.cid || null;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  let apiKey = process.env.FLOW_API_KEY;
  let secretKey = process.env.FLOW_SECRET_KEY;
  let citaFlowApiUrl = FLOW_API_URL;

  if (cid) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}&select=metodos_pago&limit=1`, { headers: sh });
      const data = await r.json();
      const cli = Array.isArray(data) ? data[0] : null;
      apiKey    = cli?.metodos_pago?.flow_api_key;
      secretKey = cli?.metodos_pago?.flow_secret_key;
      citaFlowApiUrl = cli?.metodos_pago?.flow_sandbox ? 'https://sandbox.flow.cl/api' : 'https://www.flow.cl/api';
    } catch(e) {
      console.error('flow webhook: error fetching client creds:', e.message);
      return res.status(200).send('ok');
    }
    if (!apiKey || !secretKey) {
      console.error('flow webhook: missing client credentials for cid:', cid);
      return res.status(200).send('ok');
    }
  }

  let statusData;
  try {
    const params = { apiKey, token };
    params.s = flowSign(params, secretKey);
    const qs = new URLSearchParams(params);
    const statusResp = await fetch(`${citaFlowApiUrl}/payment/getStatus?${qs}`);
    statusData = await statusResp.json();
  } catch(e) {
    console.error('flow webhook: getStatus error:', e.message);
    return res.status(200).send('ok');
  }

  console.log('flow webhook: status =', statusData.status, 'order =', statusData.commerceOrder);

  // Flow estados: 1=pendiente, 2=pagado, 3=rechazado, 4=anulado
  if (statusData.status !== 2) return res.status(200).send('ok');

  const commerceOrder = statusData.commerceOrder;
  if (!commerceOrder) return res.status(200).send('ok');

  // Suscripción attempo (orden empieza con 'AT')
  if (commerceOrder.startsWith('AT')) {
    return handleSubWebhook(commerceOrder, statusData, res);
  }

  // Compra de créditos de recordatorio (orden empieza con 'RC')
  if (commerceOrder.startsWith('RC')) {
    return handleRecWebhook(commerceOrder, res, sh);
  }

  // Pago de cotización (orden empieza con 'CT')
  if (commerceOrder.startsWith('CT')) {
    const uuidClean = commerceOrder.slice(2);
    const cot_id = [uuidClean.slice(0,8), uuidClean.slice(8,12), uuidClean.slice(12,16), uuidClean.slice(16,20), uuidClean.slice(20)].join('-');
    try {
      const rCot = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${encodeURIComponent(cot_id)}&limit=1`, { headers: sh });
      const [cot] = await rCot.json();
      if (!cot) { console.error('flow webhook CT: cotizacion no encontrada', cot_id); return res.status(200).send('ok'); }
      if (cot.estado === 'pagada') return res.status(200).send('ok');
      const respMerged = { ...(cot.respuesta || {}), metodo_pago: 'flow' };
      await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${encodeURIComponent(cot_id)}`, {
        method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'pagada', respuesta: respMerged })
      });
      // Email al negocio
      if (process.env.RESEND_API_KEY) {
        const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cot.cliente_id)}&select=nombre_negocio,email&limit=1`, { headers: sh });
        const [cli] = await rCli.json();
        if (cli?.email) {
          const neto = (cot.items || []).reduce((s, it) => s + (parseFloat(it.precio_unitario)||0)*(parseFloat(it.cantidad)||1)*(1-(parseFloat(it.descuento)||0)/100), 0);
          const total = cot.incluye_iva ? Math.round(neto * 1.19) : Math.round(neto);
          const totalFmt = '$' + total.toLocaleString('es-CL');
          const cliente = cot.datos_destinatario?.nombre || 'el cliente';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'attempo <contacto@attempo.cl>',
              to: [cli.email],
              subject: `Cotización N° ${cot.numero} — pago recibido ✓`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px"><img src="https://app.attempo.cl/attempo-logo.png" alt="attempo" style="height:32px;margin-bottom:24px"><h2 style="margin:0 0 8px;color:#1e1b3a">Pago recibido</h2><p style="color:#555;font-size:15px;margin:0 0 20px"><strong>${htmlEscape(cliente)}</strong> pagó la Cotización N° <strong>${cot.numero}</strong> por <strong style="color:#6C5CE4">${htmlEscape(totalFmt)}</strong> vía Flow.</p><p style="color:#888;font-size:13px">Ingresa a tu panel para ver los detalles.</p><a href="https://app.attempo.cl" style="display:inline-block;margin-top:16px;padding:11px 24px;background:#6C5CE4;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Ver panel →</a><p style="margin-top:32px;color:#bbb;font-size:11px">attempo · contacto@attempo.cl</p></div>`
            })
          }).catch(e => console.error('flow webhook CT: email error:', e.message));
        }
      }
    } catch(e) { console.error('flow webhook CT: error:', e.message); }
    console.log('flow webhook CT: cotizacion pagada id=', cot_id);
    return res.status(200).send('ok');
  }

  const cita_id = commerceOrder;

  const rCheck = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=estado_pago&limit=1`, { headers: sh });
  const [citaCheck] = await rCheck.json().catch(() => []);
  if (citaCheck?.estado_pago === 'pagado') return res.status(200).send('ok');

  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'confirmed', estado_pago: 'pagado', metodo_pago: 'flow' })
  }).catch(e => console.error('flow webhook: patch error:', e.message));

  try {
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
    const [cita] = await cr.json();

    if (!cita?.email_paciente || !process.env.RESEND_API_KEY) return res.status(200).send('ok');

    let nombre_especialista = null;
    if (cita.especialista_id) {
      const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`, { headers: sh });
      const [esp] = await re.json();
      nombre_especialista = esp?.nombre || null;
    }

    const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=nombre_negocio,direccion,email&limit=1`, { headers: sh });
    const [cliente] = await rcli.json();

    const fechaFmt = new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Attempo <contacto@attempo.cl>',
        to: [cita.email_paciente],
        subject: `Pago confirmado — tu cita en ${cliente?.nombre_negocio || 'la clínica'} está reservada ✓`,
        headers: {
          'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        },
        html: emailConfirmadoHtml({
          nombre_paciente:    cita.nombre_paciente,
          nombre_especialista,
          fechaFmt,
          hora:               cita.hora,
          servicio:           cita.servicio,
          negocio_nombre:     cliente?.nombre_negocio || null,
          precio:             cita.precio,
          direccion:          cliente?.direccion || null,
          email_negocio:      cliente?.email || null,
          cita_id:            cita.id
        })
      })
    }).catch(e => console.error('flow webhook: email error:', e.message));
  } catch(e) {
    console.error('flow webhook: post-payment error:', e.message);
  }

  return res.status(200).send('ok');
}

async function handleWebpayInit(req, res, session) {
  const { cita_id } = req.body || {};
  if (!cita_id) return res.status(400).json({ error: 'Falta cita_id' });

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const cr = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
  const [cita] = await cr.json();
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

  if (session.rol !== 'superadmin' && cita.cliente_id !== session.cliente_id) {
    return res.status(403).json({ error: 'Sin permiso para esta cita' });
  }

  if (!cita.email_paciente) return res.status(400).json({ error: 'La cita no tiene email del paciente' });
  if (!cita.precio) return res.status(400).json({ error: 'La cita no tiene precio asignado' });

  const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cita.cliente_id)}&select=nombre_negocio,metodos_pago&limit=1`, { headers: sh });
  const [cli] = await rcli.json();
  const mp = cli?.metodos_pago || {};

  if (!mp.webpay_commerce_code || !mp.webpay_api_key_secret) {
    return res.status(400).json({ error: 'Este negocio no tiene Webpay configurado. Agrega las credenciales en Configuración → Pagos.' });
  }

  let nombre_especialista = null;
  if (cita.especialista_id) {
    try {
      const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`, { headers: sh });
      const [esp] = await re.json();
      nombre_especialista = esp?.nombre || null;
    } catch(e) { console.error('webpay_init: especialista error:', e.message); }
  }

  // Update cita to pending_payment with metodo_pago=webpay
  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'pending_payment', metodo_pago: 'webpay' })
  }).catch(e => console.error('webpay_init: patch error:', e.message));

  const pago_url = `${BASE_URL}/webpay-pagar.html?cita=${encodeURIComponent(cita_id)}&t=${generateManageToken(cita_id)}`;

  let email_ok = false;
  let email_error = null;
  if (process.env.RESEND_API_KEY && cita.email_paciente) {
    const fechaFmt = new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    try {
      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: [cita.email_paciente],
          subject: `Pago pendiente — tu cita en ${cli?.nombre_negocio || 'la clínica'}`,
          headers: {
            'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
          html: emailWebpayPendienteHtml({
            nombre_paciente:    cita.nombre_paciente,
            nombre_especialista,
            fechaFmt,
            hora:               cita.hora,
            servicio:           cita.servicio,
            negocio_nombre:     cli?.nombre_negocio || null,
            precio:             cita.precio,
            payment_url:        pago_url,
            cita_id:            cita.id
          })
        })
      });
      if (emailResp.ok) {
        email_ok = true;
      } else {
        const errBody = await emailResp.text().catch(() => '');
        email_error = `Resend ${emailResp.status}: ${errBody}`;
        console.error('webpay_init: email error:', email_error);
      }
    } catch(e) {
      email_error = e.message;
      console.error('webpay_init: email error:', e.message);
    }
  }

  return res.json({ ok: true, pago_url, email_ok, email_error });
}

async function handleWebpayCreate(req, res) {
  const { cita_id, t } = req.body || {};
  if (!cita_id || !t) {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return res.status(400).send('<!DOCTYPE html><html><body><p>Parámetros inválidos.</p></body></html>');
  }

  if (t !== generateManageToken(cita_id)) {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return res.status(403).send('<!DOCTYPE html><html><body><p>Token inválido.</p></body></html>');
  }

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const cr = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
  const [cita] = await cr.json();
  if (!cita) {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return res.status(404).send('<!DOCTYPE html><html><body><p>Cita no encontrada.</p></body></html>');
  }

  if (cita.estado_pago === 'pagado') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return res.status(400).send('<!DOCTYPE html><html><body><p>Esta cita ya fue pagada.</p></body></html>');
  }

  const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cita.cliente_id)}&select=metodos_pago&limit=1`, { headers: sh });
  const [cli] = await rcli.json();
  const mp = cli?.metodos_pago || {};

  if (!mp.webpay_commerce_code || !mp.webpay_api_key_secret) {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return res.status(400).send('<!DOCTYPE html><html><body><p>Webpay no configurado para este negocio.</p></body></html>');
  }

  const baseUrl = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;
  const precio = Math.round(Number(String(cita.precio).replace(/\./g, '').replace(',', '.')));
  const suffix    = String(Date.now() % 100000).padStart(5, '0');
  const buy_order = cita_id.replace(/-/g, '').slice(0, 19) + suffix;
  const return_url = `${BASE_URL}/api/flow?tipo=webpay_return&cid=${encodeURIComponent(cita.cliente_id)}&cita=${encodeURIComponent(cita_id)}`;

  let initData;
  try {
    const initResp = await fetch(`${baseUrl}/transactions`, {
      method: 'POST',
      headers: webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret),
      body: JSON.stringify({ buy_order, session_id: cita_id, amount: precio, return_url })
    });
    initData = await initResp.json();
    if (!initResp.ok || !initData.token || !initData.url) {
      console.error('webpay_create: init error:', JSON.stringify(initData));
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      return res.status(502).send(`<!DOCTYPE html><html><body><p>Error al iniciar pago Webpay: ${htmlEscape(JSON.stringify(initData))}</p></body></html>`);
    }
  } catch(e) {
    console.error('webpay_create: fetch error:', e.message);
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return res.status(502).send('<!DOCTYPE html><html><body><p>No se pudo conectar con Webpay. Intenta nuevamente.</p></body></html>');
  }

  const url = htmlEscape(initData.url);
  const tkn = htmlEscape(initData.token);
  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Redirigiendo a Webpay...</title></head><body><form id="f" method="POST" action="${url}"><input type="hidden" name="token_ws" value="${tkn}"></form><script>document.getElementById('f').submit();</script></body></html>`);
}

async function handleWebpayReturn(req, res) {
  const cid       = req.query?.cid  || null;
  const cita_id   = req.query?.cita || null;
  const token_ws      = req.body?.token_ws      || req.query?.token_ws      || null;
  const TBK_TOKEN     = req.body?.TBK_TOKEN     || req.query?.TBK_TOKEN     || null;
  const TBK_ID_SESION = req.body?.TBK_ID_SESION || req.query?.TBK_ID_SESION || null;
  console.log(`WP_RET m=${req.method} tk=${token_ws?'Y':'N'} tbk=${TBK_TOKEN?'Y':'N'} ses=${TBK_ID_SESION?'Y':'N'} cid=${cid?'Y':'N'} cita=${cita_id?'Y':'N'}`);

  let clienteSlug = null;
  const redir = (resultado) => {
    let dest = `${BASE_URL}/pago-exitoso?tipo=webpay&resultado=${resultado}`;
    if (resultado === 'ok' && clienteSlug) dest += `&slug=${encodeURIComponent(clienteSlug)}`;
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${dest}"></head><body></body></html>`);
  };

  if (TBK_TOKEN && !token_ws) return redir('cancelado');
  if (TBK_TOKEN && token_ws)  return redir('timeout');  // cerró tab y recuperó
  if (!token_ws && TBK_ID_SESION) return redir('timeout'); // expiró 5 min sin token
  if (!token_ws)               return redir('error');
  if (!cid || !cita_id)        return redir('error');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  // Fetch credenciales y slug en paralelo con idempotency check
  let mp = {}, alreadyPaid = false;
  try {
    const [rcli, rCheck] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}&select=metodos_pago,booking_slug&limit=1`, { headers: sh, signal: AbortSignal.timeout(8000) }),
      fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=estado_pago&limit=1`, { headers: sh, signal: AbortSignal.timeout(8000) })
    ]);
    const [cli]       = await rcli.json();
    const [citaCheck] = await rCheck.json();
    mp = cli?.metodos_pago || {};
    clienteSlug = cli?.booking_slug || null;
    if (citaCheck?.estado_pago === 'pagado') alreadyPaid = true;
  } catch(e) {
    console.error('webpay_return: error fetching data:', e.message);
    return redir('error');
  }

  if (alreadyPaid) return redir('ok');

  if (!mp.webpay_commerce_code || !mp.webpay_api_key_secret) {
    console.error('webpay_return: missing credentials for cid:', cid);
    return redir('error');
  }

  const baseUrl   = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;
  const wbHeaders = webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret);

  // PUT (commit): confirmar la transacción con Transbank
  let commitData;
  try {
    const commitResp = await fetch(`${baseUrl}/transactions/${encodeURIComponent(token_ws)}`, {
      method: 'PUT', headers: wbHeaders, signal: AbortSignal.timeout(15000)
    });
    commitData = await commitResp.json();
    console.log(`WP_PUT rc=${commitData.response_code??'absent'} st=${commitData.status||'?'} auth=${commitData.authorization_code||'-'}`);
  } catch(e) {
    console.error('webpay_return: PUT error:', e.message);
    return redir('error');
  }

  const rc = Number(commitData.response_code);
  if (isNaN(rc) || rc !== 0) {
    console.log('webpay_return: rechazado rc=', commitData.response_code);
    return redir('rechazado');
  }

  // Update cita
  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'confirmed', estado_pago: 'pagado', metodo_pago: 'webpay', webpay_voucher: commitData })
  }).catch(e => console.error('webpay_return: patch cita error:', e.message));

  // Fire-and-forget: send confirmation email
  (async () => {
    try {
      const cr2 = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
      const [cita] = await cr2.json();
      if (!cita?.email_paciente || !process.env.RESEND_API_KEY) return;

      let nombre_especialista = null;
      if (cita.especialista_id) {
        const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`, { headers: sh });
        const [esp] = await re.json();
        nombre_especialista = esp?.nombre || null;
      }

      const rcli2 = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=nombre_negocio,direccion,email&limit=1`, { headers: sh });
      const [cliente] = await rcli2.json();

      const fechaFmt = new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: [cita.email_paciente],
          subject: `Pago confirmado — tu cita en ${cliente?.nombre_negocio || 'la clínica'} está reservada ✓`,
          headers: {
            'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
          html: emailConfirmadoHtml({
            nombre_paciente:    cita.nombre_paciente,
            nombre_especialista,
            fechaFmt,
            hora:               cita.hora,
            servicio:           cita.servicio,
            negocio_nombre:     cliente?.nombre_negocio || null,
            precio:             cita.precio,
            direccion:          cliente?.direccion || null,
            email_negocio:      cliente?.email || null,
            cita_id:            cita.id
          })
        })
      }).catch(e => console.error('webpay_return: email error:', e.message));
    } catch(e) { console.error('webpay_return: post-payment email error:', e.message); }
  })();

  return redir('ok');
}

/* ════════════════════════════════════════════
   WEBPAY — Suscripciones y Recordatorios
   ════════════════════════════════════════════ */

async function getAttempoWebpayCredentials() {
  return {
    webpay_commerce_code: process.env.ATTEMPO_WEBPAY_COMMERCE_CODE,
    webpay_api_key_secret: process.env.ATTEMPO_WEBPAY_API_KEY_SECRET,
    webpay_sandbox: process.env.ATTEMPO_WEBPAY_SANDBOX === 'true'
  };
}

async function handleWebpaySubCreate(req, res) {
  const { cid, plan, monto, tipo_plan = '', t } = req.body || {};
  const errHtml = msg => { res.setHeader('Content-Type','text/html;charset=utf-8'); return res.status(400).send(`<!DOCTYPE html><html><body><p>${htmlEscape(msg)}</p></body></html>`); };
  if (!cid || !plan || !monto || !t) return errHtml('Parámetros inválidos.');
  if (t !== generateSubToken(cid, plan, monto, tipo_plan)) return errHtml('Token inválido.');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const mp  = await getAttempoWebpayCredentials();
  if (!mp.webpay_commerce_code || !mp.webpay_api_key_secret) return errHtml('Webpay no está configurado en attempo.');

  const baseUrl  = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;
  const montoInt = Math.round(Number(monto));
  const TIPO_CODES = { inicio:'i', pro:'p', clinica_ia:'c' };
  const tc       = TIPO_CODES[tipo_plan] || 'x';
  const suffix   = String(Date.now() % 1000000).padStart(6, '0');
  const buy_order = `SUB${plan[0]}${tc}${cid.replace(/-/g,'').slice(0,14)}${suffix}`.slice(0, 26);
  const return_url = `${BASE_URL}/api/flow?tipo=webpay_sub_return&cid=${encodeURIComponent(cid)}&plan=${encodeURIComponent(plan)}&tipo_plan=${encodeURIComponent(tipo_plan)}`;

  let initData;
  try {
    const r = await fetch(`${baseUrl}/transactions`, { method:'POST', headers:webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret), body:JSON.stringify({ buy_order, session_id:cid, amount:montoInt, return_url }) });
    initData = await r.json();
    if (!r.ok || !initData.token || !initData.url) { console.error('webpay_sub_create error:', JSON.stringify(initData)); return errHtml(`Error al iniciar pago: ${JSON.stringify(initData)}`); }
  } catch(e) { console.error('webpay_sub_create fetch error:', e.message); return errHtml('No se pudo conectar con Webpay. Intenta nuevamente.'); }

  const url = htmlEscape(initData.url); const tkn = htmlEscape(initData.token);
  res.setHeader('Content-Type','text/html;charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Redirigiendo...</title></head><body><form id="f" method="POST" action="${url}"><input type="hidden" name="token_ws" value="${tkn}"></form><script>document.getElementById('f').submit();</script></body></html>`);
}

async function emitirBoletaAttempo(monto, descripcion, receptorNombre) {
  const sistema  = process.env.DTEMITE_SISTEMA  || '';
  const rut      = process.env.DTEMITE_RUT      || '';
  const usuario  = process.env.DTEMITE_USUARIO  || '';
  const claveB64 = process.env.DTEMITE_CLAVE    || '';  // ya viene en base64
  const giro     = process.env.DTEMITE_GIRO     || 'Servicios de Tecnología';
  const dir      = process.env.DTEMITE_DIR      || 'Santiago';
  if (!usuario || !claveB64 || !rut) { console.warn('emitirBoletaAttempo: faltan vars DTEMITE_*'); return null; }
  const fechaDTE  = new Date().toISOString().slice(0, 10);
  const rutLimpio = rut.replace(/\./g, '');
  const montoInt  = Math.round(Number(monto));
  const mntNeto   = Math.round(montoInt / 1.19);
  const iva       = montoInt - mntNeto;
  const dteBody = {
    Sistema: { nombre: sistema || usuario, rut: rutLimpio, usuario, clave: claveB64 },
    Documento: {
      Encabezado: {
        IdDoc: { TipoDTE: '39', Folio: '0', FchEmis: fechaDTE },
        Emisor: { RUTEmisor: rutLimpio, RznSocEmisor: 'ATTEMPO SPA', GiroEmisor: giro, DirOrigen: dir, CmnaOrigen: 'Santiago', CiudadOrigen: 'Santiago' },
        Receptor: { RUTRecep: '66666666-6', RznSocRecep: receptorNombre || 'Consumidor Final', DirRecep: 'Sin dirección', CmnaRecep: 'Santiago', CiudadRecep: 'Santiago' },
        Totales: { MntNeto: String(mntNeto), MntExe: '0', IVA: String(iva), MntTotal: String(montoInt) }
      },
      Detalle: [{ NroLinDet: '1', NmbItem: descripcion || 'Suscripción attempo', QtyItem: '1', PrcItem: String(montoInt), MontoItem: String(montoInt) }]
    }
  };
  try {
    const r = await fetch('https://sistema.dtemite.cl/sistema/Backend/WsMaster/ApiIntegracionController.php/Api/Documento', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dteBody), signal: AbortSignal.timeout(15000)
    });
    const rawText = await r.text();
    console.log(`DTEMITE emit status=${r.status} body=${rawText.slice(0, 300)}`);
    const data = JSON.parse(rawText);
    return data.LinkPDF || data.ruta_pdf || data.url_pdf || data.pdf_url || null;
  } catch(e) { console.error('emitirBoletaAttempo error:', e.message); return null; }
}

async function handleWebpaySubReturn(req, res) {
  const cid       = req.query?.cid || null;
  const plan      = req.query?.plan || null;
  const tipo_plan = req.query?.tipo_plan || null;
  const token_ws  = req.body?.token_ws || req.query?.token_ws || null;
  const TBK_TOKEN = req.body?.TBK_TOKEN || req.query?.TBK_TOKEN || null;

  const redir = r => { const dest = `${BASE_URL}/pago-exitoso?tipo=plan&resultado=${r}${plan?'&plan='+encodeURIComponent(plan):''}`;res.setHeader('Content-Type','text/html;charset=utf-8');return res.status(200).send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${dest}"></head><body></body></html>`); };

  if (TBK_TOKEN && !token_ws) return redir('cancelado');
  if (!token_ws) return redir('error');
  if (!cid || !plan) return redir('error');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const mp  = await getAttempoWebpayCredentials();
  const baseUrl = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;

  let commitData;
  try {
    const r = await fetch(`${baseUrl}/transactions/${encodeURIComponent(token_ws)}`, { method:'PUT', headers:webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret), signal:AbortSignal.timeout(15000) });
    commitData = await r.json();
    console.log(`WP_SUB_RET rc=${commitData.response_code??'absent'} plan=${plan} cid=${cid}`);
  } catch(e) { console.error('webpay_sub_return PUT error:', e.message); return redir('error'); }

  if (Number(commitData.response_code) !== 0) return redir('rechazado');

  const monto = Math.round(Number(commitData.amount || 0));
  const dias  = plan === 'anual' ? 365 : 30;

  // Extender suscripción atómicamente y obtener datos del cliente para email (SECURITY DEFINER)
  const referenciaPago = commitData.buy_order || token_ws || '';
  const rpcBody = { p_cliente_id: cid, p_dias: dias, p_plan: plan, p_tipo_plan: tipo_plan || '', p_monto: monto, p_plataforma: 'webpay', p_referencia: referenciaPago };
  console.log(`WP_SUB_RET rpc sending ${JSON.stringify(rpcBody)}`);
  let cli = null;
  const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/extend_suscripcion`, {
    method: 'POST',
    headers: { ...sh, Prefer: 'return=representation' },
    body: JSON.stringify(rpcBody)
  }).catch(e => { console.error('webpay_sub_return rpc error:', e.message); return null; });
  if (rpcResp) {
    const rpcText = await rpcResp.text().catch(() => '?');
    console.log(`WP_SUB_RET rpc status=${rpcResp.status} body=${rpcText.slice(0,200)}`);
    try {
      const rpcData = JSON.parse(rpcText);
      if (rpcData && typeof rpcData === 'object' && !Array.isArray(rpcData) && rpcData.nombre_negocio !== undefined) {
        cli = { nombre_negocio: rpcData.nombre_negocio, email: rpcData.email };
      }
    } catch(e) {}
  }

  const PLAN_LABELS = { inicio:'Agenda Esencial', pro:'Pro', clinica_ia:'Clínica IA' };
  const planLabel = `${PLAN_LABELS[tipo_plan] ? PLAN_LABELS[tipo_plan] + ' ' : ''}${plan === 'anual' ? 'Anual' : 'Mensual'}`;
  const dtePdf = await emitirBoletaAttempo(monto, `Suscripción attempo ${planLabel}`, cli?.nombre_negocio).catch(() => null);

  // Notificación interna — se hace con await para que Vercel no corte el proceso
  try {
    if (process.env.RESEND_API_KEY) {
      const fechaHoy  = new Date().toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
      const montoFmt  = `$${monto.toLocaleString('es-CL')}`;
      const referencia = commitData.buy_order || token_ws || '—';

      const html = `<div style="font-family:Inter,sans-serif;max-width:560px;margin:auto;padding:32px 24px">
        <img src="${BASE_URL}/logo_attempo.png" alt="attempo" style="height:32px;margin-bottom:24px">
        <h2 style="font-size:18px;font-weight:700;color:#1a1a2e;margin:0 0 6px">Nuevo pago de suscripción recibido</h2>
        <p style="font-size:13px;color:#6b7280;margin:0 0 24px">${fechaHoy}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280;width:40%">Negocio</td><td style="padding:10px 0;font-weight:600;color:#1a1a2e">${cli?.nombre_negocio || '—'}</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280">Email cliente</td><td style="padding:10px 0;color:#1a1a2e">${cli?.email || '—'}</td></tr>
          ${cli?.rut ? `<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280">RUT</td><td style="padding:10px 0;color:#1a1a2e">${cli.rut}</td></tr>` : ''}
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280">Plan</td><td style="padding:10px 0;font-weight:600;color:#6C5CE4">${planLabel}</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280">Monto</td><td style="padding:10px 0;font-weight:700;font-size:18px;color:#1a1a2e">${montoFmt}</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280">Plataforma</td><td style="padding:10px 0;color:#1a1a2e">Webpay (Transbank)</td></tr>
          <tr><td style="padding:10px 0;color:#6b7280">Referencia</td><td style="padding:10px 0;font-size:12px;color:#6b7280;font-family:monospace">${referencia}</td></tr>
        </table>
        ${dtePdf
          ? `<a href="${dtePdf}" target="_blank" style="display:inline-block;background:#6C5CE4;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Ver boleta electrónica →</a>
             <p style="font-size:12px;color:#9ca3af;margin-top:20px">Boleta emitida automáticamente vía DTEmite.</p>`
          : `<a href="https://bte.sii.cl/" target="_blank" style="display:inline-block;background:#6C5CE4;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Emitir boleta en SII →</a>
             <p style="font-size:12px;color:#9ca3af;margin-top:20px">Recuerda emitir la boleta electrónica por ${montoFmt} a nombre de ${cli?.nombre_negocio || 'este cliente'}.</p>`}
      </div>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'attempo <noreply@attempo.cl>', to: ['contacto@attempo.cl'], subject: `Nuevo pago — ${cli?.nombre_negocio || cid} (${planLabel} ${montoFmt})`, html })
      });

      if (cli?.email) {
        const boletaBtn = dtePdf
          ? `<a href="${dtePdf}" target="_blank" style="display:inline-block;background:#6C5CE4;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:8px">Descargar boleta electrónica →</a>`
          : '';
        const htmlCliente = `<div style="font-family:Inter,sans-serif;max-width:560px;margin:auto;padding:32px 24px">
          <img src="${BASE_URL}/logo_attempo.png" alt="attempo" style="height:32px;margin-bottom:24px">
          <h2 style="font-size:18px;font-weight:700;color:#1a1a2e;margin:0 0 8px">¡Tu pago fue recibido!</h2>
          <p style="font-size:14px;color:#374151;margin:0 0 8px">Hola <strong>${cli.nombre_negocio}</strong>, tu suscripción <strong>${planLabel}</strong> por <strong>${montoFmt}</strong> fue procesada exitosamente.</p>
          <p style="font-size:14px;color:#374151;margin:0 0 24px">Tu cuenta está activa y puedes acceder a todas las funcionalidades de tu plan.</p>
          ${boletaBtn}
          <a href="https://app.attempo.cl/admin" target="_blank" style="display:inline-block;background:#f5f3ff;color:#6C5CE4;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;border:1.5px solid #c4b5fd">Ir al panel →</a>
          <p style="font-size:12px;color:#9ca3af;margin-top:24px">attempo · <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none">attempo.cl</a> · contacto@attempo.cl</p>
        </div>`;
        const subjectCliente = dtePdf
          ? `Tu boleta de suscripción attempo — ${planLabel}`
          : `Tu suscripción attempo está activa — ${planLabel}`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'attempo <noreply@attempo.cl>', to: [cli.email], subject: subjectCliente, html: htmlCliente })
        }).catch(e => console.error('webpay_sub_return email cliente error:', e.message));
      }
    }
  } catch(e) { console.error('webpay_sub_return email notif error:', e.message); }

  console.log('webpay_sub_return: plan activado cliente_id=', cid, 'plan=', plan);
  return redir('ok');
}

async function handleWebpayRecCreate(req, res) {
  const { cid, subtipo, codigo, monto, t } = req.body || {};
  const errHtml = msg => { res.setHeader('Content-Type','text/html;charset=utf-8'); return res.status(400).send(`<!DOCTYPE html><html><body><p>${htmlEscape(msg)}</p></body></html>`); };
  if (!cid || !subtipo || !codigo || !monto || !t) return errHtml('Parámetros inválidos.');
  if (t !== generateRecToken(cid, subtipo, codigo, monto)) return errHtml('Token inválido.');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const mp  = await getAttempoWebpayCredentials();
  if (!mp.webpay_commerce_code || !mp.webpay_api_key_secret) return errHtml('Webpay no está configurado en attempo.');

  const baseUrl  = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;
  const montoInt = Math.round(Number(monto));
  const tc       = subtipo === 'topup' ? 'T' : 'M';
  const suffix   = String(Date.now() % 1000000).padStart(6, '0');
  const buy_order = `REC${tc}${codigo}${cid.replace(/-/g,'').slice(0,13)}${suffix}`.slice(0, 26);
  const return_url = `${BASE_URL}/api/flow?tipo=webpay_rec_return&cid=${encodeURIComponent(cid)}&subtipo=${encodeURIComponent(subtipo)}&codigo=${encodeURIComponent(codigo)}`;

  let initData;
  try {
    const r = await fetch(`${baseUrl}/transactions`, { method:'POST', headers:webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret), body:JSON.stringify({ buy_order, session_id:cid, amount:montoInt, return_url }) });
    initData = await r.json();
    if (!r.ok || !initData.token || !initData.url) { console.error('webpay_rec_create error:', JSON.stringify(initData)); return errHtml(`Error al iniciar pago: ${JSON.stringify(initData)}`); }
  } catch(e) { console.error('webpay_rec_create fetch error:', e.message); return errHtml('No se pudo conectar con Webpay. Intenta nuevamente.'); }

  const url = htmlEscape(initData.url); const tkn = htmlEscape(initData.token);
  res.setHeader('Content-Type','text/html;charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Redirigiendo...</title></head><body><form id="f" method="POST" action="${url}"><input type="hidden" name="token_ws" value="${tkn}"></form><script>document.getElementById('f').submit();</script></body></html>`);
}

async function handleWebpayRecReturn(req, res) {
  const cid     = req.query?.cid || null;
  const subtipo = req.query?.subtipo || null;
  const codigo  = req.query?.codigo || null;
  const token_ws  = req.body?.token_ws || req.query?.token_ws || null;
  const TBK_TOKEN = req.body?.TBK_TOKEN || req.query?.TBK_TOKEN || null;

  const redir = r => { const dest = r === 'ok' ? `${BASE_URL}/admin.html?rec_ok=1` : `${BASE_URL}/admin.html?rec_error=${r}`;res.setHeader('Content-Type','text/html;charset=utf-8');return res.status(200).send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${dest}"></head><body></body></html>`); };

  if (TBK_TOKEN && !token_ws) return redir('cancelado');
  if (!token_ws) return redir('error');
  if (!cid || !subtipo || !codigo) return redir('error');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const mp  = await getAttempoWebpayCredentials();
  const baseUrl = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;

  let commitData;
  try {
    const r = await fetch(`${baseUrl}/transactions/${encodeURIComponent(token_ws)}`, { method:'PUT', headers:webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret), signal:AbortSignal.timeout(15000) });
    commitData = await r.json();
  } catch(e) { console.error('webpay_rec_return PUT error:', e.message); return redir('error'); }

  if (Number(commitData.response_code) !== 0) return redir('rechazado');

  const mapa = subtipo === 'topup' ? REC_TOPUP : subtipo === 'mensual' ? REC_MENSUAL : null;
  if (!mapa || !mapa[codigo]) return redir('error');
  const cantidad = mapa[codigo].cant;

  const cr = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}&select=rec_mes_limit_extra,rec_limite_extra_mensual,rec_mes_key,nombre_negocio,email&limit=1`, { headers: sh });
  const [cli] = await cr.json();
  const mesActual = new Date().toISOString().slice(0, 7);
  const monto = mapa[codigo].monto;
  const patch = subtipo === 'topup'
    ? { rec_mes_limit_extra: ((cli?.rec_mes_key === mesActual ? cli.rec_mes_limit_extra : 0) || 0) + cantidad, rec_mes_key: mesActual }
    : { rec_limite_extra_mensual: (cli?.rec_limite_extra_mensual || 0) + cantidad };

  await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}`, { method:'PATCH', headers:{...sh,Prefer:'return=minimal'}, body:JSON.stringify(patch) }).catch(e => console.error('webpay_rec_return patch error:', e.message));

  const dteDescRec = `Pack recordatorios attempo — ${cantidad} recordatorios (${subtipo})`;
  const dtePdfRec  = await emitirBoletaAttempo(monto, dteDescRec, cli?.nombre_negocio).catch(() => null);

  try {
    if (process.env.RESEND_API_KEY) {
      const montoFmt = `$${monto.toLocaleString('es-CL')}`;
      const botoRec = dtePdfRec
        ? `<a href="${dtePdfRec}" target="_blank" style="display:inline-block;background:#6C5CE4;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Ver boleta electrónica →</a><p style="font-size:12px;color:#9ca3af;margin-top:20px">Boleta emitida automáticamente vía DTEmite.</p>`
        : `<a href="https://bte.sii.cl/" target="_blank" style="display:inline-block;background:#6C5CE4;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Emitir boleta en SII →</a>`;
      const htmlRec = `<div style="font-family:Inter,sans-serif;max-width:560px;margin:auto;padding:32px 24px">
        <img src="${BASE_URL}/logo_attempo.png" alt="attempo" style="height:32px;margin-bottom:24px">
        <h2 style="font-size:18px;font-weight:700;color:#1a1a2e;margin:0 0 6px">Nuevo pago de pack recibido</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280;width:40%">Negocio</td><td style="padding:10px 0;font-weight:600;color:#1a1a2e">${cli?.nombre_negocio || '—'}</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280">Pack</td><td style="padding:10px 0;color:#1a1a2e">${cantidad} recordatorios (${subtipo})</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 0;color:#6b7280">Monto</td><td style="padding:10px 0;font-weight:700;font-size:18px;color:#1a1a2e">${montoFmt}</td></tr>
          <tr><td style="padding:10px 0;color:#6b7280">Plataforma</td><td style="padding:10px 0;color:#1a1a2e">Webpay (Transbank)</td></tr>
        </table>
        ${botoRec}
      </div>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'attempo <noreply@attempo.cl>', to: ['contacto@attempo.cl'], subject: `Nuevo pack — ${cli?.nombre_negocio || cid} (${cantidad} recordatorios ${montoFmt})`, html: htmlRec })
      });
    }
  } catch(e) { console.error('webpay_rec_return email error:', e.message); }

  console.log(`webpay_rec_return: +${cantidad} recordatorios (${subtipo}) cliente=${cid}`);
  return redir('ok');
}

/* ════════════════════════════════════════════
   WEBPAY — COTIZACIONES (pago de cotización por cliente)
   ════════════════════════════════════════════ */

async function handleWebpayCotCreate(req, res) {
  const cot_token = req.query.cot_token;
  const errHtml = msg => { res.setHeader('Content-Type','text/html;charset=utf-8'); return res.status(400).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;padding:40px;color:#dc2626"><p>${htmlEscape(msg)}</p></body></html>`); };
  if (!cot_token) return errHtml('Token inválido.');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  const rCot = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?token_respuesta=eq.${encodeURIComponent(cot_token)}&limit=1`, { headers: sh });
  const cot  = (await rCot.json())[0];
  if (!cot) return errHtml('Cotización no encontrada.');

  const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cot.cliente_id}&select=metodos_pago&limit=1`, { headers: sh });
  const mp   = (await rCli.json())[0]?.metodos_pago || {};
  if (!mp.webpay_commerce_code || !mp.webpay_api_key_secret) return errHtml('Webpay no está configurado para este negocio.');

  const neto  = (cot.items || []).reduce((s, it) => s + (parseFloat(it.precio_unitario)||0)*(parseFloat(it.cantidad)||1)*(1-(parseFloat(it.descuento)||0)/100), 0);
  const total = cot.incluye_iva ? Math.round(neto * 1.19) : Math.round(neto);
  if (total <= 0) return errHtml('El monto de la cotización no es válido.');

  const baseUrl    = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;
  const suffix     = String(Date.now() % 1000000).padStart(6, '0');
  const buy_order  = `COT${cot.id.replace(/-/g,'').slice(0,18)}${suffix}`.slice(0, 26);
  const return_url = `${BASE_URL}/api/flow?tipo=webpay_cot_return&cot_token=${encodeURIComponent(cot_token)}`;

  let initData;
  try {
    const r = await fetch(`${baseUrl}/transactions`, { method:'POST', headers:webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret), body:JSON.stringify({ buy_order, session_id:cot.id, amount:total, return_url }) });
    initData = await r.json();
    if (!r.ok || !initData.token || !initData.url) { console.error('webpay_cot_create error:', JSON.stringify(initData)); return errHtml(`Error al iniciar pago Webpay.`); }
  } catch(e) { console.error('webpay_cot_create fetch error:', e.message); return errHtml('No se pudo conectar con Webpay. Intenta nuevamente.'); }

  const url = htmlEscape(initData.url); const tkn = htmlEscape(initData.token);
  res.setHeader('Content-Type','text/html;charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Redirigiendo...</title></head><body><form id="f" method="POST" action="${url}"><input type="hidden" name="token_ws" value="${tkn}"></form><script>document.getElementById('f').submit();</script></body></html>`);
}

async function handleWebpayCotReturn(req, res) {
  const cot_token = req.query.cot_token;
  const token_ws  = req.body?.token_ws || req.query.token_ws;
  const redir = (status) => res.redirect(`${BASE_URL}/cotizacion?token=${encodeURIComponent(cot_token || '')}&pago=${status}`);
  if (!cot_token || !token_ws) return redir('error');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const shJ = { ...sh, 'Content-Type': 'application/json' };

  const rCot = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?token_respuesta=eq.${encodeURIComponent(cot_token)}&limit=1`, { headers: sh });
  const cot  = (await rCot.json())[0];
  if (!cot) return redir('error');

  const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cot.cliente_id}&select=metodos_pago&limit=1`, { headers: sh });
  const mp   = (await rCli.json())[0]?.metodos_pago || {};
  if (!mp.webpay_commerce_code || !mp.webpay_api_key_secret) return redir('error');

  const baseUrl = mp.webpay_sandbox ? WEBPAY_INT_URL : WEBPAY_PROD_URL;
  try {
    const r    = await fetch(`${baseUrl}/transactions/${token_ws}`, { method:'PUT', headers:webpayHeaders(mp.webpay_commerce_code, mp.webpay_api_key_secret) });
    const data = await r.json();
    console.log('webpay_cot_return: status=', data.status, 'response_code=', data.response_code);
    if (data.status === 'AUTHORIZED' && data.response_code === 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?token_respuesta=eq.${encodeURIComponent(cot_token)}`, {
        method:'PATCH', headers:{ ...shJ, Prefer:'return=minimal' },
        body: JSON.stringify({ estado:'pagada', respuesta:{ ...(cot.respuesta||{}), pago:{ metodo:'webpay', monto:data.amount, fecha:new Date().toISOString(), order:data.buy_order } } })
      });
      return redir('ok');
    }
    return redir('cancelado');
  } catch(e) { console.error('webpay_cot_return error:', e.message); return redir('error'); }
}

/* ════════════════════════════════════════════
   MERCADO PAGO — OAuth + Pagos
   ════════════════════════════════════════════ */

async function refreshMPToken(cid, mp, sh) {
  if (!mp.mp_refresh_token) return null;
  try {
    const tr = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, refresh_token: mp.mp_refresh_token })
    });
    const td = await tr.json();
    if (!td.access_token) { console.error('refreshMPToken: no access_token', JSON.stringify(td)); return null; }
    mp.mp_access_token  = td.access_token;
    mp.mp_refresh_token = td.refresh_token || mp.mp_refresh_token;
    await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}`, {
      method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
      body: JSON.stringify({ metodos_pago: mp })
    });
    return td.access_token;
  } catch(e) { console.error('refreshMPToken error:', e.message); return null; }
}

async function handleMPConnect(req, res) {
  const cid = req.query.cid;
  if (!cid) return res.status(400).send('Missing cid');
  const state = Buffer.from(JSON.stringify({ cid })).toString('base64url');
  const redirectUri = process.env.MP_REDIRECT_URI || `${BASE_URL}/api/flow?tipo=mp_callback`;
  const url = `https://auth.mercadopago.com/authorization?client_id=${process.env.MP_CLIENT_ID}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return res.redirect(302, url);
}

async function handleMPCallback(req, res) {
  const { code, state, error } = req.query;
  if (error || !code) {
    console.error('mp_callback error:', error || 'no code');
    return res.redirect(302, '/admin.html?mp_error=1');
  }
  let cid;
  try { cid = JSON.parse(Buffer.from(state, 'base64url').toString()).cid; }
  catch(e) { return res.status(400).send('Invalid state'); }

  const redirectUri = process.env.MP_REDIRECT_URI || `${BASE_URL}/api/flow?tipo=mp_callback`;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  let tokenData;
  try {
    const tr = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    });
    tokenData = await tr.json();
  } catch(e) { console.error('mp_callback token exchange:', e.message); return res.redirect(302, '/admin.html?mp_error=1'); }

  if (!tokenData.access_token) { console.error('mp_callback: no token', JSON.stringify(tokenData)); return res.redirect(302, '/admin.html?mp_error=1'); }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}&select=metodos_pago&limit=1`, { headers: sh });
    const [cli] = await r.json();
    const mp = cli?.metodos_pago || {};
    mp.mp_connected    = true;
    mp.mp_access_token = tokenData.access_token;
    mp.mp_refresh_token= tokenData.refresh_token || null;
    mp.mp_user_id      = String(tokenData.user_id || '');
    mp.mp_public_key   = tokenData.public_key || null;
    mp.mp_sandbox      = false;
    await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}`, { method:'PATCH', headers:{...sh,Prefer:'return=minimal'}, body:JSON.stringify({metodos_pago:mp}) });
  } catch(e) { console.error('mp_callback: save token:', e.message); return res.redirect(302, '/admin.html?mp_error=1'); }

  return res.redirect(302, '/admin.html?mp_connected=1');
}

async function handleMPDisconnect(req, res) {
  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const cid = session.cliente_id;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}&select=metodos_pago&limit=1`, { headers: sh });
    const [cli] = await r.json();
    const mp = cli?.metodos_pago || {};
    delete mp.mp_connected; delete mp.mp_access_token; delete mp.mp_refresh_token; delete mp.mp_user_id; delete mp.mp_public_key;
    await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cid)}`, { method:'PATCH', headers:{...sh,Prefer:'return=minimal'}, body:JSON.stringify({metodos_pago:mp}) });
    return res.json({ ok: true });
  } catch(e) { return res.status(500).json({ error: e.message }); }
}

async function confirmMPPayment(paymentId, cita_id) {
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const cr = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
  const [cita] = await cr.json();
  if (!cita || cita.estado_pago === 'pagado') return;

  // Get seller token to fetch payment details
  const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cita.cliente_id)}&select=nombre_negocio,metodos_pago&limit=1`, { headers: sh });
  const [cli] = await rcli.json();
  let sellerToken = cli?.metodos_pago?.mp_access_token || process.env.MP_ACCESS_TOKEN;

  // Fetch payment details for voucher
  let mp_voucher = { payment_id: String(paymentId) };
  try {
    let pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${sellerToken}`, Accept: 'application/json' }
    });
    if (pr.status === 401 && cli?.metodos_pago?.mp_refresh_token) {
      const mp = cli.metodos_pago;
      const newToken = await refreshMPToken(cita.cliente_id, mp, sh);
      if (newToken) {
        sellerToken = newToken;
        pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${sellerToken}`, Accept: 'application/json' }
        });
      }
    }
    const pd = await pr.json();
    if (pd.status === 'approved') {
      mp_voucher = {
        payment_id:   String(pd.id),
        amount:       pd.transaction_amount,
        date:         pd.date_approved || pd.date_created,
        card_last4:   pd.card?.last_four_digits || null,
        card_brand:   pd.payment_method_id || null,
        installments: pd.installments || 1,
        payer_email:  pd.payer?.email || null,
        status:       pd.status
      };
    }
  } catch(e) { console.error('mp_confirm fetch payment:', e.message); }

  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'confirmed', estado_pago: 'pagado', metodo_pago: 'mercadopago', mp_payment_id: String(paymentId), mp_voucher })
  });

  if (cita.email_paciente) {
    try {
      const fechaFmt = cita.fecha ? new Date(cita.fecha+'T12:00:00').toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}) : '';
      const emailHtml = `<div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:32px 24px"><img src="${BASE_URL}/logo_attempo.png" alt="attempo" style="height:36px;margin-bottom:28px"><h2 style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 8px">¡Pago confirmado!</h2><p style="font-size:14px;color:#6b7280;margin:0 0 24px">Hola ${cita.nombre_paciente||''}, tu pago fue procesado correctamente. Tu cita${fechaFmt?' del '+fechaFmt:''} en <strong>${cli?.nombre_negocio||'attempo'}</strong> está confirmada.</p><div style="background:#f0fdf4;border-radius:12px;padding:20px;margin-bottom:24px;border:1.5px solid #22c55e"><div style="font-size:13px;color:#15803d;margin-bottom:4px">Total pagado</div><div style="font-size:28px;font-weight:700;color:#1a1a2e">$${Number(cita.precio||0).toLocaleString('es-CL')}</div><div style="font-size:12px;color:#6b7280;margin-top:4px">N° operación: ${paymentId}</div></div><p style="font-size:12px;color:#9ca3af;text-align:center">Pago procesado por Mercado Pago</p></div>`;
      await fetch('https://api.resend.com/emails', { method:'POST', headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({ from:'attempo <noreply@attempo.cl>', to:[cita.email_paciente], subject:`Pago confirmado — ${cli?.nombre_negocio||'attempo'}`, html:emailHtml }) });
    } catch(e) { console.error('mp_confirm email:', e.message); }
  }
}

async function confirmMPPaymentCot(paymentId, cotId) {
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const cr = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${encodeURIComponent(cotId)}&select=*&limit=1`, { headers: sh });
  const [cot] = await cr.json();
  if (!cot || cot.estado === 'pagada') return;
  await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${encodeURIComponent(cotId)}`, {
    method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'pagada', mp_payment_id: String(paymentId) })
  });
  const emailDest = cot.datos_destinatario?.email;
  if (emailDest) {
    try {
      const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cot.cliente_id)}&select=nombre_negocio&limit=1`, { headers: sh });
      const [cli] = await rcli.json();
      const emailHtml = `<div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:32px 24px"><img src="${BASE_URL}/logo_attempo.png" alt="attempo" style="height:36px;margin-bottom:28px"><h2 style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 8px">¡Pago recibido!</h2><p style="font-size:14px;color:#6b7280;margin:0 0 24px">Tu cotización N° ${cot.numero || ''} de <strong>${cli?.nombre_negocio || 'attempo'}</strong> ha sido pagada exitosamente.</p><div style="background:#f0fdf4;border-radius:12px;padding:20px;margin-bottom:24px;border:1.5px solid #22c55e"><div style="font-size:13px;color:#15803d;margin-bottom:4px">N° operación</div><div style="font-size:20px;font-weight:700;color:#1a1a2e">${paymentId}</div></div><p style="font-size:12px;color:#9ca3af;text-align:center">Pago procesado por Mercado Pago</p></div>`;
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'attempo <noreply@attempo.cl>', to: [emailDest], subject: `Pago confirmado — Cotización N° ${cot.numero || ''}`, html: emailHtml }) });
    } catch(e) { console.error('mp_cot confirm email:', e.message); }
  }
}

async function handleMPWebhook(req, res) {
  const paymentId = req.query.id || req.query['data.id'] || req.body?.data?.id;
  const topic = req.query.topic || req.query.type || req.body?.type;
  res.status(200).end();
  if ((topic !== 'payment' && topic !== 'payments') || !paymentId) return;
  try {
    const appToken = process.env.MP_ACCESS_TOKEN;
    if (!appToken) return;
    const pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${appToken}`, Accept: 'application/json' }
    });
    const payment = await pr.json();
    if (payment.status !== 'approved' || !payment.external_reference) return;
    const extRef = payment.external_reference;
    if (extRef.startsWith('COT-')) {
      await confirmMPPaymentCot(paymentId, extRef.slice(4));
    } else {
      await confirmMPPayment(paymentId, extRef);
    }
  } catch(e) { console.error('mp_webhook error:', e.message); }
}

async function handleMPConfirm(req, res) {
  const { payment_id, cita_id, collection_status } = req.query;
  if (!payment_id || !cita_id || collection_status !== 'approved') return res.status(400).json({ error: 'Datos inválidos' });
  try {
    await confirmMPPayment(payment_id, cita_id);
    return res.json({ ok: true });
  } catch(e) { return res.status(500).json({ error: e.message }); }
}

async function handleMPCreate(req, res, session) {
  const { cita_id } = req.body || {};
  if (!cita_id) return res.status(400).json({ error: 'Falta cita_id' });
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const cr = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
  const [cita] = await cr.json();
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
  if (session.rol !== 'superadmin' && cita.cliente_id !== session.cliente_id) return res.status(403).json({ error: 'Sin permiso' });
  if (!cita.email_paciente) return res.status(400).json({ error: 'La cita no tiene email del paciente' });
  if (!cita.precio)         return res.status(400).json({ error: 'La cita no tiene precio asignado' });

  const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cita.cliente_id)}&select=nombre_negocio,metodos_pago&limit=1`, { headers: sh });
  const [cli] = await rcli.json();
  const mpToken = cli?.metodos_pago?.mp_access_token;
  if (!mpToken) return res.status(400).json({ error: 'Mercado Pago no está conectado. Ve a Configuración → Pagos.' });

  let nombre_especialista = null;
  if (cita.especialista_id) { try { const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`,{headers:sh}); const [e]=await re.json(); nombre_especialista=e?.nombre||null; } catch(_){} }

  const fechaFmt = cita.fecha ? new Date(cita.fecha+'T12:00:00').toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}) : '';
  const preference = {
    items:[{ id:cita_id, title:`${cita.servicio||'Consulta'}${fechaFmt?' — '+fechaFmt:''}`, quantity:1, currency_id:'CLP', unit_price:Number(cita.precio) }],
    payer:{ name:(cita.nombre_paciente||'').split(' ')[0]||'', email:cita.email_paciente },
    back_urls:{ success:`${BASE_URL}/pago-mp.html?cita=${cita_id}&status=success`, failure:`${BASE_URL}/pago-mp.html?cita=${cita_id}&status=failure`, pending:`${BASE_URL}/pago-mp.html?cita=${cita_id}&status=pending` },
    auto_return:'approved', external_reference:cita_id, marketplace:process.env.MP_CLIENT_ID, marketplace_fee:0,
    notification_url:`${BASE_URL}/api/flow?tipo=mp_webhook`
  };

  let prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${mpToken}`}, body:JSON.stringify(preference)
  });
  let prefData = await prefResp.json();
  if (prefResp.status === 401 || prefData?.error === 'invalid_token') {
    const mp = cli?.metodos_pago || {};
    const newToken = await refreshMPToken(cita.cliente_id, mp, sh);
    if (!newToken) return res.status(400).json({ error: 'El token de Mercado Pago expiró. El profesional debe reconectar su cuenta en Configuración → Pagos.' });
    prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${newToken}`}, body:JSON.stringify(preference)
    });
    prefData = await prefResp.json();
  }
  if (!prefData.init_point) { console.error('mp_create error:', JSON.stringify(prefData)); return res.status(500).json({ error: prefData.message||'Error al crear preferencia MP' }); }

  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`,{ method:'PATCH', headers:{...sh,Prefer:'return=minimal'}, body:JSON.stringify({estado:'pending_payment',metodo_pago:'mercadopago'}) }).catch(()=>{});

  const isSandbox = !!cli?.metodos_pago?.mp_sandbox;
  const pago_url = isSandbox ? prefData.sandbox_init_point : prefData.init_point;
  const emailHtml = `<div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:32px 24px"><img src="${BASE_URL}/logo_attempo.png" alt="attempo" style="height:36px;margin-bottom:28px"><h2 style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 8px">Tienes un pago pendiente</h2><p style="font-size:14px;color:#6b7280;margin:0 0 24px">Hola ${cita.nombre_paciente||''}, te enviamos el link de pago para tu cita${fechaFmt?' del '+fechaFmt:''} en <strong>${cli?.nombre_negocio||'attempo'}</strong>.</p><div style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:24px"><div style="font-size:13px;color:#6b7280;margin-bottom:4px">Total a pagar</div><div style="font-size:28px;font-weight:700;color:#1a1a2e">$${Number(cita.precio).toLocaleString('es-CL')}</div>${nombre_especialista?`<div style="font-size:12px;color:#6b7280;margin-top:4px">Con ${nombre_especialista}</div>`:''}</div><a href="${pago_url}" style="display:block;text-align:center;background:#009ee3;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;margin-bottom:16px">Pagar con Mercado Pago →</a><p style="font-size:12px;color:#9ca3af;text-align:center">Pago seguro procesado por Mercado Pago</p></div>`;

  let email_error = null;
  try {
    const er = await fetch('https://api.resend.com/emails',{ method:'POST', headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({ from:'attempo <noreply@attempo.cl>', to:[cita.email_paciente], subject:`Pago de tu cita — ${cli?.nombre_negocio||'attempo'}`, html:emailHtml }) });
    if (!er.ok) { const ed=await er.json(); email_error=ed?.message||'Error email'; console.error('mp_create email:',email_error); }
  } catch(e) { email_error=e.message; }

  return res.json({ ok:true, url:pago_url, email_error:email_error||null });
}

export default async function handler(req, res) {
  // Flow redirige el browser aquí después del pago (puede ser iframe o navegación directa)
  if (req.query?.ret === '1') {
    const dest = req.query.tipo === 'cita'
      ? `${BASE_URL}/pago-exitoso?tipo=cita${req.query.slug ? '&slug=' + encodeURIComponent(req.query.slug) : ''}`
      : req.query.tipo === 'rec'
        ? `${BASE_URL}/agenda?rec_ok=1`
        : `${BASE_URL}/pago-exitoso${req.query.plan ? '?plan=' + encodeURIComponent(req.query.plan) : ''}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=${dest}"><script>try{window.top.location.replace(${JSON.stringify(dest)})}catch(e){window.location.replace(${JSON.stringify(dest)})}</script></head><body></body></html>`);
  }

  if (req.query?.tipo === 'webpay_return')     return handleWebpayReturn(req, res);
  if (req.query?.tipo === 'webpay_sub_return') return handleWebpaySubReturn(req, res);
  if (req.query?.tipo === 'webpay_rec_return') return handleWebpayRecReturn(req, res);
  if (req.query?.tipo === 'webpay_cot_create') return handleWebpayCotCreate(req, res);
  if (req.query?.tipo === 'webpay_cot_return') return handleWebpayCotReturn(req, res);

  if (req.query?.tipo === 'mp_connect')   return handleMPConnect(req, res);
  if (req.query?.tipo === 'mp_callback')  return handleMPCallback(req, res);
  if (req.query?.tipo === 'mp_disconnect') return handleMPDisconnect(req, res);
  if (req.query?.tipo === 'mp_webhook')   return handleMPWebhook(req, res);
  if (req.query?.tipo === 'mp_confirm')   return handleMPConfirm(req, res);

  if (req.method !== 'POST') return res.status(405).end();

  if (req.query?.tipo === 'webpay_create')     return handleWebpayCreate(req, res);
  if (req.query?.tipo === 'webpay_sub_create') return handleWebpaySubCreate(req, res);
  if (req.query?.tipo === 'webpay_rec_create') return handleWebpayRecCreate(req, res);

  // — Webhook de Flow: confirmación de pago (sin sesión, con token en body) —
  if (req.body?.token && !req.body.cita_id && !req.body.tipo) {
    return handleFlowWebhook(req, res);
  }

  // — Pago de suscripción (superadmin genera link para que el cliente pague) —
  if (req.body?.tipo === 'suscripcion') {
    if (!verifySaToken(req.headers['x-sa-token'])) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    return handleSubPayment(req, res);
  }

  // — Auto-renovación (admin renueva su propio plan desde "Gestionar plan") —
  if (req.body?.tipo === 'renovar') {
    const session = verifySessionToken(req.headers['x-session-token']);
    if (!session) return res.status(401).json({ error: 'No autorizado' });
    return handleSubPayment(req, res, session.cliente_id);
  }

  // — Compra de créditos de recordatorio —
  if (req.body?.tipo === 'rec_credito') {
    const session = verifySessionToken(req.headers['x-session-token']);
    if (!session) return res.status(401).json({ error: 'No autorizado' });
    return handleRecPayment(req, res, session.cliente_id);
  }

  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  if (req.body?.tipo === 'webpay_init') return handleWebpayInit(req, res, session);
  if (req.body?.tipo === 'mp_create')   return handleMPCreate(req, res, session);

  const { cita_id, enviar_email = true } = req.body || {};
  if (!cita_id) return res.status(400).json({ error: 'Falta cita_id' });

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  // Obtener cita
  const cr = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
  const [cita] = await cr.json();
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

  // Verificar que la cita pertenece al cliente de la sesión (a menos que sea superadmin)
  if (session.rol !== 'superadmin' && cita.cliente_id !== session.cliente_id) {
    return res.status(403).json({ error: 'Sin permiso para esta cita' });
  }

  if (!cita.email_paciente) return res.status(400).json({ error: 'La cita no tiene email del paciente' });
  if (!cita.precio) return res.status(400).json({ error: 'La cita no tiene precio asignado' });

  const precio = Math.round(Number(String(cita.precio).replace(/\./g, '').replace(',', '.')));
  if (!precio || precio <= 0) return res.status(400).json({ error: 'Precio inválido' });

  // Obtener credenciales Flow del cliente y datos adicionales
  let negocio_nombre = null, nombre_especialista = null, clientFlowApiKey = null, clientFlowSecretKey = null, clientFlowApiUrl = FLOW_API_URL, bookingSlug = null, precioFlow = precio;
  try {
    const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=nombre_negocio,metodos_pago,booking_slug&limit=1`, { headers: sh });
    const [cli] = await rcli.json();
    negocio_nombre = cli?.nombre_negocio || null;
    bookingSlug    = cli?.booking_slug   || null;
    const mp = cli?.metodos_pago || {};
    clientFlowApiKey    = mp.flow_api_key    || null;
    clientFlowSecretKey = mp.flow_secret_key || null;
    if (mp.flow_sandbox) clientFlowApiUrl = 'https://sandbox.flow.cl/api';
    if (mp.aplica_iva) precioFlow = Math.round(precio * 1.19);
  } catch(e) { console.error('flow: clientes_sistema error:', e.message); }

  if (!clientFlowApiKey || !clientFlowSecretKey) {
    return res.status(400).json({ error: 'Este negocio no tiene Flow configurado. Agrega las credenciales en Configuración → Pagos.' });
  }

  if (cita.especialista_id) {
    try {
      const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`, { headers: sh });
      const [esp] = await re.json();
      nombre_especialista = esp?.nombre || null;
    } catch(e) { console.error('flow: especialista error:', e.message); }
  }

  // Crear orden en Flow usando credenciales del cliente
  const params = {
    apiKey:          clientFlowApiKey,
    commerceOrder:   String(cita.id),
    subject:         `Cita ${cita.servicio || 'médica'}${negocio_nombre ? ' — ' + negocio_nombre : ''}`.slice(0, 255),
    currency:        'CLP',
    amount:          String(precioFlow),
    email:           cita.email_paciente,
    urlConfirmation: `${BASE_URL}/api/flow-confirm?cid=${cita.cliente_id}`,
    urlReturn:       `${BASE_URL}/api/flow-return?tipo=cita${bookingSlug ? '&slug=' + encodeURIComponent(bookingSlug) : ''}`
  };
  params.s = flowSign(params, clientFlowSecretKey);

  let flowResp, flowData;
  try {
    flowResp = await fetch(`${clientFlowApiUrl}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
    flowData = await flowResp.json();
  } catch(e) {
    console.error('flow: create request error:', e.message);
    return res.status(502).json({ error: 'No se pudo conectar con Flow' });
  }

  if (!flowResp.ok || flowData.code) {
    console.error('flow: create error:', JSON.stringify(flowData));
    return res.status(502).json({ error: flowData.message || `Error Flow [${flowData.code}]` });
  }

  const payment_url = `${flowData.url}?token=${flowData.token}`;

  // Actualizar cita a pending_payment
  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita.id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'pending_payment' })
  }).catch(e => console.error('flow: patch estado error:', e.message));

  // Enviar email de pago pendiente
  let email_ok = false;
  let email_error = null;
  if (enviar_email && process.env.RESEND_API_KEY && cita.email_paciente) {
    const fechaFmt = new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    try {
      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: [cita.email_paciente],
          subject: `Pago pendiente — tu cita en ${negocio_nombre || 'la clínica'}`,
          headers: {
            'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
          html: emailPendientePagoHtml({
            nombre_paciente: cita.nombre_paciente,
            nombre_especialista,
            fechaFmt,
            hora: cita.hora,
            servicio: cita.servicio,
            negocio_nombre,
            precio: cita.precio,
            payment_url,
            cita_id: cita.id
          })
        })
      });
      if (emailResp.ok) {
        email_ok = true;
      } else {
        const errBody = await emailResp.text().catch(() => '');
        email_error = `Resend ${emailResp.status}: ${errBody}`;
        console.error('flow: email error:', email_error);
      }
    } catch(e) {
      email_error = e.message;
      console.error('flow: email error:', e.message);
    }
  } else if (enviar_email && !cita.email_paciente) {
    email_error = 'La cita no tiene email del paciente';
  } else if (enviar_email && !process.env.RESEND_API_KEY) {
    email_error = 'RESEND_API_KEY no configurado';
  }

  return res.json({ ok: true, payment_url, email_ok, email_error });
}
