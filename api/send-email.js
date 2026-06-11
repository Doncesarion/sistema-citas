import crypto from 'crypto';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const BASE_URL     = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

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

function he(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Reemplaza variables en el template de recordatorio
function renderTemplate(template, vars) {
  return (template || '')
    .replace(/\{nombre\}/g,      vars.nombre      || '')
    .replace(/\{fecha\}/g,       vars.fecha        || '')
    .replace(/\{hora\}/g,        vars.hora         || '')
    .replace(/\{profesional\}/g, vars.profesional  || '')
    .replace(/\{servicio\}/g,    vars.servicio     || '')
    .replace(/\{negocio\}/g,     vars.negocio      || '');
}

// Template HTML para recordatorio
function emailRecordatorioHtml({ nombre, fecha, hora, profesional, servicio, negocio, mensaje_extra, cita_id }) {
  const gestionUrl = `${BASE_URL}/gestionar-cita?id=${he(cita_id || '')}`;
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
  <div style="width:48px;height:48px;border-radius:50%;background:#ede9fe;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:22px;">🔔</div>
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Recordatorio de cita</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${he(nombre)}</strong>, te recordamos que tienes una cita próximamente.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    ${profesional ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${he(profesional)}</span></td></tr>` : ''}
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;font-weight:600;">${he(fecha)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;font-weight:600;">${he(hora)}</span></td></tr>
    ${servicio ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Servicio</span><br><span style="color:#2d2d2d;font-size:15px;">${he(servicio)}</span></td></tr>` : ''}
  </table>
  ${mensaje_extra ? `<p style="margin:20px 0 0;color:#374151;font-size:13px;line-height:1.6;text-align:left;background:#f9f8ff;border-radius:8px;padding:12px 16px">${he(mensaje_extra).replace(/\n/g,'<br>')}</p>` : ''}
  <p style="margin:20px 0 6px;color:#6b7280;font-size:13px;text-align:center;">¿Necesitas cambios? <a href="${gestionUrl}" style="color:#6C5CE4;font-weight:600;text-decoration:none;">Cancelar o reagendar tu cita</a></p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Recordatorio automático de <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── Lógica de envío de recordatorios ─────────────────────────────────────────
async function procesarRecordatorios(sh, shJson) {
  const resend_key = process.env.RESEND_API_KEY;
  if (!resend_key) return { enviados: 0, errores: ['Sin RESEND_API_KEY'] };

  // Fechas en Santiago
  const ahoraStgo = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const hoyISO = ahoraStgo.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const mañana = new Date(ahoraStgo); mañana.setDate(mañana.getDate() + 1);
  const mañanaISO = mañana.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

  let enviados = 0;
  const errores = [];

  try {
    // Cargar todos los clientes con recordatorios activos
    const rCli = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?select=id,nombre_negocio,recordatorios_config`,
      { headers: sh }
    );
    const clientes = await rCli.json();
    if (!Array.isArray(clientes)) return { enviados, errores: ['Error cargando clientes'] };

    for (const cli of clientes) {
      const cfg = cli.recordatorios_config || {};
      if (!cfg.email_activo) continue;

      const tiempo = cfg.email_tiempo || '24h';
      // Para cron diario: 24h → mañana, resto → hoy también
      const fechas = tiempo === '24h' ? [mañanaISO] : [hoyISO, mañanaISO];

      for (const fechaTarget of fechas) {
        try {
          // Buscar citas de ese día sin recordatorio enviado
          const rCitas = await fetch(
            `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cli.id}&fecha=eq.${fechaTarget}&email_rec_enviado=eq.false&estado=neq.canceled&email_paciente=not.is.null&select=id,nombre_paciente,email_paciente,hora,servicio,fecha,especialistas(nombre)`,
            { headers: sh }
          );
          const citas = await rCitas.json();
          if (!Array.isArray(citas) || !citas.length) continue;

          for (const cita of citas) {
            if (!cita.email_paciente) continue;

            const fechaFmt = new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            });
            const horaFmt = cita.hora?.slice(0, 5) || '';
            const profNombre = cita.especialistas?.nombre || '';
            const negocioNombre = cli.nombre_negocio || 'tu negocio';

            const vars = {
              nombre:      cita.nombre_paciente || 'Estimado/a',
              fecha:       fechaFmt,
              hora:        horaFmt,
              profesional: profNombre,
              servicio:    cita.servicio || '',
              negocio:     negocioNombre
            };

            const asunto = renderTemplate(
              cfg.email_asunto || 'Recordatorio: tu cita en {negocio}',
              vars
            );
            const mensajeExtra = renderTemplate(cfg.email_mensaje || '', vars);

            // Enviar email
            const emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resend_key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: `${negocioNombre} vía Attempo <contacto@attempo.cl>`,
                to: [cita.email_paciente],
                subject: asunto,
                headers: {
                  'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
                },
                html: emailRecordatorioHtml({
                  nombre:      vars.nombre,
                  fecha:       fechaFmt,
                  hora:        horaFmt,
                  profesional: profNombre,
                  servicio:    cita.servicio || '',
                  negocio:     negocioNombre,
                  mensaje_extra: mensajeExtra,
                  cita_id:     cita.id
                })
              })
            });

            if (emailRes.ok) {
              enviados++;
              // Marcar como enviado
              fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
                method: 'PATCH',
                headers: { ...shJson, Prefer: 'return=minimal' },
                body: JSON.stringify({ email_rec_enviado: true })
              }).catch(e => console.error('send-email: error marcando recordatorio:', e.message));
            } else {
              const errTxt = await emailRes.text().catch(() => '');
              console.error('send-email: recordatorio email error', emailRes.status, errTxt);
              errores.push(`cita ${cita.id}: ${emailRes.status}`);
            }
          }
        } catch (e) {
          console.error(`send-email: error procesando cliente ${cli.id} fecha ${fechaTarget}:`, e.message);
          errores.push(`cliente ${cli.id}: ${e.message}`);
        }
      }
    }
  } catch(e) {
    console.error('send-email: error general en procesarRecordatorios:', e.message);
    errores.push(e.message);
  }

  return { enviados, errores };
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const sh    = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };
  const shJson = { ...sh, 'Content-Type': 'application/json' };

  // ── GET: cron automático ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    console.log('send-email: cron recordatorios iniciado');
    const result = await procesarRecordatorios(sh, shJson);
    console.log('send-email: cron finalizado —', result.enviados, 'enviados,', result.errores.length, 'errores');
    return res.status(200).json(result);
  }

  if (req.method !== 'POST') return res.status(405).end();

  // ── POST: requiere sesión válida ─────────────────────────────────────────
  if (!verifySessionToken(req.headers['x-session-token'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Sin clave de email' });

  const body = req.body || {};

  // — Enviar recordatorios manualmente —
  if (body.type === 'enviar_recordatorios') {
    const result = await procesarRecordatorios(sh, shJson);
    return res.status(200).json(result);
  }

  // — Envío de boleta —
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

  // — Confirmación de cita (flujo original) —
  const { to, cliente, negocio, fecha, hora, especialista, servicio, duracion, total, cliente_id } = body;
  if (!to || !cliente) return res.status(400).json({ error: 'Faltan datos' });

  let metodos_pago = null, datos_banco = null;
  if (cliente_id && process.env.SUPABASE_SERVICE_KEY) {
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
