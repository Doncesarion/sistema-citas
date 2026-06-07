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
  const expires    = parts[2];
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  const { cliente_id } = session;
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

  return res.status(405).end();
}
