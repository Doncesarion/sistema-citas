import crypto from 'crypto';

function verifyToken(token) {
  if (!token) return false;
  const SA_SECRET = process.env.SA_SECRET;
  if (!SA_SECRET) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SA_SECRET).update(payload).digest('hex');
  if (sig !== expected) return false;
  if (Date.now() > parseInt(payload)) return false;
  return true;
}

function timingSafeStringEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  const maxLen = Math.max(ba.length, bb.length);
  const padA = Buffer.concat([ba, Buffer.alloc(maxLen - ba.length)]);
  const padB = Buffer.concat([bb, Buffer.alloc(maxLen - bb.length)]);
  return crypto.timingSafeEqual(padA, padB) && ba.length === bb.length;
}

export default async function handler(req, res) {
  // ── POST login: genera token SA (no requiere autenticación previa) ─────────
  if (req.method === 'POST' && req.body?.action === 'login') {
    const { user, pass } = req.body;
    if (!user || !pass) return res.status(400).json({ error: 'Faltan credenciales' });

    const SA_USER   = process.env.SA_USER;
    const SA_PASS   = process.env.SA_PASS;
    const SA_SECRET = process.env.SA_SECRET;

    if (!SA_USER || !SA_PASS || !SA_SECRET) {
      return res.status(500).json({ error: 'Servidor no configurado correctamente' });
    }

    if (!timingSafeStringEqual(user, SA_USER) || !timingSafeStringEqual(pass, SA_PASS)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const expires = Date.now() + 8 * 60 * 60 * 1000;
    const payload = String(expires);
    const sig = crypto.createHmac('sha256', SA_SECRET).update(payload).digest('hex');
    return res.status(200).json({ token: `${payload}.${sig}` });
  }

  // ── Todas las demás rutas requieren token válido ───────────────────────────
  if (!verifyToken(req.headers['x-sa-token'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // ── POST proxy: reenvía a edge function admin-clientes ────────────────────
  if (req.method === 'POST' && req.body?.action === 'proxy') {
    const ADMIN_TOKEN   = process.env.ADMIN_TOKEN;
    const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;

    if (!ADMIN_TOKEN || !FUNCTIONS_URL) {
      return res.status(500).json({ error: 'Servidor no configurado correctamente' });
    }

    const { edge_action, action: _omit, ...forwardBody } = req.body || {};
    const url = `${FUNCTIONS_URL}/admin-clientes?action=${edge_action}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify(forwardBody),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  }

  // ── Gestión de usuarios y negocios ────────────────────────────────────────
  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const { action, cliente_id } = req.query;

      if (action === 'clientes') {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/clientes_sistema?select=id,nombre_negocio,email,plan&order=nombre_negocio.asc`,
          { headers: sh }
        );
        return res.status(r.status).json(await r.json());
      }

      if (action === 'usuarios') {
        let url = `${SUPABASE_URL}/rest/v1/usuarios?select=id,username,email,nombre,rol,cliente_id&order=nombre.asc`;
        if (cliente_id) url += `&cliente_id=eq.${encodeURIComponent(cliente_id)}`;
        const r = await fetch(url, { headers: sh });
        return res.status(r.status).json(await r.json());
      }

      return res.status(400).json({ error: 'Acción no válida' });
    }

    if (req.method === 'POST') {
      const body   = req.body || {};
      const { action } = body;

      if (action === 'crear') {
        const { username, password, email, nombre, rol, cliente_id } = body;
        if (!username || !password || !cliente_id) {
          return res.status(400).json({ error: 'username, password y cliente_id son obligatorios' });
        }
        if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

        const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
          method: 'POST',
          headers: { ...sh, Prefer: 'return=minimal' },
          body: JSON.stringify({
            username: username.trim().toLowerCase(),
            password,
            email:   email || null,
            nombre:  nombre || username,
            rol:     rol || 'admin',
            destino: '/admin.html',
            cliente_id
          })
        });

        if (!r.ok) {
          const txt = await r.text();
          const isDup = txt.includes('duplicate') || txt.includes('unique');
          return res.status(400).json({ error: isDup ? 'Ese nombre de usuario ya existe' : 'Error al crear usuario' });
        }
        return res.status(200).json({ ok: true });
      }

      if (action === 'crear-negocio') {
        const { nombre_negocio, email, plan, contacto_nombre, contacto_tel, rubro } = body;
        if (!nombre_negocio) return res.status(400).json({ error: 'El nombre del negocio es obligatorio' });

        const today    = new Date().toISOString().split('T')[0];
        const days     = plan === 'demo' ? 14 : 365;
        const nextYear = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().split('T')[0];
        const slug     = nombre_negocio.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
        if (!slug) return res.status(400).json({ error: 'El nombre del negocio debe contener al menos una letra o número' });

        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema`, {
          method: 'POST',
          headers: { ...sh, Prefer: 'return=representation' },
          body: JSON.stringify({
            nombre_negocio,
            email:            email || null,
            plan:             plan || 'basic',
            fecha_inicio:     today,
            fecha_expiracion: nextYear,
            password_hash:    '',
            activo:           true,
            booking_slug:     slug,
            contacto_nombre:  contacto_nombre || null,
            contacto_tel:     contacto_tel    || null,
            rubro:            rubro           || null
          })
        });

        if (!r.ok) {
          const txt = await r.text();
          return res.status(400).json({ error: 'Error al crear negocio: ' + txt });
        }
        const rows = await r.json();
        return res.status(200).json({ ok: true, cliente: rows[0] });
      }

      if (action === 'cambiar-password') {
        const { username, password } = body;
        if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });
        if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });

        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}`,
          { method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify({ password }) }
        );
        if (!r.ok) return res.status(500).json({ error: 'Error al actualizar' });
        return res.status(200).json({ ok: true });
      }

      if (action === 'eliminar') {
        const { username } = body;
        if (!username) return res.status(400).json({ error: 'Datos incompletos' });

        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}`,
          { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } }
        );
        if (!r.ok) return res.status(500).json({ error: 'Error al eliminar' });
        return res.status(200).json({ ok: true });
      }

      if (action === 'eliminar-negocio') {
        const { cliente_id } = body;
        if (!cliente_id) return res.status(400).json({ error: 'Datos incompletos' });

        await fetch(`${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}`,        { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } });
        await fetch(`${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}`, { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } });
        await fetch(`${SUPABASE_URL}/rest/v1/usuarios?cliente_id=eq.${cliente_id}`,     { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } });

        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`,
          { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } }
        );
        if (!r.ok) return res.status(500).json({ error: 'Error al eliminar negocio' });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Acción no válida' });
    }

    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
