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
  const cliente_id = parts[0];
  const rol        = parts[1];
  const expires    = parts[2];
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id, rol };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  let { cliente_id } = session;
  if (session.rol === 'superadmin') {
    const override = req.headers['x-override-cliente-id'];
    if (override) cliente_id = override;
  }
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const shJ = { ...sh, 'Content-Type': 'application/json' };

  // ── GET ?action=stats — contador msg IA del mes ───────────────────────────
  if (req.method === 'GET' && req.query.action === 'stats') {
    const now  = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/mensajes?cliente_id=eq.${cliente_id}&rol=eq.bot&created_at=gte.${from}&select=id`,
      { headers: sh }
    );
    const data = await r.json();
    return res.status(200).json({ msg_ia_mes: Array.isArray(data) ? data.length : 0 });
  }

  // ── GET ?id=xxx — mensajes de una conversación ────────────────────────────
  if (req.method === 'GET' && req.query.id) {
    const conv_id = req.query.id;

    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}&cliente_id=eq.${cliente_id}&limit=1`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    // Refrescar foto de perfil (IG/Messenger — URLs de Meta CDN expiran cada ~24h)
    if (conv.canal === 'instagram' || conv.canal === 'messenger') {
      try {
        const rk = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=canales_meta&limit=1`, { headers: sh });
        const [cli] = await rk.json();
        const meta  = cli?.canales_meta || {};
        const token = conv.canal === 'messenger' ? meta.fb_token : meta.ig_token;
        if (token) {
          const apiUrl = conv.canal === 'messenger'
            ? `https://graph.facebook.com/v20.0/${conv.canal_user_id}?fields=profile_pic&access_token=${token}`
            : `https://graph.instagram.com/v21.0/${conv.canal_user_id}?fields=profile_pic&access_token=${token}`;
          const nr = await fetch(apiUrl);
          const nd = await nr.json();
          if (nd.profile_pic) {
            conv.canal_user_photo = nd.profile_pic;
            fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}`, {
              method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' },
              body: JSON.stringify({ canal_user_photo: nd.profile_pic })
            }).catch(() => {});
          }
        }
      } catch (_) {}
    }

    // Leer pausa_bot real desde chat_sessions
    let pausa_bot = false;
    try {
      const rs = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(conv.canal)}&canal_user_id=eq.${encodeURIComponent(conv.canal_user_id)}&select=pausa_bot&limit=1`,
        { headers: sh }
      );
      const [sess] = await rs.json();
      pausa_bot = sess?.pausa_bot || false;
    } catch (_) {}

    // Marcar como leído
    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}`, {
        method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' },
        body: JSON.stringify({ no_leidos: 0 })
      }),
      fetch(`${SUPABASE_URL}/rest/v1/mensajes?conversacion_id=eq.${conv_id}&visto=eq.false&rol=eq.usuario`, {
        method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' },
        body: JSON.stringify({ visto: true })
      })
    ]);

    const rm = await fetch(
      `${SUPABASE_URL}/rest/v1/mensajes?conversacion_id=eq.${conv_id}&order=created_at.asc&limit=200&select=*`,
      { headers: sh }
    );
    const msgs = await rm.json();
    return res.status(200).json({
      conversacion: { ...conv, pausa_bot },
      mensajes: Array.isArray(msgs) ? msgs : []
    });
  }

  // ── GET ?contacto_id=xxx — vista unificada de un contacto ────────────────────
  if (req.method === 'GET' && req.query.contacto_id) {
    const contacto_id = req.query.contacto_id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contacto_id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?contacto_id=eq.${contacto_id}&cliente_id=eq.${cliente_id}&order=ultimo_mensaje_at.desc&select=*`,
      { headers: sh }
    );
    const conversaciones = await rc.json();
    if (!Array.isArray(conversaciones) || !conversaciones.length) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }
    const ids = conversaciones.map(c => c.id);
    const rm = await fetch(
      `${SUPABASE_URL}/rest/v1/mensajes?conversacion_id=in.(${ids.join(',')})&order=created_at.asc&limit=500&select=*`,
      { headers: sh }
    );
    const mensajes = await rm.json();
    const canalMap = Object.fromEntries(conversaciones.map(c => [c.id, c.canal]));
    const mensajesConCanal = (Array.isArray(mensajes) ? mensajes : []).map(m => ({
      ...m, canal: canalMap[m.conversacion_id] || null
    }));
    for (const conv of conversaciones) {
      fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv.id}`, {
        method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' },
        body: JSON.stringify({ no_leidos: 0 })
      }).catch(() => {});
    }
    return res.status(200).json({ conversaciones, mensajes: mensajesConCanal });
  }

  // ── GET — lista de conversaciones ─────────────────────────────────────────
  if (req.method === 'GET') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?cliente_id=eq.${cliente_id}&order=ultimo_mensaje_at.desc&limit=100&select=*`,
      { headers: sh }
    );
    const data = await r.json();
    return res.status(200).json(Array.isArray(data) ? data : []);
  }

  // ── POST — enviar mensaje manual desde admin ──────────────────────────────
  if (req.method === 'POST') {
    const { conversacion_id, contenido } = req.body || {};
    if (!conversacion_id || !contenido?.trim()) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conversacion_id}&cliente_id=eq.${cliente_id}&limit=1&select=*`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const rk = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=canales_meta&limit=1`,
      { headers: sh }
    );
    const [cli] = await rk.json();
    const meta = cli?.canales_meta || {};

    const { canal, canal_user_id } = conv;
    let accessToken = null, channelId = null;
    if (canal === 'whatsapp')       { accessToken = meta.wa_token; channelId = meta.wa_phone_number_id; }
    else if (canal === 'instagram') { accessToken = meta.ig_token; }
    else if (canal === 'messenger') { accessToken = meta.fb_token; }

    if (accessToken) {
      try {
        let metaRes;
        if (canal === 'whatsapp') {
          metaRes = await fetch(`https://graph.facebook.com/v20.0/${channelId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: canal_user_id, type: 'text', text: { body: contenido.trim() } })
          });
        } else if (canal === 'instagram') {
          metaRes = await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { id: canal_user_id }, message: { text: contenido.trim() } })
          });
        } else {
          metaRes = await fetch(`https://graph.facebook.com/v20.0/me/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { id: canal_user_id }, message: { text: contenido.trim() } })
          });
        }
        if (!metaRes.ok) {
          const errTxt = await metaRes.text();
          return res.status(502).json({ error: 'Error enviando mensaje al canal', detalle: errTxt });
        }
      } catch (e) {
        return res.status(502).json({ error: 'Error de red: ' + e.message });
      }
    }

    const ahora = new Date().toISOString();
    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
        method: 'POST', headers: { ...shJ, Prefer: 'return=minimal' },
        body: JSON.stringify({ conversacion_id, cliente_id, rol: 'admin', contenido: contenido.trim(), visto: true })
      }),
      fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conversacion_id}`, {
        method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' },
        body: JSON.stringify({ ultimo_mensaje: contenido.trim().slice(0, 120), ultimo_mensaje_at: ahora })
      })
    ]);

    return res.status(200).json({ ok: true, created_at: ahora });
  }

  // ── POST ?action=sync-contacts — obtener nombres/fotos retroactivos ─────────
  if (req.method === 'POST' && req.query.action === 'sync-contacts') {
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?cliente_id=eq.${cliente_id}&canal=in.(instagram,messenger)&select=id,canal,canal_user_id,canal_user_name`,
      { headers: sh }
    );
    const convs = await rc.json();
    if (!Array.isArray(convs) || !convs.length) return res.status(200).json({ ok: true, updated: 0 });

    const rk = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=canales_meta&limit=1`,
      { headers: sh }
    );
    const [cli] = await rk.json();
    const meta = cli?.canales_meta || {};

    let updated = 0;
    for (const conv of convs) {
      // Solo procesar los que aún no tienen nombre real
      if (conv.canal_user_name && conv.canal_user_name !== conv.canal_user_id) continue;
      const token = conv.canal === 'messenger' ? meta.fb_token : meta.ig_token;
      if (!token) continue;

      let nombre = null, foto = null;
      try {
        if (conv.canal === 'messenger') {
          const nr = await fetch(`https://graph.facebook.com/v20.0/${conv.canal_user_id}?fields=first_name,last_name,profile_pic&access_token=${token}`);
          const nd = await nr.json();
          if (nd.first_name) nombre = [nd.first_name, nd.last_name].filter(Boolean).join(' ');
          if (nd.profile_pic) foto = nd.profile_pic;
        } else {
          const nr = await fetch(`https://graph.instagram.com/v21.0/${conv.canal_user_id}?fields=name,profile_pic&access_token=${token}`);
          const nd = await nr.json();
          if (nd.name) nombre = nd.name;
          if (nd.profile_pic) foto = nd.profile_pic;
        }
      } catch(_) { continue; }

      if (nombre || foto) {
        const patch = {};
        if (nombre) patch.canal_user_name = nombre;
        if (foto)   patch.canal_user_photo = foto;
        await fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv.id}`, {
          method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' },
          body: JSON.stringify(patch)
        });
        updated++;
      }
    }
    return res.status(200).json({ ok: true, updated });
  }

  // ── PATCH ?id=xxx&action=update-name — editar nombre del contacto ─────────
  if (req.method === 'PATCH' && req.query.id && req.query.action === 'update-name') {
    const conv_id = req.query.id;
    const nombre  = (req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}&cliente_id=eq.${cliente_id}&limit=1&select=id`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    await fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}`, {
      method: 'PATCH',
      headers: { ...shJ, Prefer: 'return=minimal' },
      body: JSON.stringify({ canal_user_name: nombre })
    });
    return res.status(200).json({ ok: true });
  }

  // ── PATCH ?id=xxx&action=update-estado — cambiar estado conversación ────────
  if (req.method === 'PATCH' && req.query.id && req.query.action === 'update-estado') {
    const conv_id = req.query.id;
    const estado  = req.body?.estado;
    if (!['abierto', 'cotizando', 'cerrado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}&cliente_id=eq.${cliente_id}&limit=1&select=id`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    await fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}`, {
      method: 'PATCH',
      headers: { ...shJ, Prefer: 'return=minimal' },
      body: JSON.stringify({ estado })
    });
    return res.status(200).json({ ok: true, estado });
  }

  // ── PATCH ?id=xxx&action=toggle-bot — pausar/reanudar bot ────────────────
  if (req.method === 'PATCH' && req.query.id && req.query.action === 'toggle-bot') {
    const conv_id  = req.query.id;
    const pausaVal = req.body?.pausa === true || req.body?.pausa === 'true';

    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}&cliente_id=eq.${cliente_id}&limit=1&select=canal,canal_user_id`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    await fetch(
      `${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(conv.canal)}&canal_user_id=eq.${encodeURIComponent(conv.canal_user_id)}`,
      {
        method: 'PATCH',
        headers: { ...shJ, Prefer: 'return=minimal' },
        body: JSON.stringify({ pausa_bot: pausaVal })
      }
    );
    return res.status(200).json({ ok: true, pausa_bot: pausaVal });
  }

  // ── DELETE ?id=xxx — eliminar conversación y sus mensajes ───────────────────
  if (req.method === 'DELETE' && req.query.id) {
    const conv_id = req.query.id;
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}&cliente_id=eq.${cliente_id}&limit=1&select=id,canal,canal_user_id`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/mensajes?conversacion_id=eq.${conv_id}`, {
        method: 'DELETE', headers: sh
      }),
      fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(conv.canal)}&canal_user_id=eq.${encodeURIComponent(conv.canal_user_id)}`, {
        method: 'DELETE', headers: sh
      })
    ]);
    await fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}`, {
      method: 'DELETE', headers: sh
    });
    return res.status(200).json({ ok: true });
  }

  // ── PATCH ?action=merge — unificar conversaciones bajo un contacto_id ────────
  if (req.method === 'PATCH' && req.query.action === 'merge') {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length < 2) {
      return res.status(400).json({ error: 'Se requieren al menos 2 IDs' });
    }
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!ids.every(id => uuidRe.test(id))) return res.status(400).json({ error: 'IDs inválidos' });

    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=in.(${ids.join(',')})&cliente_id=eq.${cliente_id}&select=id,contacto_id`,
      { headers: sh }
    );
    const convs = await rc.json();
    if (!Array.isArray(convs) || convs.length !== ids.length) {
      return res.status(403).json({ error: 'Acceso denegado o IDs inválidos' });
    }
    const existingCid = convs.find(c => c.contacto_id)?.contacto_id;
    const contacto_id = existingCid || crypto.randomUUID();
    await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=in.(${ids.join(',')})`,
      { method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' }, body: JSON.stringify({ contacto_id }) }
    );
    return res.status(200).json({ ok: true, contacto_id });
  }

  // ── PATCH ?action=unlink&id=xxx — desvincular conversación ──────────────────
  if (req.method === 'PATCH' && req.query.action === 'unlink' && req.query.id) {
    const conv_id = req.query.id;
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}&cliente_id=eq.${cliente_id}&limit=1&select=id`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'No encontrada' });
    await fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}`, {
      method: 'PATCH', headers: { ...shJ, Prefer: 'return=minimal' }, body: JSON.stringify({ contacto_id: null })
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
