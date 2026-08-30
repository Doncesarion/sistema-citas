import crypto from 'crypto';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';

function verifySessionToken(token) {
  if (!token) return null;
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  if (Date.now() > parseInt(parts[2])) return null;
  return { cliente_id: parts[0], rol: parts[1] };
}

function resolveClienteId(req) {
  const session = verifySessionToken(req.headers['x-session-token']);
  const overrideId = req.headers['x-override-cliente-id'];
  if (session?.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) return overrideId;
  return session?.cliente_id || null;
}

export default async function handler(req, res) {
  const sh     = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };
  const shJson = { ...sh, 'Content-Type': 'application/json' };

  // ── GET ?token=xxx  → carga el form de evaluación para el paciente ──────────
  if (req.method === 'GET' && req.query.token) {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token inválido' });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluaciones?token=eq.${encodeURIComponent(token)}&select=id,usado,paciente_nombre,cliente_id,especialista_id&limit=1`,
      { headers: sh }
    );
    const [ev] = await r.json().catch(() => []);
    if (!ev) return res.status(404).json({ error: 'Evaluación no encontrada' });
    if (ev.usado) return res.status(200).json({ ya_usado: true });

    // Obtener nombre del especialista y del negocio por separado
    let espNombre = '', negocioNombre = '';
    if (ev.especialista_id) {
      const rEsp = await fetch(`${SUPABASE_URL}/rest/v1/especialistas?id=eq.${ev.especialista_id}&select=nombre&limit=1`, { headers: sh });
      const [esp] = await rEsp.json().catch(() => []);
      espNombre = esp?.nombre || '';
    }
    if (ev.cliente_id) {
      const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${ev.cliente_id}&select=nombre_negocio&limit=1`, { headers: sh });
      const [cli] = await rCli.json().catch(() => []);
      negocioNombre = cli?.nombre_negocio || '';
    }

    return res.status(200).json({
      ok: true,
      paciente_nombre: ev.paciente_nombre || '',
      especialista_nombre: espNombre,
      negocio_nombre: negocioNombre
    });
  }

  // ── GET ?cliente_id (con sesión) → evaluaciones para el panel admin ─────────
  if (req.method === 'GET') {
    const session = verifySessionToken(req.headers['x-session-token']);
    if (!session) return res.status(401).json({ error: 'No autorizado' });
    const cid = resolveClienteId(req);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });

    const espId = req.query.especialista_id || null;
    let url = `${SUPABASE_URL}/rest/v1/evaluaciones?cliente_id=eq.${cid}&usado=eq.true&order=created_at.desc&limit=200&select=id,estrellas,comentario,anonima,paciente_nombre,especialista_id,created_at`;
    if (espId) url += `&especialista_id=eq.${espId}`;

    const r = await fetch(url, { headers: sh });
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: true, evaluaciones: [] });

    // Enriquecer con nombres de especialistas
    const espIds = [...new Set(rows.map(r => r.especialista_id).filter(Boolean))];
    const espMap = {};
    if (espIds.length) {
      const rEsps = await fetch(
        `${SUPABASE_URL}/rest/v1/especialistas?id=in.(${espIds.join(',')})&select=id,nombre`,
        { headers: sh }
      );
      const esps = await rEsps.json().catch(() => []);
      if (Array.isArray(esps)) esps.forEach(e => { espMap[e.id] = e.nombre; });
    }

    const evaluaciones = rows.map(row => ({
      ...row,
      especialistas: row.especialista_id ? { nombre: espMap[row.especialista_id] || '' } : null
    }));
    return res.status(200).json({ ok: true, evaluaciones });
  }

  // ── POST { token, estrellas, comentario, anonima } → guardar evaluación ─────
  if (req.method === 'POST') {
    const body = req.body || {};
    const token = String(body.token || '').trim();
    const estrellas = parseInt(body.estrellas, 10);

    if (!token) return res.status(400).json({ error: 'Token requerido' });
    if (!estrellas || estrellas < 1 || estrellas > 5) return res.status(400).json({ error: 'Calificación inválida' });

    // Validar token y que no haya sido usado
    const rEv = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluaciones?token=eq.${encodeURIComponent(token)}&select=id,usado&limit=1`,
      { headers: sh }
    );
    const [ev] = await rEv.json().catch(() => []);
    if (!ev) return res.status(404).json({ error: 'Evaluación no encontrada' });
    if (ev.usado) return res.status(409).json({ error: 'Esta evaluación ya fue enviada' });

    const patch = {
      estrellas,
      comentario: String(body.comentario || '').trim().slice(0, 500) || null,
      anonima: body.anonima === true || body.anonima === 'true',
      usado: true
    };

    const rPatch = await fetch(`${SUPABASE_URL}/rest/v1/evaluaciones?id=eq.${ev.id}`, {
      method: 'PATCH',
      headers: { ...shJson, Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    });
    if (!rPatch.ok) {
      const err = await rPatch.text().catch(() => '');
      console.error('evaluar PATCH error:', err);
      return res.status(500).json({ error: 'Error al guardar evaluación' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
