export default async function handler(req, res) {
  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (req.method === 'GET') {
    // Verificar que el token existe y es válido
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/password_resets?token=eq.${token}&used=eq.false&select=expires_at`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await check.json();

    if (!rows.length) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (new Date(rows[0].expires_at) < new Date()) {
      return res.status(400).json({ error: 'El enlace ha expirado' });
    }

    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Datos incompletos' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    // Buscar token válido
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/password_resets?token=eq.${token}&used=eq.false&select=email,expires_at`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await check.json();

    if (!rows.length) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (new Date(rows[0].expires_at) < new Date()) {
      return res.status(400).json({ error: 'El enlace ha expirado' });
    }

    const email = rows[0].email;

    // Actualizar contraseña en tabla usuarios
    const update = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ password })
      }
    );

    if (!update.ok) return res.status(500).json({ error: 'Error al actualizar contraseña' });

    // Marcar token como usado
    await fetch(
      `${SUPABASE_URL}/rest/v1/password_resets?token=eq.${token}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ used: true })
      }
    );

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
