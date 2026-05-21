import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) {
    // Contraseña legacy en texto plano — comparar y señalar upgrade
    return { ok: stored === password, upgrade: stored === password };
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return { ok: false, upgrade: false };
  const [, salt, hashHex] = parts;
  const hash = await scryptAsync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (hash.length !== storedBuf.length) return { ok: false, upgrade: false };
  const ok = crypto.timingSafeEqual(hash, storedBuf);
  return { ok, upgrade: false };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: 'Datos incompletos' });

  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const input = usuario.trim().toLowerCase();

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?or=(username.eq.${encodeURIComponent(input)},email.eq.${encodeURIComponent(input)})&select=id,username,password,email,nombre,rol,destino,cliente_id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );

    const rows = await r.json();
    if (!rows.length) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const u = rows[0];
    const { ok, upgrade } = await verifyPassword(password, u.password || '');

    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    // Auto-upgrade contraseña legacy a hash scrypt
    if (upgrade) {
      const newHash = await hashPassword(password);
      fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${u.id}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ password: newHash })
      }).catch(() => {});
    }

    return res.status(200).json({
      ok: true,
      usuario: u.username,
      nombre: u.nombre,
      rol: u.rol,
      destino: u.destino,
      cliente_id: u.cliente_id
    });

  } catch (err) {
    console.error('login error');
    return res.status(500).json({ error: 'Error interno' });
  }
}
