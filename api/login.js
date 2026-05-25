import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

// Rate limiting persistente con Upstash Redis (fallback a Map en memoria)
const _loginFallback = new Map();
async function isRateLimited(ip) {
  const MAX = 10;
  const WINDOW_S = 15 * 60;

  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const bucket = Math.floor(Date.now() / (WINDOW_S * 1000));
      const key = `rl:login:${ip}:${bucket}`;
      const r = await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['INCR', key], ['EXPIRE', key, WINDOW_S * 2]])
      });
      const data = await r.json();
      const count = data[0]?.result;
      if (typeof count === 'number') return count > MAX;
    } catch {}
  }

  // Fallback en memoria si Upstash no está disponible
  const now = Date.now();
  const entry = _loginFallback.get(ip);
  if (!entry || now > entry.resetAt) {
    _loginFallback.set(ip, { count: 1, resetAt: now + WINDOW_S * 1000 });
    return false;
  }
  if (entry.count >= MAX) return true;
  entry.count++;
  return false;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, upgrade: false, first: false };

  // First-login password: prefix 'first$scrypt$...'
  if (stored.startsWith('first$')) {
    const inner = stored.slice(6);
    const parts = inner.split('$');
    if (parts.length === 3 && parts[0] === 'scrypt') {
      const [, salt, hashHex] = parts;
      const hash = await scryptAsync(password, salt, 64);
      const storedBuf = Buffer.from(hashHex, 'hex');
      if (hash.length !== storedBuf.length) return { ok: false, upgrade: false, first: false };
      const ok = crypto.timingSafeEqual(hash, storedBuf);
      return { ok, upgrade: false, first: ok };
    }
  }

  if (!stored.startsWith('scrypt$')) {
    return { ok: stored === password, upgrade: stored === password, first: false };
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return { ok: false, upgrade: false, first: false };
  const [, salt, hashHex] = parts;
  const hash = await scryptAsync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (hash.length !== storedBuf.length) return { ok: false, upgrade: false, first: false };
  const ok = crypto.timingSafeEqual(hash, storedBuf);
  return { ok, upgrade: false, first: false };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (await isRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  }

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
    const { ok, upgrade, first } = await verifyPassword(password, u.password || '');

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

    const SESSION_SECRET = process.env.SESSION_SECRET;
    let session_token = null;
    if (SESSION_SECRET && u.cliente_id) {
      const expires = Date.now() + 8 * 60 * 60 * 1000;
      const payload = `${u.cliente_id}:${u.rol}:${expires}`;
      const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
      session_token = `${payload}.${sig}`;
    }

    return res.status(200).json({
      ok: true,
      usuario: u.email || u.username,
      nombre: u.nombre,
      rol: u.rol,
      destino: u.destino,
      cliente_id: u.cliente_id,
      session_token,
      debe_cambiar: first || false,
    });

  } catch (err) {
    console.error('login error');
    return res.status(500).json({ error: 'Error interno' });
  }
}
