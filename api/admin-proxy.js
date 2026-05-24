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

export default async function handler(req, res) {
  if (!verifyToken(req.headers['x-sa-token'])) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;

  if (!ADMIN_TOKEN || !FUNCTIONS_URL) {
    return res.status(500).json({ error: 'Servidor no configurado correctamente' });
  }

  const action = req.query.action;
  const url = `${FUNCTIONS_URL}/admin-clientes?action=${action}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify(req.body || {}),
  });

  const data = await response.json();
  return res.status(response.status).json(data);
}
