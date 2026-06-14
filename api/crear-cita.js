import crypto from 'crypto';

const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

function generateManageToken(cita_id) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('gestionar:' + cita_id).digest('hex');
}

function verifyManageToken(cita_id, token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return true;
  if (!token || typeof token !== 'string' || token.length !== 64) return false;
  const expected = crypto.createHmac('sha256', secret).update('gestionar:' + cita_id).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// Rate limiting persistente con Upstash Redis (fallback a Map en memoria)
const _bookingFallback = new Map();
async function isBookingRateLimited(ip) {
  const MAX = 20;
  const WINDOW_S = 60 * 60;

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    try {
      const bucket = Math.floor(Date.now() / (WINDOW_S * 1000));
      const key = `rl:booking:${ip}:${bucket}`;
      const r = await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['INCR', key], ['EXPIRE', key, WINDOW_S * 2]])
      });
      const data = await r.json();
      const count = data[0]?.result;
      if (typeof count === 'number') return count > MAX;
    } catch {}
  }

  // Fallback en memoria si Upstash no está disponible
  const now = Date.now();
  const entry = _bookingFallback.get(ip);
  if (!entry || now > entry.resetAt) {
    _bookingFallback.set(ip, { count: 1, resetAt: now + WINDOW_S * 1000 });
    return false;
  }
  if (entry.count >= MAX) return true;
  entry.count++;
  return false;
}

export default async function handler(req, res) {
  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  // ── GET: consultar datos de una cita (gestionar-cita) ─────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta id' });

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&select=*&limit=1`, { headers: sh });
      const data = await r.json();
      const cita = data[0];
      if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

      let nombre_especialista = null;
      if (cita.especialista_id) {
        const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`, { headers: sh });
        const [esp] = await re.json();
        nombre_especialista = esp?.nombre || null;
      }

      const rc = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=booking_slug,nombre_negocio&limit=1`, { headers: sh });
      const [cliente] = await rc.json();

      return res.json({
        cita,
        nombre_especialista,
        booking_slug: cliente?.booking_slug || null,
        negocio_nombre: cliente?.nombre_negocio || null
      });
    } catch (e) {
      console.error('gestionar-cita GET error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  // ── POST: cancelar o reagendar (gestionar-cita) ───────────────────────────
  if (req.body?.accion) {
    const { id, accion, nueva_fecha, nueva_hora, token } = req.body;
    if (!id || !['cancelar', 'reagendar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });

    if (!verifyManageToken(id, token)) {
      return res.status(401).json({ error: 'Link inválido. Usa el enlace original de tu email de confirmación.' });
    }

    try {
      let patchBody;
      if (accion === 'cancelar') {
        patchBody = { estado: 'canceled' };
      } else {
        if (!nueva_fecha || !nueva_hora) return res.status(400).json({ error: 'Faltan fecha u hora' });
        patchBody = { fecha: nueva_fecha, hora: nueva_hora };
      }

      let citaPrevia = null;
      try {
        const rpre = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&select=google_event_id,cliente_id&limit=1`, { headers: sh });
        [citaPrevia] = await rpre.json();
      } catch(_) {}

      const r = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=representation' },
        body: JSON.stringify(patchBody)
      });
      if (!r.ok) {
        const err = await r.json();
        return res.status(500).json({ error: err?.message || 'Error al procesar' });
      }

      if (accion === 'cancelar' && citaPrevia?.google_event_id && citaPrevia?.cliente_id && process.env.GOOGLE_CLIENT_ID) {
        await gcGestionarEvento({ supabaseUrl: SUPABASE_URL, sh, accion: 'cancelar', cliente_id: citaPrevia.cliente_id, google_event_id: citaPrevia.google_event_id }).catch(() => {});
      }

      if (accion === 'reagendar' && process.env.RESEND_API_KEY) {
        try {
          const rc = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&select=*&limit=1`, { headers: sh });
          const [cita] = await rc.json();

          if (cita?.email_paciente) {
            let nombre_especialista = null;
            if (cita.especialista_id) {
              const re = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${cita.especialista_id}&select=nombre&limit=1`, { headers: sh });
              const [esp] = await re.json();
              nombre_especialista = esp?.nombre || null;
            }

            const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=nombre_negocio,direccion,email,metodos_pago,datos_banco,google_refresh_token&limit=1`, { headers: sh });
            const [cliente] = await rcli.json();

            const fechaFmt = new Date(nueva_fecha + 'T12:00:00').toLocaleDateString('es-CL', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            });

            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Attempo <contacto@attempo.cl>',
                to: cita.email_paciente,
                subject: `Tu cita en ${cliente?.nombre_negocio || 'la clínica'} fue reagendada ✓`,
                headers: {
                  'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
                },
                html: emailReagendadoHtml({
                  nombre_paciente:    cita.nombre_paciente,
                  nombre_especialista,
                  fechaFmt,
                  hora:               nueva_hora,
                  servicio:           cita.servicio,
                  negocio_nombre:     cliente?.nombre_negocio || null,
                  direccion:          cliente?.direccion || null,
                  email_negocio:      cliente?.email || null,
                  metodos_pago:       cliente?.metodos_pago || null,
                  datos_banco:        cliente?.datos_banco  || null,
                  cita_id:            id
                })
              })
            }).catch(e => console.error('email reagendar error:', e.message));

            if (citaPrevia?.google_event_id && cliente?.google_refresh_token && process.env.GOOGLE_CLIENT_ID) {
              await gcGestionarEvento({
                supabaseUrl: SUPABASE_URL, sh, accion: 'reagendar',
                cliente_id:      cita.cliente_id,
                google_event_id: citaPrevia.google_event_id,
                refresh_token:   cliente.google_refresh_token,
                nombre_paciente: cita.nombre_paciente,
                nombre_especialista,
                servicio:    cita.servicio,
                fecha:       nueva_fecha,
                hora:        nueva_hora,
                duracion:    cita.duracion || null,
                direccion:   cliente?.direccion || null
              }).catch(() => {});
            }
          }
        } catch (e) {
          console.error('email reagendar exception:', e.message);
        }
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error('gestionar-cita POST error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // ── POST: crear nueva cita ─────────────────────────────────────────────────
  const {
    cliente_id, especialista_id, nombre_especialista,
    nombre_paciente, tel_paciente, email_paciente,
    servicio, fecha, hora, negocio_nombre, duracion, precio,
    from_admin, enviar_email, estado_admin
  } = req.body || {};

  const ESTADO_MAP = { reservada:'pending', confirmada:'confirmed', pendiente:'pending', completada:'completed', cancelada:'canceled', inasistencia:'no-show' };
  const estadoFinal = from_admin && estado_admin ? (ESTADO_MAP[estado_admin] || 'pending') : 'pending';

  const citaIdYaCreada = req.body?._cita_id_ya_creada || null;
  if (!citaIdYaCreada) {
    const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    if (await isBookingRateLimited(ip)) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
    }
  }

  if (!cliente_id || !nombre_paciente || !fecha || !hora) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }
  if (!citaIdYaCreada && !from_admin && !email_paciente) {
    return res.status(400).json({ error: 'El email del paciente es obligatorio' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida' });
  }
  if (email_paciente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_paciente)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  if (String(nombre_paciente).length > 200) {
    return res.status(400).json({ error: 'Nombre demasiado largo' });
  }

  if (citaIdYaCreada) {
    const key = req.headers['x-internal-key'];
    if (!process.env.INTERNAL_API_SECRET || key !== process.env.INTERNAL_API_SECRET) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  try {
    let cita;
    if (citaIdYaCreada) {
      cita = { id: citaIdYaCreada };
    } else {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/citas`, {
        method: 'POST',
        headers: { ...sh, Prefer: 'return=representation' },
        body: JSON.stringify({
          cliente_id,
          especialista_id,
          nombre_paciente,
          tel_paciente:   tel_paciente   || null,
          email_paciente: email_paciente || null,
          servicio:       servicio       || 'Consulta',
          fecha,
          hora,
          duracion:       duracion ? (parseInt(duracion) || null) : null,
          precio:         precio         || null,
          estado: estadoFinal
        })
      });

      const data = await r.json();
      if (!r.ok) {
        console.error('crear-cita supabase error:', r.status, JSON.stringify(data));
        const code = data?.code;
        const isDup  = code === '23505';
        const isFk   = code === '23503';
        const isNull = code === '23502';
        const isRls  = code === '42501' || r.status === 403;
        let msg;
        if (isDup)  msg = 'Ya existe una cita en ese horario';
        else if (isFk)   msg = 'Profesional no encontrado (FK). Revisa la configuración de profesionales.';
        else if (isNull) msg = `Falta un campo obligatorio: ${data?.details || ''}`;
        else if (isRls)  msg = 'Sin permisos para crear la cita (RLS)';
        else msg = `Error al crear la cita [${code || r.status}]: ${data?.message || ''}`;
        return res.status(isDup ? 409 : 500).json({ error: msg });
      }
      cita = data[0];
    }

    let direccion = null, email_negocio = null, metodos_pago = null, datos_banco = null, google_refresh_token = null, google_calendar_id = null;
    try {
      const rc = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=direccion,email,metodos_pago,datos_banco,google_refresh_token,google_calendar_id&limit=1`,
        { headers: sh }
      );
      const rcBody = await rc.json();
      if (!rc.ok) { console.error('crear-cita: clientes_sistema fetch error:', JSON.stringify(rcBody)); }
      const [cli] = Array.isArray(rcBody) ? rcBody : [];
      direccion            = cli?.direccion            || null;
      email_negocio        = cli?.email                || null;
      metodos_pago         = cli?.metodos_pago         || null;
      datos_banco          = cli?.datos_banco          || null;
      google_refresh_token = cli?.google_refresh_token || null;
      google_calendar_id   = cli?.google_calendar_id   || null;
    } catch(e) { console.error('crear-cita: clientes_sistema exception:', e.message); }

    if (email_paciente && process.env.RESEND_API_KEY && enviar_email !== false) {
      const fechaFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      console.log('crear-cita: enviando email confirmación');
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Attempo <contacto@attempo.cl>',
            to: [email_paciente],
            subject: `Tu cita en ${negocio_nombre || 'la clínica'} está confirmada ✓`,
            headers: {
              'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            },
            html: emailHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, direccion, email_negocio, cita_id: cita.id, duracion, precio, metodos_pago, datos_banco })
          })
        });
        if (!emailRes.ok) {
          const errTxt = await emailRes.text();
          console.error('crear-cita: email error', emailRes.status, errTxt);
        } else {
          console.log('crear-cita: email enviado OK');
        }
      } catch (e) {
        console.error('crear-cita: email exception:', e.message);
      }
    } else {
      console.log('crear-cita: email omitido — RESEND_KEY:', !!process.env.RESEND_API_KEY);
    }

    let gc_debug = { token: !!google_refresh_token, client_id: !!process.env.GOOGLE_CLIENT_ID };
    if (google_refresh_token && process.env.GOOGLE_CLIENT_ID) {
      gc_debug.resultado = await gcCrearEvento({
        supabaseUrl: SUPABASE_URL, sh, cita_id: cita.id, cliente_id,
        nombre_paciente, nombre_especialista, servicio, fecha, hora, duracion, direccion,
        refresh_token: google_refresh_token, google_calendar_id
      });
    }

    console.log('crear-cita gc_debug:', JSON.stringify(gc_debug));
    return res.json({ ok: true, cita });
  } catch (e) {
    console.error('crear-cita exception:', e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}

async function gcGetAccessToken(refresh_token) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token'
    })
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error('Token refresh failed: ' + data.error);
    err.invalid = data.error === 'invalid_grant';
    throw err;
  }
  return data.access_token;
}

function gcBuildEvent({ nombre_paciente, nombre_especialista, servicio, fecha, hora, duracion, direccion }) {
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm]  = hora.split(':').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const durMin  = duracion ? parseInt(duracion) : 30;
  const endMins = hh * 60 + mm + durMin;
  const startDt = `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`;
  const endDt   = `${y}-${pad(m)}-${pad(d)}T${pad(Math.floor(endMins/60))}:${pad(endMins%60)}:00`;
  return {
    summary: `Cita: ${nombre_paciente}${nombre_especialista ? ' — ' + nombre_especialista : ''}`,
    description: [
      `Paciente: ${nombre_paciente}`,
      nombre_especialista ? `Profesional: ${nombre_especialista}` : '',
      servicio            ? `Motivo: ${servicio}`                 : ''
    ].filter(Boolean).join('\n'),
    location: direccion || undefined,
    start: { dateTime: startDt, timeZone: 'America/Santiago' },
    end:   { dateTime: endDt,   timeZone: 'America/Santiago' }
  };
}

async function gcGestionarEvento({ supabaseUrl, sh, accion, cliente_id, google_event_id, refresh_token, nombre_paciente, nombre_especialista, servicio, fecha, hora, duracion, direccion }) {
  try {
    const access_token = await gcGetAccessToken(refresh_token);
    const base = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${google_event_id}`;

    if (accion === 'cancelar') {
      await fetch(base, { method: 'DELETE', headers: { Authorization: `Bearer ${access_token}` } });
    } else if (accion === 'reagendar') {
      const event = gcBuildEvent({ nombre_paciente, nombre_especialista, servicio, fecha, hora, duracion, direccion });
      await fetch(base, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
    }
  } catch(e) {
    console.error('gcGestionarEvento error:', e.message);
    if (e.invalid && supabaseUrl && sh && cliente_id) {
      await fetch(`${supabaseUrl}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
        method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ google_refresh_token: null })
      }).catch(() => {});
    }
  }
}

async function gcGetOrCreateCalendar(access_token, supabaseUrl, sh, cliente_id, existing_calendar_id) {
  if (existing_calendar_id) {
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(existing_calendar_id)}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    if (r.ok) return existing_calendar_id;
  }
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: 'Attempo', description: 'Citas gestionadas con Attempo', timeZone: 'America/Santiago' })
  });
  if (!r.ok) throw new Error('No se pudo crear el calendario Attempo: ' + await r.text());
  const cal = await r.json();
  await fetch(`${supabaseUrl}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ google_calendar_id: cal.id })
  });
  return cal.id;
}

async function gcCrearEvento({ supabaseUrl, sh, cita_id, cliente_id, nombre_paciente, nombre_especialista, servicio, fecha, hora, duracion, direccion, refresh_token, google_calendar_id }) {
  try {
    const access_token = await gcGetAccessToken(refresh_token);
    const calendar_id  = await gcGetOrCreateCalendar(access_token, supabaseUrl, sh, cliente_id, google_calendar_id);
    const event = gcBuildEvent({ nombre_paciente, nombre_especialista, servicio, fecha, hora, duracion, direccion });
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    const rText = await r.text();
    if (!r.ok) return { error: 'GC POST failed', status: r.status, body: rText };
    const { id: google_event_id } = JSON.parse(rText);
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${cita_id}`, {
      method: 'PATCH',
      headers: { ...sh, Prefer: 'return=minimal' },
      body: JSON.stringify({ google_event_id })
    });
    return { ok: true, google_event_id, calendar_id };
  } catch(e) {
    if (e.invalid) {
      await fetch(`${supabaseUrl}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
        method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ google_refresh_token: null })
      }).catch(() => {});
    }
    return { error: e.message, invalid: !!e.invalid };
  }
}

function htmlEscape(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    if (d.banco)  filas.push(`Banco: ${htmlEscape(d.banco)}`);
    if (d.tipo)   filas.push(`Tipo: ${htmlEscape(d.tipo)}`);
    if (d.cuenta) filas.push(`N° cuenta: ${htmlEscape(d.cuenta)}`);
    if (d.rut)    filas.push(`RUT: ${htmlEscape(d.rut)}`);
    if (d.nombre) filas.push(`A nombre de: ${htmlEscape(d.nombre)}`);
    if (d.email)  filas.push(`Email: ${htmlEscape(d.email)}`);
    if (filas.length) bancoRows = `<tr><td style="padding:2px 0 10px;text-align:center;font-size:12px;color:#6b7280;line-height:1.8">${filas.join('<br>')}</td></tr>`;
  }
  return `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Métodos de pago</span><br><span style="color:#2d2d2d;font-size:13px;">${activos.join(' · ')}</span></td></tr>${bancoRows}`;
}

function emailHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, direccion, email_negocio, cita_id, duracion, precio, metodos_pago, datos_banco }) {
  const np  = htmlEscape(nombre_paciente);
  const ne  = htmlEscape(nombre_especialista || 'Profesional');
  const sv  = htmlEscape(servicio || 'Consulta');
  const dir = htmlEscape(direccion);
  const en  = htmlEscape(email_negocio);
  const dur = htmlEscape(duracion);
  const precioStr = precio
    ? htmlEscape(typeof precio === 'number' ? '$' + precio.toLocaleString('es-CL') : precio)
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
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">¡Cita confirmada! 🎉</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${np}</strong>, tu hora está reservada.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${ne}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(fechaFmt)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(hora)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${sv}</span></td></tr>
    ${dur ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Duración</span><br><span style="color:#2d2d2d;font-size:15px;">${dur}</span></td></tr>` : ''}
    ${precioStr ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</span><br><span style="color:#6C5CE4;font-size:16px;font-weight:700;">${precioStr}</span></td></tr>` : ''}
    ${buildPagoHtml(metodos_pago, datos_banco)}
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

function emailReagendadoHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, direccion, email_negocio, metodos_pago, datos_banco, cita_id }) {
  const np  = htmlEscape(nombre_paciente);
  const ne  = htmlEscape(nombre_especialista || 'Profesional');
  const sv  = htmlEscape(servicio || 'Consulta');
  const dir = htmlEscape(direccion);
  const en  = htmlEscape(email_negocio);
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
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Cita reagendada ✓</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${np}</strong>, tu cita fue reagendada exitosamente.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${ne}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Nueva fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(fechaFmt)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Nueva hora</span><br><span style="color:#2d2d2d;font-size:15px;">${htmlEscape(hora)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${sv}</span></td></tr>
    ${buildPagoHtml(metodos_pago, datos_banco)}
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
    ¿Necesitas más cambios? <a href="${BASE_URL}/gestionar-cita?id=${htmlEscape(cita_id)}&token=${generateManageToken(cita_id)}" style="color:#6C5CE4;font-weight:600;text-decoration:none;">Cancelar o reagendar tu cita</a>
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
