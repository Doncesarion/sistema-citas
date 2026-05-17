export default async function handler(req, res) {
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
      const body = req.body || {};
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
            email: email || null,
            nombre: nombre || username,
            rol: rol || 'admin',
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
        const { nombre_negocio, email, plan } = body;
        if (!nombre_negocio) return res.status(400).json({ error: 'El nombre del negocio es obligatorio' });

        const today    = new Date().toISOString().split('T')[0];
        const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];

        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema`, {
          method: 'POST',
          headers: { ...sh, Prefer: 'return=representation' },
          body: JSON.stringify({
            nombre_negocio,
            email: email || null,
            plan: plan || 'basic',
            fecha_inicio: today,
            fecha_expiracion: nextYear,
            password_hash: ''
          })
        });

        if (!r.ok) return res.status(400).json({ error: 'Error al crear negocio' });
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

      return res.status(400).json({ error: 'Acción no válida' });
    }

    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
