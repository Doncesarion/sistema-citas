import crypto from 'crypto';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

function flowSign(params, secret) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

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

async function gcCancelarEvento({ supabaseUrl, sh, cliente_id, google_event_id, refresh_token }) {
  try {
    const access_token = await gcGetAccessToken(refresh_token);
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${google_event_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${access_token}` }
    });
  } catch(e) {
    console.error('gcCancelarEvento error:', e.message);
    if (e.invalid && supabaseUrl && sh && cliente_id) {
      await fetch(`${supabaseUrl}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
        method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ google_refresh_token: null })
      }).catch(() => {});
    }
  }
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

  // Delegar evaluaciones a su handler
  const qa = req.query.action;
  if (qa === 'evaluar' || qa === 'evaluar_admin' || qa === 'evaluar_resumen' || qa === 'evaluar_pendientes' ||
      (req.method === 'POST' && (req.body?.action === 'evaluar' || req.body?.action === 'evaluar_reenviar'))) return handleEvaluar(req, res);

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
    if (!['bot_config', 'notificaciones_config', 'recordatorios_config', 'chatbot-knowledge', 'chatbot-gaps', 'ubicaciones'].includes(body.resource)) return res.status(400).json({ error: 'Recurso no válido' });

    // — POST ubicaciones (save array) —
    if (body.resource === 'ubicaciones') {
      try {
        const sedes = body.sedes;
        if (!Array.isArray(sedes)) return res.status(400).json({ error: 'sedes debe ser un arreglo' });
        const cleaned = sedes.slice(0, 20).map(s => ({
          nombre:    String(s.nombre  || '').trim().slice(0, 100),
          direccion: String(s.direccion || '').trim().slice(0, 200),
          ciudad:    String(s.ciudad  || '').trim().slice(0, 80),
          telefono:  String(s.telefono || '').trim().slice(0, 30),
        })).filter(s => s.nombre);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ ubicaciones: cleaned })
        });
        if (!r.ok) return res.status(500).json({ error: 'Error al guardar sedes' });
        return res.status(200).json({ ok: true });
      } catch(e) {
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — POST chatbot-knowledge (save / delete) —
    if (body.resource === 'chatbot-knowledge') {
      try {
        if (body.action === 'delete') {
          if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return res.status(400).json({ error: 'ID inválido' });
          await fetch(`${SUPABASE_URL}/rest/v1/chatbot_knowledge?id=eq.${body.id}&cliente_id=eq.${cliente_id}`, {
            method: 'DELETE', headers: sh
          });
          return res.status(200).json({ ok: true });
        }
        // save (create or update)
        const d = body.data || {};
        if (!d.titulo?.trim() || !d.contenido?.trim()) return res.status(400).json({ error: 'Faltan campos' });
        const payload = {
          cliente_id,
          categoria: d.categoria || 'general',
          titulo:    d.titulo.trim().slice(0, 200),
          contenido: d.contenido.trim().slice(0, 4000),
          activo:    d.activo !== false,
          orden:     d.orden || 0,
          updated_at: new Date().toISOString()
        };
        if (d.id && /^[0-9a-f-]{36}$/i.test(d.id)) {
          await fetch(`${SUPABASE_URL}/rest/v1/chatbot_knowledge?id=eq.${d.id}&cliente_id=eq.${cliente_id}`, {
            method: 'PATCH', headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(payload)
          });
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/chatbot_knowledge`, {
            method: 'POST', headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(payload)
          });
        }
        return res.status(200).json({ ok: true });
      } catch(e) {
        console.error('chatbot-knowledge POST:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — POST chatbot-gaps (resolve / delete-gap) —
    if (body.resource === 'chatbot-gaps') {
      try {
        if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return res.status(400).json({ error: 'ID inválido' });
        if (body.action === 'delete-gap') {
          await fetch(`${SUPABASE_URL}/rest/v1/chatbot_gaps?id=eq.${body.id}&cliente_id=eq.${cliente_id}`, {
            method: 'DELETE', headers: sh
          });
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/chatbot_gaps?id=eq.${body.id}&cliente_id=eq.${cliente_id}`, {
            method: 'PATCH', headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ respondida: true })
          });
        }
        return res.status(200).json({ ok: true });
      } catch(e) {
        return res.status(500).json({ error: 'Error interno' });
      }
    }

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
      conocimiento:  String(body.conocimiento || '').slice(0, 6000),
      delay_min_seg: Math.min(Math.max(parseInt(body.delay_min_seg) || 0, 0), 300),
      delay_max_seg: Math.min(Math.max(parseInt(body.delay_max_seg) || 0, 0), 300),
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

    // — PATCH estado de la cita —
    if (typeof body.estado !== 'undefined') {
      const ESTADO_MAP = { confirmada:'confirmed', reservada:'pending', pendiente:'pending', completada:'done', cancelada:'canceled', inasistencia:'no-show' };
      const nuevoEstado = String(body.estado).trim();
      const estadoDB = ESTADO_MAP[nuevoEstado];
      if (!estadoDB) return res.status(400).json({ error: 'Estado inválido' });
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ estado: estadoDB })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          console.error('slots PATCH estado error:', r.status, JSON.stringify(err));
          return res.status(500).json({ error: `DB error ${r.status}: ${err?.message || err?.code || JSON.stringify(err).slice(0,120)}` });
        }
        // Email de confirmación al paciente cuando el admin confirma manualmente
        if (estadoDB === 'confirmed' && process.env.RESEND_API_KEY) {
          try {
            const [rCita, rCli] = await Promise.all([
              fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}&select=nombre_paciente,email_paciente,fecha,hora,servicio,precio,especialistas(nombre)&limit=1`, { headers: sh }),
              fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=nombre_negocio,metodos_pago,datos_banco,booking_slug,servicios&limit=1`, { headers: sh })
            ]);
            const [cita] = await rCita.json().catch(() => []);
            const [cli]  = await rCli.json().catch(() => []);
            if (cita?.email_paciente) {
              const fechaFmt = new Date(`${cita.fecha}T12:00:00`).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
              const mp = cli?.metodos_pago || {};
              const he = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

              // Generar link Flow si está configurado y hay precio
              let flow_url = null;
              // Si la cita no tiene precio, buscarlo en el catálogo de servicios del negocio
              let precioFinal = cita.precio || 0;
              if (!precioFinal && cita.servicio && Array.isArray(cli?.servicios)) {
                const srv = cli.servicios.find(s => s.nombre === cita.servicio);
                if (srv?.precio) precioFinal = srv.precio;
              }
              const precioNum = precioFinal ? Math.round(Number(String(precioFinal).replace(/\./g,'').replace(',','.'))) : 0;
              const precioFlow = mp.aplica_iva ? Math.round(precioNum * 1.19) : precioNum;
              if (mp.flow && mp.flow_api_key && mp.flow_secret_key && precioNum > 0) {
                try {
                  const flowApiUrl = mp.flow_sandbox ? 'https://sandbox.flow.cl/api' : 'https://www.flow.cl/api';
                  const fp = {
                    apiKey: mp.flow_api_key,
                    commerceOrder: String(id),
                    subject: `Cita ${cita.servicio || 'médica'}${cli?.nombre_negocio ? ' — ' + cli.nombre_negocio : ''}`.slice(0, 255),
                    currency: 'CLP', amount: String(precioFlow),
                    email: cita.email_paciente,
                    urlConfirmation: `${BASE_URL}/api/flow-confirm?cid=${cliente_id}`,
                    urlReturn: `${BASE_URL}/api/flow-return?tipo=cita${cli?.booking_slug ? '&slug=' + encodeURIComponent(cli.booking_slug) : ''}`,
                  };
                  fp.s = flowSign(fp, mp.flow_secret_key);
                  const fr = await fetch(`${flowApiUrl}/payment/create`, {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(fp), signal: AbortSignal.timeout(10000)
                  });
                  const fd = await fr.json();
                  if (fd.url && fd.token) flow_url = `${fd.url}?token=${fd.token}`;
                  else console.error('slots flow error:', JSON.stringify(fd));
                } catch(fe) { console.error('slots flow exception:', fe.message); }
              }

              const activos = [];
              if (mp.flow)          activos.push('Flow');
              if (mp.webpay)        activos.push('Webpay / Transbank');
              if (mp.transferencia) activos.push('Transferencia bancaria');
              if (mp.efectivo)      activos.push('Efectivo en el local');
              const pagoHtml = activos.length ? `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Métodos de pago</span><br><span style="color:#2d2d2d;font-size:13px;">${activos.join(' · ')}</span></td></tr>` : '';
              const flowBtn = flow_url ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td style="text-align:center;"><p style="margin:0 0 10px;color:#6b7280;font-size:13px;">Paga online para confirmar tu reserva</p><a href="${he(flow_url)}" target="_blank" style="display:inline-block;padding:13px 32px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;">Pagar ahora con Flow →</a><p style="margin:10px 0 0;color:#9ca3af;font-size:11px;">Este link es de uso único y expira en 24 horas</p></td></tr></table>` : '';
              const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);"><tr><td style="background:#6C5CE4;padding:28px 24px;text-align:center;"><img src="https://app.attempo.cl/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;"><p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p></td></tr><tr><td style="padding:28px 24px;text-align:center;"><h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">¡Cita confirmada! ✓</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${he(cita.nombre_paciente)}</strong>, tu hora está reservada.</p><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">${cita.especialistas?.nombre?`<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${he(cita.especialistas.nombre)}</span></td></tr>`:''}<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${he(fechaFmt)}</span></td></tr><tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${he((cita.hora||'').slice(0,5))}</span></td></tr>${cita.servicio?`<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${he(cita.servicio)}</span></td></tr>`:''}${pagoHtml}</table>${flowBtn}</td></tr><tr><td style="background:#f9f8ff;padding:16px 24px;text-align:center;border-top:1px solid #ede9fe;"><p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a> — Todo a tu tiempo</p></td></tr></table></td></tr></table></body></html>`;
              fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: 'Attempo <contacto@attempo.cl>',
                  to: [cita.email_paciente],
                  subject: `Tu cita en ${cli?.nombre_negocio || 'la clínica'} está confirmada ✓`,
                  html
                })
              }).catch(e => console.error('slots confirmar email error:', e.message));
            }
          } catch(e) { console.error('slots confirmar fetch error:', e.message); }
        }
        return res.json({ ok: true });
      } catch(e) {
        console.error('slots PATCH estado exception:', e.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — PATCH metodo_pago / precio / estado_pago —
    if (typeof body.metodo_pago !== 'undefined' || typeof body.precio !== 'undefined' || typeof body.estado_pago !== 'undefined') {
      const VALID_METODOS = ['efectivo', 'transferencia', 'tarjeta', 'flow', 'webpay', ''];
      const patch = {};
      if (typeof body.metodo_pago !== 'undefined') {
        const m = String(body.metodo_pago || '');
        if (!VALID_METODOS.includes(m)) return res.status(400).json({ error: 'Método de pago inválido' });
        patch.metodo_pago = m || null;
      }
      if (typeof body.precio !== 'undefined') {
        patch.precio = parseInt(body.precio) || null;
      }
      if (typeof body.estado_pago !== 'undefined') {
        const VALID_EP = ['pagado', 'pendiente', ''];
        const ep = String(body.estado_pago || '');
        if (!VALID_EP.includes(ep)) return res.status(400).json({ error: 'Estado de pago inválido' });
        patch.estado_pago = ep || null;
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(patch)
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          return res.status(500).json({ error: `Error al guardar: ${err?.message || err?.code || r.status}` });
        }
        return res.json({ ok: true });
      } catch(e) {
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — PATCH fecha / hora (reagendamiento) —
    if (typeof body.fecha !== 'undefined' || typeof body.hora !== 'undefined') {
      const patch = {};
      if (body.fecha) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) return res.status(400).json({ error: 'Fecha inválida' });
        patch.fecha = body.fecha;
      }
      if (body.hora) {
        if (!/^\d{2}:\d{2}(:\d{2})?$/.test(body.hora)) return res.status(400).json({ error: 'Hora inválida' });
        patch.hora = body.hora;
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(patch)
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          return res.status(500).json({ error: `Error al reagendar: ${err?.message || err?.code || r.status}` });
        }
        // Email de reagendamiento al paciente (asíncrono, no bloquea la respuesta)
        if (process.env.RESEND_API_KEY) {
          Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}&select=nombre_paciente,email_paciente,fecha,hora,servicio,duracion,especialistas(nombre)&limit=1`, { headers: sh }),
            fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=nombre_negocio,direccion,ubicaciones,logo_url&limit=1`, { headers: sh })
          ]).then(async ([rCita, rCli]) => {
            const [cita] = await rCita.json().catch(() => []);
            const [cli]  = await rCli.json().catch(() => []);
            if (!cita?.email_paciente) return;
            const he = v => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            const nuevaFecha = patch.fecha || cita.fecha;
            const nuevaHora  = (patch.hora || cita.hora || '').slice(0,5);
            const fechaFmt   = new Date(`${nuevaFecha}T12:00:00`).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
            const negocio    = cli?.nombre_negocio || 'la clínica';
            const duracion   = cita.duracion ? `${parseInt(cita.duracion)} minutos` : '';
            // Dirección: campo directo o primera sede configurada
            const ubicaciones = Array.isArray(cli?.ubicaciones) ? cli.ubicaciones : [];
            const direccion   = cli?.direccion || (ubicaciones[0] ? [ubicaciones[0].nombre, ubicaciones[0].direccion, ubicaciones[0].ciudad].filter(Boolean).join(' · ') : '');
            const logoHdr = (cli?.logo_url && !cli.logo_url.startsWith('data:'))
              ? `<img src="${he(cli.logo_url)}" alt="${he(negocio)}" height="48" style="display:block;margin:0 auto 6px;max-width:180px"><div style="font-size:15px;font-weight:700;color:#fff">${he(negocio)}</div>`
              : `<img src="https://app.attempo.cl/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;"><p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>`;
            const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);"><tr><td style="background:#1E1B3A;padding:28px 32px;text-align:center;">${logoHdr}</td></tr><tr><td style="padding:32px;text-align:center;"><h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Cita reagendada 📅</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${he(cita.nombre_paciente)}</strong>, tu cita fue reagendada exitosamente.</p><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">${cita.especialistas?.nombre?`<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${he(cita.especialistas.nombre)}</span></td></tr>`:''}<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Nueva fecha</span><br><span style="color:#2d2d2d;font-size:15px;font-weight:700;">${he(fechaFmt)}</span></td></tr><tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Nueva hora</span><br><span style="color:#2d2d2d;font-size:15px;font-weight:700;">${he(nuevaHora)}</span></td></tr>${cita.servicio?`<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${he(cita.servicio)}</span></td></tr>`:''} ${duracion?`<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Duración</span><br><span style="color:#2d2d2d;font-size:15px;">${he(duracion)}</span></td></tr>`:''}</table>${direccion?`<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr><td style="text-align:center;"><p style="margin:0 0 10px;color:#6b7280;font-size:13px;">📍 ${he(direccion)}</p><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}" target="_blank" style="display:inline-block;padding:10px 22px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Ver en Google Maps</a></td></tr></table>`:''}</td></tr><tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;"><p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a> — Todo a tu tiempo</p></td></tr></table></td></tr></table></body></html>`;
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: 'Attempo <contacto@attempo.cl>', to: [cita.email_paciente], subject: `Tu cita en ${negocio} fue reagendada`, html })
            }).catch(e => console.error('slots reagendar email error:', e.message));
          }).catch(e => console.error('slots reagendar email fetch error:', e.message));
        }
        return res.json({ ok: true });
      } catch(e) {
        return res.status(500).json({ error: 'Error interno' });
      }
    }

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
      const [rCita, rCli] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${id}&cliente_id=eq.${cliente_id}&select=google_event_id,nombre_paciente,email_paciente,fecha,hora,servicio&limit=1`, { headers: sh }),
        fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=google_refresh_token,nombre_negocio&limit=1`, { headers: sh })
      ]);
      const [cita] = await rCita.json().catch(() => []);
      const [cli]  = await rCli.json().catch(() => []);

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

      // Remove Google Calendar event if integration is active
      if (cita?.google_event_id && cli?.google_refresh_token) {
        const refreshToken = decryptToken(cli.google_refresh_token);
        gcCancelarEvento({ supabaseUrl: SUPABASE_URL, sh, cliente_id, google_event_id: cita.google_event_id, refresh_token: refreshToken })
          .catch(e => console.error('gcCancelarEvento fire-and-forget error:', e.message));
      }

      // Email de cancelación al paciente (fire-and-forget)
      if (cita?.email_paciente && process.env.RESEND_API_KEY) {
        const he = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const fechaFmt = cita.fecha ? new Date(`${cita.fecha}T12:00:00`).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) : '';
        const negocio = cli?.nombre_negocio || 'attempo';
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);"><tr><td style="background:#6C5CE4;padding:28px 24px;text-align:center;"><img src="https://app.attempo.cl/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;"><p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p></td></tr><tr><td style="padding:28px 24px;text-align:center;"><h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Tu cita fue cancelada</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${he(cita.nombre_paciente)}</strong>, te informamos que tu cita en <strong>${he(negocio)}</strong> ha sido cancelada.</p><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">${fechaFmt?`<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${he(fechaFmt)}</span></td></tr>`:''}<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${he((cita.hora||'').slice(0,5))}</span></td></tr>${cita.servicio?`<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Servicio</span><br><span style="color:#2d2d2d;font-size:15px;">${he(cita.servicio)}</span></td></tr>`:''}</table><p style="margin:20px 0 0;color:#9ca3af;font-size:13px;">Si tienes consultas, comunícate directamente con ${he(negocio)}.</p></td></tr><tr><td style="background:#f9f8ff;padding:16px 24px;text-align:center;border-top:1px solid #ede9fe;"><p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a> — Todo a tu tiempo</p></td></tr></table></td></tr></table></body></html>`;
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Attempo <contacto@attempo.cl>', to: [cita.email_paciente], subject: `Tu cita en ${negocio} fue cancelada`, html })
        }).catch(e => console.error('slots DELETE email error:', e.message));
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

    // — GET ubicaciones —
    if (req.query.resource === 'ubicaciones') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=ubicaciones&limit=1`, { headers: sh });
        if (!r.ok) return res.status(500).json({ error: 'Error al obtener ubicaciones' });
        const data = await r.json();
        return res.status(200).json(data[0]?.ubicaciones || []);
      } catch(e) {
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — GET chatbot-knowledge —
    if (req.query.resource === 'chatbot-knowledge') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/chatbot_knowledge?cliente_id=eq.${cliente_id}&order=orden.asc,created_at.desc`, { headers: sh });
        const data = await r.json();
        if (!r.ok) return res.status(500).json({ error: 'Error al obtener conocimiento' });
        return res.status(200).json(data);
      } catch(e) {
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // — GET chatbot-gaps —
    if (req.query.resource === 'chatbot-gaps') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/chatbot_gaps?cliente_id=eq.${cliente_id}&respondida=eq.false&order=frecuencia.desc,last_seen.desc&limit=50`, { headers: sh });
        const data = await r.json();
        if (!r.ok) return res.status(500).json({ error: 'Error al obtener gaps' });
        return res.status(200).json(data);
      } catch(e) {
        return res.status(500).json({ error: 'Error interno' });
      }
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
      const ALLOWED_SELECT = [
        '*',
        '*,especialistas(id,nombre)',
        'id,fecha,hora,estado,nombre_paciente',
        'id,fecha,hora,estado,nombre_paciente,email_paciente,telefono_paciente',
        'id,fecha,hora,estado',
      ];
      const ALLOWED_ORDER = [
        'fecha.desc,hora.desc',
        'fecha.asc,hora.asc',
        'created_at.desc',
        'created_at.asc',
        'fecha.desc',
        'fecha.asc',
      ];
      const safeSelect = ALLOWED_SELECT.includes(select) ? select : '*,especialistas(id,nombre)';
      const safeOrder  = ALLOWED_ORDER.includes(order)   ? order  : 'fecha.desc,hora.desc';
      const parts = [`cliente_id=eq.${cliente_id}`];
      if (id)     parts.push(`id=eq.${id}`);
      if (nombre) parts.push(`nombre_paciente=ilike.${encodeURIComponent(nombre)}`);
      parts.push(`select=${safeSelect}`);
      parts.push(`order=${safeOrder}`);
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

// ── Validación de tokens de evaluación ───────────────────────────────────────
function validateEvalToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length === 1) return true; // UUID legado — sin expiración, se permite
  if (parts.length !== 3) return false;
  const [uuid, expB36, sig] = parts;
  const exp = parseInt(expB36, 36);
  if (isNaN(exp) || Math.floor(Date.now() / 1000) > exp) return false;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(`et:${uuid}:${exp}`).digest('base64url').slice(0, 22);
  try {
    const b1 = Buffer.from(sig, 'base64'), b2 = Buffer.from(expected, 'base64');
    if (b1.length !== b2.length) return false;
    return crypto.timingSafeEqual(b1, b2);
  } catch { return false; }
}

// ── Rate limiting para evaluar (en memoria + Upstash) ────────────────────────
const _evaluarFallback = new Map();
async function isEvaluarRateLimited(ip) {
  const MAX = 10, WINDOW_S = 3600;
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    try {
      const bucket = Math.floor(Date.now() / (WINDOW_S * 1000));
      const key = `rl:evaluar:${ip}:${bucket}`;
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
  const entry = _evaluarFallback.get(ip);
  if (!entry || now > entry.resetAt) {
    _evaluarFallback.set(ip, { count: 1, resetAt: now + WINDOW_S * 1000 });
    return false;
  }
  if (entry.count >= MAX) return true;
  entry.count++;
  return false;
}

// ── Evaluaciones ─────────────────────────────────────────────────────────────
// GET  ?action=evaluar&token=xxx  → carga form para paciente (sin sesión)
// GET  ?action=evaluar_admin      → lista evaluaciones para el panel (con sesión)
// POST ?action=evaluar            → guarda evaluación del paciente (sin sesión)

export async function handleEvaluar(req, res) {
  const KEY    = process.env.SUPABASE_SERVICE_KEY;
  const sh     = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const shJson = { ...sh, 'Content-Type': 'application/json' };

  // GET ?action=evaluar_pendientes → evaluaciones sin completar (admin)
  if (req.method === 'GET' && req.query.action === 'evaluar_pendientes') {
    const s = verifySessionToken(req.headers['x-session-token']);
    if (!s) return res.status(401).json({ error: 'No autorizado' });
    const overrideId = req.headers['x-override-cliente-id'];
    const cid = (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) ? overrideId : s.cliente_id;

    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluaciones?cliente_id=eq.${cid}&usado=eq.false&order=created_at.desc&limit=100&select=id,paciente_nombre,especialista_id,created_at,cita_id`,
      { headers: sh }
    ).then(r => r.json()).catch(() => []);

    if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: true, pendientes: [] });

    const espIds = [...new Set(rows.map(r => r.especialista_id).filter(Boolean))];
    const espMap = {};
    if (espIds.length) {
      const esps = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=in.(${espIds.join(',')})&select=id,nombre`, { headers: sh }).then(r => r.json()).catch(() => []);
      if (Array.isArray(esps)) esps.forEach(e => { espMap[e.id] = e.nombre; });
    }
    const pendientes = rows.map(row => ({ ...row, especialista_nombre: row.especialista_id ? (espMap[row.especialista_id] || '') : '' }));
    return res.status(200).json({ ok: true, pendientes });
  }

  // POST action=evaluar_reenviar → reenviar email al paciente (admin)
  if (req.method === 'POST' && req.body?.action === 'evaluar_reenviar') {
    const s = verifySessionToken(req.headers['x-session-token']);
    if (!s) return res.status(401).json({ error: 'No autorizado' });
    const overrideId = req.headers['x-override-cliente-id'];
    const cid = (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) ? overrideId : s.cliente_id;

    const eval_id = req.body.eval_id || '';
    if (!eval_id || !/^[0-9a-f-]{36}$/i.test(eval_id)) return res.status(400).json({ error: 'ID inválido' });

    const [ev] = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluaciones?id=eq.${eval_id}&cliente_id=eq.${cid}&usado=eq.false&select=id,token,paciente_nombre,especialista_id,cita_id&limit=1`,
      { headers: sh }
    ).then(r => r.json()).catch(() => []);
    if (!ev) return res.status(404).json({ error: 'Evaluación no encontrada o ya fue completada' });
    if (!ev.cita_id) return res.status(400).json({ error: 'Sin cita asociada' });

    const [cita] = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?id=eq.${ev.cita_id}&select=email_paciente,nombre_paciente&limit=1`,
      { headers: sh }
    ).then(r => r.json()).catch(() => []);
    if (!cita?.email_paciente) return res.status(400).json({ error: 'El paciente no tiene email registrado' });
    if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Sin configuración de email' });

    let espNombre = 'el profesional';
    if (ev.especialista_id) {
      const [esp] = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${ev.especialista_id}&select=nombre&limit=1`, { headers: sh }).then(r => r.json()).catch(() => []);
      espNombre = esp?.nombre || espNombre;
    }
    const [cli] = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=nombre_negocio&limit=1`, { headers: sh }).then(r => r.json()).catch(() => []);
    const negocio = cli?.nombre_negocio || 'tu negocio';
    const evalUrl = `${BASE_URL}/evaluar?token=${ev.token}`;
    const nombre = ev.paciente_nombre || cita.nombre_paciente || 'Estimado/a';

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);"><tr><td style="background:#6C5CE4;padding:28px 24px;text-align:center;"><img src="https://app.attempo.cl/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;"><p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p></td></tr><tr><td style="padding:32px 24px;text-align:center;"><h2 style="margin:0 0 12px;color:#2d2d2d;font-size:20px;">¿Cómo fue tu consulta?</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">Hola <strong>${nombre}</strong>, aún puedes evaluar tu atención con <strong>${espNombre}</strong> en <strong>${negocio}</strong>.</p><a href="${evalUrl}" style="display:inline-block;background:#6C5CE4;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;">Dejar evaluación</a></td></tr><tr><td style="background:#f9f8ff;padding:16px 24px;text-align:center;border-top:1px solid #ede9fe;"><p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a></p></td></tr></table></td></tr></table></body></html>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${negocio} vía Attempo <contacto@attempo.cl>`, to: [cita.email_paciente], subject: `¿Cómo fue tu consulta con ${espNombre}? Deja tu evaluación`, html })
    });
    if (!emailRes.ok) {
      const errTxt = await emailRes.text().catch(() => '');
      return res.status(500).json({ error: 'Error al enviar email' + (errTxt ? ': ' + errTxt.slice(0, 80) : '') });
    }
    return res.status(200).json({ ok: true });
  }

  // GET ?action=evaluar_resumen&cliente_id=xxx → resumen público de ratings por especialista
  if (req.method === 'GET' && req.query.action === 'evaluar_resumen') {
    const cid = req.query.cliente_id || '';
    if (!cid || !/^[0-9a-f-]{36}$/i.test(cid)) return res.status(400).json({ error: 'cliente_id inválido' });
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluaciones?cliente_id=eq.${cid}&usado=eq.true&select=especialista_id,estrellas`,
      { headers: sh }
    ).then(r => r.json()).catch(() => []);
    const mapa = {};
    if (Array.isArray(rows)) {
      rows.forEach(({ especialista_id, estrellas }) => {
        if (!especialista_id || !estrellas) return;
        if (!mapa[especialista_id]) mapa[especialista_id] = { sum: 0, count: 0 };
        mapa[especialista_id].sum += estrellas;
        mapa[especialista_id].count++;
      });
    }
    const resumen = Object.entries(mapa).map(([id, { sum, count }]) => ({
      especialista_id: id,
      promedio: Math.round(sum / count * 10) / 10,
      total: count
    }));
    return res.status(200).json({ ok: true, resumen });
  }

  // GET ?action=evaluar&token=xxx → form del paciente
  if (req.method === 'GET' && req.query.token) {
    const token = String(req.query.token || '').trim();
    if (!token || !validateEvalToken(token)) return res.status(400).json({ error: 'Token inválido o expirado' });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluaciones?token=eq.${encodeURIComponent(token)}&select=id,usado,paciente_nombre,cliente_id,especialista_id&limit=1`,
      { headers: sh }
    );
    const [ev] = await r.json().catch(() => []);
    if (!ev) return res.status(404).json({ error: 'Evaluación no encontrada' });
    if (ev.usado) return res.status(200).json({ ya_usado: true });

    let espNombre = '', negocioNombre = '';
    if (ev.especialista_id) {
      const [esp] = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${ev.especialista_id}&select=nombre&limit=1`, { headers: sh }).then(r => r.json()).catch(() => []);
      espNombre = esp?.nombre || '';
    }
    if (ev.cliente_id) {
      const [cli] = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${ev.cliente_id}&select=nombre_negocio&limit=1`, { headers: sh }).then(r => r.json()).catch(() => []);
      negocioNombre = cli?.nombre_negocio || '';
    }
    return res.status(200).json({ ok: true, paciente_nombre: ev.paciente_nombre || '', especialista_nombre: espNombre, negocio_nombre: negocioNombre });
  }

  // GET ?action=evaluar_admin → lista para el panel admin (requiere sesión)
  if (req.method === 'GET' && req.query.action === 'evaluar_admin') {
    const s = verifySessionToken(req.headers['x-session-token']);
    if (!s) return res.status(401).json({ error: 'No autorizado' });
    const overrideId = req.headers['x-override-cliente-id'];
    const cid = (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) ? overrideId : s.cliente_id;
    if (!cid) return res.status(401).json({ error: 'No autorizado' });

    const espId = req.query.especialista_id || null;
    let url = `${SUPABASE_URL}/rest/v1/evaluaciones?cliente_id=eq.${cid}&usado=eq.true&order=created_at.desc&limit=200&select=id,estrellas,comentario,anonima,paciente_nombre,especialista_id,created_at`;
    if (espId) url += `&especialista_id=eq.${espId}`;

    const rows = await fetch(url, { headers: sh }).then(r => r.json()).catch(() => []);
    if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: true, evaluaciones: [] });

    const espIds = [...new Set(rows.map(r => r.especialista_id).filter(Boolean))];
    const espMap = {};
    if (espIds.length) {
      const esps = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=in.(${espIds.join(',')})&select=id,nombre`, { headers: sh }).then(r => r.json()).catch(() => []);
      if (Array.isArray(esps)) esps.forEach(e => { espMap[e.id] = e.nombre; });
    }
    const evaluaciones = rows.map(row => ({ ...row, especialistas: row.especialista_id ? { nombre: espMap[row.especialista_id] || '' } : null }));
    return res.status(200).json({ ok: true, evaluaciones });
  }

  // POST ?action=evaluar → guardar evaluación del paciente
  if (req.method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    if (await isEvaluarRateLimited(ip)) return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });

    const body     = req.body || {};
    const token    = String(body.token || '').trim();
    const estrellas = parseInt(body.estrellas, 10);
    if (!token || !validateEvalToken(token)) return res.status(400).json({ error: 'Token inválido o expirado' });
    if (!estrellas || estrellas < 1 || estrellas > 5) return res.status(400).json({ error: 'Calificación inválida' });

    const [ev] = await fetch(`${SUPABASE_URL}/rest/v1/evaluaciones?token=eq.${encodeURIComponent(token)}&select=id,usado&limit=1`, { headers: sh }).then(r => r.json()).catch(() => []);
    if (!ev) return res.status(404).json({ error: 'Evaluación no encontrada' });
    if (ev.usado) return res.status(409).json({ error: 'Esta evaluación ya fue enviada' });

    const rPatch = await fetch(`${SUPABASE_URL}/rest/v1/evaluaciones?id=eq.${ev.id}`, {
      method: 'PATCH',
      headers: { ...shJson, Prefer: 'return=minimal' },
      body: JSON.stringify({
        estrellas,
        comentario: String(body.comentario || '').trim().slice(0, 500) || null,
        anonima: body.anonima === true || body.anonima === 'true',
        usado: true
      })
    });
    if (!rPatch.ok) return res.status(500).json({ error: 'Error al guardar evaluación' });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
