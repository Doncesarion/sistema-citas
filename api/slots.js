import crypto from 'crypto';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';

function verifySessionToken(token) {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (sig !== expected) return null;
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const [cliente_id, rol, expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id, rol };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'DELETE' && req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const sessionToken = req.headers['x-session-token'];

  // — POST: guardar bot_config —
  if (req.method === 'POST') {
    const s = verifySessionToken(sessionToken);
    if (!s) return res.status(401).json({ error: 'No autorizado' });
    let cliente_id = s.cliente_id;
    const overrideId = req.headers['x-override-cliente-id'];
    if (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) {
      cliente_id = overrideId;
    }
    const body = req.body || {};
    if (body.resource !== 'bot_config') return res.status(400).json({ error: 'Recurso no válido' });
    const TONOS = ['formal','informal'], GENEROS = ['femenino','masculino','neutro'];
    const payload = {
      cliente_id,
      nombre_bot: String(body.nombre_bot || 'Valentina').slice(0, 100),
      genero:     GENEROS.includes(body.genero) ? body.genero : 'femenino',
      tono:       TONOS.includes(body.tono) ? body.tono : 'informal',
      saludo:     String(body.saludo || '').slice(0, 500),
      faqs:       Array.isArray(body.faqs) ? body.faqs.slice(0, 50).map(f => ({
        pregunta:  String(f.pregunta  || '').slice(0, 300),
        respuesta: String(f.respuesta || '').slice(0, 1000)
      })) : [],
      conocimiento: String(body.conocimiento || '').slice(0, 6000),
      activo: true
    };
    try {
      const check = await fetch(`${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}&select=id&limit=1`, { headers: sh });
      const existing = await check.json();
      const method = existing.length ? 'PATCH' : 'POST';
      const url = existing.length
        ? `${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}`
        : `${SUPABASE_URL}/rest/v1/bot_config`;
      const r = await fetch(url, {
        method,
        headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error('bot_config save error:', r.status, JSON.stringify(err));
        return res.status(500).json({ error: 'Error al guardar configuración' });
      }
      return res.json({ ok: true });
    } catch(e) {
      console.error('bot_config save exception:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // — DELETE: cancelar una cita —
  if (req.method === 'DELETE') {
    const s = verifySessionToken(sessionToken);
    if (!s) return res.status(401).json({ error: 'No autorizado' });
    let cliente_id = s.cliente_id;
    const overrideId = req.headers['x-override-cliente-id'];
    if (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) {
      cliente_id = overrideId;
    }
    const { id } = req.query;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'ID inválido' });
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}`, {
        method: 'PATCH',
        headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'canceled' })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error('slots DELETE error:', r.status, JSON.stringify(err));
        return res.status(500).json({ error: 'No se pudo cancelar la cita' });
      }
      return res.json({ ok: true });
    } catch(e) {
      console.error('slots DELETE exception:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // — GET: proxy admin o slots públicos —
  if (sessionToken) {
    const s = verifySessionToken(sessionToken);
    if (!s) return res.status(401).json({ error: 'No autorizado' });

    let cliente_id = s.cliente_id;
    const overrideId = req.headers['x-override-cliente-id'];
    if (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) {
      cliente_id = overrideId;
    }

    // — GET bot_config —
    if (req.query.resource === 'bot_config') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}&limit=1`, { headers: sh });
        const data = await r.json();
        if (!r.ok) return res.status(500).json({ error: 'Error al obtener configuración' });
        return res.status(200).json(data[0] || null);
      } catch(e) {
        console.error('bot_config GET exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    try {
      const { select, order, limit, id, nombre } = req.query;
      if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const parts = [`cliente_id=eq.${cliente_id}`];
      if (id)     parts.push(`id=eq.${id}`);
      if (nombre) parts.push(`nombre_paciente=ilike.${encodeURIComponent(nombre)}`);
      parts.push(`select=${select || '*,especialistas(id,nombre)'}`);
      parts.push(`order=${order   || 'fecha.desc,hora.desc'}`);
      if (limit) parts.push(`limit=${Math.min(parseInt(limit) || 100, 2000)}`);

      const url = `${SUPABASE_URL}/rest/v1/citas?${parts.join('&')}`;
      const r   = await fetch(url, { headers: sh });
      const data = await r.json();
      if (!r.ok) {
        console.error('slots/citas error:', r.status, JSON.stringify(data));
        return res.status(500).json({ error: 'Error al obtener citas' });
      }
      return res.status(200).json(data);
    } catch (e) {
      console.error('slots/citas exception:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // — Rama pública: slots disponibles —
  const { especialista_id, fecha } = req.query;
  if (!especialista_id || !fecha) return res.status(400).json({ error: 'Faltan parámetros' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
  const [fy, fm, fd] = fecha.split('-').map(Number);
  if (isNaN(new Date(fy, fm - 1, fd).getTime()) || fm < 1 || fm > 12 || fd < 1 || fd > 31) {
    return res.status(400).json({ error: 'Fecha inválida' });
  }

  function generarSlots(desde, hasta, min = 30) {
    const r = []; let [h, m] = desde.split(':').map(Number);
    const [hf, mf] = hasta.split(':').map(Number); const fin = hf * 60 + mf;
    while (h * 60 + m < fin) {
      r.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
      m += min; if (m >= 60) { h++; m -= 60; }
    }
    return r;
  }

  try {
    const [esp] = await fetch(
      `${SUPABASE_URL}/rest/v1/especialistas?id=eq.${especialista_id}&select=horario`,
      { headers: sh }
    ).then(r => r.json());

    if (!esp) return res.json({ disponible: false });

    const diasKey = ['dom','lun','mar','mie','jue','vie','sab'];
    const dia = esp.horario?.[diasKey[new Date(fecha + 'T12:00:00').getDay()]];
    if (!dia?.activo || !dia.bloques?.length) return res.json({ disponible: false });

    const todos = generarSlots(dia.bloques[0].desde, dia.bloques[0].hasta);
    const citas = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?especialista_id=eq.${especialista_id}&fecha=eq.${fecha}&estado=neq.canceled&select=hora`,
      { headers: sh }
    ).then(r => r.json());

    const ocupadas = new Set((citas || []).map(c => c.hora?.slice(0, 5)));
    const libres = todos.filter(s => !ocupadas.has(s));

    res.json(libres.length ? { disponible: true, slots: libres } : { disponible: false });
  } catch (e) {
    console.error('slots error:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
}
