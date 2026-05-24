import crypto from 'crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: 'Faltan credenciales' });

  const SA_USER = process.env.SA_USER;
  const SA_PASS = process.env.SA_PASS;
  const SA_SECRET = process.env.SA_SECRET;

  if (!SA_USER || !SA_PASS || !SA_SECRET) {
    return res.status(500).json({ error: 'Servidor no configurado correctamente' });
  }

  if (user !== SA_USER || pass !== SA_PASS) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const expires = Date.now() + 8 * 60 * 60 * 1000; // 8 horas
  const payload = String(expires);
  const sig = crypto.createHmac('sha256', SA_SECRET).update(payload).digest('hex');

  return res.status(200).json({ token: `${payload}.${sig}` });
}
