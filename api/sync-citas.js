const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { cliente_id } = req.body || {};
  if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  try {
    // 1. Obtener datos del cliente
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=google_refresh_token,google_calendar_id,direccion&limit=1`,
      { headers: sh }
    );
    const [cli] = await rc.json();
    if (!cli?.google_refresh_token) return res.status(400).json({ error: 'Google Calendar no conectado' });

    // 2. Obtener citas sin google_event_id (o todas si se fuerza)
    const force = req.body.force === true;
    const filter = force
      ? `cliente_id=eq.${cliente_id}&estado=neq.canceled`
      : `cliente_id=eq.${cliente_id}&google_event_id=is.null&estado=neq.canceled`;
    const rc2 = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?${filter}&select=id,nombre_paciente,email_paciente,servicio,fecha,hora,especialistas(nombre)&order=fecha.asc&limit=200`,
      { headers: sh }
    );
    const citas = await rc2.json();
    if (!Array.isArray(citas)) return res.status(500).json({ error: 'Error al obtener citas' });

    // 3. Obtener access_token
    const access_token = await gcGetAccessToken(cli.google_refresh_token);

    // 4. Obtener o crear calendario Attempo
    const calendar_id = await gcGetOrCreateCalendar(access_token, sh, cliente_id, cli.google_calendar_id);

    // 5. Sincronizar cada cita
    let ok = 0, errors = 0;
    for (const cita of citas) {
      try {
        const nombre_especialista = cita.especialistas?.nombre || null;
        const event = gcBuildEvent({
          nombre_paciente: cita.nombre_paciente,
          nombre_especialista,
          servicio: cita.servicio,
          fecha: cita.fecha,
          hora: cita.hora,
          duracion: null,
          direccion: cli.direccion
        });
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event)
        });
        if (!r.ok) { errors++; continue; }
        const { id: google_event_id } = await r.json();
        await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
          method: 'PATCH',
          headers: { ...sh, Prefer: 'return=minimal' },
          body: JSON.stringify({ google_event_id })
        });
        ok++;
      } catch(_) { errors++; }
    }

    return res.json({ ok: true, sincronizadas: ok, errores: errors, total: citas.length, calendar_id });
  } catch(e) {
    console.error('sync-citas error:', e.message);
    return res.status(500).json({ error: e.message });
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
  if (!r.ok) throw new Error('No se pudo crear el calendario Attempo');
  const cal = await r.json();
  await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
    method: 'PATCH',
    headers: { ...sh, Prefer: 'return=minimal' },
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
