import crypto from 'crypto';

const REDIRECT_URI = 'https://app.attempo.cl/api/google-auth';
const SCOPE        = 'https://www.googleapis.com/auth/calendar';
const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';

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

function encryptToken(token) {
  const key = Buffer.from(process.env.GOOGLE_TOKEN_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(stored) {
  if (!stored || !stored.startsWith('enc:')) return stored; // tokens anteriores sin encriptar
  const parts = stored.split(':');
  if (parts.length !== 4) return stored;
  const [, ivHex, tagHex, dataHex] = parts;
  const key = Buffer.from(process.env.GOOGLE_TOKEN_KEY, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
}

export default async function handler(req, res) {
  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const KEY           = process.env.SUPABASE_SERVICE_KEY;
  const sh = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google OAuth no configurado en las variables de entorno' });
  }

  // ── GET sin code: iniciar flujo OAuth ──────────────────────────────────────
  if (req.method === 'GET' && !req.query.code) {
    const sessionToken = req.headers['x-session-token'];
    const session = verifySessionToken(sessionToken);
    if (!session) return res.status(401).json({ error: 'No autorizado' });
    const { cliente_id } = req.query;
    if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });
    if (session.rol !== 'superadmin' && cliente_id !== session.cliente_id) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const csrf = crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(cliente_id + Date.now()).digest('hex').slice(0, 32);
    res.setHeader('Set-Cookie', `oauth_csrf=${encodeURIComponent(cliente_id + ':' + csrf)}; HttpOnly; SameSite=Lax; Path=/api/google-auth; Max-Age=600`);
    const state = Buffer.from(JSON.stringify({ cliente_id, csrf })).toString('base64url');

    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         SCOPE,
      access_type:   'offline',
      prompt:        'consent',   // fuerza refresh_token en cada conexión
      state
    });
    return res.redirect(302, url);
  }

  // ── GET con code: callback de Google ───────────────────────────────────────
  if (req.method === 'GET' && req.query.code) {
    const { code, state, error } = req.query;

    if (error || !code || !state) {
      return res.redirect(302, '/gc-callback?status=error');
    }

    // Validar CSRF state contra cookie
    const rawCookie = req.headers.cookie?.split(';').find(c => c.trim().startsWith('oauth_csrf='));
    const cookieVal = rawCookie ? decodeURIComponent(rawCookie.split('=')[1]) : '';
    const [cookieClienteId, cookieCsrf] = cookieVal.split(':');
    let stateData;
    try { stateData = JSON.parse(Buffer.from(state, 'base64url').toString()); } catch { return res.status(400).json({ error: 'State inválido' }); }
    if (!stateData.csrf || !stateData.cliente_id || stateData.csrf !== cookieCsrf || stateData.cliente_id !== cookieClienteId) {
      return res.status(403).json({ error: 'CSRF validation failed' });
    }
    const cliente_id = stateData.cliente_id;
    // Limpiar cookie CSRF
    res.setHeader('Set-Cookie', 'oauth_csrf=; HttpOnly; SameSite=Lax; Path=/api/google-auth; Max-Age=0');

    try {
      // Intercambiar code por tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri:  REDIRECT_URI,
          grant_type:    'authorization_code'
        })
      });
      const tokens = await tokenRes.json();

      if (!tokenRes.ok || !tokens.refresh_token) {
        return res.redirect(302, '/gc-callback?status=error');
      }
      const patch = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=id`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=representation' },
        body: JSON.stringify({ google_refresh_token: encryptToken(tokens.refresh_token) })
      });

      let patchBody;
      try { patchBody = await patch.json(); } catch(_) { patchBody = null; }
      if (!patch.ok || !Array.isArray(patchBody) || patchBody.length === 0) {
        return res.redirect(302, '/gc-callback?status=error');
      }

      return res.redirect(302, '/gc-callback?status=ok');
    } catch(e) {
      console.error('google-auth callback error:', e.message);
      return res.redirect(302, '/gc-callback?status=error');
    }
  }

  // ── DELETE: desconectar Google Calendar ────────────────────────────────────
  if (req.method === 'DELETE') {
    const sessionToken = req.headers['x-session-token'];
    const session = verifySessionToken(sessionToken);
    if (!session) return res.status(401).json({ error: 'No autorizado' });

    const { cliente_id } = req.body || {};
    if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });

    try {
      // Obtener token actual para revocarlo en Google
      const rc = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=google_refresh_token&limit=1`,
        { headers: sh }
      );
      const [cli] = await rc.json();

      if (cli?.google_refresh_token) {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptToken(cli.google_refresh_token))}`,
          { method: 'POST' }
        ).catch(() => {});
      }

      // Limpiar token en Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ google_refresh_token: null })
      });

      return res.json({ ok: true });
    } catch(e) {
      console.error('google-auth disconnect error:', e.message);
      return res.status(500).json({ error: 'Error al desconectar calendario' });
    }
  }

  // ── POST: sincronizar citas existentes al calendario Attempo ──────────────
  if (req.method === 'POST') {
    const sessionToken = req.headers['x-session-token'];
    const session = verifySessionToken(sessionToken);
    if (!session) return res.status(401).json({ error: 'No autorizado' });
    const { cliente_id } = req.body || {};
    if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });
    if (session.rol !== 'superadmin' && cliente_id !== session.cliente_id) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
      const rc = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=google_refresh_token,google_calendar_id,direccion&limit=1`,
        { headers: sh }
      );
      const [cli] = await rc.json();
      if (!cli?.google_refresh_token) return res.status(400).json({ error: 'Google Calendar no conectado' });

      const access_token = await gcGetAccessToken(decryptToken(cli.google_refresh_token), CLIENT_ID, CLIENT_SECRET);
      const calendar_id  = await gcGetOrCreateCalendar(access_token, sh, cliente_id, cli.google_calendar_id);

      const rc2 = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&google_event_id=is.null&estado=neq.canceled&select=id,nombre_paciente,servicio,fecha,hora,especialistas(nombre)&order=fecha.asc&limit=200`,
        { headers: sh }
      );
      const citas = await rc2.json();
      if (!Array.isArray(citas)) return res.status(500).json({ error: 'Error al obtener citas' });

      let ok = 0, errors = 0;
      for (const cita of citas) {
        try {
          const event = gcBuildEvent({
            nombre_paciente: cita.nombre_paciente,
            nombre_especialista: cita.especialistas?.nombre || null,
            servicio: cita.servicio, fecha: cita.fecha, hora: cita.hora,
            duracion: null, direccion: cli.direccion
          });
          const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
          });
          if (!r.ok) { errors++; continue; }
          const { id: google_event_id } = await r.json();
          await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
            method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
            body: JSON.stringify({ google_event_id })
          });
          ok++;
        } catch(_) { errors++; }
      }
      return res.json({ ok: true, sincronizadas: ok, errores: errors, total: citas.length, calendar_id });
    } catch(e) {
      console.error('google-auth sync error:', e.message);
      return res.status(500).json({ error: 'Error al sincronizar calendario' });
    }
  }

  return res.status(405).end();
}

async function gcGetAccessToken(refresh_token, client_id, client_secret) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token, client_id, client_secret, grant_type: 'refresh_token' })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Token refresh failed: ' + data.error);
  return data.access_token;
}

async function gcGetOrCreateCalendar(access_token, sh, cliente_id, existing_calendar_id) {
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
  if (!r.ok) {
    const errBody = await r.text();
    console.error('gcGetOrCreateCalendar error:', r.status, errBody);
    throw new Error(`Error ${r.status} al crear calendario: ${errBody}`);
  }
  const cal = await r.json();
  await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
    method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
    body: JSON.stringify({ google_calendar_id: cal.id })
  });
  return cal.id;
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
    description: [`Paciente: ${nombre_paciente}`, nombre_especialista ? `Profesional: ${nombre_especialista}` : '', servicio ? `Motivo: ${servicio}` : ''].filter(Boolean).join('\n'),
    location: direccion || undefined,
    start: { dateTime: startDt, timeZone: 'America/Santiago' },
    end:   { dateTime: endDt,   timeZone: 'America/Santiago' }
  };
}
