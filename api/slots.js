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

async function logAudit(KEY, action, actorRole, actorClienteId, targetClienteId, details = {}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ action, actor_role: actorRole, actor_cliente_id: actorClienteId, target_cliente_id: targetClienteId, details })
    });
  } catch (e) {
    console.error('audit log error:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'DELETE' && req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).end();

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
      logAudit(KEY, 'superadmin_impersonate_post', s.rol, s.cliente_id, overrideId, { resource: req.body?.resource });
    }
    const body = req.body || {};
    if (!['bot_config', 'notificaciones_config', 'recordatorios_config'].includes(body.resource)) return res.status(400).json({ error: 'Recurso no válido' });

    // — POST notificaciones_config —
    if (body.resource === 'notificaciones_config') {
      const TIEMPOS = ['24h', '12h', '2h', '1h'];
      const cfg = {
        wa_confirmacion:         body.wa_confirmacion         !== false,
        wa_recordatorio:         body.wa_recordatorio         !== false,
        wa_recordatorio_tiempo:  TIEMPOS.includes(body.wa_recordatorio_tiempo)  ? body.wa_recordatorio_tiempo  : '1h',
        wa_aviso_profesional:    body.wa_aviso_profesional    !== false,
        email_confirmacion:      body.email_confirmacion      !== false,
        email_recordatorio:      body.email_recordatorio      !== false,
        email_recordatorio_tiempo: TIEMPOS.includes(body.email_recordatorio_tiempo) ? body.email_recordatorio_tiempo : '2h',
        email_resumen_diario:    body.email_resumen_diario    === true,
        email_cancelacion:       body.email_cancelacion       !== false
      };
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ notificaciones_config: cfg })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          console.error('notificaciones_config save error:', r.status, JSON.stringify(err));
          return res.status(500).json({ error: 'Error al guardar notificaciones' });
        }
        return res.json({ ok: true });
      } catch(e) {
        console.error('notificaciones_config save exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — POST recordatorios_config —
    if (body.resource === 'recordatorios_config') {
      const TIEMPOS = ['24h', '12h', '2h', '1h', '30m'];
      let cfg;
      if (Array.isArray(body.lista)) {
        const lista = body.lista.slice(0, 20).map(r => ({
          id:            String(r.id || `rec_${Date.now()}_${Math.random().toString(36).slice(2,6)}`).slice(0, 60),
          activo:        r.activo !== false,
          tiempo:        TIEMPOS.includes(r.tiempo) ? r.tiempo : '24h',
          email_activo:  r.email_activo === true,
          email_asunto:  String(r.email_asunto  || '').slice(0, 300),
          email_mensaje: String(r.email_mensaje || '').slice(0, 2000),
          wa_activo:     r.wa_activo === true,
          wa_mensaje:    String(r.wa_mensaje    || '').slice(0, 1000)
        }));
        cfg = { lista };
      } else {
        // formato antiguo plano (compatibilidad)
        cfg = {
          email_activo:  body.email_activo !== false,
          email_tiempo:  TIEMPOS.includes(body.email_tiempo) ? body.email_tiempo : '24h',
          email_asunto:  String(body.email_asunto  || '').slice(0, 300),
          email_mensaje: String(body.email_mensaje || '').slice(0, 2000),
          wa_activo:     body.wa_activo === true,
          wa_tiempo:     TIEMPOS.includes(body.wa_tiempo) ? body.wa_tiempo : '24h',
          wa_mensaje:    String(body.wa_mensaje    || '').slice(0, 1000)
        };
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ recordatorios_config: cfg })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          console.error('recordatorios_config save error:', r.status, JSON.stringify(err));
          return res.status(500).json({ error: 'Error al guardar recordatorios' });
        }
        return res.json({ ok: true });
      } catch(e) {
        console.error('recordatorios_config save exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — POST bot_config —
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
      promociones: Array.isArray(body.promociones) ? body.promociones.slice(0, 20).map(p => ({
        titulo:       String(p.titulo       || '').slice(0, 200),
        descripcion:  String(p.descripcion  || '').slice(0, 1000),
        fecha_inicio: /^\d{4}-\d{2}-\d{2}$/.test(p.fecha_inicio || '') ? p.fecha_inicio : null,
        fecha_fin:    /^\d{4}-\d{2}-\d{2}$/.test(p.fecha_fin    || '') ? p.fecha_fin    : null
      })) : [],
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

  // — PATCH: actualizar datos del paciente —
  if (req.method === 'PATCH') {
    const s = verifySessionToken(sessionToken);
    if (!s) return res.status(401).json({ error: 'No autorizado' });
    let cliente_id = s.cliente_id;
    const overrideId = req.headers['x-override-cliente-id'];
    if (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) cliente_id = overrideId;

    if (req.query.action === 'update_paciente') {
      const body = req.body || {};
      const nombreActual = String(body.nombre_actual || '').trim();
      const nombreNuevo  = String(body.nombre  || '').trim();
      if (!nombreActual || !nombreNuevo) return res.status(400).json({ error: 'nombre_actual y nombre requeridos' });
      const email  = body.email  ? String(body.email).trim()  : null;
      const tel    = body.tel    ? String(body.tel).trim()    : null;
      const rut    = body.rut    ? String(body.rut).trim()    : null;
      const ciudad = body.ciudad ? String(body.ciudad).trim() : null;
      const region = body.region ? String(body.region).trim() : null;
      try {
        // Actualizar todas las citas del paciente
        const updateCitas = { nombre_paciente: nombreNuevo };
        if (email !== null) updateCitas.email_paciente = email;
        if (tel   !== null) updateCitas.tel_paciente   = tel;
        const rc = await fetch(
          `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&nombre_paciente=ilike.${encodeURIComponent(nombreActual)}`,
          { method: 'PATCH', headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(updateCitas) }
        );
        if (!rc.ok) { const e = await rc.json().catch(() => ({})); console.error('update citas paciente:', e); }
        // Upsert perfil en tabla pacientes
        const profileData = { cliente_id, nombre: nombreNuevo, email, telefono: tel, rut, ciudad, region, updated_at: new Date().toISOString() };
        const checkR = await fetch(`${SUPABASE_URL}/rest/v1/pacientes?cliente_id=eq.${cliente_id}&nombre=ilike.${encodeURIComponent(nombreActual)}&select=id&limit=1`, { headers: sh });
        const existing = await checkR.json().catch(() => []);
        if (Array.isArray(existing) && existing.length > 0) {
          await fetch(`${SUPABASE_URL}/rest/v1/pacientes?id=eq.${existing[0].id}`,
            { method: 'PATCH', headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(profileData) });
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/pacientes`,
            { method: 'POST', headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(profileData) });
        }
        return res.json({ ok: true });
      } catch(e) {
        console.error('update_paciente exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    const { id } = req.query;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'ID de cita inválido' });
    const body = req.body || {};
    if (typeof body.notas === 'undefined') return res.status(400).json({ error: 'Campo requerido: notas' });
    const notas = body.notas === null ? null : String(body.notas).slice(0, 10000);
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}`, {
        method: 'PATCH',
        headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ notas })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error('slots PATCH notas error:', r.status, JSON.stringify(err));
        return res.status(500).json({ error: 'Error al guardar' });
      }
      return res.json({ ok: true });
    } catch(e) {
      console.error('slots PATCH notas exception:', e.message);
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
      logAudit(KEY, 'superadmin_impersonate_delete', s.rol, s.cliente_id, overrideId, { cita_id: req.query.id });
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
      logAudit(KEY, 'superadmin_impersonate_get', s.rol, s.cliente_id, overrideId, { resource: req.query.resource });
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

    // — GET notificaciones_config —
    if (req.query.resource === 'notificaciones_config') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=notificaciones_config&limit=1`, { headers: sh });
        const data = await r.json();
        if (!r.ok) return res.status(500).json({ error: 'Error al obtener notificaciones' });
        return res.status(200).json(data[0]?.notificaciones_config || null);
      } catch(e) {
        console.error('notificaciones_config GET exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — GET recordatorios_config —
    if (req.query.resource === 'recordatorios_config') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=recordatorios_config&limit=1`, { headers: sh });
        const data = await r.json();
        if (!r.ok) return res.status(500).json({ error: 'Error al obtener recordatorios' });
        return res.status(200).json(data[0]?.recordatorios_config || null);
      } catch(e) {
        console.error('recordatorios_config GET exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — GET canales_meta —
    if (req.query.resource === 'canales_meta') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=canales_meta&limit=1`, { headers: sh });
        const data = await r.json();
        if (!r.ok) return res.status(500).json({ error: 'Error al obtener canales' });
        return res.status(200).json(data[0]?.canales_meta || {});
      } catch(e) {
        console.error('canales_meta GET exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — GET perfil del paciente —
    if (req.query.action === 'paciente') {
      const { nombre: npac } = req.query;
      if (!npac) return res.status(400).json({ error: 'nombre requerido' });
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/pacientes?cliente_id=eq.${cliente_id}&nombre=ilike.${encodeURIComponent(npac)}&limit=1`,
          { headers: sh }
        );
        const data = await r.json();
        return res.status(200).json(Array.isArray(data) ? (data[0] || null) : null);
      } catch(e) {
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
      if (limit) parts.push(`limit=${Math.min(parseInt(limit) || 50, 200)}`);

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
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const citas = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?especialista_id=eq.${especialista_id}&fecha=eq.${fecha}&estado=neq.canceled&or=(estado.neq.pending_payment,created_at.gte.${encodeURIComponent(cutoff)})&select=hora`,
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
