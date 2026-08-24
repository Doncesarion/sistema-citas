import crypto from 'crypto';

const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

function verifySessionToken(token) {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const [cliente_id, rol, expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id, rol };
}

function decryptToken(encrypted) {
  if (!encrypted?.startsWith('enc:')) return encrypted;
  const parts = encrypted.split(':');
  if (parts.length !== 4) return encrypted;
  const [, ivHex, tagHex, dataHex] = parts;
  const key = Buffer.from(process.env.GOOGLE_TOKEN_KEY, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
}

function flowSign(params, secret) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secret || process.env.FLOW_SECRET_KEY).update(str).digest('hex');
}

function generateManageToken(cita_id) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return '';
  const expire = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 días
  const hmac = crypto.createHmac('sha256', secret).update('gestionar:' + cita_id + ':' + expire).digest('hex');
  return expire + '.' + hmac;
}

function verifyManageToken(cita_id, token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  if (!token || typeof token !== 'string') return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return false;
  const expire = parseInt(token.slice(0, dotIdx), 10);
  const hmac = token.slice(dotIdx + 1);
  if (isNaN(expire) || hmac.length !== 64) return false;
  if (Math.floor(Date.now() / 1000) > expire) return false; // token expirado
  const expected = crypto.createHmac('sha256', secret).update('gestionar:' + cita_id + ':' + expire).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// Rate limiting persistente con Upstash Redis (fallback a Map en memoria)
const _bookingFallback = new Map();
const _gestionarFallback = new Map();
const _emailLookupFallback = new Map();
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

async function isGestionRateLimited(ip) {
  const MAX = 10;
  const WINDOW_S = 3600;

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    try {
      const bucket = Math.floor(Date.now() / (WINDOW_S * 1000));
      const key = `rl:gestionar:${ip}:${bucket}`;
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

  const now = Date.now();
  const entry = _gestionarFallback.get(ip);
  if (!entry || now > entry.resetAt) {
    _gestionarFallback.set(ip, { count: 1, resetAt: now + WINDOW_S * 1000 });
    return false;
  }
  if (entry.count >= MAX) return true;
  entry.count++;
  return false;
}

async function isEmailLookupRateLimited(ip) {
  const MAX = 15;
  const WINDOW_S = 3600;
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    try {
      const bucket = Math.floor(Date.now() / (WINDOW_S * 1000));
      const key = `rl:emaillookup:${ip}:${bucket}`;
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
  const now = Date.now();
  const entry = _emailLookupFallback.get(ip);
  if (!entry || now > entry.resetAt) {
    _emailLookupFallback.set(ip, { count: 1, resetAt: now + WINDOW_S * 1000 });
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
    const { id, t, email, cid } = req.query;

    // Lookup por email: paciente busca sus citas próximas en la página de reserva
    if (email && cid) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
      const UUID_RE_Q = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE_Q.test(cid)) return res.status(400).json({ error: 'Parámetro inválido' });
      const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
      if (await isEmailLookupRateLimited(ip)) return res.status(429).json({ error: 'Demasiadas consultas. Intenta más tarde.' });
      try {
        const hace90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/citas?email_paciente=ilike.${encodeURIComponent(email)}&cliente_id=eq.${cid}&fecha=gte.${hace90}&order=fecha.desc&limit=6&select=id,fecha,hora,servicio,estado,especialista_id,nombre_especialista,duracion,precio`,
          { headers: sh }
        );
        const rows = await r.json();
        if (!Array.isArray(rows)) {
          console.error('email-lookup supabase error:', JSON.stringify(rows));
          return res.status(500).json({ error: 'Error al buscar citas' });
        }
        const citas = rows.map(c => ({ id: c.id, fecha: c.fecha, hora: c.hora, servicio: c.servicio, estado: c.estado, especialista_id: c.especialista_id, nombre_especialista: c.nombre_especialista, duracion: c.duracion, precio: c.precio, token: generateManageToken(c.id) }));
        return res.json({ ok: true, citas });
      } catch(e) {
        console.error('email-lookup error:', e.message);
        return res.status(500).json({ error: 'Error al buscar citas' });
      }
    }

    // Lookup por número de reserva AT-XXXXXXXX
    const { ref, cid: refCid } = req.query;
    if (ref && refCid) {
      const hex = ref.toUpperCase().startsWith('AT-') ? ref.slice(3).toLowerCase() : ref.toLowerCase();
      if (!/^[0-9a-f]{8}$/.test(hex)) return res.status(400).json({ error: 'Número de reserva inválido' });
      const UUID_RE_Q2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE_Q2.test(refCid)) return res.status(400).json({ error: 'Parámetro inválido' });
      const ip2 = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
      if (await isEmailLookupRateLimited(ip2)) return res.status(429).json({ error: 'Demasiadas consultas. Intenta más tarde.' });
      try {
        const lo = `${hex}-0000-0000-0000-000000000000`;
        const hi = `${hex}-ffff-ffff-ffff-ffffffffffff`;
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/citas?id=gte.${lo}&id=lte.${hi}&cliente_id=eq.${refCid}&select=id,fecha,hora,servicio,estado&limit=1`,
          { headers: sh }
        );
        const rows = await r.json();
        if (!Array.isArray(rows)) return res.status(500).json({ error: 'Error al buscar cita' });
        const citas = rows.map(c => ({ id: c.id, fecha: c.fecha, hora: c.hora, servicio: c.servicio, estado: c.estado, token: generateManageToken(c.id) }));
        return res.json({ ok: true, citas });
      } catch(e) {
        return res.status(500).json({ error: 'Error al buscar cita' });
      }
    }

    if (!id) return res.status(400).json({ error: 'Falta id' });
    if (!t || !verifyManageToken(id, t)) return res.status(403).json({ error: 'Acceso no autorizado' });

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
    if (!id || !['cancelar', 'reagendar', 'feedback'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });

    const ipGestionar = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    if (await isGestionRateLimited(ipGestionar)) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
    }

    if (!verifyManageToken(id, token)) {
      return res.status(401).json({ error: 'Link inválido. Usa el enlace original de tu email de confirmación.' });
    }

    // ── FEEDBACK ──────────────────────────────────────────────────────────────
    if (accion === 'feedback') {
      const { rating, comentario } = req.body;
      const r = parseInt(rating, 10);
      if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating inválido' });
      try {
        const rc = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&select=nombre_paciente,servicio,fecha,hora,cliente_id&limit=1`, { headers: sh });
        const [cita] = await rc.json();
        if (cita?.cliente_id && process.env.RESEND_API_KEY) {
          const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=email,nombre_negocio&limit=1`, { headers: sh });
          const [cli] = await rcli.json();
          if (cli?.email) {
            const estrellas = '★'.repeat(r) + '☆'.repeat(5 - r);
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Attempo <contacto@attempo.cl>',
                to: cli.email,
                subject: `Nueva reseña de ${cita.nombre_paciente || 'paciente'} — ${r}/5 estrellas`,
                html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                  <h2 style="color:#16143A;margin-bottom:4px">Nueva reseña recibida</h2>
                  <p style="color:#9C96B4;font-size:13px;margin-bottom:20px">${cita.nombre_paciente || 'Paciente'} · ${cita.servicio || ''} · ${cita.fecha || ''}</p>
                  <div style="font-size:32px;margin-bottom:12px">${estrellas}</div>
                  <div style="font-size:22px;font-weight:700;color:#16143A;margin-bottom:16px">${r}/5 estrellas</div>
                  ${comentario ? `<div style="background:#F8F7FF;border-left:3px solid #6C5CE4;padding:12px 16px;border-radius:4px;font-size:14px;color:#16143A;font-style:italic">"${htmlEscape(comentario)}"</div>` : ''}
                  <p style="font-size:12px;color:#9C96B4;margin-top:20px">Desde el panel de gestión puedes ver todas tus reseñas.</p>
                </div>`
              })
            }).catch(() => {});
          }
        }
      } catch (_) {}
      return res.json({ ok: true });
    }

    try {
      let patchBody;
      if (accion === 'cancelar') {
        patchBody = { estado: 'canceled' };
      } else {
        if (!nueva_fecha || !nueva_hora) return res.status(400).json({ error: 'Faltan fecha u hora' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva_fecha)) {
          return res.status(400).json({ error: 'Formato de fecha inválido' });
        }
        if (!/^\d{2}:\d{2}$/.test(nueva_hora)) {
          return res.status(400).json({ error: 'Formato de hora inválido' });
        }
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
        try {
          const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${citaPrevia.cliente_id}&select=google_refresh_token&limit=1`, { headers: sh });
          const [cli] = await rcli.json();
          if (cli?.google_refresh_token) {
            await gcGestionarEvento({ supabaseUrl: SUPABASE_URL, sh, accion: 'cancelar', cliente_id: citaPrevia.cliente_id, google_event_id: citaPrevia.google_event_id, refresh_token: decryptToken(cli.google_refresh_token) });
          }
        } catch(_) {}
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

            const rcli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cita.cliente_id}&select=nombre_negocio,direccion,email,metodos_pago,datos_banco,google_refresh_token,logo_url&limit=1`, { headers: sh });
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
                subject: `Tu cita en ${cliente?.nombre_negocio || 'la clínica'} fue reagendada`,
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
                  cita_id:            id,
                  logo_negocio:       (cliente?.logo_url && !cliente.logo_url.startsWith('data:')) ? cliente.logo_url : null
                })
              })
            }).catch(e => console.error('email reagendar error:', e.message));

            if (citaPrevia?.google_event_id && cliente?.google_refresh_token && process.env.GOOGLE_CLIENT_ID) {
              await gcGestionarEvento({
                supabaseUrl: SUPABASE_URL, sh, accion: 'reagendar',
                cliente_id:      cita.cliente_id,
                google_event_id: citaPrevia.google_event_id,
                refresh_token:   decryptToken(cliente.google_refresh_token),
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
    cliente_id, nombre_especialista,
    nombre_paciente, tel_paciente, email_paciente,
    servicio, fecha, hora, negocio_nombre, duracion, precio,
    enviar_email, estado_admin, slug,
    metodo_pago_admin
  } = req.body || {};

  // Validar que from_admin solo sea true si el request tiene sesión válida de admin
  const sessionToken = req.headers['x-session-token'];
  const session = verifySessionToken(sessionToken);
  const isAdmin = !!session;
  const effectiveFromAdmin = isAdmin ? (req.body?.from_admin || false) : false;
  const from_admin = effectiveFromAdmin;

  // Sanitizar especialista_id: solo aceptar UUIDs válidos, cualquier otro valor (como 'any') → null
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const especialista_id = UUID_RE.test(req.body?.especialista_id || '') ? req.body.especialista_id : null;

  // metodo_pago_admin: 'efectivo' | 'tarjeta' | 'link_flow' | 'link_webpay' | 'link_mp' | null (booking público)
  const esPagoPresencial = from_admin && (metodo_pago_admin === 'efectivo' || metodo_pago_admin === 'tarjeta');
  const esLinkWebpay     = from_admin && metodo_pago_admin === 'link_webpay';
  const esLinkFlow       = from_admin && metodo_pago_admin === 'link_flow';
  const esLinkMP         = from_admin && metodo_pago_admin === 'link_mp';

  const ESTADO_MAP = { reservada:'pending', confirmada:'confirmed', pendiente:'pending', completada:'done', cancelada:'canceled', inasistencia:'no-show' };
  // Pago presencial desde admin → confirmar directamente; link de pago → pending_payment lo asigna el handler de pago
  const estadoFinal = esPagoPresencial ? 'confirmed'
    : (from_admin && estado_admin ? (ESTADO_MAP[estado_admin] || 'pending') : 'pending');
  const confirmarDespues = !from_admin && !esPagoPresencial;

  const citaIdYaCreada = req.body?._cita_id_ya_creada || null;
  if (citaIdYaCreada && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(citaIdYaCreada)) {
    return res.status(400).json({ error: 'ID de cita inválido' });
  }
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
          estado: estadoFinal,
          ...(esPagoPresencial ? { metodo_pago: metodo_pago_admin } : {})
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

      // Conflict check: si otro request creó el mismo slot en paralelo, rechazar el duplicado
      if (especialista_id) {
        const rConflict = await fetch(
          `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&especialista_id=eq.${especialista_id}&fecha=eq.${encodeURIComponent(fecha)}&hora=eq.${encodeURIComponent(hora)}&estado=neq.canceled&select=id&limit=2`,
          { headers: sh }
        );
        const conflictos = await rConflict.json().catch(() => []);
        if (Array.isArray(conflictos) && conflictos.length > 1) {
          await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, { method: 'DELETE', headers: sh }).catch(() => {});
          return res.status(409).json({ error: 'Este horario ya fue reservado. Por favor elige otro.' });
        }
      }
    }

    let direccion = null, email_negocio = null, metodos_pago = null, datos_banco = null, google_refresh_token = null, google_calendar_id = null, logo_negocio = null;
    try {
      const rc = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=direccion,email,metodos_pago,datos_banco,google_refresh_token,google_calendar_id,logo_url&limit=1`,
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
      logo_negocio         = (cli?.logo_url && !cli.logo_url.startsWith('data:')) ? cli.logo_url : null;
    } catch(e) { console.error('crear-cita: clientes_sistema exception:', e.message); }

    let gc_debug = { token: !!google_refresh_token, client_id: !!process.env.GOOGLE_CLIENT_ID };
    if (google_refresh_token && process.env.GOOGLE_CLIENT_ID) {
      gc_debug.resultado = await gcCrearEvento({
        supabaseUrl: SUPABASE_URL, sh, cita_id: cita.id, cliente_id,
        nombre_paciente, nombre_especialista, servicio, fecha, hora, duracion, direccion,
        refresh_token: decryptToken(google_refresh_token), google_calendar_id
      });
    }

    console.log('crear-cita gc_debug:', JSON.stringify(gc_debug));

    // Generar link Flow si el cliente tiene credenciales y hay precio
    let flow_url = null;
    const flowApiKey    = metodos_pago?.flow_api_key;
    const flowSecretKey = metodos_pago?.flow_secret_key;
    const flowSandbox   = metodos_pago?.flow_sandbox;
    const precioNum     = precio ? Math.round(Number(String(precio).replace(/\./g, '').replace(',', '.'))) : 0;
    const precioFlow    = metodos_pago?.aplica_iva ? Math.round(precioNum * 1.19) : precioNum;

    let flow_error = null;
    // Flow solo se genera cuando el admin elige explícitamente "link_flow" — no en booking público
    const generarFlow = esLinkFlow && flowApiKey && flowSecretKey && precioNum > 0;
    if (generarFlow) {
      const flowApiUrl = flowSandbox ? 'https://sandbox.flow.cl/api' : 'https://www.flow.cl/api';
      try {
        const fp = {
          apiKey:          flowApiKey,
          commerceOrder:   String(cita.id),
          subject:         `Cita ${servicio || 'médica'}${negocio_nombre ? ' — ' + negocio_nombre : ''}`.slice(0, 255),
          currency:        'CLP',
          amount:          String(precioFlow),
          email:           email_paciente,
          urlConfirmation: `${BASE_URL}/api/flow-confirm?cid=${cliente_id}`,
          urlReturn:       `${BASE_URL}/api/flow-return?tipo=cita${slug ? '&slug=' + encodeURIComponent(slug) : ''}`,
        };
        fp.s = flowSign(fp, flowSecretKey);
        const fr = await fetch(`${flowApiUrl}/payment/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fp),
          signal: AbortSignal.timeout(12000),
        });
        const fd = await fr.json();
        if (fd.url && fd.token) {
          flow_url = `${fd.url}?token=${fd.token}`;
          // pending_payment: si es solo Flow configurado (booking público) O el admin eligió explícitamente link Flow
          const soloFlow = esLinkFlow || (!metodos_pago.transferencia && !metodos_pago.webpay && !metodos_pago.efectivo);
          if (soloFlow) {
            await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
              method: 'PATCH',
              headers: { ...sh, Prefer: 'return=minimal' },
              body: JSON.stringify({ estado: 'pending_payment', metodo_pago: 'flow' })
            });
          }
          console.log('crear-cita: flow_url generado OK, soloFlow:', soloFlow);
        } else {
          flow_error = fd.message || fd.error || JSON.stringify(fd);
          console.error('crear-cita: flow error:', flow_error);
        }
      } catch(e) {
        flow_error = e.name === 'TimeoutError' ? 'timeout conectando con Flow' : e.message;
        console.error('crear-cita: flow exception:', flow_error);
      }
    }

    const soloFlow = !!(flow_url && esLinkFlow);

    // Mercado Pago checkout — booking público O admin eligió link_mp
    let mp_url = null;
    let mp_error = null;
    const generarMP = !esPagoPresencial && !esLinkWebpay && !esLinkFlow &&
                      metodos_pago?.mp_connected && metodos_pago?.mp_access_token && precioNum > 0;
    if (generarMP) {
      try {
        let mpToken = metodos_pago.mp_access_token;
        const manageLink = `${BASE_URL}/gestionar-cita?id=${cita.id}&token=${generateManageToken(cita.id)}`;
        const prefBody = {
          items: [{ title: `${servicio || 'Cita'} — ${negocio_nombre || ''}`.slice(0, 255), quantity: 1, unit_price: precioNum, currency_id: 'CLP' }],
          payer: email_paciente ? { email: email_paciente } : undefined,
          external_reference: `CITA-${cita.id}`,
          back_urls: { success: `${manageLink}&pago=ok`, failure: `${manageLink}&pago=error`, pending: manageLink },
          auto_return: 'approved',
          notification_url: `${BASE_URL}/api/flow?tipo=mp_webhook`
        };
        let prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mpToken}` },
          body: JSON.stringify(prefBody),
          signal: AbortSignal.timeout(12000)
        });
        if (prefResp.status === 401 && metodos_pago.mp_refresh_token) {
          const tr = await fetch('https://api.mercadopago.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'refresh_token', client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, refresh_token: metodos_pago.mp_refresh_token })
          });
          const td = await tr.json();
          if (td.access_token) {
            metodos_pago.mp_access_token = td.access_token;
            if (td.refresh_token) metodos_pago.mp_refresh_token = td.refresh_token;
            await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, { method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify({ metodos_pago }) });
            mpToken = td.access_token;
            prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mpToken}` },
              body: JSON.stringify(prefBody)
            });
          }
        }
        const prefData = await prefResp.json();
        if (prefData.init_point) {
          mp_url = prefData.init_point;
          const soloMP = !metodos_pago.transferencia && !metodos_pago.webpay && !metodos_pago.efectivo;
          if (soloMP) {
            await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
              method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
              body: JSON.stringify({ estado: 'pending_payment', metodo_pago: 'mercadopago' })
            }).catch(e => console.error('crear-cita: patch mp pending_payment:', e.message));
          }
          console.log('crear-cita: mp_url generado OK, soloMP:', soloMP);
        } else {
          mp_error = prefData.message || prefData.error || JSON.stringify(prefData).slice(0, 120);
          console.error('crear-cita: mp error:', mp_error);
        }
      } catch(e) {
        mp_error = e.name === 'TimeoutError' ? 'timeout conectando con Mercado Pago' : e.message;
        console.error('crear-cita: mp exception:', mp_error);
      }
    }
    const soloMP = !!(mp_url && !metodos_pago?.transferencia && !metodos_pago?.webpay && !metodos_pago?.efectivo);

    // Link MP desde admin → marcar pending_payment con metodo_pago='mercadopago'
    if (esLinkMP && !mp_url) {
      await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'pending_payment', metodo_pago: 'mercadopago' })
      }).catch(e => console.error('crear-cita: patch link_mp error', e.message));
    }

    // Link Webpay desde admin → marcar pending_payment con metodo_pago='webpay'
    if (esLinkWebpay) {
      const patchR = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'pending_payment', metodo_pago: 'webpay' })
      }).catch(e => ({ ok: false, _err: e.message }));
      if (!patchR.ok) console.error('crear-cita: patch pending_payment error', patchR.status, await patchR.text?.().catch(()=>''));
      else console.log('crear-cita: cita marcada pending_payment webpay');
    }

    // Enviar email de confirmación (después de generar flow_url para incluirlo)
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
            subject: `Tu cita en ${negocio_nombre || 'la clínica'} está confirmada`,
            headers: {
              'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            },
            html: emailHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, direccion, email_negocio, cita_id: cita.id, duracion, precio, metodos_pago, datos_banco, flow_url, logo_negocio })
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

    // Confirmar la cita si es booking público y no requiere pago Flow obligatorio
    if (confirmarDespues && !soloFlow) {
      await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'confirmed' })
      }).catch(e => console.error('crear-cita: patch confirmed error:', e.message));
    }

    return res.json({ ok: true, cita, flow_url, solo_flow: soloFlow, flow_error, mp_url, solo_mp: soloMP, mp_error, manage_token: cita?.id ? generateManageToken(cita.id) : null });
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

function emailHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, direccion, email_negocio, cita_id, duracion, precio, metodos_pago, datos_banco, flow_url, logo_negocio }) {
  const np  = htmlEscape(nombre_paciente);
  const ne  = htmlEscape(nombre_especialista || 'Profesional');
  const sv  = htmlEscape(servicio || 'Consulta');
  const dir = htmlEscape(direccion);
  const en  = htmlEscape(email_negocio);
  const dur = duracion ? htmlEscape(String(parseInt(duracion) || duracion)) + ' minutos' : '';
  const precioStr = precio
    ? htmlEscape(typeof precio === 'number' ? '$' + precio.toLocaleString('es-CL') : precio)
    : '';
  const logoHdr = logo_negocio
    ? `<img src="${htmlEscape(logo_negocio)}" alt="${htmlEscape(negocio_nombre||'')}" height="48" style="display:block;margin:0 auto 6px;max-width:180px"><div style="font-size:15px;font-weight:700;color:#fff">${htmlEscape(negocio_nombre||'')}</div>`
    : `<img src="${BASE_URL}/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;"><p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#1E1B3A;padding:28px 32px;text-align:center;">
  ${logoHdr}
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
  ${flow_url ? `\
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">\
    <tr><td style="text-align:center;">\
      <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">Paga online para confirmar tu reserva</p>\
      <a href="${htmlEscape(flow_url)}" target="_blank" style="display:inline-block;padding:13px 32px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;">Pagar ahora con Flow →</a>\
      <p style="margin:10px 0 0;color:#9ca3af;font-size:11px;">Este link es de uso único y expira en 24 horas</p>\
    </td></tr>\
  </table>` : ''}
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

function emailReagendadoHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, direccion, email_negocio, metodos_pago, datos_banco, cita_id, logo_negocio }) {
  const np  = htmlEscape(nombre_paciente);
  const ne  = htmlEscape(nombre_especialista || 'Profesional');
  const sv  = htmlEscape(servicio || 'Consulta');
  const dir = htmlEscape(direccion);
  const en  = htmlEscape(email_negocio);
  const logoHdr = logo_negocio
    ? `<img src="${htmlEscape(logo_negocio)}" alt="${htmlEscape(negocio_nombre||'')}" height="48" style="display:block;margin:0 auto 6px;max-width:180px"><div style="font-size:15px;font-weight:700;color:#fff">${htmlEscape(negocio_nombre||'')}</div>`
    : `<img src="${BASE_URL}/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;"><p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#1E1B3A;padding:28px 32px;text-align:center;">
  ${logoHdr}
</td></tr>
<tr><td style="padding:32px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Cita reagendada</h2>
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
