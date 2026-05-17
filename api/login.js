export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: 'Datos incompletos' });

  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const input = usuario.trim().toLowerCase();

    // Buscar por username o email
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?or=(username.eq.${encodeURIComponent(input)},email.eq.${encodeURIComponent(input)})&select=username,password,email,nombre,rol,destino,cliente_id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );

    const rows = await r.json();

    if (!rows.length || rows[0].password !== password) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const u = rows[0];
    return res.status(200).json({
      ok: true,
      usuario: u.username,
      nombre: u.nombre,
      rol: u.rol,
      destino: u.destino,
      cliente_id: u.cliente_id
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
