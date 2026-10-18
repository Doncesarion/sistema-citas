import crypto from 'crypto';

const SUPABASE_URL   = 'https://xztqawulvrtjvtfixofy.supabase.co';
const BASE_URL       = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');
const KLAP_SAND_URL  = 'https://api-pasarela-sandbox.mcdesaqa.cl';
const KLAP_PROD_URL  = 'https://api.pasarela.multicaja.cl';

function sh() {
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
}

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
  if (Date.now() > parseInt(parts[2])) return null;
  return { cliente_id: parts[0], rol: parts[1] };
}

function generateManageToken(cita_id) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('gestionar:' + cita_id).digest('hex');
}

function validateKlapApikey(headerApikey, order, apikey) {
  if (!apikey || !headerApikey) return false;
  const key  = order.reference_id + order.order_id + apikey;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  try {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(headerApikey, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function htmlEscape(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function emailPendienteHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, precio, payment_url, cita_id }) {
  const np = htmlEscape(nombre_paciente);
  const ne = htmlEscape(nombre_especialista || 'Profesional');
  const sv = htmlEscape(servicio || 'Consulta');
  const nn = htmlEscape(negocio_nombre || 'la clínica');
  const precioStr = precio ? '$' + Number(precio).toLocaleString('es-CL') : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;">
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
    Este enlace es válido por 24 horas. Si no puedes pagar, <a href="${BASE_URL}/gestionar-cita?id=${htmlEscape(cita_id)}&token=${generateManageToken(cita_id)}" style="color:#6C5CE4;text-decoration:none;">cancela tu cita aquí</a>.
  </p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function emailConfirmadoHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, precio, cita_id }) {
  const np = htmlEscape(nombre_paciente);
  const ne = htmlEscape(nombre_especialista || 'Profesional');
  const sv = htmlEscape(servicio || 'Consulta');
  const nn = htmlEscape(negocio_nombre || 'la clínica');
  const precioStr = precio ? '$' + Number(precio).toLocaleString('es-CL') : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;text-align:center;">
  <div style="width:56px;height:56px;background:#d1fae5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
    <span style="color:#059669;font-size:28px;">✓</span>
  </div>
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Pago confirmado — cita reservada</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${np}</strong>, recibimos tu pago. Tu hora está confirmada.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Centro</span><br><span style="color:#2d2d2d;font-size:15px;">${nn}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${ne}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(fechaFmt)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(hora)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${sv}</span></td></tr>
    ${precioStr ? `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total pagado</span><br><span style="color:#6C5CE4;font-size:18px;font-weight:700;">${htmlEscape(precioStr)}</span></td></tr>` : ''}
  </table>
  <a href="${BASE_URL}/gestionar-cita?id=${htmlEscape(cita_id)}&token=${generateManageToken(cita_id)}" target="_blank"
     style="display:inline-block;padding:12px 28px;background:#f3f0ff;color:#6C5CE4;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">
    Ver detalles de tu cita
  </a>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function handleKlapInit(req, res, session) {
  const { cita_id } = req.body || {};
  if (!cita_id) return res.status(400).json({ error: 'Falta cita_id' });

  const headers = sh();

  // Fetch cita
  const rCita = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers })
    .then(r => r.json()).catch(() => null);
  const cita = Array.isArray(rCita) ? rCita[0] : null;
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
  if (cita.cliente_id !== session.cliente_id && session.rol !== 'superadmin')
    return res.status(403).json({ error: 'Sin acceso' });
  if (cita.estado_pago === 'pagado') return res.status(409).json({ error: 'La cita ya fue pagada' });

  // Fetch client credentials (klap_api_key per-client or fallback to global)
  const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cita.cliente_id)}&select=nombre_negocio,email,metodos_pago&limit=1`, { headers })
    .then(r => r.json()).catch(() => null);
  const cli = Array.isArray(rCli) ? rCli[0] : null;
  const mp  = cli?.metodos_pago || {};

  const apiKey   = mp.klap_api_key || process.env.KLAP_API_KEY;
  const sandbox  = mp.klap_sandbox !== false && !process.env.KLAP_PROD;
  const klapBase = sandbox ? KLAP_SAND_URL : KLAP_PROD_URL;

  if (!apiKey) return res.status(400).json({ error: 'No hay credenciales Klap configuradas' });

  const precio = cita.precio || cita.monto;
  if (!precio || Number(precio) < 50) return res.status(400).json({ error: 'Monto inválido para Klap (mínimo $50)' });

  // Fetch especialista nombre
  let nombre_especialista = '';
  if (cita.especialista_id) {
    const rE = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${encodeURIComponent(cita.especialista_id)}&select=nombre&limit=1`, { headers })
      .then(r => r.json()).catch(() => null);
    nombre_especialista = (Array.isArray(rE) ? rE[0]?.nombre : null) || '';
  }

  const cancelUrl = `${BASE_URL}/gestionar-cita?id=${encodeURIComponent(cita_id)}&token=${generateManageToken(cita_id)}`;

  // Create Klap order
  const orderPayload = {
    reference_id: cita_id,
    amount: { currency: 'CLP', total: Math.round(Number(precio)) },
    methods: ['tarjetas'],
    description: `Pago de cita${cita.servicio ? ' — ' + cita.servicio : ''}`,
    urls: {
      return_url: `${BASE_URL}/pago-exitoso?tipo=cita`,
      cancel_url: cancelUrl
    },
    webhooks: {
      webhook_confirm: `${BASE_URL}/api/klap-confirm`,
      webhook_reject:  `${BASE_URL}/api/klap-reject`
    }
  };

  let klapOrder;
  try {
    const klapRes = await fetch(`${klapBase}/payment-gateway/v1/orders`, {
      method:  'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify(orderPayload),
      signal:  AbortSignal.timeout(15000)
    });
    klapOrder = await klapRes.json();
    if (!klapRes.ok || !klapOrder?.redirect_url) {
      console.error('klap_init: error de API', klapRes.status, JSON.stringify(klapOrder));
      return res.status(502).json({ error: 'Error al crear orden en Klap', detail: klapOrder });
    }
  } catch (e) {
    console.error('klap_init: fetch error', e.message);
    return res.status(502).json({ error: 'No se pudo conectar con Klap' });
  }

  const redirect_url = klapOrder.redirect_url;

  // Update cita → pending_payment
  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method:  'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body:    JSON.stringify({ estado: 'pending_payment', metodo_pago: 'klap', klap_order_id: klapOrder.order_id })
  }).catch(e => console.error('klap_init: patch error', e.message));

  // Send payment email
  let email_ok = false;
  if (cita.email_paciente && process.env.RESEND_API_KEY) {
    try {
      const fechaFmt = cita.fecha ? new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
      const html = emailPendienteHtml({
        nombre_paciente:    cita.nombre_paciente || 'Paciente',
        nombre_especialista,
        fechaFmt,
        hora:               cita.hora || '',
        servicio:           cita.servicio || '',
        negocio_nombre:     cli?.nombre_negocio || '',
        precio,
        payment_url:        redirect_url,
        cita_id
      });
      const er = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from: 'attempo <noreply@attempo.cl>', to: [cita.email_paciente], subject: 'Completa el pago de tu cita', html })
      });
      email_ok = er.ok;
      if (!er.ok) console.error('klap_init: email error', er.status);
    } catch (e) {
      console.error('klap_init: email error', e.message);
    }
  }

  return res.status(200).json({ ok: true, redirect_url, order_id: klapOrder.order_id, email_ok });
}

async function handleKlapConfirm(req, res) {
  const order       = req.body || {};
  const headerApikey = req.headers['apikey'] || req.headers['Apikey'];
  const cita_id     = order.reference_id;

  if (!cita_id) {
    console.error('klap_confirm: falta reference_id');
    return res.status(200).json({ status: 'ok' });
  }

  const headers = sh();

  // Validate Apikey (try per-client key first, then global)
  const rCita = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=cliente_id,estado_pago,email_paciente,nombre_paciente,especialista_id,fecha,hora,servicio,precio,monto&limit=1`, { headers })
    .then(r => r.json()).catch(() => null);
  const cita = Array.isArray(rCita) ? rCita[0] : null;

  if (!cita) {
    console.error('klap_confirm: cita no encontrada', cita_id);
    return res.status(200).json({ status: 'ok' });
  }

  // Get API key for validation
  const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cita.cliente_id)}&select=nombre_negocio,email,metodos_pago&limit=1`, { headers })
    .then(r => r.json()).catch(() => null);
  const cli    = Array.isArray(rCli) ? rCli[0] : null;
  const apiKey = cli?.metodos_pago?.klap_api_key || process.env.KLAP_API_KEY;

  if (!validateKlapApikey(headerApikey, order, apiKey)) {
    console.error('klap_confirm: Apikey inválida para cita', cita_id);
    return res.status(200).json({ status: 'ok' });
  }

  // Idempotency check
  if (cita.estado_pago === 'pagado') {
    return res.status(200).json({ status: 'ok' });
  }

  // Update cita → confirmed + pagado
  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method:  'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body:    JSON.stringify({ estado: 'confirmed', estado_pago: 'pagado', metodo_pago: 'klap' })
  }).catch(e => console.error('klap_confirm: patch error', e.message));

  console.log('klap_confirm: cita pagada', cita_id, 'amount=', order.amount);

  // Send confirmation email
  if (cita.email_paciente && process.env.RESEND_API_KEY) {
    try {
      let nombre_especialista = '';
      if (cita.especialista_id) {
        const rE = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${encodeURIComponent(cita.especialista_id)}&select=nombre&limit=1`, { headers })
          .then(r => r.json()).catch(() => null);
        nombre_especialista = (Array.isArray(rE) ? rE[0]?.nombre : null) || '';
      }
      const fechaFmt = cita.fecha ? new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
      const html = emailConfirmadoHtml({
        nombre_paciente:    cita.nombre_paciente || 'Paciente',
        nombre_especialista,
        fechaFmt,
        hora:               cita.hora || '',
        servicio:           cita.servicio || '',
        negocio_nombre:     cli?.nombre_negocio || '',
        precio:             cita.precio || cita.monto,
        cita_id
      });
      const er = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          from:    'attempo <noreply@attempo.cl>',
          to:      [cita.email_paciente],
          subject: `Pago confirmado — tu cita en ${cli?.nombre_negocio || 'la clínica'} está reservada ✓`,
          html
        })
      });
      if (!er.ok) console.error('klap_confirm: email error', er.status);
    } catch (e) {
      console.error('klap_confirm: email error', e.message);
    }
  }

  return res.status(200).json({ status: 'ok' });
}

async function handleKlapReject(req, res) {
  const order        = req.body || {};
  const headerApikey = req.headers['apikey'] || req.headers['Apikey'];
  const cita_id      = order.reference_id;

  if (!cita_id) return res.status(200).json({ status: 'ok' });

  const headers = sh();

  const rCita = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=cliente_id&limit=1`, { headers })
    .then(r => r.json()).catch(() => null);
  const cita = Array.isArray(rCita) ? rCita[0] : null;
  if (!cita) return res.status(200).json({ status: 'ok' });

  const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cita.cliente_id)}&select=metodos_pago&limit=1`, { headers })
    .then(r => r.json()).catch(() => null);
  const apiKey = rCli?.[0]?.metodos_pago?.klap_api_key || process.env.KLAP_API_KEY;

  if (!validateKlapApikey(headerApikey, order, apiKey)) {
    console.error('klap_reject: Apikey inválida para cita', cita_id);
    return res.status(200).json({ status: 'ok' });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method:  'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body:    JSON.stringify({ estado: 'pending', estado_pago: 'rechazado', metodo_pago: 'klap' })
  }).catch(e => console.error('klap_reject: patch error', e.message));

  console.log('klap_reject: pago rechazado cita', cita_id);
  return res.status(200).json({ status: 'ok' });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tipo = req.query?.tipo;

  // Webhooks de Klap (POST desde servidores Klap, sin autenticación de sesión)
  if (tipo === 'klap_confirm') return handleKlapConfirm(req, res);
  if (tipo === 'klap_reject')  return handleKlapReject(req, res);

  // Iniciar pago (POST desde el admin de attempo, requiere sesión)
  if (req.method !== 'POST') return res.status(405).end();

  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  if (tipo === 'klap_init') return handleKlapInit(req, res, session);

  return res.status(404).json({ error: 'Acción no reconocida' });
}
