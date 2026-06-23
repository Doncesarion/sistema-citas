import crypto from 'crypto';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const FLOW_API_URL = (process.env.FLOW_API_URL || 'https://www.flow.cl/api').trim().replace(/\/$/, '');
const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

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

export default async function handler(req, res) {
  // Flow envía el webhook como POST con form-encoded
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) {
    console.error('flow-confirm: Flow no configurado');
    return res.status(200).send('ok'); // Siempre 200 para Flow
  }

  const token = req.body?.token;
  if (!token) {
    console.error('flow-confirm: sin token');
    return res.status(200).send('ok');
  }

  // Consultar estado del pago en Flow
  let statusData;
  try {
    const params = { apiKey: process.env.FLOW_API_KEY, token };
    params.s = flowSign(params);
    const qs = new URLSearchParams(params);
    const statusResp = await fetch(`${FLOW_API_URL}/payment/getStatus?${qs}`);
    statusData = await statusResp.json();
  } catch(e) {
    console.error('flow-confirm: getStatus error:', e.message);
    return res.status(200).send('ok');
  }

  console.log('flow-confirm: status =', statusData.status, 'order =', statusData.commerceOrder);

  // Flow estados: 1=pendiente, 2=pagado, 3=rechazado, 4=anulado
  if (statusData.status !== 2) {
    return res.status(200).send('ok');
  }

  const cita_id = statusData.commerceOrder;
  if (!cita_id) {
    console.error('flow-confirm: sin commerceOrder en respuesta');
    return res.status(200).send('ok');
  }

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  // Actualizar cita a confirmed
  await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'confirmed' })
  }).catch(e => console.error('flow-confirm: patch error:', e.message));

  // Enviar email de confirmación
  try {
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${encodeURIComponent(cita_id)}&select=*&limit=1`, { headers: sh });
    const [cita] = await cr.json();

    if (!cita?.email_paciente || !process.env.RESEND_API_KEY) {
      return res.status(200).send('ok');
    }

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
    }).catch(e => console.error('flow-confirm: email error:', e.message));
  } catch(e) {
    console.error('flow-confirm: post-payment processing error:', e.message);
  }

  return res.status(200).send('ok');
}
