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
  if (req.method !== 'POST') return res.status(405).end();

  const sessionToken = req.headers['x-session-token'];
  const session = verifySessionToken(sessionToken);
  if (!session) return res.status(401).json({ error: 'No autorizado' });

  const { cita_id, cliente_id: bodyClienteId } = req.body || {};
  if (!cita_id || !/^[0-9a-f-]{36}$/i.test(cita_id)) {
    return res.status(400).json({ error: 'ID de cita inválido' });
  }

  // For superadmin impersonation, use the body's cliente_id; otherwise use session's
  let cliente_id = session.cliente_id;
  const overrideId = req.headers['x-override-cliente-id'];
  if (session.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) {
    cliente_id = overrideId;
  } else if (bodyClienteId && /^[0-9a-f-]{36}$/i.test(bodyClienteId)) {
    cliente_id = bodyClienteId;
  }

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?id=eq.${cita_id}&cliente_id=eq.${cliente_id}`,
      { method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'cancelada' }) }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error('cancelar-cita error:', r.status, JSON.stringify(err));
      return res.status(500).json({ error: 'No se pudo cancelar la cita' });
    }
    return res.json({ ok: true });
  } catch(e) {
    console.error('cancelar-cita exception:', e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}
