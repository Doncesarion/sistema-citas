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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = verifySessionToken(req.headers['x-session-token']);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  const { cliente_id } = session;
  const KEY  = process.env.SUPABASE_SERVICE_KEY;
  const sh   = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const shJ  = { ...sh, 'Content-Type': 'application/json' };

  // ── GET /api/bandeja — lista de conversaciones ────────────────────────────
  if (req.method === 'GET' && !req.query.id) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?cliente_id=eq.${cliente_id}&order=ultimo_mensaje_at.desc&limit=100&select=*`,
      { headers: sh }
    );
    const data = await r.json();
    return res.status(200).json(Array.isArray(data) ? data : []);
  }

  // ── GET /api/bandeja?id=xxx — mensajes de una conversación ────────────────
  if (req.method === 'GET' && req.query.id) {
    const conv_id = req.query.id;

    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conv_id}&cliente_id=eq.${cliente_id}&limit=1`,
      { headers: sh }
    );
    const [conv] = await rc.json();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

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
    return res.status(200).json({ conversacion: conv, mensajes: Array.isArray(msgs) ? msgs : [] });
  }

  // ── GET /api/bandeja?action=stats — contador msg IA del mes ──────────────
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

  return res.status(405).end();
}
