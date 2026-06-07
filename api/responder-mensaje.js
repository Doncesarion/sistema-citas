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
  const [cliente_id, , expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  const { cliente_id } = session;
  const { conversacion_id, contenido } = req.body || {};
  if (!conversacion_id || !contenido?.trim()) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const shJ = { ...sh, 'Content-Type': 'application/json' };

  // Verificar que la conversación pertenece al cliente
  const rc = await fetch(
    `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conversacion_id}&cliente_id=eq.${cliente_id}&limit=1&select=*`,
    { headers: sh }
  );
  const [conv] = await rc.json();
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

  // Obtener tokens Meta del cliente
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

  // Enviar mensaje via Meta API
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
        console.error('responder-mensaje: Meta error', metaRes.status, errTxt);
        return res.status(502).json({ error: 'Error enviando mensaje al canal', detalle: errTxt });
      }
    } catch (e) {
      return res.status(502).json({ error: 'Error de red: ' + e.message });
    }
  } else {
    console.warn('responder-mensaje: sin access token para canal', canal, '— guardando solo en DB');
  }

  const ahora = new Date().toISOString();

  // Guardar mensaje en DB y actualizar conversación
  await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
      method: 'POST',
      headers: { ...shJ, Prefer: 'return=minimal' },
      body: JSON.stringify({
        conversacion_id, cliente_id,
        rol: 'admin',
        contenido: contenido.trim(),
        visto: true
      })
    }),
    fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conversacion_id}`, {
      method: 'PATCH',
      headers: { ...shJ, Prefer: 'return=minimal' },
      body: JSON.stringify({
        ultimo_mensaje: contenido.trim().slice(0, 120),
        ultimo_mensaje_at: ahora
      })
    })
  ]);

  return res.status(200).json({ ok: true, created_at: ahora });
}
