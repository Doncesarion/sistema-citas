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


function authenticate(req) {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) return null;
  const s = verifySessionToken(sessionToken);
  if (!s) return null;
  // Superadmin puede indicar un cliente_id diferente (impersonación)
  const overrideId = req.headers['x-override-cliente-id'];
  if (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) {
    return { cliente_id: overrideId };
  }
  return { cliente_id: s.cliente_id };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'No autorizado' });

  const { cliente_id } = auth;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  try {
    const { select, order, limit, id, nombre } = req.query;

    // Validar id si viene (UUID)
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Construir query — siempre filtra por cliente_id del token (nunca del body)
    const parts = [`cliente_id=eq.${cliente_id}`];
    if (id)     parts.push(`id=eq.${id}`);
    if (nombre) parts.push(`nombre_paciente=ilike.${encodeURIComponent(nombre)}`);

    // select y order se pasan tal cual (PostgREST necesita la sintaxis sin codificar)
    parts.push(`select=${select || '*,especialistas(id,nombre)'}`);
    parts.push(`order=${order   || 'fecha.desc,hora.desc'}`);
    if (limit) parts.push(`limit=${Math.min(parseInt(limit) || 100, 2000)}`);

    const url = `${SUPABASE_URL}/rest/v1/citas?${parts.join('&')}`;
    const r   = await fetch(url, { headers: sh });
    const data = await r.json();

    if (!r.ok) {
      console.error('citas-get supabase error:', r.status, JSON.stringify(data));
      return res.status(500).json({ error: 'Error al obtener citas' });
    }

    return res.status(200).json(data);
  } catch (e) {
    console.error('citas-get exception:', e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}
