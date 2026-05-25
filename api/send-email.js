import crypto from 'crypto';

function verifySessionToken(token) {
  if (!token) return false;
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  if (sig !== expected) return false;
  const parts = payload.split(':');
  if (parts.length !== 3) return false;
  if (Date.now() > parseInt(parts[2])) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!verifySessionToken(req.headers['x-session-token'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Sin clave de email' });

  const body = req.body || {};

  // Envío de boleta
  if (body.type === 'boleta') {
    const { to, negocio, folio, html_boleta } = body;
    if (!to || !html_boleta) return res.status(400).json({ error: 'Faltan datos' });
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to,
          subject: `Tu boleta de ${negocio || 'tu negocio'}`,
          html: html_boleta
        })
      });
      if (!r.ok) { console.error('send-boleta error:', await r.text()); return res.status(500).json({ error: 'Error al enviar' }); }
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('send-boleta exception:', e.message);
      return res.status(500).json({ error: 'Error al enviar boleta' });
    }
  }

  // Confirmación de cita (flujo original)
  const { to, cliente, negocio, fecha, hora, especialista, servicio, duracion, total, cliente_id } = body;
  if (!to || !cliente) return res.status(400).json({ error: 'Faltan datos' });

  let metodos_pago = null, datos_banco = null;
  if (cliente_id && process.env.SUPABASE_SERVICE_KEY) {
    const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
    const sh = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };
    try {
      const rc = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=metodos_pago,datos_banco&limit=1`,
        { headers: sh }
      );
      const [cli] = await rc.json();
      metodos_pago = cli?.metodos_pago || null;
      datos_banco  = cli?.datos_banco  || null;
    } catch(_) {}
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Attempo <contacto@attempo.cl>',
        to,
        subject: `Tu cita en ${negocio || 'la clínica'} está confirmada ✓`,
        html: emailHtml({ nombre_paciente: cliente, nombre_especialista: especialista, fechaFmt: fecha, hora, servicio, negocio_nombre: negocio, duracion, total, metodos_pago, datos_banco })
      })
    });
    if (!r.ok) console.error('send-email error:', await r.text());
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('send-email exception:', e.message);
    return res.status(500).json({ error: 'Error al enviar email' });
  }
}

function buildPagoHtml(metodos_pago, datos_banco) {
  if (!metodos_pago) return '';
  const activos = [];
  if (metodos_pago.webpay)        activos.push('Webpay / Transbank');
  if (metodos_pago.transferencia) activos.push('Transferencia bancaria');
  if (metodos_pago.efectivo)      activos.push('Efectivo en el local');
  if (!activos.length) return '';
  let bancoRows = '';
  if (metodos_pago.transferencia && datos_banco && Object.keys(datos_banco).length) {
    const d = datos_banco;
    const filas = [];
    if (d.banco)  filas.push(`Banco: ${d.banco}`);
    if (d.tipo)   filas.push(`Tipo: ${d.tipo}`);
    if (d.cuenta) filas.push(`N° cuenta: ${d.cuenta}`);
    if (d.rut)    filas.push(`RUT: ${d.rut}`);
    if (d.nombre) filas.push(`A nombre de: ${d.nombre}`);
    if (d.email)  filas.push(`Email: ${d.email}`);
    if (filas.length) bancoRows = `<tr><td style="padding:2px 0 10px;text-align:center;font-size:12px;color:#6b7280;line-height:1.8">${filas.join('<br>')}</td></tr>`;
  }
  return `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Métodos de pago</span><br><span style="color:#2d2d2d;font-size:13px;">${activos.join(' · ')}</span></td></tr>${bancoRows}`;
}

function emailHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, duracion, total, metodos_pago, datos_banco }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="https://attempo.cl/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">¡Cita confirmada! 🎉</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${nombre_paciente}</strong>, tu hora está reservada.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${nombre_especialista || 'Profesional'}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${fechaFmt}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${hora}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${servicio || 'Consulta'}</span></td></tr>
    ${duracion ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Duración</span><br><span style="color:#2d2d2d;font-size:15px;">${duracion}</span></td></tr>` : ''}
    ${total ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</span><br><span style="color:#6C5CE4;font-size:16px;font-weight:700;">${total}</span></td></tr>` : ''}
    ${buildPagoHtml(metodos_pago, datos_banco)}
  </table>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
