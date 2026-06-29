import crypto from 'crypto';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const FLOW_API_URL = (process.env.FLOW_API_URL || 'https://www.flow.cl/api').trim().replace(/\/$/, '');
const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

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

function flowSign(params) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', process.env.FLOW_SECRET_KEY).update(str).digest('hex');
}

function generateManageToken(cita_id) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('gestionar:' + cita_id).digest('hex');
}

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
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">¡Pago confirmado y cita reservada! 🎉</h2>
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
      <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">📍 ${dir}</p>
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
  // Format: AT{m|a}{uuid_sin_guiones_32chars}{4digits} = 39 chars total
  if (commerceOrder.length < 35) return res.status(200).send('ok');
  const planCode   = commerceOrder[2];
  const plan       = planCode === 'a' ? 'anual' : 'mensual';
  const uuidClean  = commerceOrder.slice(3, 35);
  const cliente_id = `${uuidClean.slice(0,8)}-${uuidClean.slice(8,12)}-${uuidClean.slice(12,16)}-${uuidClean.slice(16,20)}-${uuidClean.slice(20)}`;
  if (!['mensual', 'anual'].includes(plan) || uuidClean.length !== 32) return res.status(200).send('ok');

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const monto = statusData.amount ? Math.round(Number(statusData.amount)) : (plan === 'anual' ? 269100 : 29900);
  const dias  = plan === 'anual' ? 365 : 30;
  const fecha_expiracion = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];

  await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cliente_id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ activo: true, plan, fecha_expiracion })
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

async function handleSubPayment(req, res) {
  const { cliente_id, plan } = req.body || {};
  if (!cliente_id || !plan) return res.status(400).json({ error: 'Falta cliente_id o plan' });
  if (!['mensual', 'anual'].includes(plan)) return res.status(400).json({ error: 'Plan inválido' });

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const cr = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(cliente_id)}&select=id,email,nombre_negocio&limit=1`, { headers: sh });
  const [cliente] = await cr.json();
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (!cliente.email) return res.status(400).json({ error: 'El cliente no tiene email registrado' });

  const montoDefault = plan === 'anual' ? 269100 : 29900;
  const montoReq = req.body.monto ? parseInt(req.body.monto) : null;
  const monto = (montoReq && montoReq > 0) ? montoReq : montoDefault;
  // AT{m|a}{uuid_sin_guiones}{4digits} = 2+1+32+4 = 39 chars (límite Flow: 45)
  const planCode = plan === 'anual' ? 'a' : 'm';
  const uuidClean = cliente_id.replace(/-/g, '');
  const suffix = String(Date.now() % 10000).padStart(4, '0');
  const commerceOrder = `AT${planCode}${uuidClean}${suffix}`;

  const params = {
    apiKey:          process.env.FLOW_API_KEY,
    commerceOrder,
    subject:         `Suscripción attempo — Plan ${plan === 'anual' ? 'Anual' : 'Mensual'}`,
    currency:        'CLP',
    amount:          String(monto),
    email:           cliente.email,
    urlConfirmation: `${BASE_URL}/api/flow-confirm`,
    urlReturn:       `${BASE_URL}/api/flow-return?plan=${plan}`
  };
  params.s = flowSign(params);

  let flowResp, flowData;
  try {
    flowResp = await fetch(`${FLOW_API_URL}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
    flowData = await flowResp.json();
  } catch(e) {
    console.error('flow sub: create error:', e.message);
    return res.status(502).json({ error: 'No se pudo conectar con Flow' });
  }

  if (!flowResp.ok || flowData.code) {
    console.error('flow sub: create error:', JSON.stringify(flowData));
    return res.status(502).json({ error: flowData.message || `Error Flow [${flowData.code}]` });
  }

  const payment_url = `${flowData.url}?token=${flowData.token}`;
  return res.json({ ok: true, payment_url });
}

async function handleFlowWebhook(req, res) {
  const token = req.body?.token;
  if (!token) return res.status(200).send('ok');

  let statusData;
  try {
    const params = { apiKey: process.env.FLOW_API_KEY, token };
    params.s = flowSign(params);
    const qs = new URLSearchParams(params);
    const statusResp = await fetch(`${FLOW_API_URL}/payment/getStatus?${qs}`);
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

  const cita_id = commerceOrder;

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'confirmed' })
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

export default async function handler(req, res) {
  // Flow redirige el browser aquí después del pago — mostrar página de confirmación
  if (req.query?.ret === '1') {
    const plan = req.query.plan || '';
    const dest = plan ? `/pago-exitoso?plan=${encodeURIComponent(plan)}` : '/pago-exitoso';
    return res.redirect(302, dest);
  }

  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) {
    return res.status(503).json({ error: 'Pagos con Flow no están configurados' });
  }

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

  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

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

  // Obtener nombre negocio y especialista
  let negocio_nombre = null, nombre_especialista = null;
  try {
    const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=nombre_negocio&limit=1`, { headers: sh });
    const [cli] = await rcli.json();
    negocio_nombre = cli?.nombre_negocio || null;
  } catch(e) { console.error('flow: clientes_sistema error:', e.message); }

  if (cita.especialista_id) {
    try {
      const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`, { headers: sh });
      const [esp] = await re.json();
      nombre_especialista = esp?.nombre || null;
    } catch(e) { console.error('flow: especialista error:', e.message); }
  }

  // Crear orden en Flow
  const params = {
    apiKey:          process.env.FLOW_API_KEY,
    commerceOrder:   String(cita.id),
    subject:         `Cita ${cita.servicio || 'médica'}${negocio_nombre ? ' — ' + negocio_nombre : ''}`.slice(0, 255),
    currency:        'CLP',
    amount:          String(precio),
    email:           cita.email_paciente,
    urlConfirmation: `${BASE_URL}/api/flow-confirm`,
    urlReturn:       `${BASE_URL}/gestionar-cita?id=${cita.id}&token=${generateManageToken(cita.id)}&pago=ok`
  };
  params.s = flowSign(params);

  let flowResp, flowData;
  try {
    flowResp = await fetch(`${FLOW_API_URL}/payment/create`, {
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
  if (enviar_email && process.env.RESEND_API_KEY) {
    const fechaFmt = new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    fetch('https://api.resend.com/emails', {
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
    }).catch(e => console.error('flow: email error:', e.message));
  }

  return res.json({ ok: true, payment_url });
}
