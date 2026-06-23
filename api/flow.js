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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) {
    return res.status(503).json({ error: 'Pagos con Flow no están configurados' });
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
